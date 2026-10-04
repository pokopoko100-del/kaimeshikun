// src/pages/RecipeListPage.tsx（ファイル全体。これで丸ごと置き換えてください）
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import type { Recipe as RecipeBase } from '../types/recipe' // 共通の型を読み込む

// 独自定義をやめて、共通のRecipe型から一覧で使う項目だけ抜き出す
type Recipe = Pick<
  RecipeBase,
  | 'id'
  | 'dish_name'
  | 'source_name'
  | 'calories_per_serving'
  | 'cost_per_serving'
  | 'cooking_time_minutes'
  | 'cook_count'
  | 'image_path'
  | 'is_planned'
>

const BUCKET = 'recipe-images'

export default function RecipeListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [plannedOnly, setPlannedOnly] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          'id, dish_name, source_name, calories_per_serving, cost_per_serving, cooking_time_minutes, cook_count, image_path, is_planned'
        )
        .order('updated_at', { ascending: false })

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      const list = (data ?? []) as Recipe[]
      setRecipes(list)

      // 非公開バケットなので署名付きURLをまとめて発行（1時間有効）
      const paths = list.map((r) => r.image_path).filter((p): p is string => !!p)
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
        const map: Record<string, string> = {}
        signed?.forEach((s) => {
          if (s.path && s.signedUrl) map[s.path] = s.signedUrl
        })
        setImageUrls(map)
      }
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return recipes.filter((r) => {
      if (plannedOnly && !r.is_planned) return false
      if (!k) return true
      return (
        r.dish_name.toLowerCase().includes(k) ||
        (r.source_name ?? '').toLowerCase().includes(k)
      )
    })
  }, [recipes, keyword, plannedOnly])

  return (
    <div>
      {/* 上部：検索バー（スクロールしても固定） */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur px-3 pt-3 pb-2 border-b border-gray-100">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="🔍 料理名・引用元で検索"
          className="w-full rounded-full bg-gray-100 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-300"
        />
        <div className="mt-2 flex gap-2">
          <Chip active={!plannedOnly} onClick={() => setPlannedOnly(false)}>すべて</Chip>
          <Chip active={plannedOnly} onClick={() => setPlannedOnly(true)}>作る予定</Chip>
        </div>
      </header>

      {error && <p className="p-4 text-sm text-red-600">読み込みエラー：{error}</p>}

      {/* 2列グリッド */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-2">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : filtered.map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
              />
            ))}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="p-8 text-center text-sm text-gray-400">レシピが見つかりません</p>
      )}
    </div>
  )
}

function RecipeCard({ recipe: r, imageUrl }: { recipe: Recipe; imageUrl?: string }) {
  const title = r.source_name ? `${r.dish_name} / ${r.source_name}` : r.dish_name

  return (
    <Link to={`/recipes/${r.id}`} className="block active:opacity-70">
      {/* サムネ（16:9） */}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-gray-200">
        {imageUrl ? (
          <img src={imageUrl} alt={r.dish_name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🍽️</div>
        )}

        {r.is_planned && (
          <span className="absolute left-1 top-1 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            作る予定
          </span>
        )}

        {/* YouTubeの再生時間風に、右下へ調理時間 */}
        {r.cooking_time_minutes != null && (
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
            ⏱ {r.cooking_time_minutes}分
          </span>
        )}
      </div>

      {/* タイトル：料理名 / 引用元（最大2行） */}
      <p className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-snug text-gray-900">{title}</p>

      {/* メタ情報 */}
      <p className="mt-0.5 text-[11px] text-gray-500">
        {r.calories_per_serving != null ? `${Math.round(r.calories_per_serving)}kcal` : '—kcal'}
        {' ・ '}
        {r.cost_per_serving != null ? `¥${r.cost_per_serving.toLocaleString()}` : '¥—'}
        {' ・ '}
        {r.cook_count}回作った
      </p>
    </Link>
  )
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-xl bg-gray-200" />
      <div className="mt-2 h-3 w-4/5 rounded bg-gray-200" />
      <div className="mt-1.5 h-3 w-3/5 rounded bg-gray-200" />
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1 text-xs font-bold ${
        active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
