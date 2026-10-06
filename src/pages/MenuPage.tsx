// src/pages/MenuPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：09_menu_status_migration.sql を実行済み（recipes.plan_confirmed 列がある）
// 献立画面：日割りなし。「確定」と「候補」の2つのリストを並べる
//   候補  ：［確定する］［外す］
//   確定  ：［作った］［候補に戻す］［外す］
//     作った      … 作った回数を +1 して、献立から外す
//     外す        … 献立から外す（レシピ自体は消えません）
//     候補に戻す  … 確定を取り消して、候補に戻す
// 操作のあとに「元に戻す」付きのメッセージを数秒表示
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import type { Recipe as RecipeBase } from '../types/recipe'

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
  | 'plan_confirmed'
  | 'planned_by'
  | 'planned_at'
>

type MenuRow = Recipe & {
  kcal: number | null
  price: number | null
  unresolved: number
}

// 更新する列のまとまり（「元に戻す」では、操作前の値をそのまま書き戻す）
type Patch = {
  is_planned: boolean
  plan_confirmed: boolean
  planned_by: string | null
  planned_at: string | null
  cook_count: number
}

type Toast = { message: string; undo: () => void }

const BUCKET = 'recipe-images'

const GENRES = ['和食', '洋食', '中華', 'エスニック'] as const
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

// 操作前の状態（元に戻す用）
function snapshot(r: MenuRow): Patch {
  return {
    is_planned: r.is_planned,
    plan_confirmed: r.plan_confirmed,
    planned_by: r.planned_by,
    planned_at: r.planned_at,
    cook_count: r.cook_count,
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '不明なエラー'
}

export default function MenuPage() {
  const [rows, setRows] = useState<MenuRow[]>([])
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data, error: recErr } = await supabase
        .from('recipes')
        .select(
          'id, dish_name, genre, category, source_name, cooking_time_minutes, cook_count, image_path, is_planned, plan_confirmed, planned_by, planned_at',
        )
        .eq('is_planned', true)

      if (recErr) {
        setError(recErr.message)
        setLoading(false)
        return
      }

      const recipes = (data ?? []) as Recipe[]
      const ids = recipes.map((r) => r.id)

      // カロリー・費用（材料マスタから計算した1人前あたり）。読めなくても献立自体は表示する
      const nutrition = new Map<string, { kcal: number | null; price: number | null; unresolved: number }>()
      if (ids.length > 0) {
        const { data: nutData, error: nutErr } = await supabase
          .from('recipe_nutrition')
          .select('recipe_id, calorie_per_serving, price_per_serving, unresolved_count')
          .in('recipe_id', ids)
        if (nutErr) {
          console.error(nutErr)
        } else {
          ;(nutData ?? []).forEach((n) => {
            nutrition.set(String(n.recipe_id), {
              kcal: typeof n.calorie_per_serving === 'number' ? n.calorie_per_serving : null,
              price: typeof n.price_per_serving === 'number' ? n.price_per_serving : null,
              unresolved: typeof n.unresolved_count === 'number' ? n.unresolved_count : 0,
            })
          })
        }
      }

      setRows(
        recipes.map((r) => {
          const n = nutrition.get(r.id)
          return { ...r, kcal: n?.kcal ?? null, price: n?.price ?? null, unresolved: n?.unresolved ?? 0 }
        }),
      )

      // 非公開バケットなので署名付きURLをまとめて発行（1時間有効）
      const paths = recipes.map((r) => r.image_path).filter((p): p is string => !!p)
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

  // 「元に戻す」メッセージは5秒で自動的に消す
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // DBを更新 → 成功したら画面に反映（失敗したら何も変えずにエラーを出す）
  const applyPatch = async (id: string, patch: Patch): Promise<boolean> => {
    const { data, error: updErr } = await supabase
      .from('recipes')
      .update(patch)
      .eq('id', id)
      .select('id')
    if (updErr || !data || data.length === 0) {
      alert('更新に失敗しました: ' + (updErr ? errorText(updErr) : '権限を確認してください'))
      return false
    }
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    return true
  }

  const act = async (row: MenuRow, patch: Patch, message: string) => {
    if (busyId) return
    setBusyId(row.id)
    const before = snapshot(row)
    const ok = await applyPatch(row.id, patch)
    setBusyId(null)
    if (!ok) return
    setToast({
      message,
      undo: () => {
        void applyPatch(row.id, before)
        setToast(null)
      },
    })
  }

  // ---- 各操作 ----
  const confirm = (r: MenuRow) =>
    act(r, { ...snapshot(r), plan_confirmed: true }, `「${r.dish_name}」を確定しました`)

  const backToCandidate = (r: MenuRow) =>
    act(r, { ...snapshot(r), plan_confirmed: false }, `「${r.dish_name}」を候補に戻しました`)

  const removeFromMenu = (r: MenuRow) =>
    act(
      r,
      { ...snapshot(r), is_planned: false, plan_confirmed: false, planned_by: null, planned_at: null },
      `「${r.dish_name}」を献立から外しました`,
    )

  const markCooked = (r: MenuRow) =>
    act(
      r,
      {
        is_planned: false,
        plan_confirmed: false,
        planned_by: null,
        planned_at: null,
        cook_count: r.cook_count + 1,
      },
      `「${r.dish_name}」を作りました（作った回数 ${r.cook_count + 1}回）`,
    )

  // 確定／候補に分ける（追加した順に並べる。新しいものが上）
  const { confirmed, candidates } = useMemo(() => {
    const byPlanned = (a: MenuRow, b: MenuRow) => (b.planned_at ?? '').localeCompare(a.planned_at ?? '')
    const planned = rows.filter((r) => r.is_planned)
    return {
      confirmed: planned.filter((r) => r.plan_confirmed).sort(byPlanned),
      candidates: planned.filter((r) => !r.plan_confirmed).sort(byPlanned),
    }
  }, [rows])

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <header className="sticky top-0 z-40 bg-white px-4 pb-3 pt-4 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">📅 献立</h1>
        <p className="mt-0.5 text-xs text-gray-400">
          レシピ一覧から「候補」に追加 → 決まったら「確定」にします
        </p>
      </header>

      {error && <p className="p-4 text-sm text-red-600">読み込みエラー：{error}</p>}

      {loading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : (
        <div className="space-y-6 p-3">
          {/* 確定 */}
          <section>
            <SectionTitle icon="✅" title="確定" count={confirmed.length} sub="作る予定の料理" />
            {confirmed.length === 0 ? (
              <Empty text="確定した料理はまだありません。候補から「確定する」を押してください。" />
            ) : (
              <div className="space-y-2">
                {confirmed.map((r) => (
                  <MenuCard
                    key={r.id}
                    row={r}
                    imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
                    busy={busyId === r.id}
                  >
                    <ActionButton kind="primary" onClick={() => markCooked(r)} disabled={busyId !== null}>
                      🍳 作った
                    </ActionButton>
                    <ActionButton onClick={() => backToCandidate(r)} disabled={busyId !== null}>
                      ↩ 候補に戻す
                    </ActionButton>
                    <ActionButton kind="danger" onClick={() => removeFromMenu(r)} disabled={busyId !== null}>
                      外す
                    </ActionButton>
                  </MenuCard>
                ))}
              </div>
            )}
          </section>

          {/* 候補 */}
          <section>
            <SectionTitle icon="💭" title="候補" count={candidates.length} sub="迷い中の料理" />
            {candidates.length === 0 ? (
              <Empty text="候補はまだありません。レシピ一覧で、左スワイプ（写真表示は右上の＋）で追加できます。" />
            ) : (
              <div className="space-y-2">
                {candidates.map((r) => (
                  <MenuCard
                    key={r.id}
                    row={r}
                    imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
                    busy={busyId === r.id}
                  >
                    <ActionButton kind="primary" onClick={() => confirm(r)} disabled={busyId !== null}>
                      ✅ 確定する
                    </ActionButton>
                    <ActionButton kind="danger" onClick={() => removeFromMenu(r)} disabled={busyId !== null}>
                      外す
                    </ActionButton>
                  </MenuCard>
                ))}
              </div>
            )}
          </section>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            ※「外す」は献立から外すだけで、レシピ自体は消えません。「作った」を押すと作った回数が1回増えて、献立から外れます。
          </p>
        </div>
      )}

      {/* 操作のあとに出る「元に戻す」メッセージ */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            <button onClick={toast.undo} className="shrink-0 font-bold text-amber-300">
              元に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({
  icon,
  title,
  count,
  sub,
}: {
  icon: string
  title: string
  count: number
  sub: string
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-1">
      <h2 className="text-base font-bold text-gray-900">
        {icon} {title}
      </h2>
      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">{count}</span>
      <span className="text-xs text-gray-400">{sub}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-xs leading-relaxed text-gray-400">
      {text}
    </p>
  )
}

// ---------- 献立カード（上：レシピの情報／下：操作ボタン） ----------
function MenuCard({
  row: r,
  imageUrl,
  busy,
  children,
}: {
  row: MenuRow
  imageUrl?: string
  busy: boolean
  children: React.ReactNode
}) {
  const genre = genreOf(r)
  return (
    <div className={`rounded-xl bg-white shadow-sm ${busy ? 'opacity-60' : ''}`}>
      <Link to={`/recipes/${r.id}`} className="flex items-center px-4 py-3 active:opacity-70">
        {/* 左：①ジャンル＋サブカテゴリ ②料理名 ③引用元 */}
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${GENRE_COLOR[genre]}`}>
              {genre}
            </span>
            {r.category && (
              <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                {r.category}
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-medium text-gray-800">{r.dish_name}</div>
          {r.source_name && <div className="mt-0.5 truncate text-xs text-gray-400">{r.source_name}</div>}
        </div>

        {/* 中央：サムネ（写真があるときだけ） */}
        {imageUrl && (
          <div className="mx-2 h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
            <img src={imageUrl} alt={r.dish_name} loading="lazy" className="h-full w-full object-cover" />
          </div>
        )}

        {/* 右：1人前の値 */}
        <div className="ml-2 shrink-0 whitespace-nowrap text-right">
          <div className="flex items-baseline justify-end gap-3 text-sm font-semibold text-gray-700">
            <span>{fmtVal(r.kcal, 'kcal')}</span>
            <span>{fmtVal(r.price, '円')}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">
            （1人前, ⏱ {r.cooking_time_minutes != null ? `${r.cooking_time_minutes}分` : '―'}）
          </div>
          {r.unresolved > 0 && <div className="text-[10px] text-amber-600">※未計算あり</div>}
        </div>
      </Link>

      <div className="flex gap-2 border-t border-gray-100 px-3 py-2">{children}</div>
    </div>
  )
}

function ActionButton({
  kind,
  onClick,
  disabled,
  children,
}: {
  kind?: 'primary' | 'danger'
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  const style =
    kind === 'primary'
      ? 'flex-[1.4] bg-amber-500 text-white'
      : kind === 'danger'
        ? 'flex-1 border border-red-200 bg-white text-red-500'
        : 'flex-1 border border-gray-300 bg-white text-gray-600'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-0 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-bold transition active:opacity-70 disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  )
}
