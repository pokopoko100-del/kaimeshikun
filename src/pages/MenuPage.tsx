// src/pages/MenuPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：
//  ・一番上の「食事回数・1食平均」を、「📊 分析」ボタンに置き換えた（MenuAnalysisSheet）
//      主食を足した1人1食のカロリー・値段を計算して上に表示。栄養の過不足と、AIの提案（選んだときだけ）
//      結果は端末に保存し、確定の料理（購入済を含む）・人数・1人前の値が変わるまで残る
//  前提：15_family_staples_migration.sql を実行済み（未実行でも、平均値・主食なしで分析できる）
// 前回の変更：
//  ・「確定(購入済)」を追加（14_menu_purchased_migration.sql）。確定した料理を買い物リストに追加すると、購入済に移る（確定より上に表示）
//      【確定(購入済)】 → 右スワイプ：作った ／ ← 左スワイプ：確定に戻す・候補に戻す・削除 を選ぶ
//      【確定】        → 右スワイプ：なし   ／ ← 左スワイプ：候補に戻す・削除 を選ぶ
//      「買い物リストに追加」は、まだ購入済になっていない確定の料理だけが対象
//  ・料理名をタップしてレシピを開くと、材料は献立の人数で表示される（?servings=）
// 前回の変更：
//  ・レシピごとに「何人前つくるか」（planned_servings）を入れられるようにした（行の下の －○人前＋）。横に、レシピの標準の人前を表示
//    献立に入れたときの初期値は、設定画面の「献立に追加したときの人数」。買い物リストの分量は、この人数で計算する
//  ・カロリー・値段は「1人前」で表示（画面全体の人数切替はなくした）。上の「1食平均」も1人前
// 前提：13_servings_migration.sql を実行済み
// 前回の変更：
// 今回の変更：①家族が候補・確定を変えたとき、すぐ画面に反映（Supabase Realtime）／②空欄メッセージを「レシピ一覧で右スワイプ」に統一（レシピ一覧のスワイプを右向きに変更したため）
// 前提：09_menu_status_migration.sql（plan_confirmed 列）と 11_cook_logs_migration.sql（cook_logs テーブル）を実行済み
// 献立画面：日割りなし。「確定」と「候補」の2つのリストを、小さな行（料理名＋引用元）で並べる（ボタンなし・スワイプで操作）
//   【候補】 → 右スワイプ：確定に追加 ／ ← 左スワイプ：削除（献立から外す。レシピは残る）
//   【確定】 → 右スワイプ：作った（作った回数 +1 ＋ 作った日付を履歴に保存。献立から外れる） ／ ← 左スワイプ：候補に戻す
// 一番上（スクロールしても固定）：
//   ・1食あたりの平均価格・平均カロリー（食事回数＝確定した「主菜」と「麺・丼・ワンプレート」の数）
//   ・「🛒 買い物リストに追加」ボタン
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { Recipe as RecipeBase } from '../types/recipe'
import SwipeRow from '../components/SwipeRow'
import type { SwipeAction } from '../components/SwipeRow'
import ServingsStepper from '../components/ServingsStepper'
import ShoppingAddSheet from '../components/ShoppingAddSheet'
import MenuAnalysisSheet from '../components/MenuAnalysisSheet'
import type { AnalysisResult, DishInput } from '../lib/menuAnalysis'
import { fingerprint, loadSaved, saveResult } from '../lib/menuAnalysis'
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
  | 'plan_purchased'
  | 'planned_by'
  | 'planned_at'
  | 'planned_servings'
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
  plan_purchased: boolean
  planned_by: string | null
  planned_at: string | null
  cook_count: number
}

type Toast = { message: string; actionLabel: string; onAction: () => void }

// 何人前つくるか（未設定のときは、レシピの標準の人前）
function plannedOf(r: Pick<Recipe, 'planned_servings' | 'servings'>): number {
  return r.planned_servings ?? Math.max(1, r.servings || 1)
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
    plan_purchased: r.plan_purchased,
    planned_by: r.planned_by,
    planned_at: r.planned_at,
    cook_count: r.cook_count,
  }
}

// スワイプのラベル
const ACT_CONFIRM: SwipeAction = { label: '✅ 確定', readyLabel: '離して確定', className: 'bg-green-600' }
const ACT_DELETE: SwipeAction = { label: '削除', readyLabel: '離して削除', className: 'bg-red-500' }
const ACT_COOKED: SwipeAction = { label: '🍳 作った', readyLabel: '離して作った', className: 'bg-amber-500' }
const ACT_MORE: SwipeAction = { label: '戻す・削除', readyLabel: '離して選ぶ', className: 'bg-gray-500' }

export default function MenuPage() {
  const { session } = useOutletContext<{ session: Session }>()
  const navigate = useNavigate()
  const userId = session.user.id

  const [rows, setRows] = useState<MenuRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // 自分の操作中は、Realtimeでの読み込み直しを止める
  const [toast, setToast] = useState<Toast | null>(null)
  const [showAdd, setShowAdd] = useState(false) // 「買い物リストに追加」の確認画面
  const [choice, setChoice] = useState<MenuRow | null>(null) // 左スワイプで出す選択（戻す・削除）
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)

  const load = useCallback(async () => {
    const { data, error: recErr } = await supabase
      .from('recipes')
      .select(
        'id, dish_name, servings, category, source_name, cooking_time_minutes, cook_count, is_planned, plan_confirmed, plan_purchased, planned_by, planned_at, planned_servings',
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
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 家族が候補・確定を変えたとき、すぐ反映する（Supabase Realtime）
  //   ・自分の操作中（busy）は読み込み直しを後ろに回す。短時間に何度も来ても1回にまとめる（0.3秒）
  useEffect(() => {
    let timer: number | undefined
    const reload = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (busyRef.current) reload()
        else void load()
      }, 300)
    }
    // StrictModeで2回動いても名前がぶつからないよう、毎回ちがう名前にする
    const channel = supabase
      .channel(`menu-recipes-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes' }, reload)
      .subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [load])

  // 別のアプリから戻ったときにも、最新を読み込み直す（Realtimeが切れていた場合の保険）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busyRef.current) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

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
    busyRef.current = true
    const before = snapshot(row)
    const ok = await applyPatch(row.id, patch)
    busyRef.current = false
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
    act(r, { ...snapshot(r), plan_confirmed: true, plan_purchased: false }, `「${r.dish_name}」を確定しました`)

  const backToCandidate = (r: MenuRow) =>
    act(r, { ...snapshot(r), plan_confirmed: false, plan_purchased: false }, `「${r.dish_name}」を候補に戻しました`)
  const backToConfirmed = (r: MenuRow) =>
    act(r, { ...snapshot(r), plan_purchased: false }, `「${r.dish_name}」を確定（未購入）に戻しました`)

  const removeFromMenu = (r: MenuRow) =>
    act(
      r,
      { ...snapshot(r), is_planned: false, plan_confirmed: false, plan_purchased: false, planned_by: null, planned_at: null },
      `「${r.dish_name}」を献立から削除しました（レシピは残ります）`,
    )

  // 作った：作った日付を履歴（cook_logs）に保存 → 作った回数 +1 → 献立から外す
  const markCooked = async (r: MenuRow) => {
    if (busy) return
    setBusy(true)
    busyRef.current = true
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
      busyRef.current = false
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
      plan_purchased: false,
      planned_by: null,
      planned_at: null,
      cook_count: r.cook_count + 1,
    })
    busyRef.current = false
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

  // 買い物リストに追加した確定の料理を「購入済」にする
  const markPurchased = async (ids: string[]) => {
    if (ids.length === 0) return
    setRows((list) => list.map((x) => (ids.includes(x.id) ? { ...x, plan_purchased: true } : x)))
    busyRef.current = true
    const { error: updErr } = await supabase.from('recipes').update({ plan_purchased: true }).in('id', ids)
    busyRef.current = false
    if (updErr) {
      setRows((list) => list.map((x) => (ids.includes(x.id) ? { ...x, plan_purchased: false } : x)))
      alert(
        '購入済への切り替えに失敗しました: ' +
          errorText(updErr) +
          '（14_menu_purchased_migration.sql を実行済みか確認してください）',
      )
    }
  }

  // 何人前つくるか：変えるとすぐ保存（失敗したら元に戻す）
  const setPlannedServings = async (r: MenuRow, n: number) => {
    const prev = r.planned_servings
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, planned_servings: n } : x)))
    busyRef.current = true
    const { data, error: updErr } = await supabase
      .from('recipes')
      .update({ planned_servings: n })
      .eq('id', r.id)
      .select('id')
    busyRef.current = false
    if (updErr || !data || data.length === 0) {
      setRows((list) => list.map((x) => (x.id === r.id ? { ...x, planned_servings: prev } : x)))
      alert(
        '人数の保存に失敗しました: ' +
          (updErr ? errorText(updErr) : '権限を確認してください') +
          '（13_servings_migration.sql を実行済みか確認してください）',
      )
    }
  }

  // 確定／候補に分ける（追加した順に並べる。新しいものが上）
  const { purchased, confirmed, candidates } = useMemo(() => {
    const byPlanned = (a: MenuRow, b: MenuRow) => (b.planned_at ?? '').localeCompare(a.planned_at ?? '')
    const planned = rows.filter((r) => r.is_planned)
    return {
      purchased: planned.filter((r) => r.plan_confirmed && r.plan_purchased).sort(byPlanned),
      confirmed: planned.filter((r) => r.plan_confirmed && !r.plan_purchased).sort(byPlanned),
      candidates: planned.filter((r) => !r.plan_confirmed).sort(byPlanned),
    }
  }, [rows])

  // 分析の対象：確定した料理（購入済も含む）。目印（fp）が変わったら、保存した結果はリセット
  const dishes: DishInput[] = useMemo(
    () =>
      [...purchased, ...confirmed].map((r) => ({
        id: r.id,
        dish_name: r.dish_name,
        category: r.category,
        planned: plannedOf(r),
        kcal: r.kcal,
        price: r.price,
      })),
    [purchased, confirmed],
  )
  const fp = useMemo(() => fingerprint(dishes), [dishes])
  useEffect(() => {
    if (loading) return // 読み込み前（料理0件）で判定すると、保存した結果を消してしまうため
    setAnalysis(loadSaved(fp))
  }, [fp, loading])

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* 一番上（スクロールしても固定）：1食あたりの平均 ＋ 買い物リストに追加 */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-gray-50 px-2 pb-2 pt-2">
        <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-gray-600">
          <span className="min-w-0 flex-1 truncate">
            {analysis ? (
              <>
                1食平均 <b className="text-gray-900">{fmtVal(analysis.perMeal.price, '円')}</b>
                {' ・ '}
                <b className="text-gray-900">{fmtVal(analysis.perMeal.kcal, 'kcal')}</b>
                <span className="text-gray-400">（1人・主食込み・{analysis.meals}食）</span>
                {analysis.items.some((i) => i.status === 'short') && <span className="ml-1 text-red-600">栄養に不足あり</span>}
              </>
            ) : dishes.length === 0 ? (
              <span className="text-gray-400">確定した料理を分析できます</span>
            ) : (
              <span className="text-gray-400">確定の料理から、1食の平均と栄養を分析</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowAnalysis(true)}
            disabled={dishes.length === 0}
            className="shrink-0 rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-700 active:bg-amber-50 disabled:opacity-40"
          >
            📊 分析
          </button>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          disabled={confirmed.length === 0}
          className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white shadow-sm active:opacity-80 disabled:bg-gray-300"
        >
          {confirmed.length === 0
            ? '🛒 買い物リストに追加（未購入の確定がありません）'
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
          {/* 確定(購入済)：買い物リストに追加済み */}
          {purchased.length > 0 && (
            <>
              <SectionTitle icon="🛍" title="確定(購入済)" count={purchased.length} hint="→作った ←戻す・削除" />
              <div className="mb-4 space-y-1">
                {purchased.map((r) => (
                  <SwipeRow
                    key={r.id}
                    right={ACT_COOKED}
                    left={ACT_MORE}
                    onSwipeRight={() => markCooked(r)}
                    onSwipeLeft={() => setChoice(r)}
                  >
                    <MenuLine row={r} onServings={(n) => void setPlannedServings(r, n)} />
                  </SwipeRow>
                ))}
              </div>
            </>
          )}

          {/* 確定（まだ買い物リストに追加していない） */}
          <SectionTitle icon="✅" title="確定" count={confirmed.length} hint="←戻す・削除" />
          {confirmed.length === 0 ? (
            <Empty text="確定した料理はありません（候補を右にスワイプ）" />
          ) : (
            <div className="space-y-1">
              {confirmed.map((r) => (
                <SwipeRow key={r.id} left={ACT_MORE} onSwipeLeft={() => setChoice(r)}>
                  <MenuLine row={r} onServings={(n) => void setPlannedServings(r, n)} />
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
                  <MenuLine row={r} onServings={(n) => void setPlannedServings(r, n)} />
                </SwipeRow>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 買い物リストに追加の確認画面（全画面） */}
      {showAdd && (
        <ShoppingAddSheet
          recipes={confirmed.map((r) => ({
            id: r.id,
            dish_name: r.dish_name,
            servings: r.servings,
            planned: plannedOf(r),
          }))}
          userId={userId}
          onClose={() => setShowAdd(false)}
          onAdded={(count) => {
            setShowAdd(false)
            void markPurchased(confirmed.map((r) => r.id))
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

      {/* 分析（画面いっぱい） */}
      {showAnalysis && (
        <MenuAnalysisSheet
          userId={userId}
          dishes={dishes}
          saved={analysis}
          onResult={(res) => {
            setAnalysis(res)
            saveResult(res)
          }}
          onClose={() => setShowAnalysis(false)}
        />
      )}

      {/* 左スワイプの選択：確定に戻す（購入済のとき）・候補に戻す・削除 */}
      {choice && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={() => setChoice(null)}>
          <div
            className="w-full rounded-t-2xl bg-white px-4 pt-4"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] text-gray-400">{choice.plan_purchased ? '確定(購入済)' : '確定'}</p>
            <h3 className="mb-3 truncate text-base font-bold text-gray-900">{choice.dish_name}</h3>
            {choice.plan_purchased && (
              <button
                type="button"
                onClick={() => {
                  const r = choice
                  setChoice(null)
                  void backToConfirmed(r)
                }}
                className="mb-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-bold text-gray-800 active:bg-gray-50"
              >
                ✅ 確定（未購入）に戻す
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const r = choice
                setChoice(null)
                void backToCandidate(r)
              }}
              className="mb-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-bold text-gray-800 active:bg-gray-50"
            >
              ↩ 候補に戻す
            </button>
            <button
              type="button"
              onClick={() => {
                const r = choice
                setChoice(null)
                void removeFromMenu(r)
              }}
              className="mb-2 w-full rounded-xl border border-red-200 px-4 py-3 text-left text-sm font-bold text-red-600 active:bg-red-50"
            >
              🗑 献立から削除（レシピは残ります）
            </button>
            <button
              type="button"
              onClick={() => setChoice(null)}
              className="mt-1 w-full rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600"
            >
              キャンセル
            </button>
          </div>
        </div>
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

// ---------- 献立の1行：料理名＋引用元／右に1人前のカロリー・費用。下の段に「何人前つくるか」と標準の人前 ----------
function MenuLine({ row: r, onServings }: { row: MenuRow; onServings: (n: number) => void }) {
  return (
    <div className="px-3 py-1.5">
      <Link to={`/recipes/${r.id}?servings=${plannedOf(r)}`} draggable={false} className="flex items-center gap-2 active:opacity-70">
        {/* 左：①料理名 ②引用元（左揃え。長いときは省略） */}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium leading-tight text-gray-800">
            {r.dish_name}
            {r.unresolved > 0 && <span className="ml-1 text-[10px] font-normal text-amber-600">※</span>}
          </div>
          {r.source_name && <div className="truncate text-[11px] leading-tight text-gray-400">{r.source_name}</div>}
        </div>
        {/* 右：1人前のカロリー・費用 */}
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-gray-700">
          {fmtVal(r.kcal, 'kcal')}　{fmtVal(r.price, '円')}
        </span>
      </Link>
      {/* 何人前つくるか（スワイプと区別するため、ボタンだけで操作する） */}
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="text-[10px] text-gray-400">標準{r.servings}人前</span>
        <ServingsStepper value={plannedOf(r)} onChange={onServings} min={1} max={20} />
      </div>
    </div>
  )
}
