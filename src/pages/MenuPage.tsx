// src/pages/MenuPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：09_menu_status_migration.sql（plan_confirmed 列）と 11_cook_logs_migration.sql（cook_logs テーブル）を実行済み
// 献立画面：日割りなし。「確定」と「候補」の2つのリストを、小さな行（料理名＋引用元）で並べる（ボタンなし・スワイプで操作）
//   【候補】 → 右スワイプ：確定に追加 ／ ← 左スワイプ：削除（献立から外す。レシピは残る）
//   【確定】 → 右スワイプ：作った（作った回数 +1 ＋ 作った日付を履歴に保存。献立から外れる） ／ ← 左スワイプ：候補に戻す
// 一番上（スクロールしても固定）：
//   ・1食あたりの平均価格・平均カロリー（食事回数＝確定した「主菜」と「麺・丼・ワンプレート」の数）
//   ・「🛒 買い物リストに追加」ボタン
// 人数切替は「確定」見出しの右端（共通設定。一覧・詳細と同じ人数で表示）
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { Recipe as RecipeBase } from '../types/recipe'
import SwipeRow from '../components/SwipeRow'
import type { SwipeAction } from '../components/SwipeRow'
import ServingsStepper from '../components/ServingsStepper'
import ShoppingAddSheet from '../components/ShoppingAddSheet'
import { useServings } from '../lib/useServings'
import { getHouseholdId } from '../lib/household'
import { todayLocal } from '../lib/dates'
import { errorText } from '../lib/errorText'

type Recipe = Pick<
  RecipeBase,
  | 'id'
  | 'dish_name'
  | 'servings'
  | 'category'
  | 'source_name'
  | 'cooking_time_minutes'
  | 'cook_count'
  | 'is_planned'
  | 'plan_confirmed'
  | 'planned_by'
  | 'planned_at'
>

type MenuRow = Recipe & {
  kcal: number | null // 1人前あたり
  price: number | null // 1人前あたり
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

type Toast = { message: string; actionLabel: string; onAction: () => void }

// 「1回の食事」として数えるサブカテゴリ（主菜と、麺・丼・ワンプレート）
const MEAL_CATEGORIES = ['主菜', '麺・丼・ワンプレート']

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

// スワイプのラベル
const ACT_CONFIRM: SwipeAction = { label: '✅ 確定', readyLabel: '離して確定', className: 'bg-green-600' }
const ACT_DELETE: SwipeAction = { label: '削除', readyLabel: '離して削除', className: 'bg-red-500' }
const ACT_COOKED: SwipeAction = { label: '🍳 作った', readyLabel: '離して作った', className: 'bg-amber-500' }
const ACT_BACK: SwipeAction = { label: '↩ 候補に戻す', readyLabel: '離して戻す', className: 'bg-gray-500' }

export default function MenuPage() {
  const { session } = useOutletContext<{ session: Session }>()
  const navigate = useNavigate()
  const userId = session.user.id

  const [rows, setRows] = useState<MenuRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [servings, setServings] = useServings()
  const [showAdd, setShowAdd] = useState(false) // 「買い物リストに追加」の確認画面

  useEffect(() => {
    ;(async () => {
      const { data, error: recErr } = await supabase
        .from('recipes')
        .select(
          'id, dish_name, servings, category, source_name, cooking_time_minutes, cook_count, is_planned, plan_confirmed, planned_by, planned_at',
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(nutData ?? []).forEach((n: any) => {
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
    if (busy) return
    setBusy(true)
    const before = snapshot(row)
    const ok = await applyPatch(row.id, patch)
    setBusy(false)
    if (!ok) return
    setToast({
      message,
      actionLabel: '元に戻す',
      onAction: () => {
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
      `「${r.dish_name}」を献立から削除しました（レシピは残ります）`,
    )

  // 作った：作った日付を履歴（cook_logs）に保存 → 作った回数 +1 → 献立から外す
  const markCooked = async (r: MenuRow) => {
    if (busy) return
    setBusy(true)
    const before = snapshot(r)

    // ① 作った日付を保存（先に保存。あとの更新に失敗したら、この履歴を消す）
    let logId: string
    try {
      const householdId = await getHouseholdId(userId)
      const { data, error: logErr } = await supabase
        .from('cook_logs')
        .insert({ household_id: householdId, recipe_id: r.id, cooked_on: todayLocal(), cooked_by: userId })
        .select('id')
        .single()
      if (logErr) throw logErr
      logId = (data as { id: string }).id
    } catch (e) {
      setBusy(false)
      alert(
        '作った日付の記録に失敗しました：' +
          errorText(e) +
          '\n（11_cook_logs_migration.sql を実行済みか確認してください）',
      )
      return
    }

    // ② 作った回数 +1、献立から外す
    const ok = await applyPatch(r.id, {
      is_planned: false,
      plan_confirmed: false,
      planned_by: null,
      planned_at: null,
      cook_count: r.cook_count + 1,
    })
    setBusy(false)
    if (!ok) {
      await supabase.from('cook_logs').delete().eq('id', logId)
      return
    }

    setToast({
      message: `「${r.dish_name}」を作りました（${r.cook_count + 1}回目）`,
      actionLabel: '元に戻す',
      onAction: () => {
        void applyPatch(r.id, before)
        void supabase.from('cook_logs').delete().eq('id', logId) // 履歴も取り消す
        setToast(null)
      },
    })
  }

  // 確定／候補に分ける（追加した順に並べる。新しいものが上）
  const { confirmed, candidates } = useMemo(() => {
    const byPlanned = (a: MenuRow, b: MenuRow) => (b.planned_at ?? '').localeCompare(a.planned_at ?? '')
    const planned = rows.filter((r) => r.is_planned)
    return {
      confirmed: planned.filter((r) => r.plan_confirmed).sort(byPlanned),
      candidates: planned.filter((r) => !r.plan_confirmed).sort(byPlanned),
    }
  }, [rows])

  // 1食あたりの平均（確定した料理ぜんぶの合計 ÷ 食事回数）。食事回数＝主菜と麺・丼・ワンプレートの数
  const stats = useMemo(() => {
    const meals = confirmed.filter((r) => r.category != null && MEAL_CATEGORIES.includes(r.category)).length
    let totalKcal = 0
    let totalPrice = 0
    let uncertain = false
    for (const r of confirmed) {
      if (r.kcal != null) totalKcal += r.kcal * servings
      else uncertain = true
      if (r.price != null) totalPrice += r.price * servings
      else uncertain = true
      if (r.unresolved > 0) uncertain = true
    }
    return {
      meals,
      avgKcal: meals > 0 ? totalKcal / meals : null,
      avgPrice: meals > 0 ? totalPrice / meals : null,
      uncertain,
    }
  }, [confirmed, servings])

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* 一番上（スクロールしても固定）：1食あたりの平均 ＋ 買い物リストに追加 */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-gray-50 px-2 pb-2 pt-2">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1 text-xs text-gray-600">
          <span className="shrink-0">
            🍽 食事 <b className="text-gray-900">{stats.meals}</b>回
          </span>
          {stats.meals > 0 ? (
            <span className="min-w-0 truncate text-right">
              1食平均{' '}
              <b className="text-gray-900">{fmtVal(stats.avgPrice, '円')}</b>
              {' ・ '}
              <b className="text-gray-900">{fmtVal(stats.avgKcal, 'kcal')}</b>
              {stats.uncertain && <span className="text-amber-600">※</span>}
              <span className="text-gray-400">（{servings}人前）</span>
            </span>
          ) : (
            <span className="min-w-0 truncate text-right text-gray-400">
              1食平均 ―（確定した主菜・麺・丼がありません）
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          disabled={confirmed.length === 0}
          className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white shadow-sm active:opacity-80 disabled:bg-gray-300"
        >
          {confirmed.length === 0
            ? '🛒 買い物リストに追加（確定した料理がありません）'
            : `🛒 買い物リストに追加（確定 ${confirmed.length}品）`}
        </button>
      </div>

      {error && <p className="p-4 text-sm text-red-600">読み込みエラー：{error}</p>}

      {loading ? (
        <div className="space-y-1.5 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : (
        <div className="px-2 pt-2">
          {/* 確定（見出しの右端に人数切替） */}
          <SectionTitle
            icon="✅"
            title="確定"
            count={confirmed.length}
            hint="→作った ←戻す"
            trailing={<ServingsStepper value={servings} onChange={setServings} />}
          />
          {confirmed.length === 0 ? (
            <Empty text="確定した料理はありません（候補を右にスワイプ）" />
          ) : (
            <div className="space-y-1">
              {confirmed.map((r) => (
                <SwipeRow
                  key={r.id}
                  right={ACT_COOKED}
                  left={ACT_BACK}
                  onSwipeRight={() => markCooked(r)}
                  onSwipeLeft={() => backToCandidate(r)}
                >
                  <MenuLine row={r} servings={servings} />
                </SwipeRow>
              ))}
            </div>
          )}

          {/* 候補 */}
          <div className="mt-4" />
          <SectionTitle icon="💭" title="候補" count={candidates.length} hint="→確定 ←削除" />
          {candidates.length === 0 ? (
            <Empty text="候補はありません（レシピ一覧で右スワイプ／＋で追加）" />
          ) : (
            <div className="space-y-1">
              {candidates.map((r) => (
                <SwipeRow
                  key={r.id}
                  right={ACT_CONFIRM}
                  left={ACT_DELETE}
                  onSwipeRight={() => confirm(r)}
                  onSwipeLeft={() => removeFromMenu(r)}
                >
                  <MenuLine row={r} servings={servings} />
                </SwipeRow>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 買い物リストに追加の確認画面（全画面） */}
      {showAdd && (
        <ShoppingAddSheet
          recipes={confirmed.map((r) => ({ id: r.id, dish_name: r.dish_name, servings: r.servings }))}
          servings={servings}
          userId={userId}
          onClose={() => setShowAdd(false)}
          onAdded={(count) => {
            setShowAdd(false)
            setToast({
              message: `${count}件を買い物リストに追加しました`,
              actionLabel: '見る',
              onAction: () => {
                setToast(null)
                navigate('/shopping')
              },
            })
          }}
        />
      )}

      {/* 操作のあとに出るメッセージ */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            <button onClick={toast.onAction} className="shrink-0 font-bold text-amber-300">
              {toast.actionLabel}
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
  hint,
  trailing,
}: {
  icon: string
  title: string
  count: number
  hint: string
  trailing?: React.ReactNode // 右端に置く部品（人数切替など）
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5 px-1">
      <h2 className="shrink-0 text-sm font-bold text-gray-900">
        {icon} {title}
      </h2>
      <span className="shrink-0 rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold text-gray-600">{count}</span>
      <span className="ml-auto min-w-0 truncate text-[10px] text-gray-400">{hint}</span>
      {trailing}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-3 text-center text-[11px] text-gray-400">
      {text}
    </p>
  )
}

// ---------- 献立の1行（コンパクト：料理名＋引用元の2段／右に人数ぶんのカロリー・費用） ----------
function MenuLine({ row: r, servings }: { row: MenuRow; servings: number }) {
  const kcal = r.kcal != null ? r.kcal * servings : null
  const price = r.price != null ? r.price * servings : null
  return (
    <Link
      to={`/recipes/${r.id}`}
      draggable={false}
      className="flex items-center gap-2 px-3 py-1.5 active:opacity-70"
    >
      {/* 左：①料理名 ②引用元（左揃え。長いときは省略） */}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium leading-tight text-gray-800">
          {r.dish_name}
          {r.unresolved > 0 && <span className="ml-1 text-[10px] font-normal text-amber-600">※</span>}
        </div>
        {r.source_name && <div className="truncate text-[11px] leading-tight text-gray-400">{r.source_name}</div>}
      </div>

      {/* 右：人数ぶんのカロリー・費用 */}
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-gray-700">
        {fmtVal(kcal, 'kcal')}　{fmtVal(price, '円')}
      </span>
    </Link>
  )
}
