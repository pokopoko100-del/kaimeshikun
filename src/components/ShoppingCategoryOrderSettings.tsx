// src/components/ShoppingCategoryOrderSettings.tsx（ファイル全体。これで丸ごと置き換えてください）
// 設定画面の「買い物リストのカテゴリ順」の中身（▲▼で入れ替え。変更するとすぐ保存される）
// 今回の変更：外側のカードと見出しを外した（開閉は SettingsSection がやるため）。中身の動きは前と同じ。
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { CATEGORY_BADGE, DEFAULT_CATEGORY_ORDER, normalizeCategoryOrder } from '../lib/categoryOrder'
import { fetchCategoryOrder, getHouseholdId, saveCategoryOrder } from '../lib/household'
import { errorText } from '../lib/errorText'

export default function ShoppingCategoryOrderSettings() {
  const { session } = useOutletContext<{ session: Session }>()
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>(normalizeCategoryOrder(null))
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const id = await getHouseholdId(session.user.id)
        setHouseholdId(id)
        setOrder(await fetchCategoryOrder(id))
      } catch (e) {
        setStatus('読み込みに失敗しました：' + errorText(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [session.user.id])

  // 変更してすぐ保存（失敗したら元の順に戻す）
  const save = async (next: string[]) => {
    if (!householdId) return
    const prev = order
    setOrder(next)
    setStatus('保存中…')
    try {
      await saveCategoryOrder(householdId, next)
      setStatus('保存しました')
    } catch (e) {
      setOrder(prev)
      setStatus('保存に失敗しました：' + errorText(e))
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    void save(next)
  }

  const reset = () => {
    if (!window.confirm('カテゴリ順を初期の順（野菜→肉→魚介→乳製品・卵→調味料→…）に戻しますか？')) return
    void save([...DEFAULT_CATEGORY_ORDER])
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed text-gray-400">
        新しく追加する材料は、この順に並びます。すでにあるリストを並べ直すときは、買い物リストの「自動配置」を使ってください。
      </p>

      {loading ? (
        <div className="mt-3 space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {order.map((c, i) => (
            <li key={c} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5">
              <span className="w-5 text-center text-xs font-bold text-gray-400">{i + 1}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${CATEGORY_BADGE[c] ?? CATEGORY_BADGE['その他']}`}>
                {c}
              </span>
              <span className="ml-auto flex gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`${c}を上へ`}
                  className="h-8 w-8 rounded-md border border-gray-300 text-sm text-gray-600 active:bg-gray-100 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  aria-label={`${c}を下へ`}
                  className="h-8 w-8 rounded-md border border-gray-300 text-sm text-gray-600 active:bg-gray-100 disabled:opacity-30"
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="min-w-0 truncate text-[11px] text-gray-400">{status}</span>
        <button
          onClick={reset}
          disabled={loading}
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
        >
          初期の順に戻す
        </button>
      </div>
    </div>
  )
}
