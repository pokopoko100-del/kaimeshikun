// src/pages/ShoppingPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：10_shopping_migration.sql を実行済み
// 買い物リスト：
//   ・一番上の帯（タイトル・自動配置）はスクロールしても固定
//   ・並びは「カテゴリ順（設定画面で変更可）」で自動配置 →「長押し → ドラッグ＆ドロップ」で手動で入れ替え
//   ・タップ：カゴに入れた／戻す　　← 左スワイプ：削除（元に戻すメッセージあり）
//   ・「自動配置」：手動で入れ替えた順をリセットして、カテゴリ順に並べ直す
//   ・アプリを開き直したとき・別のアプリから戻ったときに、最新の内容を読み込み直す
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import type { ShoppingItem } from '../types/shopping'
import SwipeRow from '../components/SwipeRow'
import type { SwipeAction } from '../components/SwipeRow'
import { categoryRank, CATEGORY_BADGE, normalizeCategoryOrder } from '../lib/categoryOrder'
import { fetchCategoryOrder, findShoppingListId, getHouseholdId } from '../lib/household'
import { formatAmount } from '../lib/shoppingAggregate'
import { errorText } from '../lib/errorText'
import { computeToIndex, planSortOrder, shiftSlots } from '../lib/dragReorder'

type Toast = { message: string; actionLabel: string; onAction: () => void }

const SWIPE_DELETE: SwipeAction = { label: '削除', readyLabel: '離して削除', className: 'bg-red-500' }

const LONG_PRESS_MS = 350 // この時間ずっと押していると、ドラッグ開始
const MOVE_TOLERANCE = 8 // 押している間にこれ以上動いたら、長押しではなくスクロール／スワイプ扱い(px)
const GAP = 4 // 行と行のすき間(px)。行の mb-1 と同じ

// ドラッグ中の測定値
type Rect = { id: string; top: number; height: number } // top はページ全体での位置
type DragInfo = {
  id: string
  fromIndex: number // ドラッグ開始時の位置
  startClientY: number // ドラッグ開始時の指の位置
  oldScreenTop: number // ドラッグ開始時、行が画面上で見えていた位置
  anchor: number | null // 行の見た目を指に合わせるための補正（測定後に決まる）
  rects: Rect[] // 全行の位置（見出しを消したあとに測定）
}
type DragView = { t: number; toIndex: number; from: number; height: number }

// 並び順（sort_order → 追加した順）
function bySort(a: ShoppingItem, b: ShoppingItem): number {
  return a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? '')
}

export default function ShoppingPage() {
  const { session } = useOutletContext<{ session: Session }>()
  const userId = session.user.id

  const [items, setItems] = useState<ShoppingItem[]>([])
  const [order, setOrder] = useState<string[]>(normalizeCategoryOrder(null))
  const [listId, setListId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  // ドラッグ関連
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragView, setDragView] = useState<DragView>({ t: 0, toIndex: 0, from: 0, height: 0 })
  const dragRef = useRef<DragInfo | null>(null)
  const toIndexRef = useRef(0)
  const pressRef = useRef<{ id: string; x: number; y: number; timer: number } | null>(null)
  const lastYRef = useRef(0)
  const dragActiveRef = useRef(false)
  const suppressClickUntil = useRef(0)
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const headerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const householdId = await getHouseholdId(userId)
      const [catOrder, id] = await Promise.all([fetchCategoryOrder(householdId), findShoppingListId(householdId)])
      setOrder(catOrder)
      setListId(id)
      if (!id) {
        setItems([])
      } else {
        const { data, error: e } = await supabase
          .from('shopping_items')
          .select('*')
          .eq('shopping_list_id', id)
          .order('sort_order', { ascending: true })
        if (e) throw e
        setItems((data ?? []) as ShoppingItem[])
      }
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  // 別のアプリから戻ったとき（家族が追加した分など）に、最新を読み込み直す（ドラッグ中は除く）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !dragActiveRef.current) void load()
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

  const open = useMemo(() => items.filter((i) => !i.is_checked).sort(bySort), [items])
  const checked = useMemo(() => items.filter((i) => i.is_checked).sort(bySort), [items])

  // ドラッグ処理から最新の並びを読むための入れ物
  const openRef = useRef<ShoppingItem[]>([])
  useEffect(() => {
    openRef.current = open
  }, [open])

  const patchLocal = (id: string, p: Partial<ShoppingItem>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)))

  // ---- タップ：カゴに入れた／戻す ----
  const toggleChecked = async (it: ShoppingItem) => {
    const next = !it.is_checked
    const p = {
      is_checked: next,
      checked_by: next ? userId : null,
      checked_at: next ? new Date().toISOString() : null,
    }
    patchLocal(it.id, p)
    const { data, error: e } = await supabase
      .from('shopping_items')
      .update({ ...p, updated_by: userId })
      .eq('id', it.id)
      .select('id')
    if (e || !data || data.length === 0) {
      patchLocal(it.id, { is_checked: it.is_checked, checked_by: it.checked_by, checked_at: it.checked_at })
      alert('更新に失敗しました: ' + (e ? errorText(e) : '権限を確認してください'))
    }
  }

  // ---- 左スワイプ：削除（元に戻せる） ----
  const removeItem = async (it: ShoppingItem) => {
    setItems((list) => list.filter((i) => i.id !== it.id))
    const { data, error: e } = await supabase.from('shopping_items').delete().eq('id', it.id).select('id')
    if (e || !data || data.length === 0) {
      setItems((list) => [...list, it])
      alert('削除に失敗しました: ' + (e ? errorText(e) : '権限を確認してください'))
      return
    }
    setToast({
      message: `「${it.item_name}」を削除しました`,
      actionLabel: '元に戻す',
      onAction: async () => {
        setToast(null)
        const { error: insErr } = await supabase.from('shopping_items').insert(it)
        if (insErr) {
          alert('元に戻せませんでした: ' + errorText(insErr))
          return
        }
        setItems((list) => [...list, it])
      },
    })
  }

  // ---- 購入済み（カゴに入れた）をまとめて削除 ----
  const clearChecked = async () => {
    if (!listId || checked.length === 0) return
    if (!window.confirm(`カゴに入れた ${checked.length}件 を削除しますか？`)) return
    const { error: e } = await supabase
      .from('shopping_items')
      .delete()
      .eq('shopping_list_id', listId)
      .eq('is_checked', true)
    if (e) {
      alert('削除に失敗しました: ' + errorText(e))
      return
    }
    setItems((list) => list.filter((i) => !i.is_checked))
  }

  // ---- 自動配置：カテゴリ順に並べ直す（手動で入れ替えた順はリセット） ----
  const autoArrange = async () => {
    if (!window.confirm('手動で入れ替えた順をリセットして、カテゴリ順に並べ直しますか？')) return
    const sorted = [...items].sort(
      (a, b) => categoryRank(order, a.category) - categoryRank(order, b.category) || bySort(a, b),
    )
    const next = sorted.map((it, idx) => ({ ...it, sort_order: (idx + 1) * 1000 }))
    setItems(next)
    const results = await Promise.all(
      next.map((it) => supabase.from('shopping_items').update({ sort_order: it.sort_order }).eq('id', it.id)),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) {
      alert('並べ直しに失敗しました: ' + errorText(failed.error))
      void load()
    }
  }

  // =====================================================================
  // 長押し → ドラッグ＆ドロップ
  //   1) 行を350ms押し続ける（途中で動かすとスクロール／スワイプ扱いで中止）
  //   2) 行が浮き上がる。ここから指を動かすと、行が指についてくる（画面の端に近づくと自動スクロール）
  //   3) 指を離した位置に入る。動かしたのは1行だけ。前後の行の「並び順」の真ん中の値を入れる
  // =====================================================================

  // ドロップ：動かした行の並び順を決めて保存（計算は lib/dragReorder.ts）
  const commitMove = useCallback(
    async (id: string, toIndex: number) => {
      const plan = planSortOrder(openRef.current, id, toIndex)
      if (plan.kind === 'none') return

      if (plan.kind === 'single') {
        const value = plan.value
        setItems((l) => l.map((i) => (i.id === id ? { ...i, sort_order: value } : i)))
        const { error: e } = await supabase
          .from('shopping_items')
          .update({ sort_order: value, updated_by: userId })
          .eq('id', id)
        if (e) {
          alert('並べ替えに失敗しました: ' + errorText(e))
          void load()
        }
        return
      }

      // 前後の値が近すぎたときは、全部振り直す
      const numbers = new Map(plan.orders.map((o) => [o.id, o.sort_order]))
      setItems((l) => l.map((i) => (numbers.has(i.id) ? { ...i, sort_order: numbers.get(i.id) as number } : i)))
      const results = await Promise.all(
        plan.orders.map((o) => supabase.from('shopping_items').update({ sort_order: o.sort_order }).eq('id', o.id)),
      )
      const failed = results.find((r) => r.error)
      if (failed?.error) {
        alert('並べ替えに失敗しました: ' + errorText(failed.error))
        void load()
      }
    },
    [load, userId],
  )

  const cancelPress = () => {
    const p = pressRef.current
    if (p) {
      window.clearTimeout(p.timer)
      pressRef.current = null
    }
  }

  // 長押しが成立したとき：ドラッグ開始
  const startDrag = useCallback((id: string) => {
    const el = rowEls.current.get(id)
    const from = openRef.current.findIndex((i) => i.id === id)
    if (!el || from < 0) return
    pressRef.current = null
    const r = el.getBoundingClientRect()
    dragRef.current = {
      id,
      fromIndex: from,
      startClientY: lastYRef.current,
      oldScreenTop: r.top,
      anchor: null,
      rects: [],
    }
    toIndexRef.current = from
    dragActiveRef.current = true // これ以降、画面のスクロールを止める
    setDragView({ t: 0, toIndex: from, from, height: r.height })
    setDragId(id)
  }, [])

  // ドラッグ終了（指を離した／中断された）
  const finishDrag = useCallback(
    (cancelled: boolean) => {
      const d = dragRef.current
      if (!d) return
      const toIndex = toIndexRef.current
      dragRef.current = null
      dragActiveRef.current = false
      suppressClickUntil.current = Date.now() + 400 // 指を離した瞬間のタップで「カゴに入れる」が働かないように
      setDragId(null)
      if (cancelled || toIndex === d.fromIndex) return
      void commitMove(d.id, toIndex)
    },
    [commitMove],
  )

  // ① カテゴリ見出しが消えた直後に、全行の位置を測る（見出しの分だけ行がずれるので、指に合わせて補正）
  useLayoutEffect(() => {
    const d = dragRef.current
    if (!dragId || !d) return
    const rects: Rect[] = []
    for (const it of openRef.current) {
      const el = rowEls.current.get(it.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      rects.push({ id: it.id, top: r.top + window.scrollY, height: r.height })
    }
    const me = rects.find((r) => r.id === dragId)
    if (!me) return
    d.rects = rects
    d.anchor = d.oldScreenTop - me.top
    setDragView({ t: d.anchor + window.scrollY, toIndex: d.fromIndex, from: d.fromIndex, height: me.height })
  }, [dragId])

  // ② ドラッグ中：毎フレーム、指の位置に行を合わせ、入る位置を計算（画面の端では自動スクロール）
  useEffect(() => {
    if (!dragId) return
    let raf = 0
    const tick = () => {
      const d = dragRef.current
      if (d && d.anchor !== null) {
        const y = lastYRef.current
        const topEdge = (headerRef.current?.getBoundingClientRect().bottom ?? 0) + 40
        const bottomEdge = window.innerHeight - 120
        if (y < topEdge) window.scrollBy(0, -Math.min(18, (topEdge - y) / 6 + 2))
        else if (y > bottomEdge) window.scrollBy(0, Math.min(18, (y - bottomEdge) / 6 + 2))

        const t = d.anchor + window.scrollY + (y - d.startClientY)
        const me = d.rects.find((r) => r.id === d.id)
        if (me) {
          const toIndex = computeToIndex(d.rects, d.id, t)
          toIndexRef.current = toIndex
          setDragView((prev) =>
            Math.abs(prev.t - t) < 0.5 && prev.toIndex === toIndex ? prev : { ...prev, t, toIndex },
          )
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [dragId])

  // ③ ドラッグ中の指の動き・離したことを、画面全体で受け取る
  useEffect(() => {
    if (!dragId) return
    const move = (e: PointerEvent) => {
      lastYRef.current = e.clientY
    }
    const up = () => finishDrag(false)
    const cancel = () => finishDrag(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragId, finishDrag])

  // ④ ドラッグ中は、画面が縦にスクロールしないようにする（iPhoneなどのタッチ操作用）
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragActiveRef.current && e.cancelable) e.preventDefault()
    }
    window.addEventListener('touchmove', block, { passive: false })
    return () => window.removeEventListener('touchmove', block)
  }, [])

  // 画面を離れるときの後片付け
  useEffect(() => {
    return () => {
      const p = pressRef.current
      if (p) window.clearTimeout(p.timer)
      dragActiveRef.current = false
    }
  }, [])

  // 行の上での指の動き（長押しの判定）
  const onRowPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (dragRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    cancelPress()
    lastYRef.current = e.clientY
    const timer = window.setTimeout(() => startDrag(id), LONG_PRESS_MS)
    pressRef.current = { id, x: e.clientX, y: e.clientY, timer }
  }
  const onRowPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    lastYRef.current = e.clientY
    const p = pressRef.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancelPress()
  }
  // ドラッグ直後のクリックは無効にする（ドロップした瞬間に「カゴに入れる」が働かないように）
  const onRowClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntil.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* 一番上の帯（スクロールしても固定） */}
      <div
        ref={headerRef}
        className="sticky top-0 z-40 flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2"
      >
        <h1 className="text-sm font-bold text-gray-900">🛒 買い物リスト</h1>
        <span className="rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold text-gray-600">{open.length}</span>
        <span className="ml-auto text-[10px] text-gray-400">長押しで並べ替え</span>
        <button
          onClick={autoArrange}
          disabled={open.length < 2}
          className="shrink-0 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 disabled:opacity-40"
        >
          自動配置
        </button>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">読み込みエラー：{error}</p>}

      {loading ? (
        <div className="space-y-1.5 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : (
        <div className="px-2">
          {items.length === 0 && !error && (
            <div className="px-4 py-12 text-center text-sm text-gray-400">
              <p>買い物リストは空です</p>
              <p className="mt-1 text-xs">
                <Link to="/menu" className="text-amber-600 underline">
                  献立
                </Link>
                の「🛒 買い物リストに追加」から、確定した料理の材料を入れられます
              </p>
            </div>
          )}

          {/* 買うもの */}
          {open.map((it, idx) => {
            const isDragged = dragId === it.id
            // ドラッグ中は見出しを隠す（並べ替え中は、カテゴリをまたいで自由に動かせるため）
            const showHeader = !dragId && (idx === 0 || open[idx - 1].category !== it.category)

            let style: CSSProperties | undefined
            if (dragId) {
              if (isDragged) {
                style = {
                  transform: `translateY(${dragView.t}px) scale(1.02)`,
                  zIndex: 30,
                  position: 'relative',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
                  borderRadius: 12,
                }
              } else {
                // 動かしている行の前後にいる行は、1行ぶん上下にずれて場所を空ける
                const slots = shiftSlots(idx, dragView.from, dragView.toIndex)
                style = {
                  transform: `translateY(${slots * (dragView.height + GAP)}px)`,
                  transition: 'transform 150ms ease-out',
                }
              }
            }

            return (
              <div key={it.id}>
                {showHeader && <CategoryHeader category={it.category} />}
                <div
                  ref={(el) => {
                    if (el) rowEls.current.set(it.id, el)
                    else rowEls.current.delete(it.id)
                  }}
                  className="mb-1 select-none [-webkit-touch-callout:none]"
                  style={style}
                  onPointerDown={(e) => onRowPointerDown(e, it.id)}
                  onPointerMove={onRowPointerMove}
                  onPointerUp={cancelPress}
                  onPointerCancel={cancelPress}
                  onClickCapture={onRowClickCapture}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <SwipeRow left={SWIPE_DELETE} onSwipeLeft={() => removeItem(it)} disabled={dragId !== null}>
                    <ItemRow item={it} onToggle={() => toggleChecked(it)} />
                  </SwipeRow>
                </div>
              </div>
            )
          })}

          {/* カゴに入れた */}
          {checked.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex items-center gap-1.5 px-1">
                <h2 className="text-sm font-bold text-gray-500">🧺 カゴに入れた</h2>
                <span className="rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold text-gray-600">
                  {checked.length}
                </span>
                <button
                  onClick={clearChecked}
                  className="ml-auto rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-500"
                >
                  すべて削除
                </button>
              </div>
              {checked.map((it) => (
                <div key={it.id} className="mb-1">
                  <SwipeRow left={SWIPE_DELETE} onSwipeLeft={() => removeItem(it)}>
                    <ItemRow item={it} onToggle={() => toggleChecked(it)} />
                  </SwipeRow>
                </div>
              ))}
            </div>
          )}

          {open.length > 0 && (
            <p className="mt-3 px-1 text-[10px] text-gray-400">
              タップ：カゴに入れる　←左スワイプ：削除　長押し：並べ替え
            </p>
          )}
        </div>
      )}

      {/* 削除のあとに出る「元に戻す」メッセージ */}
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

function CategoryHeader({ category }: { category: string }) {
  return (
    <div className="mb-0.5 mt-2 px-1">
      <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${CATEGORY_BADGE[category] ?? CATEGORY_BADGE['その他']}`}>
        {category}
      </span>
    </div>
  )
}

// ---------- 買い物の1行（コンパクト：名前＋どのレシピ用か／右に数量） ----------
function ItemRow({ item, onToggle }: { item: ShoppingItem; onToggle: () => void }) {
  const done = item.is_checked
  const amount = formatAmount(item.quantity, item.unit)
  return (
    <div className="flex items-center gap-2 bg-white px-3 py-1.5">
      <button
        onClick={onToggle}
        aria-label={done ? 'カゴから戻す' : 'カゴに入れる'}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
            done ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300 bg-white text-transparent'
          }`}
        >
          ✓
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm font-medium leading-tight ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}
          >
            {item.item_name}
          </span>
          {item.note && <span className="block truncate text-[10px] leading-tight text-gray-400">{item.note}</span>}
        </span>
        <span className={`shrink-0 whitespace-nowrap text-sm font-semibold ${done ? 'text-gray-400' : 'text-gray-700'}`}>
          {amount}
        </span>
      </button>
    </div>
  )
}
