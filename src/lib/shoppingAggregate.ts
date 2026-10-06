// src/lib/shoppingAggregate.ts（新規作成）
// 確定した献立の材料を、買い物用に合計する（画面に依存しない計算だけの部品）
//   ・同じ材料は合算（例：玉ねぎ 200g ＋ 100g → 300g）
//   ・人数に合わせて分量を増減（レシピの元の人数 → 選んだ人数）
//   ・単位が違うときは、材料マスタの「既定の単位」と「1単位の重さ」で換算して合算できる場合だけ合算
//     （換算できなければ、単位ごとに別の行にする）
//   ・「適量」「少々」などは、数量がある行があれば無視。なければ「適量」の1行にする

export type RawIngredient = {
  recipe_id: string
  ingredient_master_id: string | null
  ingredient_name: string
  quantity: string | null
  unit: string | null
  master: {
    ingredient_name: string
    category: string
    default_unit: string | null
    unit_weight_g: number | null
  } | null
}

export type RecipeInfo = { id: string; dish_name: string; servings: number }

export type AggItem = {
  key: string // 画面内で行を区別するためのキー
  masterId: string | null
  name: string
  category: string
  quantity: string | null // 数値か「適量」などの文字
  unit: string | null
  recipeNames: string[]
  recipeIds: string[]
}

// ---------- 小さな部品 ----------

// 分量(text)を数値に変換："2" "0.5" "1/2" に対応。それ以外は null
export function parseQty(t: string | null | undefined): number | null {
  if (t == null) return null
  const s = t.trim()
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return Number(s)
  const m = s.match(/^([0-9]+)\/([0-9]+)$/)
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2])
  return null
}

// 「少々・適量・適宜・ひとつまみ」や空欄
export function isNegligible(quantity: string | null | undefined): boolean {
  const q = (quantity ?? '').trim()
  return q === '' || /^(少々|適量|適宜|ひとつまみ)/.test(q)
}

// グラムの表記ゆれをそろえる
export function normUnit(unit: string | null | undefined): string | null {
  if (unit == null) return null
  const u = unit.trim()
  if (u === '') return null
  if (u === 'ｇ' || u === 'グラム') return 'g'
  return u
}

// 見やすい桁数に丸めて、文字列にする（0.75 / 12.5 / 300）
export function roundQty(v: number): string {
  const r = v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100
  return String(r)
}

// 「大さじ3」「小さじ1」は単位が先頭、それ以外は数量が先頭（300g・2個）
export function formatAmount(quantity: string | null, unit: string | null): string {
  const q = quantity ?? ''
  const u = unit ?? ''
  if (u === '大さじ' || u === '小さじ') return `${u}${q}`
  return `${q}${u}`
}

// 同じ材料かどうかを判定するキー（マスタに紐付いていれば id、なければ名前）
export function itemKeyOf(masterId: string | null, name: string): string {
  return masterId ?? `name:${name}`
}

// ---------- 合計の本体 ----------

type Line = {
  recipe: RecipeInfo
  qty: number | null // 人数換算後の数量（数値でなければ null）
  unit: string | null
  text: string | null // 元の分量の文字
  negligible: boolean
}

type Group = {
  itemKey: string
  masterId: string | null
  name: string
  category: string
  master: RawIngredient['master']
  lines: Line[]
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function buildItems(g: Group): AggItem[] {
  const recipeNames = uniq(g.lines.map((l) => l.recipe.dish_name))
  const recipeIds = uniq(g.lines.map((l) => l.recipe.id))
  const base = { masterId: g.masterId, name: g.name, category: g.category, recipeNames, recipeIds }
  const items: AggItem[] = []
  let n = 0
  const push = (quantity: string | null, unit: string | null) => {
    items.push({ ...base, key: `${g.itemKey}#${n++}`, quantity, unit })
  }

  const numeric = g.lines.filter((l) => l.qty != null)
  const others = g.lines.filter((l) => l.qty == null)

  if (numeric.length > 0) {
    const units = uniq(numeric.map((l) => l.unit))
    if (units.length === 1) {
      // 単位が全部同じ → そのまま合算
      push(roundQty(numeric.reduce((s, l) => s + (l.qty as number), 0)), units[0])
    } else {
      // 単位がばらばら → マスタの既定の単位に換算できるなら合算
      const du = normUnit(g.master?.default_unit)
      const w = g.master?.unit_weight_g ?? null
      const convertible =
        du != null && numeric.every((l) => l.unit === 'g' || (l.unit === du && w != null && w > 0))
      if (convertible && du != null) {
        const grams = numeric.reduce(
          (s, l) => s + (l.unit === 'g' ? (l.qty as number) : (l.qty as number) * (w as number)),
          0,
        )
        const q = du === 'g' ? grams : grams / (w as number)
        push(roundQty(q), du)
      } else {
        // 換算できない → 単位ごとに別の行
        for (const u of units) {
          const sum = numeric.filter((l) => l.unit === u).reduce((s, l) => s + (l.qty as number), 0)
          push(roundQty(sum), u)
        }
      }
    }
    // 数値にできない分量（「2〜3」など）。「適量」系は数量があるので無視
    const seen = new Set<string>()
    for (const l of others) {
      if (l.negligible) continue
      const k = `${l.text}|${l.unit}`
      if (seen.has(k)) continue
      seen.add(k)
      push(l.text, l.unit)
    }
  } else if (others.length > 0) {
    // 数量がある行がない → 「適量」など文字の分量を1行にする
    const real = others.find((l) => !l.negligible)
    const text = (real?.text ?? others[0].text ?? '').trim()
    push(text === '' ? '適量' : text, real ? real.unit : null)
  }
  return items
}

export function aggregateIngredients(
  raws: RawIngredient[],
  recipes: RecipeInfo[],
  servings: number,
): AggItem[] {
  const recipeMap = new Map(recipes.map((r) => [r.id, r]))
  const groups = new Map<string, Group>()

  for (const raw of raws) {
    const recipe = recipeMap.get(raw.recipe_id)
    if (!recipe) continue
    const factor = recipe.servings > 0 ? servings / recipe.servings : 1
    const itemKey = itemKeyOf(raw.ingredient_master_id, raw.ingredient_name)

    let g = groups.get(itemKey)
    if (!g) {
      g = {
        itemKey,
        masterId: raw.ingredient_master_id,
        name: raw.master?.ingredient_name ?? raw.ingredient_name,
        category: raw.master?.category ?? 'その他',
        master: raw.master,
        lines: [],
      }
      groups.set(itemKey, g)
    }

    const q = parseQty(raw.quantity)
    g.lines.push({
      recipe,
      qty: q != null ? q * factor : null,
      unit: normUnit(raw.unit),
      text: raw.quantity,
      negligible: isNegligible(raw.quantity),
    })
  }

  const out: AggItem[] = []
  for (const g of groups.values()) out.push(...buildItems(g))
  return out
}
