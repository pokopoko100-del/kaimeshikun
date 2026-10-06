// src/pages/RecipeListPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：Supabaseに recipe_nutrition ビューを作成済みであること（01_recipe_nutrition_view.sql）
// 機能：
//  ・表示切替：「写真」（YouTube風2列）／「リスト」（材料画面と同じUI）
//  ・絞り込み：すべて／作る予定（1行目）、ジャンル 和食・洋食・中華・エスニック・その他（2行目）、
//             サブカテゴリ 主菜・副菜・つまみ・汁物・スープ・麺・丼・ワンプレート・デザート・ソース・調味料（3行目）
//  ・並び替え：作った回数が多い順（既定）／値段が安い順／カロリーが低い順／調理時間が短い順
//             ／栄養素が多い順／食塩・脂質・糖質が少ない順
//  ・値は「1人前あたり」。材料マスタから計算（未計算の材料があれば※表示、並び替えでは後ろへ）
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import type { Recipe as RecipeBase } from '../types/recipe'
import type { IngredientMaster } from '../types/ingredient'
import { NUTRIENT_INFO_LIST, getNutrientInfo } from '../data/nutrientInfo'

// 一覧で使う項目だけ抜き出す
type Recipe = Pick<
  RecipeBase,
  | 'id'
  | 'dish_name'
  | 'genre'
  | 'category'
  | 'source_name'
  | 'cooking_time_minutes'
  | 'cook_count'
  | 'image_path'
  | 'is_planned'
  | 'updated_at'
>

// recipe_nutrition ビューの1行（列名は *_per_serving。値は number か null）
type NutritionRow = Record<string, number | string | null>

type RecipeRow = Recipe & { nutrition: NutritionRow | null }

const BUCKET = 'recipe-images'

// ---------- ジャンル ----------
const GENRES = ['和食', '洋食', '中華', 'エスニック'] as const
type GenreFilter = 'すべて' | (typeof GENRES)[number] | 'その他'
const GENRE_CHIPS: GenreFilter[] = [...GENRES, 'その他']

const GENRE_COLOR: Record<string, string> = {
  和食: 'bg-red-100 text-red-700',
  洋食: 'bg-blue-100 text-blue-700',
  中華: 'bg-orange-100 text-orange-700',
  エスニック: 'bg-green-100 text-green-700',
  その他: 'bg-gray-100 text-gray-700',
}

function genreOf(r: { genre: string | null }): string {
  return r.genre && (GENRES as readonly string[]).includes(r.genre) ? r.genre : 'その他'
}

// ---------- サブカテゴリ（recipes.category に保存する値） ----------
const CATEGORIES = [
  '主菜',
  '副菜・つまみ',
  '汁物・スープ',
  '麺・丼・ワンプレート',
  'デザート',
  'ソース・調味料',
] as const
type CategoryFilter = 'すべて' | (typeof CATEGORIES)[number]

// ---------- 並び替えの定義 ----------
// 栄養素の「多い順」「少ない順」。キーは材料マスタ側の列名（nutrientInfo.ts と共通）
const HIGH_KEYS: (keyof IngredientMaster)[] = [
  'protein_g_per_100g',
  'dietary_fiber_g_per_100g',
  'vitamin_a_ug_per_100g',
  'vitamin_b1_mg_per_100g',
  'vitamin_b2_mg_per_100g',
  'vitamin_b6_mg_per_100g',
  'vitamin_b12_ug_per_100g',
  'folate_ug_per_100g',
  'vitamin_c_mg_per_100g',
  'vitamin_d_ug_per_100g',
  'vitamin_e_mg_per_100g',
  'calcium_mg_per_100g',
  'iron_mg_per_100g',
  'zinc_mg_per_100g',
  'potassium_mg_per_100g',
  'magnesium_mg_per_100g',
]
const LOW_KEYS: (keyof IngredientMaster)[] = [
  'salt_g_per_100g',
  'fat_g_per_100g',
  'sugar_g_per_100g',
]

// 材料マスタの列名 → ビューの列名（xxx_per_100g → xxx_per_serving）
function servingCol(key: string): string {
  return key.replace('_per_100g', '_per_serving')
}

type SortOption = { value: string; label: string }

const BASIC_SORTS: SortOption[] = [
  { value: 'cook_count', label: '作った回数が多い順' },
  { value: 'price_asc', label: '値段が安い順' },
  { value: 'calorie_asc', label: 'カロリーが低い順' },
  { value: 'time_asc', label: '調理時間が短い順' },
]

function nutrientLabel(key: keyof IngredientMaster): string {
  return getNutrientInfo(key)?.label ?? String(key)
}

const HIGH_SORTS: SortOption[] = HIGH_KEYS.filter((k) =>
  NUTRIENT_INFO_LIST.some((n) => n.key === k),
).map((k) => ({ value: `high:${k}`, label: `${nutrientLabel(k)}が多い順` }))

const LOW_SORTS: SortOption[] = LOW_KEYS.filter((k) =>
  NUTRIENT_INFO_LIST.some((n) => n.key === k),
).map((k) => ({ value: `low:${k}`, label: `${nutrientLabel(k)}が少ない順` }))

// 並び替えの値の取り方（栄養系のみ）。nutrition系は未計算・値なしを後ろへ回す
type SortSpec = { col: string; dir: 'asc' | 'desc' } | null

function getSortSpec(sortKey: string): SortSpec {
  if (sortKey === 'price_asc') return { col: 'price_per_serving', dir: 'asc' }
  if (sortKey === 'calorie_asc') return { col: 'calorie_per_serving', dir: 'asc' }
  if (sortKey.startsWith('high:')) return { col: servingCol(sortKey.slice(5)), dir: 'desc' }
  if (sortKey.startsWith('low:')) return { col: servingCol(sortKey.slice(4)), dir: 'asc' }
  return null
}

// ---------- 表示用ヘルパー ----------
type ViewMode = 'photo' | 'list'
const VIEW_MODE_KEY = 'kaimeshi.recipeViewMode'

function roundSmart(value: number): number {
  const abs = Math.abs(value)
  if (abs === 0) return 0
  if (abs >= 10) return Math.round(value)
  if (abs >= 1) return Math.round(value * 10) / 10
  return Math.round(value * 100) / 100
}

function nv(r: RecipeRow, col: string): number | null {
  const v = r.nutrition?.[col]
  return typeof v === 'number' ? v : null
}

function unresolvedCount(r: RecipeRow): number {
  const v = r.nutrition?.unresolved_count
  return typeof v === 'number' ? v : 0
}

function fmtVal(value: number | null, unit: string): string {
  if (value == null) return '―'
  return `${roundSmart(value)}${unit}`
}

export default function RecipeListPage() {
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nutritionNotice, setNutritionNotice] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [plannedOnly, setPlannedOnly] = useState(false)
  const [genreFilter, setGenreFilter] = useState<GenreFilter>('すべて')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('すべて')
  const [sortKey, setSortKey] = useState<string>('cook_count')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'photo',
  )

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }

  useEffect(() => {
    ;(async () => {
      const [recipeRes, nutritionRes] = await Promise.all([
        supabase
          .from('recipes')
          .select(
            'id, dish_name, genre, category, source_name, cooking_time_minutes, cook_count, image_path, is_planned, updated_at',
          )
          .order('updated_at', { ascending: false }),
        supabase.from('recipe_nutrition').select('*'),
      ])

      if (recipeRes.error) {
        setError(recipeRes.error.message)
        setLoading(false)
        return
      }

      // 栄養ビューが無い／読めない場合でも、レシピ自体は表示する
      const nutritionMap = new Map<string, NutritionRow>()
      if (nutritionRes.error) {
        console.error(nutritionRes.error)
        setNutritionNotice('栄養・費用の計算ビュー（recipe_nutrition）を読み込めませんでした。SQLの実行を確認してください。')
      } else {
        ;((nutritionRes.data ?? []) as NutritionRow[]).forEach((n) => {
          nutritionMap.set(String(n.recipe_id), n)
        })
      }

      const list: RecipeRow[] = ((recipeRes.data ?? []) as Recipe[]).map((r) => ({
        ...r,
        nutrition: nutritionMap.get(r.id) ?? null,
      }))
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

  // 絞り込み
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return recipes.filter((r) => {
      if (plannedOnly && !r.is_planned) return false
      if (genreFilter !== 'すべて' && genreOf(r) !== genreFilter) return false
      if (categoryFilter !== 'すべて' && r.category !== categoryFilter) return false
      if (!k) return true
      return (
        r.dish_name.toLowerCase().includes(k) ||
        (r.source_name ?? '').toLowerCase().includes(k) ||
        (r.genre ?? '').toLowerCase().includes(k) ||
        (r.category ?? '').toLowerCase().includes(k)
      )
    })
  }, [recipes, keyword, plannedOnly, genreFilter, categoryFilter])

  // 並び替え
  const sorted = useMemo(() => {
    const arr = [...filtered]
    const byUpdated = (a: RecipeRow, b: RecipeRow) => b.updated_at.localeCompare(a.updated_at)

    if (sortKey === 'cook_count') {
      return arr.sort((a, b) => b.cook_count - a.cook_count || byUpdated(a, b))
    }

    if (sortKey === 'time_asc') {
      return arr.sort((a, b) => {
        const ta = a.cooking_time_minutes
        const tb = b.cooking_time_minutes
        if (ta == null && tb == null) return byUpdated(a, b)
        if (ta == null) return 1
        if (tb == null) return -1
        return ta - tb || byUpdated(a, b)
      })
    }

    const spec = getSortSpec(sortKey)
    if (!spec) return arr

    // 値があり、かつ未計算の材料が無いレシピだけを「有効」とし、先に並べる
    const isValid = (r: RecipeRow) => nv(r, spec.col) != null && unresolvedCount(r) === 0
    return arr.sort((a, b) => {
      const va = isValid(a)
      const vb = isValid(b)
      if (va && !vb) return -1
      if (!va && vb) return 1
      if (!va && !vb) return byUpdated(a, b)
      const x = nv(a, spec.col) as number
      const y = nv(b, spec.col) as number
      return (spec.dir === 'asc' ? x - y : y - x) || byUpdated(a, b)
    })
  }, [filtered, sortKey])

  // 栄養素で並べているとき、カードに出す値
  const sortNutrient = useMemo(() => {
    if (sortKey.startsWith('high:') || sortKey.startsWith('low:')) {
      const key = sortKey.split(':')[1] as keyof IngredientMaster
      return getNutrientInfo(key)
    }
    return null
  }, [sortKey])
  const sortNutrientCol = sortNutrient ? servingCol(String(sortNutrient.key)) : null

  // 「すべて」：作る予定・ジャンル・サブカテゴリをまとめて解除
  const handleSelectAll = () => {
    setPlannedOnly(false)
    setGenreFilter('すべて')
    setCategoryFilter('すべて')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 上部固定エリア */}
      <header className="sticky top-0 z-40 bg-white px-3 pt-3 pb-2 shadow-sm">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="🔍 料理名・引用元で検索"
          className="w-full rounded-full bg-gray-100 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-300"
        />

        {/* 1段目：すべて・作る予定　／　右端：表示切替 */}
        <div className="mt-2 flex items-center gap-2">
          <Chip
            active={!plannedOnly && genreFilter === 'すべて' && categoryFilter === 'すべて'}
            onClick={handleSelectAll}
          >
            すべて
          </Chip>
          <Chip active={plannedOnly} onClick={() => setPlannedOnly((p) => !p)}>
            作る予定
          </Chip>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-gray-200 text-xs font-bold">
            <button
              onClick={() => changeViewMode('photo')}
              className={`px-2.5 py-1 ${viewMode === 'photo' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
            >
              🖼️ 写真
            </button>
            <button
              onClick={() => changeViewMode('list')}
              className={`px-2.5 py-1 ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
            >
              📋 リスト
            </button>
          </div>
        </div>

        {/* 2段目：ジャンル */}
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {GENRE_CHIPS.map((g) => (
            <Chip key={g} active={genreFilter === g} onClick={() => setGenreFilter((prev) => (prev === g ? 'すべて' : g))}>
              {g}
            </Chip>
          ))}
        </div>

        {/* 3段目：サブカテゴリ（横スクロール） */}
        <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={categoryFilter === c}
              onClick={() => setCategoryFilter((prev) => (prev === c ? 'すべて' : c))}
            >
              {c}
            </Chip>
          ))}
        </div>

        {/* 栄養素（多い順）を選んだときだけ、働きを表示 */}
        {sortNutrient && sortKey.startsWith('high:') && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
            <p className="font-semibold text-amber-700">多い順：{sortNutrient.label}</p>
            <p className="mt-0.5">
              <span className="font-bold text-green-600">　＋　</span>
              {sortNutrient.effectTags.join('、')}
            </p>
            <p>
              <span className="font-bold text-red-500">　－　</span>
              {sortNutrient.deficiencyTags.join('、')}
            </p>
          </div>
        )}

        {/* 並び替え */}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">並び替え：</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-amber-500 focus:outline-none"
          >
            <optgroup label="基本">
              {BASIC_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="栄養素（多い順）">
              {HIGH_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="栄養素（少ない順）">
              {LOW_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* 件数（左）＋「1人前あたり」の固定表示（右） */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>{loading ? '読み込み中…' : `${sorted.length}件`}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">1人前あたり</span>
        </div>
      </header>

      {error && <p className="p-4 text-sm text-red-600">読み込みエラー：{error}</p>}
      {nutritionNotice && (
        <p className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{nutritionNotice}</p>
      )}

      {/* 一覧 */}
      {viewMode === 'photo' ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-2">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : sorted.map((r) => (
                <PhotoCard
                  key={r.id}
                  recipe={r}
                  imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
                  sortNutrient={sortNutrient ? { label: sortNutrient.label, unit: sortNutrient.unit, col: sortNutrientCol as string } : null}
                />
              ))}
        </div>
      ) : (
        <div className="space-y-2 px-3 pt-2">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-200" />
              ))
            : sorted.map((r) => (
                <ListCard
                  key={r.id}
                  recipe={r}
                  imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
                  sortNutrient={sortNutrient ? { label: sortNutrient.label, unit: sortNutrient.unit, col: sortNutrientCol as string } : null}
                />
              ))}
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <p className="p-8 text-center text-sm text-gray-400">レシピが見つかりません</p>
      )}
    </div>
  )
}

type SortNutrientInfo = { label: string; unit: string; col: string } | null

// ---------- 写真表示（YouTube風2列） ----------
function PhotoCard({
  recipe: r,
  imageUrl,
  sortNutrient,
}: {
  recipe: RecipeRow
  imageUrl?: string
  sortNutrient: SortNutrientInfo
}) {
  const title = r.source_name ? `${r.dish_name} / ${r.source_name}` : r.dish_name
  const kcal = nv(r, 'calorie_per_serving')
  const price = nv(r, 'price_per_serving')
  const unresolved = unresolvedCount(r)

  return (
    <Link to={`/recipes/${r.id}`} className="block active:opacity-70">
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
        {r.cooking_time_minutes != null && (
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
            ⏱ {r.cooking_time_minutes}分
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-snug text-gray-900">{title}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {sortNutrient
          ? `${sortNutrient.label} ${fmtVal(nv(r, sortNutrient.col), sortNutrient.unit)}`
          : fmtVal(kcal, 'kcal')}
        {' ・ '}
        {fmtVal(price, '円')}
        {' ・ '}
        {r.cook_count}回
        {unresolved > 0 && <span className="ml-1 text-amber-600">※未計算あり</span>}
      </p>
    </Link>
  )
}

// ---------- リスト表示（材料画面と同じUI） ----------
function ListCard({
  recipe: r,
  imageUrl,
  sortNutrient,
}: {
  recipe: RecipeRow
  imageUrl?: string
  sortNutrient: SortNutrientInfo
}) {
  const genre = genreOf(r)
  const kcal = nv(r, 'calorie_per_serving')
  const price = nv(r, 'price_per_serving')
  const unresolved = unresolvedCount(r)

  return (
    <Link to={`/recipes/${r.id}`} className="block rounded-xl bg-white shadow-sm active:opacity-70">
      <div className="flex items-center px-4 py-3">
        {/* 左：①ジャンル＋サブカテゴリ＋作る予定 ②料理名 ③引用元（左揃え） */}
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${GENRE_COLOR[genre]}`}>{genre}</span>
            {r.category && (
              <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{r.category}</span>
            )}
            {r.is_planned && (
              <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
                作る予定
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-medium text-gray-800">{r.dish_name}</div>
          {r.source_name && <div className="mt-0.5 truncate text-xs text-gray-400">{r.source_name}</div>}
        </div>

        {/* 中央：サムネ（写真があるときだけ小さく） */}
        {imageUrl && (
          <div className="mx-2 h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
            <img src={imageUrl} alt={r.dish_name} loading="lazy" className="h-full w-full object-cover" />
          </div>
        )}

        {/* 右：上段＝1人前の値（大きめ）／下段＝調理時間・作った回数（小さめ） */}
        <div className="ml-2 shrink-0 whitespace-nowrap text-right">
          <div className="flex items-baseline justify-end gap-3 text-sm font-semibold">
            {sortNutrient ? (
              <span className="text-amber-600">
                {sortNutrient.label} {fmtVal(nv(r, sortNutrient.col), sortNutrient.unit)}
              </span>
            ) : (
              <span className="text-gray-700">{fmtVal(kcal, 'kcal')}</span>
            )}
            <span className="text-gray-700">{fmtVal(price, '円')}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">
            （⏱ {r.cooking_time_minutes != null ? `${r.cooking_time_minutes}分` : '―'}, {r.cook_count}回作った）
          </div>
          {unresolved > 0 && <div className="text-[10px] text-amber-600">※未計算あり</div>}
        </div>
      </div>
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}
