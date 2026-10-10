// src/pages/RecipeDetailPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：recipe_nutrition ビュー（01）、recipes.plan_confirmed 列（09）、cook_logs テーブル（11）を作成済みであること
// 前提：12_ingredients_by_step.sql（steps.tip / ingredients.step_id / ingredients.group_label）を実行済みであること
// 前提：ingredient_units テーブル（複数単位の対応）を作成済みであること
// 前提：src/lib/recipePhoto.ts と src/lib/ingredientOrder.ts を置いてあること（今回の追加ファイル）
// 今回の変更：
//  ・献立から開いたときは、材料を献立の人数（URLの ?servings=）で表示する
//  ・ヘッダーに「✏️ 編集」ボタン（/recipes/:id/edit へ）。一番下の「参考元」はなくした（上の参考元が、URLがあればリンクになる）
//  ・「材料」表で、同じ材料はまとめて合算して表示（単位が違うときは「大さじ1＋50g」のように並べる）
//  ・分量は 0.333 → 1/3、1.5 → 1と1/2 のように分数で表示（g・ml と 10以上は小数）
//  ・材料の記号（A・B…）のバッジを青にした（工程番号のオレンジと見分けやすく）
//  ・献立の状態に「購入済」を追加（14_menu_purchased_migration.sql）。献立から外すときは購入済も解除
// 前回の変更：
//  ・カロリー・値段・栄養素は「1人前」で固定表示（人数で変わらない）
//  ・材料の人数切替は、このレシピの「標準の人前」（recipes.servings）から始まる（共通設定ではなくなった。画面を開き直すと標準に戻る）
//  ・献立に追加したときは、設定画面の「人数の初期値」を planned_servings に入れる
// 前回の変更：
//  ・写真の右下に「📷 登録／変更」ボタンを追加。選んだ写真は端末で縮めてから保存し、古い写真は消す
//  ・「材料」表を、買い物リストのカテゴリ順（設定画面の順）に並べ替えた
//      カテゴリ名は出さず、カテゴリが変わるところの線だけ濃くした。A・Bなどのグループ分けと、下ごしらえ（括弧書き）は、この表では出さない
//      （「作り方」の各工程に出る材料は、これまでどおり。グループ記号・下ごしらえも出る）
// これまでの内容：
//  ・一番上に固定の帯（スクロールしても動かない）
//      1行目：左＝「← 戻る」／右＝「追加」「履歴（回数つき）」「栄養素」ボタン
//      2行目：料理名。その下に小さく「参照元・時間・カロリー・費用」
//  ・「履歴」「栄養素」は、ボタンを押すと下から出る画面で表示
//  ・「追加」は献立候補の追加／外す。押したあとに「元に戻す」付きのメッセージを表示
//  ・人数切替（－ ○人前 ＋）は「材料」の見出しの右（材料の分量だけが連動）
//  ・材料のグループ記号（A・B…）をオレンジの丸バッジで表示（作り方の工程内）。工程の本文中の [A] もバッジにする
//  ・カロリー／費用／栄養素は recipe_nutrition ビュー（材料マスタから計算）から表示
//  ・計算できていない材料には「未計算」マーク（判定は材料マスタの単位表 ingredient_units に合わせてある）
//  ・分量は「大さじ3」のように、大さじ・小さじは単位を先頭に表示
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { Ingredient, Recipe, Step } from '../types/recipe'
import type { CookLog } from '../types/cookLog'
import { useRecipeImage } from '../lib/useRecipeImage'
import { formatCookedDate } from '../lib/dates'
import { NUTRIENT_INFO_LIST } from '../data/nutrientInfo'
import type { NutrientInfo } from '../data/nutrientInfo'
import ServingsStepper from '../components/ServingsStepper'
import { normalizeCategoryOrder } from '../lib/categoryOrder'
import { defaultPlanServingsFor, fetchCategoryOrder, getHouseholdId } from '../lib/household'
import { orderByCategory } from '../lib/ingredientOrder'
import type { OrderedRow } from '../lib/ingredientOrder'
import { compressForDisplay, replaceRecipePhoto } from '../lib/recipePhoto'
import { errorText } from '../lib/errorText'
import { formatNumber, joinAmount, parseAmount, scaledAmount } from '../lib/amount'

// 材料 ＋ 紐付いたマスタの情報（カテゴリ順の並びと、未計算の判定に使う）
type IngredientRow = Ingredient & {
  ingredient_master: {
    category: string | null
    default_unit: string | null
    unit_weight_g: number | null
    ingredient_units?: { unit: string; weight_g: number }[] | null
  } | null
}

// 工程の中の材料のまとまり（グループ記号 A・B… がある材料は、同じ記号どうしで1つにまとめる）
type IngBlock = { label: string | null; stepId: string | null; items: IngredientRow[] }

// recipe_nutrition ビューの1行
type NutritionRow = Record<string, number | string | null>

// 献立の状態（追加／外す、「元に戻す」で書き込む列）
type PlanPatch = {
  is_planned: boolean
  plan_confirmed: boolean
  planned_by: string | null
  planned_at: string | null
  planned_servings: number | null
  plan_purchased: boolean
}
type Toast = { message: string; onUndo: () => void }

const LOG_PREVIEW = 10 // 作った履歴は、最初は新しい順に10件だけ表示

// ---------- 計算ルール（SQLビュー 01_recipe_nutrition_view.sql と同じ） ----------
// 分量(text)を数値に変換："2" "0.5" "1/2" に対応。それ以外は null
function parseQty(t: string | null): number | null {
  if (t == null) return null
  const s = t.trim()
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return Number(s)
  const m = s.match(/^([0-9]+)\/([0-9]+)$/)
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2])
  return null
}

// 「少々・適量・適宜・ひとつまみ」や空欄は、計算対象外（未計算に数えない）
function isNegligible(quantity: string | null): boolean {
  const q = (quantity ?? '').trim()
  return q === '' || /^(少々|適量|適宜|ひとつまみ)/.test(q)
}

// この材料がマスタから計算できているか
function isResolved(ing: IngredientRow): boolean {
  const m = ing.ingredient_master
  if (!ing.ingredient_master_id || !m) return false
  if (parseQty(ing.quantity) == null) return false
  if (ing.unit != null && ['g', 'ｇ', 'グラム'].includes(ing.unit)) return true
  // マスタの単位表に、この材料の単位があって重さが入っていれば計算できる
  if ((m.ingredient_units ?? []).some((u) => u.unit === ing.unit && Number(u.weight_g) > 0)) return true
  // 単位表がまだ無い場合の保険（旧列）
  return m.default_unit != null && ing.unit === m.default_unit && m.unit_weight_g != null
}

// ---------- 表示用ヘルパー ----------
function roundSmart(value: number): number {
  const abs = Math.abs(value)
  if (abs === 0) return 0
  if (abs >= 10) return Math.round(value)
  if (abs >= 1) return Math.round(value * 10) / 10
  return Math.round(value * 100) / 100
}

function fmtVal(value: number | null, unit: string): string {
  if (value == null) return '―'
  return `${roundSmart(value)}${unit}`
}

// ビューの値を number で取り出す
function nv(row: NutritionRow | null, col: string): number | null {
  const v = row?.[col]
  return typeof v === 'number' ? v : null
}


// 材料マスタの列名 → ビューの列名（xxx_per_100g → xxx_per_serving）
function servingCol(key: string): string {
  return key.replace('_per_100g', '_per_serving')
}

// 工程の材料を、表示用のまとまりに分ける（並びは sort_order のまま。同じ記号 A は1か所に集める）
function buildBlocks(list: IngredientRow[]): IngBlock[] {
  const blocks: IngBlock[] = []
  for (const ing of list) {
    const label = ing.group_label
    if (label) {
      // 同じ記号でも、別の工程の材料はまとめない（工程ごとのA・Bが混ざらないように）
      const found = blocks.find((b) => b.label === label && b.stepId === ing.step_id)
      if (found) {
        found.items.push(ing)
      } else {
        blocks.push({ label, stepId: ing.step_id, items: [ing] })
      }
    } else {
      const last = blocks[blocks.length - 1]
      if (last && last.label === null) {
        last.items.push(ing)
      } else {
        blocks.push({ label: null, stepId: ing.step_id, items: [ing] })
      }
    }
  }
  return blocks
}

// 栄養素の表示グループ（カロリーは上のカードに出すので除外）
const MAIN_KEYS = [
  'protein_g_per_100g',
  'fat_g_per_100g',
  'carbohydrate_g_per_100g',
  'sugar_g_per_100g',
  'dietary_fiber_g_per_100g',
  'salt_g_per_100g',
]
const INDENT_KEYS = ['sugar_g_per_100g', 'dietary_fiber_g_per_100g'] // 炭水化物の内訳は字下げ

// ---------- 「材料」表：同じ材料をまとめる ----------
// 同じ材料（材料マスタが同じ、またはマスタ無しで名前が同じ）は1行にまとめ、同じ単位どうしは足す
type MergedRow = {
  key: string
  name: string
  category: string | null
  sortOrder: number
  parts: { qty: number | null; text: string | null; unit: string | null }[]
  unresolved: boolean
}

function mergeIngredients(list: IngredientRow[], unresolvedSet: Set<string>): MergedRow[] {
  const map = new Map<string, MergedRow>()
  for (const ing of list) {
    const key = ing.ingredient_master_id ?? `name:${ing.ingredient_name.trim()}`
    let row = map.get(key)
    if (!row) {
      row = {
        key,
        name: ing.ingredient_name,
        category: ing.ingredient_master?.category ?? null,
        sortOrder: ing.sort_order,
        parts: [],
        unresolved: false,
      }
      map.set(key, row)
    }
    row.sortOrder = Math.min(row.sortOrder, ing.sort_order)
    if (unresolvedSet.has(ing.id)) row.unresolved = true
    const unit = ing.unit && ing.unit.trim() !== '' ? ing.unit.trim() : null
    const qty = parseAmount(ing.quantity)
    if (qty != null) {
      const same = row.parts.find((p) => p.qty != null && p.unit === unit)
      if (same) same.qty = (same.qty as number) + qty
      else row.parts.push({ qty, text: null, unit })
    } else if (!isNegligible(ing.quantity) || row.parts.length === 0) {
      const text = (ing.quantity ?? '').trim()
      if (!row.parts.some((p) => p.qty == null && p.text === text && p.unit === unit)) {
        row.parts.push({ qty: null, text, unit })
      }
    }
  }
  // 数値のある行があれば、「少々」などの行は消す
  for (const row of map.values()) {
    if (row.parts.some((p) => p.qty != null)) {
      row.parts = row.parts.filter((p) => p.qty != null || !isNegligible(p.text))
    }
  }
  return [...map.values()]
}

function mergedAmount(row: MergedRow, factor: number): string {
  return row.parts
    .map((p) => (p.qty != null ? joinAmount(formatNumber(p.qty * factor, p.unit), p.unit) : joinAmount(p.text, p.unit)))
    .filter((t) => t !== '')
    .join('＋')
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  // 献立から開いたときの人数（?servings=3）。無いときは、レシピの標準の人前
  const planServings = (() => {
    const n = Number(searchParams.get('servings'))
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null
  })()
  const navigate = useNavigate()
  const { session } = useOutletContext<{ session: Session }>()
  const photoInput = useRef<HTMLInputElement>(null)

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [nutrition, setNutrition] = useState<NutritionRow | null>(null)
  const [nutritionFailed, setNutritionFailed] = useState(false)
  const [cookLogs, setCookLogs] = useState<CookLog[]>([])
  const [cookLogsFailed, setCookLogsFailed] = useState(false)
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [togglingPlanned, setTogglingPlanned] = useState(false)
  const [sheet, setSheet] = useState<'history' | 'nutrition' | null>(null) // 下から出る画面（履歴／栄養素）
  const [toast, setToast] = useState<Toast | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false) // 料理写真を保存している途中
  const [categoryOrder, setCategoryOrder] = useState<string[]>(normalizeCategoryOrder(null)) // 買い物リストのカテゴリ順
  const [servings, setServings] = useState(1) // 材料を何人前で表示するか（開いたときは、レシピの標準の人前）
  const imageUrl = useRecipeImage(recipe?.image_path ?? null)

  // 「元に戻す」メッセージは4秒で自動的に消す
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // 買い物リストのカテゴリ順（設定画面の順）。読めなくても、初期の順で表示する
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const householdId = await getHouseholdId(session.user.id)
        const order = await fetchCategoryOrder(householdId)
        if (!cancelled) setCategoryOrder(order)
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  useEffect(() => {
    if (!id) return
    let isCancelled = false

    const fetchDetail = async () => {
      setLoading(true)
      setErrorMessage(null)

      const [recipeResult, ingredientsResult, stepsResult, nutritionResult, logsResult] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase
          .from('ingredients')
          .select('*, ingredient_master(category, default_unit, unit_weight_g, ingredient_units(unit, weight_g))')
          .eq('recipe_id', id)
          .order('sort_order'),
        supabase.from('steps').select('*').eq('recipe_id', id).order('step_number'),
        supabase.from('recipe_nutrition').select('*').eq('recipe_id', id).maybeSingle(),
        supabase
          .from('cook_logs')
          .select('id, household_id, recipe_id, cooked_on, cooked_by, created_at')
          .eq('recipe_id', id)
          .order('cooked_on', { ascending: false })
          .order('created_at', { ascending: false }),
      ])

      if (isCancelled) return

      if (recipeResult.error) {
        setErrorMessage('レシピが見つかりませんでした。')
        setLoading(false)
        return
      }
      setRecipe(recipeResult.data as Recipe)
      setServings(planServings ?? Math.max(1, (recipeResult.data as Recipe).servings || 1))

      // 材料：マスタ結合つきの取得に失敗したときは、結合なしで取り直す（表示は止めない）
      if (ingredientsResult.error) {
        console.error(ingredientsResult.error)
        const fallback = await supabase
          .from('ingredients')
          .select('*')
          .eq('recipe_id', id)
          .order('sort_order')
        if (isCancelled) return
        setIngredients(
          ((fallback.data ?? []) as Ingredient[]).map((i) => ({ ...i, ingredient_master: null })),
        )
      } else {
        setIngredients((ingredientsResult.data ?? []) as IngredientRow[])
      }

      setSteps((stepsResult.data as Step[]) ?? [])

      if (nutritionResult.error) {
        console.error(nutritionResult.error)
        setNutritionFailed(true)
      } else {
        setNutrition((nutritionResult.data as NutritionRow | null) ?? null)
      }

      // 作った履歴：読めなくても（11のSQL未実行など）、ほかの表示は止めない
      if (logsResult.error) {
        console.error(logsResult.error)
        setCookLogsFailed(true)
      } else {
        setCookLogs((logsResult.data ?? []) as CookLog[])
      }

      setLoading(false)
    }

    fetchDetail()
    return () => {
      isCancelled = true
    }
  }, [id])

  // 献立の状態を書き込む（成功したら画面にも反映）。「元に戻す」にも使う
  const writePlan = async (next: PlanPatch): Promise<boolean> => {
    if (!recipe) return false
    setTogglingPlanned(true)
    const { data, error } = await supabase.from('recipes').update(next).eq('id', recipe.id).select('id')
    setTogglingPlanned(false)
    if (error || !data || data.length === 0) {
      alert('更新に失敗しました: ' + (error?.message ?? '権限を確認してください'))
      return false
    }
    setRecipe((r) => (r ? { ...r, ...next } : r))
    return true
  }

  // 献立候補の追加／外す。追加は「候補」から。外すときは確定も解除する（確定・作ったは献立画面で行う）
  const handleTogglePlanned = async () => {
    if (!recipe || togglingPlanned) return
    const before: PlanPatch = {
      is_planned: recipe.is_planned,
      plan_confirmed: recipe.plan_confirmed,
      planned_by: recipe.planned_by,
      planned_at: recipe.planned_at,
      planned_servings: recipe.planned_servings ?? null,
      plan_purchased: recipe.plan_purchased ?? false,
    }
    const adding = !recipe.is_planned
    const ok = await writePlan({
      is_planned: adding,
      plan_confirmed: false,
      planned_by: adding ? session.user.id : null,
      planned_at: adding ? new Date().toISOString() : null,
      planned_servings: adding ? await defaultPlanServingsFor(session.user.id) : null,
      plan_purchased: false,
    })
    if (!ok) return
    setToast({
      message: adding ? '献立候補に追加しました' : '献立から外しました',
      onUndo: () => {
        void writePlan(before)
        setToast(null)
      },
    })
  }

  // 料理写真の登録・変更：端末で縮める → 保存 → レシピの写真を差し替え → 古い写真を消す
  const handlePickPhoto = async (file: File) => {
    if (!recipe || photoBusy) return
    setPhotoBusy(true)
    try {
      const blob = await compressForDisplay(file)
      const newPath = await replaceRecipePhoto({
        householdId: recipe.household_id,
        recipeId: recipe.id,
        oldPath: recipe.image_path,
        blob,
        userId: session.user.id,
      })
      setRecipe((r) => (r ? { ...r, image_path: newPath } : r))
    } catch (e) {
      console.error(e)
      alert('写真の保存に失敗しました：' + errorText(e))
    } finally {
      setPhotoBusy(false)
    }
  }

  // 未計算の材料（分量が「適量」などのものは数えない）
  const unresolvedSet = useMemo(() => {
    const s = new Set<string>()
    ingredients.forEach((ing) => {
      if (!isNegligible(ing.quantity) && !isResolved(ing)) s.add(ing.id)
    })
    return s
  }, [ingredients])

  // 栄養素の表示行（マスタ側の定義を流用）
  const nutrientRows = useMemo(() => {
    const byKey = new Map(NUTRIENT_INFO_LIST.map((n) => [String(n.key), n]))
    const main = MAIN_KEYS.map((k) => byKey.get(k)).filter((n): n is NutrientInfo => n !== undefined)
    const micro = NUTRIENT_INFO_LIST.filter(
      (n) => String(n.key) !== 'calorie_per_100g' && !MAIN_KEYS.includes(String(n.key)),
    )
    return { main, micro }
  }, [])

  // 作り方の各工程に出す材料（工程に紐付いたものだけ）。1つも紐付いていないレシピ（古い形式）は、工程に材料を出さない
  const stepIngredients = useMemo(() => {
    const stepIds = new Set(steps.map((s) => s.id))
    const byStep = new Map<string, IngredientRow[]>()
    for (const ing of ingredients) {
      if (ing.step_id != null && stepIds.has(ing.step_id)) {
        byStep.set(ing.step_id, [...(byStep.get(ing.step_id) ?? []), ing])
      }
    }
    return byStep
  }, [ingredients, steps])

  // 「材料」表：買い物リストのカテゴリ順に並べる（同じカテゴリの中は、レシピに書かれた順）
  const orderedIngredients = useMemo(
    () =>
      orderByCategory(
        mergeIngredients(ingredients, unresolvedSet),
        categoryOrder,
        (row) => row.category,
        (row) => row.sortOrder,
      ),
    [ingredients, categoryOrder, unresolvedSet],
  )

  if (loading) {
    return (
      <div className="max-w-md mx-auto p-4">
        <div className="h-48 bg-gray-200 rounded-xl animate-pulse mb-4" />
        <div className="h-6 bg-gray-200 rounded w-2/3 animate-pulse mb-2" />
        <div className="h-4 bg-gray-200 rounded w-1/3 animate-pulse" />
      </div>
    )
  }

  if (errorMessage || !recipe) {
    return (
      <div className="max-w-md mx-auto p-4 text-center">
        <p className="text-sm text-red-600 mb-4">{errorMessage}</p>
        <button onClick={() => navigate('/recipes')} className="text-amber-600 underline text-sm">
          一覧に戻る
        </button>
      </div>
    )
  }

  // カロリー・費用・栄養素は、いつも1人前（ビューの値そのまま）
  const kcalPer = nv(nutrition, 'calorie_per_serving')
  const costPer = nv(nutrition, 'price_per_serving')
  const factor = servings / recipe.servings // 材料の分量を増減する倍率
  const unresolvedCount = unresolvedSet.size
  const uncertain = unresolvedCount > 0 || nutritionFailed // 計算に含まれていない材料がある

  // 献立の状態：未追加／候補／確定
  const planState: 'none' | 'candidate' | 'confirmed' | 'purchased' = !recipe.is_planned
    ? 'none'
    : recipe.plan_confirmed
      ? recipe.plan_purchased
        ? 'purchased'
        : 'confirmed'
      : 'candidate'

  // 作った履歴（新しい順に10件。「すべて表示」で全件）
  const shownLogs = showAllLogs ? cookLogs : cookLogs.slice(0, LOG_PREVIEW)

  return (
    <div className="max-w-md mx-auto pb-6">
      {/* ===== 一番上に固定：①ボタンの帯 ②料理名＋参照元・時間・カロリー・費用 ===== */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white px-3 pb-2 pt-2 shadow-sm">
        {/* ①左：戻る ／ 右：追加・履歴（回数つき）・栄養素 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/recipes'))}
            aria-label="戻る"
            className="shrink-0 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700 active:bg-gray-200"
          >
            ← 戻る
          </button>
          <button
            onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
            aria-label="レシピを編集する"
            className="shrink-0 rounded-full border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-700 active:bg-gray-100"
          >
            ✏️ 編集
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={handleTogglePlanned}
              disabled={togglingPlanned}
              aria-label={
                planState === 'none'
                  ? '献立候補に追加する'
                  : planState === 'candidate'
                    ? '献立候補から外す'
                    : '献立から外す'
              }
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                planState === 'none'
                  ? 'bg-amber-500 text-white'
                  : planState === 'candidate'
                    ? 'border border-amber-400 bg-amber-100 text-amber-700'
                    : 'border border-green-400 bg-green-100 text-green-700'
              }`}
            >
              {planState === 'none' && '＋ 追加'}
              {planState === 'candidate' && '✓ 候補'}
              {planState === 'confirmed' && '✓ 確定'}
              {planState === 'purchased' && '✓ 購入済'}
            </button>
            <button
              onClick={() => setSheet('history')}
              className="whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 active:bg-gray-100"
            >
              🍳 履歴 {recipe.cook_count}
            </button>
            <button
              onClick={() => setSheet('nutrition')}
              className="whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 active:bg-gray-100"
            >
              栄養素
            </button>
          </div>
        </div>

        {/* ②料理名 ＋ 下に小さく：参照元・時間・カロリー・費用（選んだ人数ぶん） */}
        <h1 className="mt-1.5 truncate text-lg font-bold leading-tight text-gray-900">{recipe.dish_name}</h1>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-gray-500">
          {recipe.source_name &&
            (recipe.source_url ? (
              <a href={recipe.source_url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-amber-700 underline">
                {recipe.source_name}
              </a>
            ) : (
              <span className="min-w-0 truncate">{recipe.source_name}</span>
            ))}
          <span className="shrink-0 whitespace-nowrap">
            {recipe.source_name ? '・' : ''}⏱ {recipe.cooking_time_minutes != null ? `${recipe.cooking_time_minutes}分` : '―'}
            {' ・ '}
            {fmtVal(kcalPer, 'kcal')}
            {' ・ '}
            {fmtVal(costPer, '円')}
            {uncertain && <span className="text-amber-600">※</span>}
            <span className="text-gray-400">（1人前）</span>
          </span>
        </p>
      </header>

      {/* 写真（右下の「登録／変更」ボタンで、写真を選び直せる） */}
      <div className="relative flex h-56 w-full items-center justify-center bg-gray-100">
        {imageUrl ? (
          <img src={imageUrl} alt={recipe.dish_name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-5xl">🍚</span>
        )}
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (photoInput.current) photoInput.current.value = '' // 同じ写真をもう一度選べるように
            if (f) void handlePickPhoto(f)
          }}
        />
        <button
          type="button"
          onClick={() => photoInput.current?.click()}
          disabled={photoBusy}
          aria-label={recipe.image_path ? '写真を変更する' : '写真を登録する'}
          className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white active:opacity-80 disabled:opacity-60"
        >
          {photoBusy ? '保存中…' : recipe.image_path ? '📷 変更' : '📷 登録'}
        </button>
      </div>

      <div className="p-4">
        {(recipe.genre || recipe.category) && (
          <p className="text-xs text-gray-400">
            {recipe.genre}
            {recipe.genre && recipe.category ? ' ・ ' : ''}
            {recipe.category}
          </p>
        )}

        {/* 材料表（買い物リストのカテゴリ順。カテゴリ名は出さず、カテゴリが変わるところの線だけ濃くする） */}
        <section className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800">
              材料
              {planServings != null && servings === planServings && servings !== recipe.servings ? (
                <span className="ml-2 text-xs font-normal text-gray-400">献立の人数（標準{recipe.servings}人前）</span>
              ) : servings !== recipe.servings ? (
                <button
                  type="button"
                  onClick={() => setServings(recipe.servings)}
                  className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-normal text-gray-500 active:bg-gray-200"
                >
                  標準{recipe.servings}人前に戻す
                </button>
              ) : (
                <span className="ml-2 text-xs font-normal text-gray-400">標準</span>
              )}
            </h2>
            <ServingsStepper value={servings} onChange={setServings} max={20} />
          </div>
          {ingredients.length === 0 ? (
            <p className="text-sm text-gray-400">材料情報はありません。</p>
          ) : (
            <div className="rounded-xl bg-white px-4 py-1 shadow-sm">
              <IngredientTable rows={orderedIngredients} factor={factor} />
            </div>
          )}
        </section>

        {/* 作り方（新しい形式なら、各工程に「その工程で使う材料」も表示） */}
        <section className="mt-6">
          <h2 className="font-semibold text-gray-800 mb-2">作り方</h2>
          {steps.length === 0 ? (
            <p className="text-sm text-gray-400">工程情報はありません。</p>
          ) : (
            <ol className="space-y-3">
              {steps.map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  ingredients={stepIngredients.get(step.id) ?? []}
                  factor={factor}
                  unresolvedSet={unresolvedSet}
                />
              ))}
            </ol>
          )}
        </section>

      </div>

      {/* 履歴（作った日付。新しい順） */}
      {sheet === 'history' && (
        <Sheet title={`🍳 作った履歴（${recipe.cook_count}回）`} onClose={() => setSheet(null)}>
          {cookLogsFailed ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              作った履歴を読み込めませんでした（11_cook_logs_migration.sql を実行済みか確認してください）。
            </p>
          ) : cookLogs.length === 0 ? (
            <p className="text-sm text-gray-400">
              日付の記録はまだありません。献立で「作った」にすると、ここに残ります。
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                {shownLogs.map((log) => (
                  <li key={log.id} className="px-4 py-2 text-sm text-gray-700">
                    {formatCookedDate(log.cooked_on)}
                  </li>
                ))}
              </ul>
              {cookLogs.length > LOG_PREVIEW && (
                <button
                  onClick={() => setShowAllLogs((v) => !v)}
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white py-2 text-xs font-semibold text-gray-600"
                >
                  {showAllLogs ? '閉じる ▲' : `すべて表示（${cookLogs.length}件） ▼`}
                </button>
              )}
              {recipe.cook_count > cookLogs.length && (
                <p className="mt-2 text-[11px] text-gray-400">
                  ※ 日付が残るのは、履歴機能を入れたあとに「作った」にした分だけです（それ以前の分は回数のみ）。
                </p>
              )}
            </>
          )}
        </Sheet>
      )}

      {/* 栄養素（カロリー・費用の内訳 ＋ 栄養価） */}
      {sheet === 'nutrition' && (
        <Sheet title="栄養素（1人前）" onClose={() => setSheet(null)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-400">カロリー(1人前)</p>
              <p className="text-lg font-semibold text-gray-800">{fmtVal(kcalPer, 'kcal')}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-400">費用(1人前)</p>
              <p className="text-lg font-semibold text-gray-800">{fmtVal(costPer, '円')}</p>
            </div>
          </div>
          {nutritionFailed && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              栄養・費用の計算ビュー（recipe_nutrition）を読み込めませんでした。
            </p>
          )}
          {unresolvedCount > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ※ 計算できていない材料が{unresolvedCount}件あります（材料に「未計算」と表示）。その分は金額・栄養に含まれていません。
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-400">※ 材料マスタの単価・栄養価から計算した目安です。</p>

          <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
            {nutrition == null ? (
              <p className="text-gray-400">栄養データがありません。</p>
            ) : (
              <>
                <div className="mb-1 text-xs font-semibold text-gray-500">栄養価</div>
                {nutrientRows.main.map((n) => (
                  <NutrientLine
                    key={String(n.key)}
                    label={n.label}
                    indent={INDENT_KEYS.includes(String(n.key))}
                    value={fmtVal(nv(nutrition, servingCol(String(n.key))), n.unit)}
                  />
                ))}
                <div className="mb-1 mt-3 border-t border-gray-100 pt-2 text-xs font-semibold text-gray-500">
                  ビタミン・ミネラル
                </div>
                {nutrientRows.micro.map((n) => (
                  <NutrientLine
                    key={String(n.key)}
                    label={n.label}
                    value={fmtVal(nv(nutrition, servingCol(String(n.key))), n.unit)}
                  />
                ))}
                <p className="mt-3 text-[11px] text-gray-400">
                  ※ マスタに値が入っていない材料は、その栄養素の合計に含まれません。
                </p>
              </>
            )}
          </div>
        </Sheet>
      )}

      {/* 追加／外したあとに出る「元に戻す」メッセージ */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            <button onClick={toast.onUndo} className="shrink-0 font-bold text-amber-300">
              元に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// 下から出てくる画面（履歴・栄養素）。外側をタップするか「閉じる」で閉じる
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end bg-black/40 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 sm:max-w-md sm:rounded-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
            閉じる
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// 栄養素の1行表示（ラベル ＋ 値）
function NutrientLine({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-gray-700">
      <span className={indent ? 'pl-4 text-gray-500' : ''}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// ---------- 材料表（買い物リストのカテゴリ順） ----------
// カテゴリ名は出さない。1つ前の行とカテゴリが違う行の上の線だけ、濃くする。同じ材料はまとめて合算して表示
function IngredientTable({ rows, factor }: { rows: OrderedRow<MergedRow>[]; factor: number }) {
  return (
    <ul>
      {rows.map(({ item: row, startsGroup }, i) => (
        <li
          key={row.key}
          className={`flex justify-between gap-2 py-1.5 text-sm ${
            i === 0 ? '' : startsGroup ? 'border-t border-gray-400' : 'border-t border-gray-100'
          }`}
        >
          <span className="min-w-0 text-gray-700">
            {row.name}
            {row.unresolved && (
              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                未計算
              </span>
            )}
          </span>
          <span className="shrink-0 text-right text-gray-500">{mergedAmount(row, factor)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------- 工程ごとの表示部品 ----------
// グループ記号（A・B…）の青い丸バッジ（工程番号のオレンジと見分けやすく）
function GroupBadge({ label, small }: { label: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-sky-600 font-bold text-white ${
        small ? 'mx-0.5 h-4 w-4 align-middle text-[10px]' : 'h-5 w-5 text-[11px]'
      }`}
    >
      {label}
    </span>
  )
}

// 工程の本文：[A] の部分だけバッジにする（例：「[A]を入れる」→「Ⓐを入れる」）
function StepText({ text }: { text: string }) {
  const parts = text.split(/\[([A-Z])\]/) // 奇数番目が、かっこの中の記号
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <GroupBadge key={i} label={part} small /> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

// 材料1行（名前＋下処理＋未計算マーク／右に分量）
function IngredientLine({
  ing,
  factor,
  unresolved,
}: {
  ing: IngredientRow
  factor: number
  unresolved: boolean
}) {
  return (
    <li className="flex justify-between gap-2 py-1 text-sm">
      <span className="min-w-0 text-gray-700">
        {ing.ingredient_name}
        {ing.preparation && <span className="text-gray-400">({ing.preparation})</span>}
        {unresolved && (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            未計算
          </span>
        )}
      </span>
      <span className="shrink-0 text-gray-500">{scaledAmount(ing.quantity, ing.unit, factor)}</span>
    </li>
  )
}

// 材料のかたまり：記号なしの材料はそのまま並べ、記号（A・B…）がある材料は、バッジ付きの囲みにまとめる
function StepIngredients({
  list,
  factor,
  unresolvedSet,
}: {
  list: IngredientRow[]
  factor: number
  unresolvedSet: Set<string>
}) {
  const blocks = buildBlocks(list)
  return (
    <div>
      {blocks.map((b, i) =>
        b.label ? (
          <div key={i} className="my-1 flex items-start gap-2 rounded-lg bg-sky-50 px-2 py-1">
            <span className="mt-1">
              <GroupBadge label={b.label} />
            </span>
            <ul className="min-w-0 flex-1 divide-y divide-sky-100">
              {b.items.map((ing) => (
                <IngredientLine key={ing.id} ing={ing} factor={factor} unresolved={unresolvedSet.has(ing.id)} />
              ))}
            </ul>
          </div>
        ) : (
          <ul key={i} className="divide-y divide-gray-100">
            {b.items.map((ing) => (
              <IngredientLine key={ing.id} ing={ing} factor={factor} unresolved={unresolvedSet.has(ing.id)} />
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

// 工程のカード：① 工程名 → 材料 → → 本文 → POINT
function StepCard({
  step,
  ingredients,
  factor,
  unresolvedSet,
}: {
  step: Step
  ingredients: IngredientRow[]
  factor: number
  unresolvedSet: Set<string>
}) {
  return (
    <li className="rounded-xl bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-semibold text-white">
          {step.step_number}
        </span>
        {step.step_name && <span className="text-sm font-medium text-gray-800">{step.step_name}</span>}
      </div>
      {ingredients.length > 0 && (
        <div className="mb-1 pl-8">
          <StepIngredients list={ingredients} factor={factor} unresolvedSet={unresolvedSet} />
        </div>
      )}
      {step.description && (
        <p className="pl-8 text-sm leading-relaxed text-gray-600">
          <span className="mr-1 font-bold text-amber-500">→</span>
          <StepText text={step.description} />
        </p>
      )}
      {step.tip && (
        <div className="ml-8 mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs leading-relaxed text-yellow-800">
          <span className="mr-1 font-bold">💡 POINT</span>
          <StepText text={step.tip} />
        </div>
      )}
    </li>
  )
}
