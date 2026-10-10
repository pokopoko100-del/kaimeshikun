// src/lib/ingredientRegister.ts（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：材料ページからの追加・編集でも使えるようにした
//   ・RegItem に、既存材料のID（masterId）・銘柄・いつもの商品・購入店・メモ・データ出典を追加
//   ・RegUnit に、既存の単位のID（id）と、gの行（fixed：重さ1g固定）を追加
//   ・名前の重複チェックは、編集中の材料自身を除く
// レシピ取り込みの「材料の登録」の共通部品
//   ・AIが読み取ったレシピに、材料マスタに無い材料（や、マスタに無い単位）があるとき、
//     先に材料マスタへ登録する。栄養素・カロリー・価格・旬・単位（1単位が何gか）は、AIが推定する
//   ・AIの推定は Supabase の関数 analyze-ingredients（自分のGeminiキーで動く）。この関数は「推定するだけ」で保存はしない
//   ・登録は、この画面から ingredient_master → ingredient_units の順に行う（途中で失敗したら、登録したぶんを消して元に戻す）
//   ・AIが推定した材料は、nutrition_source = 'ai_estimate'（AI推定）として保存する
import { supabase } from '../supabaseClient'
import { callFunction } from './callFunction'
import type { CallFailure } from './callFunction'
import { DEFAULT_CATEGORY_ORDER } from './categoryOrder'
import { getHouseholdId } from './household'
import type { Draft, MasterOption } from './recipeImport'
import { fmtUsage, newKey, normName, normUnit, rowStatus } from './recipeImport'

// ---------- 栄養素（材料マスタの列。すべて「100gあたり」） ----------
export const NUTRIENTS = [
  { col: 'calorie_per_100g', label: 'カロリー', unit: 'kcal' },
  { col: 'protein_g_per_100g', label: 'たんぱく質', unit: 'g' },
  { col: 'fat_g_per_100g', label: '脂質', unit: 'g' },
  { col: 'carbohydrate_g_per_100g', label: '炭水化物', unit: 'g' },
  { col: 'sugar_g_per_100g', label: '糖質', unit: 'g' },
  { col: 'dietary_fiber_g_per_100g', label: '食物繊維', unit: 'g' },
  { col: 'salt_g_per_100g', label: '食塩相当量', unit: 'g' },
  { col: 'vitamin_a_ug_per_100g', label: 'ビタミンA', unit: 'µg' },
  { col: 'vitamin_b1_mg_per_100g', label: 'ビタミンB1', unit: 'mg' },
  { col: 'vitamin_b2_mg_per_100g', label: 'ビタミンB2', unit: 'mg' },
  { col: 'vitamin_b6_mg_per_100g', label: 'ビタミンB6', unit: 'mg' },
  { col: 'vitamin_b12_ug_per_100g', label: 'ビタミンB12', unit: 'µg' },
  { col: 'vitamin_c_mg_per_100g', label: 'ビタミンC', unit: 'mg' },
  { col: 'vitamin_d_ug_per_100g', label: 'ビタミンD', unit: 'µg' },
  { col: 'vitamin_e_mg_per_100g', label: 'ビタミンE', unit: 'mg' },
  { col: 'folate_ug_per_100g', label: '葉酸', unit: 'µg' },
  { col: 'calcium_mg_per_100g', label: 'カルシウム', unit: 'mg' },
  { col: 'iron_mg_per_100g', label: '鉄', unit: 'mg' },
  { col: 'zinc_mg_per_100g', label: '亜鉛', unit: 'mg' },
  { col: 'potassium_mg_per_100g', label: 'カリウム', unit: 'mg' },
  { col: 'magnesium_mg_per_100g', label: 'マグネシウム', unit: 'mg' },
] as const

export type NutrientCol = (typeof NUTRIENTS)[number]['col']
export type NutrientForm = Record<NutrientCol, string>

export function emptyNutrients(): NutrientForm {
  return Object.fromEntries(NUTRIENTS.map((n) => [n.col, ''])) as NutrientForm
}

export const CATEGORY_OPTIONS = DEFAULT_CATEGORY_ORDER

// ---------- 型 ----------
// id：編集のとき、すでにDBにある単位の行のID（名前を変えたときも、同じ行として更新するため）
// fixed：gの行（重さは1g固定。名前・重さを直したり、削除したりできない。基準にはできる）
export type RegUnit = { key: string; unit: string; weight: string; isDefault: boolean; id?: string; fixed?: boolean }

// 新しく登録する材料
export type RegItem = {
  key: string // 'n:' + 正規化した名前
  match: string // レシピの材料名（正規化したもの）。レシピ側の材料と結び付けるのに使う
  name: string // 登録する名前（直せる）
  usage: string // レシピでの使い方の表示（例：1枚、大さじ2）
  usages: { quantity: string; unit: string }[]
  checked: boolean // 登録する
  linkTo: string // 「既存の材料にまとめる」で選んだ材料のID（空なら新規登録）
  category: string
  price: string // 100gあたりの円
  peakMonths: number[] // 旬の月（空なら通年）
  units: RegUnit[] // 単位（gは含めない）
  nutrients: NutrientForm
  warnings: string[]
  aiOk: boolean
  masterId: string | null // 編集中の既存材料のID（新しく登録する材料は null）
  brand: string // 銘柄（調味料など）
  product: string // いつもの商品名
  store: string // 購入店
  note: string // メモ
  source: string // データ出典（standard_table / label / ai_estimate）
}

// すでにある材料に、単位を1つ足す
export type UnitAddItem = {
  key: string // 'u:' + 材料ID + '|' + 単位
  masterId: string
  masterName: string
  unit: string
  quantity: string // レシピでの分量（AIへのヒント）
  usage: string
  weight: string // 1単位が何gか
  checked: boolean
  aiOk: boolean
  note: string
}

export type RegisterPlan = { items: RegItem[]; unitAdds: UnitAddItem[] }

// ---------- 何を登録するかを決める ----------
export function buildPlan(draft: Draft, masters: MasterOption[]): RegisterPlan {
  const masterMap = new Map(masters.map((m) => [m.id, m]))
  const items = new Map<string, RegItem>()
  const unitAdds = new Map<string, UnitAddItem>()

  for (const ing of draft.ingredients) {
    const name = ing.name.trim()
    if (!name) continue
    const unit = normUnit(ing.unit)
    const usageText = fmtUsage(ing.quantity, unit)

    if (!ing.masterId) {
      // マスタに無い材料（同じ名前の行は、1つにまとめる）
      const match = normName(name)
      let it = items.get(match)
      if (!it) {
        it = {
          key: `n:${match}`,
          match,
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
          note: 'レシピ取り込み時にAIが推定した値',
          source: 'ai_estimate',
        }
        items.set(match, it)
      }
      it.usages.push({ quantity: ing.quantity.trim(), unit })
      if (usageText) it.usage = it.usage ? `${it.usage}、${usageText}` : usageText
      // AIが答えられなかったときのために、使われている単位だけ、重さ空欄の行を用意しておく
      if (unit && unit !== 'g' && !it.units.some((u) => u.unit === unit)) {
        it.units.push({ key: newKey(), unit, weight: '', isDefault: it.units.length === 0 })
      }
      continue
    }

    // マスタにある材料で、単位だけが合わないもの
    const master = masterMap.get(ing.masterId)
    if (!master) continue
    if (rowStatus(ing.quantity, unit, master) === 'unit_unknown' && unit && unit !== 'g') {
      const key = `u:${master.id}|${unit}`
      const ua = unitAdds.get(key)
      if (ua) {
        if (usageText) ua.usage = `${ua.usage}、${usageText}`
      } else {
        unitAdds.set(key, {
          key,
          masterId: master.id,
          masterName: master.name,
          unit,
          quantity: ing.quantity.trim(),
          usage: usageText,
          weight: '',
          checked: true,
          aiOk: false,
          note: '',
        })
      }
    }
  }

  return { items: [...items.values()], unitAdds: [...unitAdds.values()] }
}

export function planIsEmpty(p: RegisterPlan): boolean {
  return p.items.length === 0 && p.unitAdds.length === 0
}

// 名前が近い既存の材料（「既存の材料にまとめる」の候補。名前が含まれ合うもの）
export function similarMasters(name: string, masters: MasterOption[], limit = 6): MasterOption[] {
  const n = normName(name)
  if (n.length < 2) return []
  return masters
    .filter((m) => {
      const mn = normName(m.name)
      return mn.length >= 2 && (mn.includes(n) || n.includes(mn))
    })
    .slice(0, limit)
}

// ---------- AIで推定する（analyze-ingredients を呼ぶ） ----------
type ServerUnit = { unit: string; weight_g: number | null; is_default: boolean }
type ServerItem = {
  key: string
  ai_ok: boolean
  category?: string
  price_per_100g?: number | null
  peak_season_months?: number[]
  units?: ServerUnit[]
  nutrients?: Record<string, number | null>
  warnings?: string[]
}
type ServerUnitResult = { key: string; ai_ok: boolean; weight_g: number | null }
export type IngredientAnalysis = { items: ServerItem[]; unit_results: ServerUnitResult[] }

export type AnalyzeIngredientsResult = { ok: true; analysis: IngredientAnalysis } | CallFailure

export async function analyzeIngredients(plan: RegisterPlan, recipeName: string): Promise<AnalyzeIngredientsResult> {
  const r = await callFunction<Partial<IngredientAnalysis>>('analyze-ingredients', {
    recipe_name: recipeName,
    items: plan.items.map((it) => ({ key: it.key, name: it.name, usages: it.usages })),
    unit_requests: plan.unitAdds.map((u) => ({
      key: u.key,
      master_name: u.masterName,
      unit: u.unit,
      quantity: u.quantity,
    })),
  })
  if (!r.ok) return r
  return { ok: true, analysis: { items: r.items ?? [], unit_results: r.unit_results ?? [] } }
}

// AIの推定結果を、入力欄に入れる
export function mergeAnalysis(plan: RegisterPlan, a: IngredientAnalysis): RegisterPlan {
  const byKey = new Map(a.items.map((i) => [i.key, i]))
  const unitByKey = new Map(a.unit_results.map((u) => [u.key, u]))

  return {
    items: plan.items.map((it) => {
      const r = byKey.get(it.key)
      if (!r || r.ai_ok === false) {
        return {
          ...it,
          aiOk: false,
          warnings: [...it.warnings, ...(r?.warnings ?? ['AIが結果を返しませんでした。手で入力してください'])],
        }
      }
      const nutrients = emptyNutrients()
      for (const n of NUTRIENTS) {
        const v = r.nutrients?.[n.col]
        nutrients[n.col] = v == null ? '' : String(v)
      }
      return {
        ...it,
        aiOk: true,
        category: r.category && CATEGORY_OPTIONS.includes(r.category) ? r.category : it.category,
        price: r.price_per_100g == null ? '' : String(r.price_per_100g),
        peakMonths: r.peak_season_months ?? [],
        units: (r.units ?? []).map((u) => ({
          key: newKey(),
          unit: u.unit,
          weight: u.weight_g == null ? '' : String(u.weight_g),
          isDefault: u.is_default,
        })),
        nutrients,
        warnings: r.warnings ?? [],
      }
    }),
    unitAdds: plan.unitAdds.map((ua) => {
      const r = unitByKey.get(ua.key)
      if (!r || r.weight_g == null) {
        return { ...ua, aiOk: false, note: 'AIが重さを出せませんでした。入力してください' }
      }
      return { ...ua, aiOk: true, weight: String(r.weight_g), note: '' }
    }),
  }
}

// ---------- 入力のチェック ----------
export function parseNum(s: string): number | null {
  const t = s.normalize('NFKC').replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

// 単位の表を、保存できる形に整える（空の行・重複は除く。基準の単位は必ず1つ）
//   ・gの行（fixed）は、重さ1gで残す。fixed でない「g」の行は、これまでどおり除く（gは常に1gのため）
//   ・id は、編集のときの、既存の行のID
export type NormUnit = { id?: string; unit: string; weight: number; isDefault: boolean }

export function normalizeUnits(units: RegUnit[]): NormUnit[] {
  const seen = new Set<string>()
  const out: NormUnit[] = []
  for (const u of units) {
    if (u.fixed) {
      if (seen.has('g')) continue
      seen.add('g')
      out.push({ id: u.id, unit: 'g', weight: 1, isDefault: u.isDefault })
      continue
    }
    const name = normUnit(u.unit)
    const w = parseNum(u.weight)
    if (!name || name === 'g' || seen.has(name) || w === null || Number.isNaN(w) || w <= 0) continue
    seen.add(name)
    out.push({ id: u.id, unit: name, weight: w, isDefault: u.isDefault })
  }
  let found = false
  for (const u of out) {
    if (u.isDefault && !found) found = true
    else u.isDefault = false
  }
  if (!found && out.length > 0) out[0].isDefault = true
  return out
}

export function validatePlan(plan: RegisterPlan, masters: MasterOption[]): string | null {
  const existing = new Map(masters.map((m) => [normName(m.name), m.id]))
  const used = new Set<string>()

  for (const it of plan.items) {
    if (!it.checked || it.linkTo) continue
    const name = it.name.trim()
    if (!name) return '材料名が空の材料があります'
    const n = normName(name)
    // 編集のときは、自分自身と同じ名前でも構わない（ほかの材料と同じ名前だけを、重複とする）
    if (existing.has(n) && existing.get(n) !== it.masterId) {
      return it.masterId
        ? `「${name}」は、材料マスタにほかの材料としてすでにあります。名前を変えてください`
        : `「${name}」は、材料マスタにすでにあります。「既存の材料にまとめる」で選んでください`
    }
    if (used.has(n)) return `「${name}」が2つあります。名前を変えるか、片方のチェックを外してください`
    used.add(n)

    if (!CATEGORY_OPTIONS.includes(it.category)) return `「${name}」のカテゴリを選んでください`

    const price = parseNum(it.price)
    if (price !== null && (Number.isNaN(price) || price < 0)) return `「${name}」の価格は、0以上の数字で入力してください`

    const seenUnits = new Set<string>()
    for (const u of it.units) {
      if (u.fixed) {
        seenUnits.add('g')
        continue
      }
      const unit = normUnit(u.unit)
      const w = parseNum(u.weight)
      if (!unit && w === null) continue // 何も入っていない行は、無視する
      if (!unit) return `「${name}」の単位に、名前の空欄があります`
      if (unit === 'g') return `「${name}」の単位に「g」は入れないでください（gは常に1gです）`
      if (seenUnits.has(unit)) return `「${name}」の単位「${unit}」が2つあります`
      seenUnits.add(unit)
      if (w === null || Number.isNaN(w) || w <= 0) return `「${name}」の単位「${unit}」の重さ(g)を、0より大きい数字で入力してください`
    }

    for (const n2 of NUTRIENTS) {
      const v = parseNum(it.nutrients[n2.col])
      if (v !== null && (Number.isNaN(v) || v < 0)) return `「${name}」の${n2.label}は、0以上の数字で入力してください`
    }

    if (it.brand.length > 100 || it.product.length > 100 || it.store.length > 100) {
      return `「${name}」の銘柄・いつもの商品・購入店は、100文字までにしてください`
    }
    if (it.note.length > 500) return `「${name}」のメモは、500文字までにしてください`
  }

  for (const ua of plan.unitAdds) {
    if (!ua.checked) continue
    const w = parseNum(ua.weight)
    if (w === null || Number.isNaN(w) || w <= 0) {
      return `「${ua.masterName}」の「${ua.unit}」の重さ(g)を、0より大きい数字で入力してください`
    }
  }
  return null
}

// ---------- 登録する ----------
type DbError = { code?: string; message?: string; details?: string }

// 1つの材料を登録（ingredient_master → ingredient_units）。登録した材料のIDを返す
export async function applyPlan(plan: RegisterPlan, userId: string): Promise<{ createdIds: Map<string, string> }> {
  const householdId = await getHouseholdId(userId)
  const createdMasters: string[] = []
  const addedUnits: string[] = []
  const createdIds = new Map<string, string>()

  try {
    for (const it of plan.items) {
      if (!it.checked || it.linkTo || it.masterId) continue // 編集中の材料は、ここでは登録しない（saveEdit で保存する）
      const name = it.name.trim()
      const units = normalizeUnits(it.units)
      const def = units.find((u) => u.isDefault)

      const row: Record<string, unknown> = {
        household_id: householdId,
        ingredient_name: name,
        category: it.category,
        default_unit: def ? def.unit : 'g',
        unit_weight_g: def ? def.weight : 1,
        price_per_100g: parseNum(it.price),
        nutrition_source: it.source || 'ai_estimate',
        peak_season_months: it.peakMonths.length > 0 ? it.peakMonths : null,
        brand_name: it.brand.trim() || null,
        usual_product_name: it.product.trim() || null,
        store_name: it.store.trim() || null,
        note: it.note.trim() || null,
        created_by: userId,
      }
      for (const n of NUTRIENTS) row[n.col] = parseNum(it.nutrients[n.col])

      const { data, error } = await supabase.from('ingredient_master').insert(row).select('id').single()
      if (error) {
        if ((error as DbError).code === '23505') {
          throw new Error(`「${name}」は、材料マスタにすでにあります。「既存の材料にまとめる」で選んでください`)
        }
        throw error
      }
      const id = data.id as string
      createdMasters.push(id)

      if (units.length > 0) {
        const { error: unitErr } = await supabase.from('ingredient_units').insert(
          units.map((u, i) => ({
            ingredient_master_id: id,
            unit: u.unit,
            weight_g: u.weight,
            is_default: u.isDefault,
            sort_order: i,
          })),
        )
        if (unitErr) throw unitErr
      }
      createdIds.set(it.key, id)
    }

    let order = 90
    for (const ua of plan.unitAdds) {
      if (!ua.checked) continue
      const { data, error } = await supabase
        .from('ingredient_units')
        .insert({
          ingredient_master_id: ua.masterId,
          unit: ua.unit.trim(),
          weight_g: Number(ua.weight.normalize('NFKC')),
          is_default: false,
          sort_order: order++,
        })
        .select('id')
        .single()
      if (error) {
        if ((error as DbError).code === '23505') continue // すでにある単位。そのまま使える
        throw error
      }
      addedUnits.push(data.id as string)
    }
  } catch (e) {
    // 登録したぶんを消して、元に戻す
    if (addedUnits.length > 0) await supabase.from('ingredient_units').delete().in('id', addedUnits)
    if (createdMasters.length > 0) await supabase.from('ingredient_master').delete().in('id', createdMasters)
    throw e
  }

  return { createdIds }
}

// ---------- 登録した結果を、画面の状態に反映する ----------
// 材料マスタの一覧（画面で持っているもの）に、登録したぶんを足す
export function mergeMasters(masters: MasterOption[], plan: RegisterPlan, createdIds: Map<string, string>): MasterOption[] {
  const next = masters.map((m) => ({ ...m, units: [...m.units] }))

  for (const it of plan.items) {
    const id = createdIds.get(it.key)
    if (!id) continue
    const units = normalizeUnits(it.units)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((u) => u.unit)
    next.push({ id, name: it.name.trim(), category: it.category, units: ['g', ...units] })
  }
  for (const ua of plan.unitAdds) {
    if (!ua.checked) continue
    const m = next.find((x) => x.id === ua.masterId)
    if (m && !m.units.map(normUnit).includes(normUnit(ua.unit))) m.units.push(ua.unit.trim())
  }
  return next
}

// レシピの材料を、登録した（または選んだ）材料マスタに結び付ける
export function applyToDraft(
  draft: Draft,
  plan: RegisterPlan,
  createdIds: Map<string, string>,
  masters: MasterOption[],
): Draft {
  const masterMap = new Map(masters.map((m) => [m.id, m]))
  const byMatch = new Map<string, { id: string; name: string }>()

  for (const it of plan.items) {
    if (!it.checked) continue
    if (it.linkTo) {
      const m = masterMap.get(it.linkTo)
      if (m) byMatch.set(it.match, { id: m.id, name: m.name })
    } else {
      const id = createdIds.get(it.key)
      if (id) byMatch.set(it.match, { id, name: it.name.trim() })
    }
  }

  return {
    ...draft,
    ingredients: draft.ingredients.map((ing) => {
      if (ing.masterId) return ing
      const hit = byMatch.get(normName(ing.name))
      return hit ? { ...ing, masterId: hit.id, name: hit.name } : ing
    }),
  }
}
