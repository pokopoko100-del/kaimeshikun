// src/lib/ingredientMasterEdit.ts（新規作成）
// 材料ページからの「AIで材料を追加」「材料を編集」「この材料を使うレシピを探す」の共通部品
//   ・追加：材料名をテキストで入力 → AIで栄養素・価格・旬・単位を推定 → 確認・修正 → 登録（レシピ取り込みと同じ画面）
//   ・編集：今の値を入れた同じ画面で直す。「AIで再取得」で、栄養素・価格・旬・単位をAIの推定値に置き換えられる
//   ・編集の保存は、材料マスタ（ingredient_master）と単位（ingredient_units）を更新する。途中で失敗したら、元に戻す
//   ・レシピ検索：材料マスタに結び付いているレシピ（と、名前が同じで未結び付けのレシピ）を探す
import { supabase } from '../supabaseClient'
import type { IngredientMaster } from '../types/ingredient'
import type { CallFailure } from './callFunction'
import { errorText } from './errorText'
import type { IngredientAnalysis, RegisterPlan, RegItem, RegUnit } from './ingredientRegister'
import { NUTRIENTS, analyzeIngredients, emptyNutrients, normalizeUnits, parseNum } from './ingredientRegister'
import type { MasterOption } from './recipeImport'
import { fmtUsage, newKey, normName, normUnit, splitPrep } from './recipeImport'

// ---------- 追加：名前の入力を読み取る ----------
export const MAX_ADD_ITEMS = 30 // 一度に分析できる材料の数（関数側の上限と同じ）

// 改行・カンマ（、，,）・セミコロンで区切る。先頭の「・」「-」「1.」などの飾りと、末尾の（　）の下ごしらえは取り除く
export function parseNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n\r,、，;；]+/)) {
    let t = raw.trim()
    t = t.replace(/^[・\-*•●○■□▪‣\s]+/, '').replace(/^\d+[.)．）]\s*/, '')
    t = splitPrep(t, '').name.trim()
    if (!t) continue
    if (t.length > 40) t = t.slice(0, 40)
    const k = normName(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export type AddPlanResult = {
  plan: RegisterPlan
  existing: { name: string; masterId: string; masterName: string }[] // すでに材料マスタにある名前（登録しない）
  tooMany: boolean
}

export function buildAddPlan(text: string, masters: { id: string; name: string }[]): AddPlanResult {
  const byName = new Map(masters.map((m) => [normName(m.name), m]))
  const items: RegItem[] = []
  const existing: AddPlanResult['existing'] = []

  for (const name of parseNames(text)) {
    const hit = byName.get(normName(name))
    if (hit) {
      existing.push({ name, masterId: hit.id, masterName: hit.name })
      continue
    }
    items.push({
      key: `n:${normName(name)}`,
      match: normName(name),
      name,
      usage: '',
      usages: [],
      checked: true,
      linkTo: '',
      category: 'その他',
      price: '',
      peakMonths: [],
      units: [],
      nutrients: emptyNutrients(),
      warnings: [],
      aiOk: false,
      masterId: null,
      brand: '',
      product: '',
      store: '',
      note: '',
      source: 'ai_estimate',
    })
  }
  return { plan: { items: items.slice(0, MAX_ADD_ITEMS), unitAdds: [] }, existing, tooMany: items.length > MAX_ADD_ITEMS }
}

// 入力した名前に近い（含まれ合う）既存の材料。二重に登録しないための目印として出す
export function nearMasters(name: string, masters: MasterOption[], limit = 3): MasterOption[] {
  const n = normName(name)
  if (n.length < 2) return []
  return masters
    .filter((m) => {
      const mn = normName(m.name)
      return mn !== n && mn.length >= 2 && (mn.includes(n) || n.includes(mn))
    })
    .slice(0, limit)
}

// ---------- 編集：今の値を、登録画面と同じ形にする ----------
export type UnitDbRow = {
  id: string
  ingredient_master_id: string
  unit: string
  weight_g: number
  is_default: boolean
  sort_order: number
}

// 基準の単位が先頭 → 並び順 → 名前順（材料ページの単位編集と同じ並び）
function sortUnits(rows: UnitDbRow[]): UnitDbRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order || a.unit.localeCompare(b.unit, 'ja'),
  )
}

export function masterToRegItem(m: IngredientMaster, units: UnitDbRow[]): RegItem {
  const nutrients = emptyNutrients()
  const rec = m as unknown as Record<string, unknown>
  for (const n of NUTRIENTS) {
    const v = rec[n.col]
    nutrients[n.col] = typeof v === 'number' ? String(v) : v == null || v === '' ? '' : String(v)
  }
  const regUnits: RegUnit[] = sortUnits(units).map((u) => {
    const isG = normUnit(u.unit) === 'g'
    return {
      key: newKey(),
      id: u.id,
      unit: u.unit,
      weight: isG ? '1' : String(u.weight_g),
      isDefault: u.is_default,
      fixed: isG,
    }
  })
  return {
    key: `e:${m.id}`,
    match: normName(m.ingredient_name),
    name: m.ingredient_name,
    usage: '',
    usages: [],
    checked: true,
    linkTo: '',
    category: m.category,
    price: m.price_per_100g == null ? '' : String(m.price_per_100g),
    peakMonths: [...(m.peak_season_months ?? [])].sort((a, b) => a - b),
    units: regUnits,
    nutrients,
    warnings: [],
    aiOk: true,
    masterId: m.id,
    brand: m.brand_name ?? '',
    product: m.usual_product_name ?? '',
    store: m.store_name ?? '',
    note: m.note ?? '',
    source: m.nutrition_source ?? 'ai_estimate',
  }
}

export async function fetchUnitsFor(masterId: string): Promise<UnitDbRow[]> {
  const { data, error } = await supabase
    .from('ingredient_units')
    .select('id, ingredient_master_id, unit, weight_g, is_default, sort_order')
    .eq('ingredient_master_id', masterId)
  if (error) throw error
  return ((data ?? []) as UnitDbRow[]).map((r) => ({ ...r, weight_g: Number(r.weight_g) }))
}

// ---------- 編集：AIで再取得 ----------
type ServerItem = IngredientAnalysis['items'][number]

// AIの結果を、編集中の材料に取り込む。名前・銘柄・いつもの商品・購入店・メモは、そのまま残す
//   ・AIが出せなかった項目（空欄・重さ不明）は、今の値を残す
//   ・今ある単位は、AIの結果に無くても残す（レシピで使っている単位を、勝手に消さないため）
export function mergeRefetch(item: RegItem, s: ServerItem | undefined): RegItem {
  if (!s || s.ai_ok === false) {
    return {
      ...item,
      warnings: [...(s?.warnings ?? ['AIが結果を返しませんでした。もう一度お試しください'])],
    }
  }

  const nutrients = { ...item.nutrients }
  for (const n of NUTRIENTS) {
    const v = s.nutrients?.[n.col]
    if (v != null) nutrients[n.col] = String(v)
  }

  const old = new Map(item.units.map((u) => [normUnit(u.unit), u]))
  const units: RegUnit[] = []
  const seen = new Set<string>()

  // gの行（fixed）は、先頭に残す
  for (const u of item.units) {
    if (u.fixed) {
      units.push({ ...u })
      seen.add('g')
    }
  }
  for (const u of s.units ?? []) {
    const name = normUnit(u.unit)
    if (!name || name === 'g' || seen.has(name)) continue
    seen.add(name)
    const prev = old.get(name)
    const weight = u.weight_g != null ? String(u.weight_g) : (prev?.weight ?? '')
    units.push({ key: prev?.key ?? newKey(), id: prev?.id, unit: u.unit, weight, isDefault: false })
  }
  for (const u of item.units) {
    const name = normUnit(u.unit)
    if (u.fixed || !name || seen.has(name)) continue
    seen.add(name)
    units.push({ ...u, isDefault: false })
  }

  // 基準の単位：今の基準が残っていればそのまま。無ければAIの基準 → 先頭
  const curDef = item.units.find((u) => u.isDefault)
  const aiDef = (s.units ?? []).find((u) => u.is_default)
  const want = normUnit(curDef?.unit ?? aiDef?.unit ?? '')
  const idx = units.findIndex((u) => (u.fixed ? 'g' : normUnit(u.unit)) === want)
  const defIdx = idx >= 0 ? idx : units.length > 0 ? 0 : -1
  const finalUnits = units.map((u, i) => ({ ...u, isDefault: i === defIdx }))

  const price = s.price_per_100g != null ? String(s.price_per_100g) : item.price

  return {
    ...item,
    aiOk: true,
    category: s.category && s.category.length > 0 ? s.category : item.category,
    price,
    peakMonths: s.peak_season_months ?? item.peakMonths,
    units: finalUnits,
    nutrients,
    warnings: s.warnings ?? [],
    source: 'ai_estimate',
  }
}

export type RefetchResult = { ok: true; item: RegItem } | CallFailure

export async function refetchItem(item: RegItem): Promise<RefetchResult> {
  // 今ある単位を「使い方」として渡すと、AIがその単位の重さも答える
  const usages = item.units
    .filter((u) => !u.fixed && u.unit.trim() !== '')
    .map((u) => ({ quantity: '1', unit: normUnit(u.unit) }))
  const plan: RegisterPlan = { items: [{ ...item, usages }], unitAdds: [] }
  const r = await analyzeIngredients(plan, '')
  if (!r.ok) return r
  return { ok: true, item: mergeRefetch(item, r.analysis.items.find((i) => i.key === item.key)) }
}

// ---------- 編集：保存 ----------
export async function countUnitUsage(masterId: string, units: string[]): Promise<number> {
  if (units.length === 0) return 0
  const { count, error } = await supabase
    .from('ingredients')
    .select('id', { count: 'exact', head: true })
    .eq('ingredient_master_id', masterId)
    .in('unit', units)
  if (error) throw error
  return count ?? 0
}

type Undo = () => Promise<void>

// 編集を保存する。戻り値：'saved'（保存した）／'cancelled'（確認で中止した）
//   順番：① 材料マスタ本体 → ② 基準の解除 → ③ 単位の削除 → ④ 単位の更新（名前・重さ・基準）→ ⑤ 単位の追加
//   途中で失敗したら、行った操作を逆の順に取り消す
export async function saveEdit(
  item: RegItem,
  original: { master: IngredientMaster; units: UnitDbRow[] },
  confirmFn: (message: string) => boolean,
): Promise<'saved' | 'cancelled'> {
  const masterId = item.masterId
  if (!masterId) throw new Error('編集する材料が分かりません')
  const name = item.name.trim()
  if (!name) throw new Error('材料名を入力してください')

  const final = normalizeUnits(item.units)
  const origById = new Map(original.units.map((u) => [u.id, u]))
  const keptIds = new Set(final.filter((f) => f.id && origById.has(f.id)).map((f) => f.id as string))
  const toDelete = original.units.filter((u) => !keptIds.has(u.id) && normUnit(u.unit) !== 'g')

  // 削除・名前の変更で、レシピの材料が「未計算」になるときは、確認する
  const gone = new Set(toDelete.map((u) => u.unit))
  for (const f of final) {
    const o = f.id ? origById.get(f.id) : undefined
    if (o && o.unit !== f.unit) gone.add(o.unit)
  }
  if (gone.size > 0) {
    const used = await countUnitUsage(masterId, [...gone])
    if (used > 0) {
      const ok = confirmFn(
        `削除・名前を変えた単位（${[...gone].join('・')}）は、レシピの材料 ${used} 件で使われています。保存すると、その材料が「未計算」になります。それでも保存しますか？`,
      )
      if (!ok) return 'cancelled'
    }
  }

  const def = final.find((f) => f.isDefault)
  const peak = [...item.peakMonths].sort((a, b) => a - b)
  const payload: Record<string, unknown> = {
    ingredient_name: name,
    category: item.category,
    price_per_100g: parseNum(item.price),
    peak_season_months: peak.length > 0 ? peak : null,
    brand_name: item.brand.trim() || null,
    usual_product_name: item.product.trim() || null,
    store_name: item.store.trim() || null,
    note: item.note.trim() || null,
    nutrition_source: item.source || original.master.nutrition_source || 'ai_estimate',
    default_unit: def ? def.unit : 'g',
    unit_weight_g: def ? (def.unit === 'g' ? 1 : def.weight) : 1,
    updated_at: new Date().toISOString(),
  }
  for (const n of NUTRIENTS) payload[n.col] = parseNum(item.nutrients[n.col])

  const undo: Undo[] = []
  try {
    // ① 材料マスタ本体（名前の重複はここで分かるので、いちばん先に行う）
    const before: Record<string, unknown> = {}
    const origRec = original.master as unknown as Record<string, unknown>
    for (const k of Object.keys(payload)) before[k] = origRec[k] ?? null
    {
      const { data, error } = await supabase.from('ingredient_master').update(payload).eq('id', masterId).select('id')
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error(`「${name}」は、材料マスタにほかの材料としてすでにあります。名前を変えてください`)
        }
        throw error
      }
      if (!data || data.length === 0) throw new Error('材料を更新できませんでした（権限を確認してください）')
      undo.push(async () => {
        const { error: e } = await supabase.from('ingredient_master').update(before).eq('id', masterId)
        if (e) throw e
      })
    }

    // ② 基準でなくなる単位の、基準を外す（基準は1材料に1つだけなので、新しい基準を付ける前に外す）
    for (const f of final) {
      const o = f.id ? origById.get(f.id) : undefined
      if (o && o.is_default && !f.isDefault) {
        const { data, error } = await supabase.from('ingredient_units').update({ is_default: false }).eq('id', o.id).select('id')
        if (error) throw error
        if (!data || data.length === 0) throw new Error('単位を更新できませんでした（権限を確認してください）')
        undo.push(async () => {
          const { error: e } = await supabase.from('ingredient_units').update({ is_default: true }).eq('id', o.id)
          if (e) throw e
        })
      }
    }

    // ③ 単位の削除
    for (const o of toDelete) {
      const { data, error } = await supabase.from('ingredient_units').delete().eq('id', o.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('単位を削除できませんでした（権限を確認してください）')
      undo.push(async () => {
        const { error: e } = await supabase.from('ingredient_units').insert({
          id: o.id,
          ingredient_master_id: o.ingredient_master_id,
          unit: o.unit,
          weight_g: o.weight_g,
          is_default: o.is_default,
          sort_order: o.sort_order,
        })
        if (e) throw e
      })
    }

    // ④ 単位の更新（名前・重さ・基準。並び順は、画面で入れ替えられないので、そのままにする）
    for (const f of final) {
      const o = f.id ? origById.get(f.id) : undefined
      if (!o) continue
      const patch: Record<string, unknown> = {}
      const back: Record<string, unknown> = {}
      if (o.unit !== f.unit && normUnit(o.unit) !== 'g') {
        patch.unit = f.unit
        back.unit = o.unit
      }
      if (normUnit(o.unit) !== 'g' && o.weight_g !== f.weight) {
        patch.weight_g = f.weight
        back.weight_g = o.weight_g
      }
      if (!o.is_default && f.isDefault) {
        patch.is_default = true
        back.is_default = false
      }
      if (Object.keys(patch).length === 0) continue
      const { data, error } = await supabase.from('ingredient_units').update(patch).eq('id', o.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('単位を更新できませんでした（権限を確認してください）')
      undo.push(async () => {
        const { error: e } = await supabase.from('ingredient_units').update(back).eq('id', o.id)
        if (e) throw e
      })
    }

    // ⑤ 単位の追加（並び順は、今ある単位のあとに続ける）
    let order = original.units.reduce((m, u) => Math.max(m, u.sort_order), -1)
    const adds = final
      .filter((f) => !(f.id && origById.has(f.id)))
      .map((f) => ({
        ingredient_master_id: masterId,
        unit: f.unit,
        weight_g: f.weight,
        is_default: f.isDefault,
        sort_order: ++order,
      }))
    if (adds.length > 0) {
      const { data, error } = await supabase.from('ingredient_units').insert(adds).select('id')
      if (error) throw error
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
      if (ids.length !== adds.length) throw new Error('単位を追加できませんでした（権限を確認してください）')
      undo.push(async () => {
        const { error: e } = await supabase.from('ingredient_units').delete().in('id', ids)
        if (e) throw e
      })
    }
  } catch (e) {
    let rollbackFailed = false
    for (const u of undo.reverse()) {
      try {
        await u()
      } catch (e2) {
        console.error(e2)
        rollbackFailed = true
      }
    }
    if (rollbackFailed) {
      throw new Error(`${errorText(e)}（元に戻す処理にも失敗しました。材料を開き直して、内容を確認してください）`)
    }
    throw e
  }
  return 'saved'
}

// ---------- この材料を使うレシピを探す ----------
export type RecipeBrief = {
  id: string
  dish_name: string
  source_name: string | null
  genre: string | null
  category: string | null
  image_path: string | null
  cooking_time_minutes: number | null
  cook_count: number
}
export type RecipeUsage = {
  recipe: RecipeBrief
  amounts: string[] // この材料の分量（例：大さじ2、100g）
  linked: boolean // 材料マスタに結び付いている（false＝名前が同じだけで、未結び付け）
}

type UsageRaw = {
  quantity: string | null
  unit: string | null
  recipe_id: string
  recipes: RecipeBrief | RecipeBrief[] | null
}

const RECIPE_COLS = 'id, dish_name, source_name, genre, category, image_path, cooking_time_minutes, cook_count'

export async function fetchRecipesUsing(master: { id: string; name: string }): Promise<RecipeUsage[]> {
  const sel = `quantity, unit, recipe_id, recipes(${RECIPE_COLS})`
  const [linked, byName] = await Promise.all([
    supabase.from('ingredients').select(sel).eq('ingredient_master_id', master.id),
    // 結び付けていないレシピでも、材料名が同じなら拾う
    supabase.from('ingredients').select(sel).is('ingredient_master_id', null).eq('ingredient_name', master.name),
  ])
  if (linked.error) throw linked.error
  // 名前での検索に失敗しても、結び付いているレシピは表示する
  if (byName.error) console.error(byName.error)

  const map = new Map<string, RecipeUsage>()
  const add = (rows: UsageRaw[], isLinked: boolean) => {
    for (const r of rows) {
      const rec = Array.isArray(r.recipes) ? r.recipes[0] : r.recipes
      if (!rec) continue
      const amount = fmtUsage(r.quantity ?? '', r.unit ?? '')
      const hit = map.get(rec.id)
      if (hit) {
        if (amount && !hit.amounts.includes(amount)) hit.amounts.push(amount)
        if (isLinked) hit.linked = true
      } else {
        map.set(rec.id, { recipe: rec, amounts: amount ? [amount] : [], linked: isLinked })
      }
    }
  }
  add((linked.data ?? []) as unknown as UsageRaw[], true)
  add((byName.data ?? []) as unknown as UsageRaw[], false)

  // 作った回数が多い順 → 料理名順
  return [...map.values()].sort(
    (a, b) => b.recipe.cook_count - a.recipe.cook_count || a.recipe.dish_name.localeCompare(b.recipe.dish_name, 'ja'),
  )
}
