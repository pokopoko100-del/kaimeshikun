// src/lib/menuAnalysis.ts（新規作成）
// 献立の「分析」の計算・保存・候補の検索
//   ・対象：確定した料理（購入済も含む）。分析した結果は端末に保存し、確定の料理が変わるまで残す
//     （確定の料理・何人前つくるか・1人前のカロリー/値段のどれかが変わると、目印が変わって結果はリセット）
//   ・1人1食あたり ＝（料理の1人前の値 × 何人前つくるか の合計 ＋ 主食 × 人数 × 食事回数）÷（食事回数 × 人数）
//   ・目安は nutritionTarget.ts（日本人の食事摂取基準 2025年版）。家族の平均の「1人1食」と比べる
import { supabase } from '../supabaseClient'
import { callFunction } from './callFunction'
import type { CallFailure } from './callFunction'
import { fetchMealShare, fetchPeople, fetchStaples } from './family'
import { fetchDefaultPlanServings, getHouseholdId } from './household'
import type { NutrientKey, Person } from './nutritionTarget'
import { ANALYSIS_NUTRIENTS, perMealTargets } from './nutritionTarget'

export const MEAL_CATEGORIES = ['主菜', '麺・丼・ワンプレート']
const STORAGE_KEY = 'kaimeshi.menuAnalysis.v1'

export type DishInput = {
  id: string
  dish_name: string
  category: string | null
  planned: number // 何人前つくるか
  kcal: number | null // 1人前（目印に使う）
  price: number | null
}

// 確定の料理の「目印」。これが変わったら、保存した結果は使わない
export function fingerprint(dishes: DishInput[]): string {
  return [...dishes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => `${d.id}:${d.planned}:${d.kcal ?? '-'}:${d.price ?? '-'}`)
    .join('|')
}

export function estimateMeals(dishes: DishInput[]): number {
  return dishes.filter((d) => d.category != null && MEAL_CATEGORIES.includes(d.category)).length
}

// ---------- 分析に使うデータ ----------
export type StapleOption = {
  id: string
  name: string
  amount_g: number
  is_default: boolean
  per100: Record<string, number | null> // 材料マスタの100gあたり（calorie・price・各栄養素）
}

export type AnalysisContext = {
  people: Person[]
  peopleCount: number // 計算に使う人数（家族が未登録なら、設定画面の人数）
  familyRegistered: boolean
  mealShare: number
  staples: StapleOption[]
}

const MASTER_COLS = ['calorie_per_100g', 'price_per_100g', ...ANALYSIS_NUTRIENTS.map((n) => n.col)]

export async function fetchAnalysisContext(userId: string): Promise<AnalysisContext> {
  const householdId = await getHouseholdId(userId)
  let people: Person[] = []
  let staples: StapleOption[] = []
  try {
    people = (await fetchPeople(householdId)).map((p) => ({
      sex: p.sex,
      age: p.age,
      height_cm: p.height_cm,
      weight_kg: p.weight_kg,
      activity: p.activity,
    }))
  } catch (e) {
    console.error(e) // 15のSQLが未実行でも、平均値で分析できるようにする
  }
  try {
    const rows = await fetchStaples(householdId)
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from('ingredient_master')
        .select(`id, ingredient_name, ${MASTER_COLS.join(', ')}`)
        .in('id', rows.map((r) => r.ingredient_master_id))
      if (error) throw error
      const byId = new Map(((data ?? []) as unknown as Record<string, unknown>[]).map((m) => [String(m.id), m]))
      staples = rows
        .filter((r) => byId.has(r.ingredient_master_id))
        .map((r) => {
          const m = byId.get(r.ingredient_master_id) as Record<string, unknown>
          return {
            id: r.id,
            name: String(m.ingredient_name),
            amount_g: r.amount_g,
            is_default: r.is_default,
            per100: Object.fromEntries(MASTER_COLS.map((c) => [c, typeof m[c] === 'number' ? (m[c] as number) : m[c] == null ? null : Number(m[c])])),
          }
        })
    }
  } catch (e) {
    console.error(e)
  }
  const mealShare = await fetchMealShare(householdId)
  const peopleCount = people.length > 0 ? people.length : await fetchDefaultPlanServings(householdId)
  return { people, peopleCount, familyRegistered: people.length > 0, mealShare, staples }
}

// 料理の1人前の値（recipe_nutrition）
export async function fetchDishNutrition(ids: string[]): Promise<Map<string, Record<string, number | null>>> {
  const map = new Map<string, Record<string, number | null>>()
  if (ids.length === 0) return map
  const { data, error } = await supabase.from('recipe_nutrition').select('*').in('recipe_id', ids)
  if (error) throw error
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const rec: Record<string, number | null> = {}
    for (const [k, v] of Object.entries(row)) rec[k] = typeof v === 'number' ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null
    map.set(String(row.recipe_id), rec)
  }
  return map
}

// ---------- 計算 ----------
export type ItemStatus = 'short' | 'low' | 'ok' | 'over'
export type AnalysisItem = { key: NutrientKey; label: string; unit: string; col: string; ratio: number; status: ItemStatus }

export type AnalysisResult = {
  fingerprint: string
  createdAt: string
  meals: number
  peopleCount: number
  familyRegistered: boolean
  stapleNames: string[] // 食事ごとの主食（無しは「なし」）
  perMeal: { kcal: number; price: number } // 1人1食あたり
  targetKcal: number // 1人1食の目安
  items: AnalysisItem[]
  uncertain: boolean // 値が無い料理・未計算の材料がある
  dishes: { name: string; category: string | null }[]
  ai?: AiAdvice | null
}

const status = (kind: 'min' | 'max', ratio: number): ItemStatus => {
  if (kind === 'max') return ratio > 1 ? 'over' : 'ok'
  if (ratio < 0.5) return 'short'
  if (ratio < 0.8) return 'low'
  return 'ok'
}

export function computeAnalysis(args: {
  dishes: DishInput[]
  nutrition: Map<string, Record<string, number | null>>
  ctx: AnalysisContext
  meals: number
  stapleChoice: (string | null)[] // 食事ごとの主食ID（null＝なし）
}): AnalysisResult {
  const { dishes, nutrition, ctx, meals, stapleChoice } = args
  const people = Math.max(1, ctx.peopleCount)
  const totals: Record<string, number> = { kcal: 0, price: 0 }
  let uncertain = false
  const add = (k: string, v: number | null | undefined, times: number) => {
    if (v == null || !Number.isFinite(v)) return
    totals[k] = (totals[k] ?? 0) + v * times
  }

  for (const d of dishes) {
    const n = nutrition.get(d.id)
    if (!n) {
      uncertain = true
      continue
    }
    if ((n.unresolved_count ?? 0) > 0) uncertain = true
    add('kcal', n.calorie_per_serving, d.planned)
    add('price', n.price_per_serving, d.planned)
    for (const a of ANALYSIS_NUTRIENTS) add(a.key, n[a.col.replace('_per_100g', '_per_serving')], d.planned)
  }

  const stapleById = new Map(ctx.staples.map((s) => [s.id, s]))
  const stapleNames: string[] = []
  for (let i = 0; i < meals; i++) {
    const s = stapleChoice[i] ? stapleById.get(stapleChoice[i] as string) : undefined
    stapleNames.push(s ? s.name : 'なし')
    if (!s) continue
    const f = (s.amount_g / 100) * people
    add('kcal', s.per100.calorie_per_100g, f)
    add('price', s.per100.price_per_100g, f)
    for (const a of ANALYSIS_NUTRIENTS) add(a.key, s.per100[a.col], f)
  }

  const denom = Math.max(1, meals) * people
  const target = perMealTargets(ctx.people, ctx.mealShare)
  const items: AnalysisItem[] = ANALYSIS_NUTRIENTS.map((a) => {
    const t = target.nutrients[a.key]
    const v = (totals[a.key] ?? 0) / denom
    const ratio = t.value > 0 ? v / t.value : 1
    return { ...a, ratio, status: status(t.kind, ratio) }
  })

  return {
    fingerprint: fingerprint(dishes),
    createdAt: new Date().toISOString(),
    meals,
    peopleCount: people,
    familyRegistered: ctx.familyRegistered,
    stapleNames,
    perMeal: { kcal: totals.kcal / denom, price: totals.price / denom },
    targetKcal: target.kcal,
    items,
    uncertain,
    dishes: dishes.map((d) => ({ name: d.dish_name, category: d.category })),
    ai: null,
  }
}

// ---------- 端末への保存 ----------
export function loadSaved(fp: string): AnalysisResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as AnalysisResult
    if (r.fingerprint !== fp) {
      localStorage.removeItem(STORAGE_KEY) // 確定の料理が変わったのでリセット
      return null
    }
    return r
  } catch {
    return null
  }
}

export function saveResult(r: AnalysisResult): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r))
  } catch (e) {
    console.error(e)
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 何もしない */
  }
}

// ---------- 栄養素が多いレシピ・材料（上位5件） ----------
export type TopRecipe = { id: string; name: string; value: number }
export type TopIngredient = { id: string; name: string; category: string; value: number }

export async function topRecipes(col: string): Promise<TopRecipe[]> {
  const servingCol = col.replace('_per_100g', '_per_serving')
  const { data, error } = await supabase
    .from('recipe_nutrition')
    .select(`recipe_id, ${servingCol}`)
    .gt(servingCol, 0)
    .order(servingCol, { ascending: false })
    .limit(5)
  if (error) throw error
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  if (rows.length === 0) return []
  const ids = rows.map((r) => String(r.recipe_id))
  const { data: rec, error: e2 } = await supabase.from('recipes').select('id, dish_name').in('id', ids)
  if (e2) throw e2
  const names = new Map(((rec ?? []) as { id: string; dish_name: string }[]).map((r) => [r.id, r.dish_name]))
  return rows.map((r) => ({ id: String(r.recipe_id), name: names.get(String(r.recipe_id)) ?? '（名前なし）', value: Number(r[servingCol]) }))
}

export async function topIngredients(col: string): Promise<TopIngredient[]> {
  const { data, error } = await supabase
    .from('ingredient_master')
    .select(`id, ingredient_name, category, ${col}`)
    .gt(col, 0)
    .neq('category', '日用品')
    .order(col, { ascending: false })
    .limit(5)
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.ingredient_name),
    category: String(r.category),
    value: Number(r[col]),
  }))
}

// ---------- AIの提案（選んだときだけ） ----------
export type AiAdvice = { summary: string; items: { nutrient: string; advice: string }[] }

export async function requestAiAdvice(r: AnalysisResult): Promise<{ ok: true; advice: AiAdvice } | CallFailure> {
  const shortages = r.items
    .filter((i) => i.status === 'short' || i.status === 'low')
    .map((i) => ({ nutrient: i.label, level: i.status === 'short' ? '不足' : 'やや不足' }))
  const excess = r.items.filter((i) => i.status === 'over').map((i) => i.label)
  const res = await callFunction<{ advice?: AiAdvice }>('analyze-menu', {
    meals: r.meals,
    people: r.peopleCount,
    dishes: r.dishes,
    staples: r.stapleNames,
    shortages,
    excess,
  })
  if (!res.ok) return res
  if (!res.advice) return { ok: false, code: null, message: 'AIから結果が返りませんでした' }
  return { ok: true, advice: res.advice }
}
