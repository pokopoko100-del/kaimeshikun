// src/pages/ShoppingPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：10_shopping_migration.sql を実行済み
// 買い物リスト：
//   ・並びは「カテゴリ順（設定画面で変更可）」で自動配置 → 「並べ替え」で▲▼から手動で入れ替え
//   ・タップ：カゴに入れた／戻す　　← 左スワイプ：削除（元に戻すメッセージあり）
//   ・「自動配置」：手動で入れ替えた順をリセットして、カテゴリ順に並べ直す
//   ・アプリを開き直したとき・別のアプリから戻ったときに、最新の内容を読み込み直す
import { useCallback, useEffect, useMemo, useState } from 'react'
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

type Toast = { message: string; actionLabel: string; onAction: () => void }

const SWIPE_DELETE: SwipeAction = { label: '削除', readyLabel: '離して削除', className: 'bg-red-500' }

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
  const [reorder, setReorder] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

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

  // 別のアプリから戻ったとき（家族が追加した分など）に、最新を読み込み直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
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

  // ---- 手動の入れ替え（▲▼）：隣の材料と並び順を交換 ----
  const move = async (id: string, dir: -1 | 1) => {
    const i = open.findIndex((x) => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= open.length) return
    const a = open[i]
    const b = open[j]
    // 並び順の値が同じだったときは、少しずらして入れ替える
    const newA = a.sort_order === b.sort_order ? b.sort_order + dir * 0.5 : b.sort_order
    const newB = a.sort_order
    patchLocal(a.id, { sort_order: newA })
    patchLocal(b.id, { sort_order: newB })
    const [r1, r2] = await Promise.all([
      supabase.from('shopping_items').update({ sort_order: newA }).eq('id', a.id),
      supabase.from('shopping_items').update({ sort_order: newB }).eq('id', b.id),
    ])
    if (r1.error || r2.error) {
      alert('並べ替えに失敗しました: ' + errorText(r1.error ?? r2.error))
      void load()
    }
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

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* 1行だけの小さな操作バー */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <h1 className="text-sm font-bold text-gray-900">🛒 買い物リスト</h1>
        <span className="rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold text-gray-600">{open.length}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {reorder && (
            <button
              onClick={autoArrange}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600"
            >
              自動配置
            </button>
          )}
          <button
            onClick={() => setReorder((v) => !v)}
            disabled={open.length < 2}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 ${
              reorder ? 'bg-amber-500 text-white' : 'border border-gray-300 bg-white text-gray-600'
            }`}
          >
            {reorder ? '完了' : '並べ替え'}
          </button>
        </div>
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
            const showHeader = idx === 0 || open[idx - 1].category !== it.category
            const row = (
              <ItemRow
                item={it}
                reorder={reorder}
                canUp={idx > 0}
                canDown={idx < open.length - 1}
                onToggle={() => toggleChecked(it)}
                onUp={() => move(it.id, -1)}
                onDown={() => move(it.id, 1)}
              />
            )
            return (
              <div key={it.id}>
                {showHeader && <CategoryHeader category={it.category} />}
                <div className="mb-1">
                  {reorder ? (
                    <div className="overflow-hidden rounded-xl">{row}</div>
                  ) : (
                    <SwipeRow left={SWIPE_DELETE} onSwipeLeft={() => removeItem(it)}>
                      {row}
                    </SwipeRow>
                  )}
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
                    <ItemRow
                      item={it}
                      reorder={false}
                      canUp={false}
                      canDown={false}
                      onToggle={() => toggleChecked(it)}
                      onUp={() => {}}
                      onDown={() => {}}
                    />
                  </SwipeRow>
                </div>
              ))}
            </div>
          )}

          {open.length > 0 && !reorder && (
            <p className="mt-3 px-1 text-[10px] text-gray-400">タップ：カゴに入れる　←左スワイプ：削除</p>
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
function ItemRow({
  item,
  reorder,
  canUp,
  canDown,
  onToggle,
  onUp,
  onDown,
}: {
  item: ShoppingItem
  reorder: boolean
  canUp: boolean
  canDown: boolean
  onToggle: () => void
  onUp: () => void
  onDown: () => void
}) {
  const done = item.is_checked
  const amount = formatAmount(item.quantity, item.unit)
  return (
    <div className="flex items-center gap-2 bg-white px-3 py-1.5">
      <button
        onClick={reorder ? undefined : onToggle}
        disabled={reorder}
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
          <span className={`block truncate text-sm font-medium leading-tight ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {item.item_name}
          </span>
          {item.note && (
            <span className="block truncate text-[10px] leading-tight text-gray-400">{item.note}</span>
          )}
        </span>
        <span className={`shrink-0 whitespace-nowrap text-sm font-semibold ${done ? 'text-gray-400' : 'text-gray-700'}`}>
          {amount}
        </span>
      </button>

      {reorder && (
        <div className="flex shrink-0 gap-1">
          <button
            onClick={onUp}
            disabled={!canUp}
            aria-label="上へ"
            className="h-8 w-8 rounded-md border border-gray-300 bg-white text-sm text-gray-600 active:bg-gray-100 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={onDown}
            disabled={!canDown}
            aria-label="下へ"
            className="h-8 w-8 rounded-md border border-gray-300 bg-white text-sm text-gray-600 active:bg-gray-100 disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      )}
    </div>
  )
}
