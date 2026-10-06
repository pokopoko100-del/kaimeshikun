// src/pages/RecipeDetailPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：recipe_nutrition ビュー（01）と、recipes.plan_confirmed 列（09）を作成済みであること
// 今回の変更：
//  ・「作る予定」ボタンを「献立候補」に変更。状態は 未追加／候補／確定 の3つを表示
//  ・追加は「候補」から。外すときは確定も解除（確定・作ったは献立画面で行う）
// これまでの内容：
//  ・カロリー／費用／栄養素は recipe_nutrition ビュー（材料マスタから計算）から表示（1人前あたり＋合計）
//  ・栄養素（たんぱく質・ビタミン・ミネラルなど）をタップで開閉
//  ・計算できていない材料には「未計算」マーク
//  ・分量は「大さじ3」のように、大さじ・小さじは単位を先頭に表示
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { Ingredient, Recipe, Step } from '../types/recipe'
import { useRecipeImage } from '../lib/useRecipeImage'
import { NUTRIENT_INFO_LIST } from '../data/nutrientInfo'
import type { NutrientInfo } from '../data/nutrientInfo'

// 材料 ＋ 紐付いたマスタの単位情報（未計算の判定に使う）
type IngredientRow = Ingredient & {
  ingredient_master: { default_unit: string | null; unit_weight_g: number | null } | null
}

// recipe_nutrition ビューの1行
type NutritionRow = Record<string, number | string | null>

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
  return m.default_unit != null && ing.unit === m.default_unit && m.unit_weight_g != null
}

// ---------- 表示用ヘルパー ----------

// 分量の表示：「大さじ」「小さじ」は単位が先頭（大さじ3）、それ以外は数量が先頭（300g・2個）
function formatAmount(quantity: string | null, unit: string | null): string {
  const q = quantity ?? ''
  const u = unit ?? ''
  if (u === '大さじ' || u === '小さじ') return `${u}${q}`
  return `${q}${u}`
}

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

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useOutletContext<{ session: Session }>()

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [nutrition, setNutrition] = useState<NutritionRow | null>(null)
  const [nutritionFailed, setNutritionFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [togglingPlanned, setTogglingPlanned] = useState(false)
  const [showNutrients, setShowNutrients] = useState(false)

  const imageUrl = useRecipeImage(recipe?.image_path ?? null)

  useEffect(() => {
    if (!id) return
    let isCancelled = false

    const fetchDetail = async () => {
      setLoading(true)
      setErrorMessage(null)

      const [recipeResult, ingredientsResult, stepsResult, nutritionResult] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase
          .from('ingredients')
          .select('*, ingredient_master(default_unit, unit_weight_g)')
          .eq('recipe_id', id)
          .order('sort_order'),
        supabase.from('steps').select('*').eq('recipe_id', id).order('step_number'),
        supabase.from('recipe_nutrition').select('*').eq('recipe_id', id).maybeSingle(),
      ])

      if (isCancelled) return

      if (recipeResult.error) {
        setErrorMessage('レシピが見つかりませんでした。')
        setLoading(false)
        return
      }

      setRecipe(recipeResult.data as Recipe)

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
      setLoading(false)
    }

    fetchDetail()
    return () => {
      isCancelled = true
    }
  }, [id])

  // 献立候補の追加／外す。追加は「候補」から。外すときは確定も解除する
  const handleTogglePlanned = async () => {
    if (!recipe) return
    setTogglingPlanned(true)
    const adding = !recipe.is_planned
    const { data, error } = await supabase
      .from('recipes')
      .update({
        is_planned: adding,
        plan_confirmed: false,
        planned_by: adding ? session.user.id : null,
        planned_at: adding ? new Date().toISOString() : null,
      })
      .eq('id', recipe.id)
      .select('id')
    setTogglingPlanned(false)

    if (error || !data || data.length === 0) {
      alert('更新に失敗しました: ' + (error?.message ?? '権限を確認してください'))
      return
    }
    setRecipe({ ...recipe, is_planned: adding, plan_confirmed: false })
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

  // 1人前あたり（ビューの値）と合計
  const kcalPer = nv(nutrition, 'calorie_per_serving')
  const costPer = nv(nutrition, 'price_per_serving')
  const totalKcal = kcalPer != null ? Math.round(kcalPer * recipe.servings) : null
  const totalCost = costPer != null ? Math.round(costPer * recipe.servings) : null
  const unresolvedCount = unresolvedSet.size

  // 献立の状態：未追加／候補／確定
  const planState: 'none' | 'candidate' | 'confirmed' = !recipe.is_planned
    ? 'none'
    : recipe.plan_confirmed
      ? 'confirmed'
      : 'candidate'

  return (
    <div className="max-w-md mx-auto pb-6">
      {/* 写真 */}
      <div className="w-full h-56 bg-gray-100 flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt={recipe.dish_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-5xl">🍚</span>
        )}
      </div>

      <div className="p-4">
        {/* 戻るボタン */}
        <button onClick={() => navigate('/recipes')} className="text-sm text-gray-500 mb-3">
          ← 一覧に戻る
        </button>

        <h1 className="text-xl font-bold text-gray-900">{recipe.dish_name}</h1>
        {(recipe.genre || recipe.category) && (
          <p className="text-sm text-gray-400 mt-0.5">
            {recipe.genre}
            {recipe.genre && recipe.category ? ' ・ ' : ''}
            {recipe.category}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          ⏱ {recipe.cooking_time_minutes != null ? `${recipe.cooking_time_minutes}分` : '―'}
          {' ・ '}
          {recipe.cook_count}回作った
        </p>

        {/* 献立候補トグル（確定・作ったは献立画面で行う） */}
        <button
          onClick={handleTogglePlanned}
          disabled={togglingPlanned}
          className={`mt-4 w-full rounded-lg py-2.5 font-semibold transition disabled:opacity-50 ${
            planState === 'none'
              ? 'bg-amber-500 text-white'
              : planState === 'candidate'
                ? 'bg-amber-100 text-amber-700 border border-amber-400'
                : 'bg-green-100 text-green-700 border border-green-400'
          }`}
        >
          {planState === 'none' && '献立候補に追加する'}
          {planState === 'candidate' && '✓ 献立候補に入っています(タップで外す)'}
          {planState === 'confirmed' && '✓ 献立に確定済みです(タップで外す)'}
        </button>
        {planState !== 'none' && (
          <p className="mt-1 text-center text-[11px] text-gray-400">
            確定・作ったの操作は、下の「献立」タブで行えます
          </p>
        )}

        {/* カロリー・費用（材料マスタから計算した1人前あたり） */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400">カロリー(1人前)</p>
            <p className="text-lg font-semibold text-gray-800">{fmtVal(kcalPer, 'kcal')}</p>
            {totalKcal != null && (
              <p className="text-xs text-gray-400">
                合計 約{totalKcal}kcal({recipe.servings}人前)
              </p>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400">費用(1人前)</p>
            <p className="text-lg font-semibold text-gray-800">{fmtVal(costPer, '円')}</p>
            {totalCost != null && (
              <p className="text-xs text-gray-400">
                合計 約{totalCost}円({recipe.servings}人前)
              </p>
            )}
          </div>
        </div>

        {/* 計算できなかったときの注意 */}
        {nutritionFailed && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            栄養・費用の計算ビュー（recipe_nutrition）を読み込めませんでした。
          </p>
        )}
        {unresolvedCount > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ※ 計算できていない材料が{unresolvedCount}件あります（下の材料に「未計算」と表示）。その分は金額・栄養に含まれていません。
          </p>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          ※ 材料マスタの単価・栄養価から計算した目安です。
        </p>

        {/* 栄養素（タップで開閉） */}
        <section className="mt-4">
          <button
            onClick={() => setShowNutrients((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm"
          >
            <span className="font-semibold text-gray-800">栄養素（1人前あたり）</span>
            <span className="text-sm text-gray-400">{showNutrients ? '閉じる ▲' : '開く ▼'}</span>
          </button>

          {showNutrients && (
            <div className="mt-2 rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
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
          )}
        </section>

        {/* 材料 */}
        <section className="mt-6">
          <h2 className="font-semibold text-gray-800 mb-2">材料({recipe.servings}人前)</h2>
          {ingredients.length === 0 ? (
            <p className="text-sm text-gray-400">材料情報はありません。</p>
          ) : (
            <ul className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
              {ingredients.map((ing) => (
                <li key={ing.id} className="flex justify-between px-4 py-2 text-sm">
                  <span className="text-gray-700">
                    {ing.ingredient_name}
                    {ing.preparation && <span className="text-gray-400">({ing.preparation})</span>}
                    {unresolvedSet.has(ing.id) && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        未計算
                      </span>
                    )}
                  </span>
                  <span className="text-gray-500">{formatAmount(ing.quantity, ing.unit)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 作り方 */}
        <section className="mt-6">
          <h2 className="font-semibold text-gray-800 mb-2">作り方</h2>
          {steps.length === 0 ? (
            <p className="text-sm text-gray-400">工程情報はありません。</p>
          ) : (
            <ol className="space-y-3">
              {steps.map((step) => (
                <li key={step.id} className="bg-white rounded-xl shadow-sm p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-semibold">
                      {step.step_number}
                    </span>
                    {step.step_name && (
                      <span className="font-medium text-gray-800 text-sm">{step.step_name}</span>
                    )}
                  </div>
                  {step.description && <p className="text-sm text-gray-600 pl-8">{step.description}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 参考元情報 */}
        {(recipe.source_name || recipe.source_url) && (
          <section className="mt-6 text-xs text-gray-400">
            <p>参考元: {recipe.source_name}</p>
            {recipe.source_url && (
              <a href={recipe.source_url} target="_blank" rel="noreferrer" className="underline break-all">
                {recipe.source_url}
              </a>
            )}
          </section>
        )}
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
