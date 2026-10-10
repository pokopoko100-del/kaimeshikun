// src/components/RecipesUsingSheet.tsx（新規作成）
// 「この材料を使うレシピ」の一覧（下から出る画面）。タップすると、そのレシピの詳細画面へ移動する
//   ・材料マスタに結び付いているレシピが対象。名前が同じでも結び付いていないレシピは「未結び付け」と表示する
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorText } from '../lib/errorText'
import type { RecipeUsage } from '../lib/ingredientMasterEdit'
import { fetchRecipesUsing } from '../lib/ingredientMasterEdit'
import { useRecipeImage } from '../lib/useRecipeImage'

function Thumb({ path }: { path: string | null }) {
  const url = useRecipeImage(path)
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-xl">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : '🍽️'}
    </div>
  )
}

export default function RecipesUsingSheet({
  master,
  onClose,
}: {
  master: { id: string; name: string }
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<RecipeUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchRecipesUsing({ id: master.id, name: master.name })
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [master.id, master.name])

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 sm:max-w-md sm:rounded-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-base font-bold text-gray-900">🍳 「{master.name}」を使うレシピ</h3>
          <button onClick={onClose} className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
            閉じる
          </button>
        </div>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">レシピを検索できませんでした：{error}</p>
        ) : rows === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">この材料を使うレシピは、まだありません。</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-400">{rows.length}件（作った回数が多い順）</p>
            <ul className="space-y-2">
              {rows.map(({ recipe, amounts, linked }) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/recipes/${recipe.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-gray-100 p-2 text-left active:bg-gray-50"
                  >
                    <Thumb path={recipe.image_path} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-gray-900">{recipe.dish_name}</span>
                      <span className="block truncate text-[11px] text-gray-400">
                        {[recipe.source_name, recipe.genre, recipe.category].filter(Boolean).join(' ・ ')}
                      </span>
                      <span className="block truncate text-[11px] text-gray-500">
                        {amounts.length > 0 ? `${master.name} ${amounts.join('、')}` : master.name}
                        {recipe.cook_count > 0 && <span className="text-gray-400">　🍳{recipe.cook_count}回</span>}
                        {!linked && (
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            未結び付け
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-gray-300">›</span>
                  </button>
                </li>
              ))}
            </ul>
            {rows.some((r) => !r.linked) && (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                「未結び付け」は、材料名が同じだけで、材料マスタに結び付いていないレシピです（カロリー・費用は、その材料ぶんが「未計算」になります）。
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
