// ファイル: src/pages/RecipeDetailPage.tsx
// レシピ詳細画面:写真・基本情報・材料・工程・「作る予定」トグル

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { Ingredient, Recipe, Step } from '../types/recipe'
import { useRecipeImage } from '../lib/useRecipeImage'

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useOutletContext<{ session: Session }>()

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [togglingPlanned, setTogglingPlanned] = useState(false)

  const imageUrl = useRecipeImage(recipe?.image_path ?? null)

  useEffect(() => {
    if (!id) return
    let isCancelled = false

    const fetchDetail = async () => {
      setLoading(true)
      setErrorMessage(null)

      const [recipeResult, ingredientsResult, stepsResult] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase.from('ingredients').select('*').eq('recipe_id', id).order('sort_order'),
        supabase.from('steps').select('*').eq('recipe_id', id).order('step_number'),
      ])

      if (isCancelled) return

      if (recipeResult.error) {
        setErrorMessage('レシピが見つかりませんでした。')
        setLoading(false)
        return
      }

      setRecipe(recipeResult.data as Recipe)
      setIngredients((ingredientsResult.data as Ingredient[]) ?? [])
      setSteps((stepsResult.data as Step[]) ?? [])
      setLoading(false)
    }

    fetchDetail()

    return () => {
      isCancelled = true
    }
  }, [id])

  const handleTogglePlanned = async () => {
    if (!recipe) return
    setTogglingPlanned(true)

    const nextIsPlanned = !recipe.is_planned
    const { error } = await supabase
      .from('recipes')
      .update({
        is_planned: nextIsPlanned,
        planned_by: nextIsPlanned ? session.user.id : null,
        planned_at: nextIsPlanned ? new Date().toISOString() : null,
      })
      .eq('id', recipe.id)

    setTogglingPlanned(false)

    if (error) {
      alert('更新に失敗しました: ' + error.message)
      return
    }

    setRecipe({ ...recipe, is_planned: nextIsPlanned })
  }

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
        <button
          onClick={() => navigate('/recipes')}
          className="text-amber-600 underline text-sm"
        >
          一覧に戻る
        </button>
      </div>
    )
  }

  const totalCalories =
    recipe.calories_per_serving != null ? recipe.calories_per_serving * recipe.servings : null
  const totalCost =
    recipe.cost_per_serving != null ? recipe.cost_per_serving * recipe.servings : null

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
        <button
          onClick={() => navigate('/recipes')}
          className="text-sm text-gray-500 mb-3"
        >
          ← 一覧に戻る
        </button>

        <h1 className="text-xl font-bold text-gray-900">{recipe.dish_name}</h1>
        {(recipe.genre || recipe.category) && (
          <p className="text-sm text-gray-400 mt-0.5">
            {recipe.genre}{recipe.genre && recipe.category ? ' ・ ' : ''}{recipe.category}
          </p>
        )}

        {/* 作る予定トグル */}
        <button
          onClick={handleTogglePlanned}
          disabled={togglingPlanned}
          className={`mt-4 w-full rounded-lg py-2.5 font-semibold transition disabled:opacity-50 ${
            recipe.is_planned
              ? 'bg-amber-100 text-amber-700 border border-amber-400'
              : 'bg-amber-500 text-white'
          }`}
        >
          {recipe.is_planned ? '✓ 作る予定に入っています(タップで解除)' : '作る予定に追加する'}
        </button>

        {/* カロリー・費用 */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400">カロリー(目安)</p>
            <p className="text-lg font-semibold text-gray-800">
              {recipe.calories_per_serving ?? '—'} kcal/人前
            </p>
            {totalCalories != null && (
              <p className="text-xs text-gray-400">合計 約{totalCalories}kcal({recipe.servings}人前)</p>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-xs text-gray-400">費用(目安)</p>
            <p className="text-lg font-semibold text-gray-800">
              {recipe.cost_per_serving ?? '—'} 円/人前
            </p>
            {totalCost != null && (
              <p className="text-xs text-gray-400">合計 約{totalCost}円({recipe.servings}人前)</p>
            )}
          </div>
        </div>

        {/* 材料 */}
        <section className="mt-6">
          <h2 className="font-semibold text-gray-800 mb-2">
            材料({recipe.servings}人前)
          </h2>
          {ingredients.length === 0 ? (
            <p className="text-sm text-gray-400">材料情報はありません。</p>
          ) : (
            <ul className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
              {ingredients.map((ing) => (
                <li key={ing.id} className="flex justify-between px-4 py-2 text-sm">
                  <span className="text-gray-700">
                    {ing.ingredient_name}
                    {ing.preparation && (
                      <span className="text-gray-400">({ing.preparation})</span>
                    )}
                  </span>
                  <span className="text-gray-500">
                    {ing.quantity ?? ''}{ing.unit ?? ''}
                  </span>
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
                  {step.description && (
                    <p className="text-sm text-gray-600 pl-8">{step.description}</p>
                  )}
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