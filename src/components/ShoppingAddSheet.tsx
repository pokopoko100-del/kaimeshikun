
// src/components/ShoppingAddSheet.tsx（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：材料マスタの単位表（ingredient_units）も読み込み、単位違いの材料を基準単位にそろえて合算する
// 「買い物リストに追加」の確認画面（全画面）
//   確定した献立の材料を合計して一覧表示 → 選択／削除／数量変更 → 「確定して買い物リストへ追加」
//   ・人数は、献立画面の人数設定（○人前）で分量を計算
//   ・すでに買い物リストにある材料は、最初は選択オフ（追加すると数量が足されます）
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { aggregateIngredients, itemKeyOf } from '../lib/shoppingAggregate'
import type { AggItem, MasterUnit, RawIngredient, RecipeInfo } from '../lib/shoppingAggregate'
import { addItemsToShoppingList } from '../lib/shoppingList'
import { fetchCategoryOrder, findShoppingListId, getHouseholdId } from '../lib/household'
import { CATEGORY_BADGE, normalizeCategoryOrder } from '../lib/categoryOrder'
import { errorText } from '../lib/errorText'

type SheetItem = AggItem & {
  selected: boolean // 買い物リストに追加する
  inList: boolean // すでに買い物リストにある（未購入）
  qty: string // 入力中の数量（変更できる）
}

type Props = {
  recipes: RecipeInfo[] // 確定している料理
  servings: number // 何人前ぶん買うか
  userId: string
  onClose: () => void
  onAdded: (count: number) => void
}

export default function ShoppingAddSheet({ recipes, servings, userId, onClose, onAdded }: Props) {
  const [items, setItems] = useState<SheetItem[]>([])
  const [order, setOrder] = useState<string[]>(normalizeCategoryOrder(null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 開いたときに1回だけ読み込む（編集中の内容が上書きされないよう、依存は空）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ids = recipes.map((r) => r.id)
        const householdId = await getHouseholdId(userId)

        const [ingRes, catOrder, listId] = await Promise.all([
          supabase
            .from('ingredients')
            .select(
              'recipe_id, ingredient_master_id, ingredient_name, quantity, unit, ingredient_master(ingredient_name, category, default_unit, unit_weight_g, ingredient_units(unit, weight_g, is_default))',
            )
            .in('recipe_id', ids)
            .order('sort_order'),
          fetchCategoryOrder(householdId),
          findShoppingListId(householdId),
        ])
        if (ingRes.error) throw ingRes.error

        // 買い物リストに既にある（未購入の）材料
        const inListKeys = new Set<string>()
        if (listId) {
          const { data: ex, error: exErr } = await supabase
            .from('shopping_items')
            .select('ingredient_master_id, item_name')
            .eq('shopping_list_id', listId)
            .eq('is_checked', false)
          if (exErr) throw exErr
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(ex ?? []).forEach((e: any) => {
            inListKeys.add(itemKeyOf(e.ingredient_master_id as string | null, e.item_name as string))
          })
        }

        // 結合したマスタ情報は、配列で返る場合もあるのでそろえる（単位表は ingredient_units で返る）
        type JoinedMaster = {
          ingredient_name: string
          category: string
          default_unit: string | null
          unit_weight_g: number | null
          ingredient_units: MasterUnit[] | null
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raws: RawIngredient[] = (ingRes.data ?? []).map((row: any) => {
          const m = (Array.isArray(row.ingredient_master) ? row.ingredient_master[0] : row.ingredient_master) as
            | JoinedMaster
            | null
            | undefined
          return {
            recipe_id: row.recipe_id as string,
            ingredient_master_id: row.ingredient_master_id as string | null,
            ingredient_name: row.ingredient_name as string,
            quantity: row.quantity as string | null,
            unit: row.unit as string | null,
            master: m
              ? {
                  ingredient_name: m.ingredient_name,
                  category: m.category,
                  default_unit: m.default_unit,
                  unit_weight_g: m.unit_weight_g,
                  units: m.ingredient_units ?? [],
                }
              : null,
          }
        })

        const agg = aggregateIngredients(raws, recipes, servings)
        if (cancelled) return
        setOrder(catOrder)
        setItems(
          agg.map((a) => {
            const inList = inListKeys.has(itemKeyOf(a.masterId, a.name))
            return { ...a, inList, selected: !inList, qty: a.quantity ?? '' }
          }),
        )
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const patch = (key: string, p: Partial<SheetItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const remove = (key: string) => setItems((list) => list.filter((i) => i.key !== key))

  // カテゴリごとにまとめる（設定画面の順）
  const groups = useMemo(() => {
    const map = new Map<string, SheetItem[]>()
    items.forEach((i) => {
      const cat = order.includes(i.category) ? i.category : 'その他'
      map.set(cat, [...(map.get(cat) ?? []), i])
    })
    return order
      .filter((c) => map.has(c))
      .map((c) => ({
        category: c,
        items: (map.get(c) as SheetItem[]).slice().sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      }))
  }, [items, order])

  const selectedCount = items.filter((i) => i.selected).length
  const allSelected = items.length > 0 && selectedCount === items.length

  const toggleAll = () => setItems((list) => list.map((i) => ({ ...i, selected: !allSelected })))

  const confirm = async () => {
    const chosen = items.filter((i) => i.selected)
    if (chosen.length === 0 || saving) return
    setSaving(true)
    try {
      await addItemsToShoppingList({
        userId,
        items: chosen.map((i) => ({
          masterId: i.masterId,
          name: i.name,
          category: order.includes(i.category) ? i.category : 'その他',
          quantity: i.qty.trim() === '' ? null : i.qty.trim(),
          unit: i.unit,
          note: i.recipeNames.join('・'),
          recipeId: i.recipeIds.length === 1 ? i.recipeIds[0] : null,
        })),
      })
      onAdded(chosen.length)
    } catch (e) {
      alert('買い物リストへの追加に失敗しました：' + errorText(e))
      setSaving(false)
    }
  }

  const inListCount = items.filter((i) => i.inList).length

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-gray-50">
      {/* 上部：タイトル・閉じる */}
      <div className="flex items-center gap-2 bg-white px-3 py-2.5 shadow-sm">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-gray-900">🛒 買い物リストに追加</h2>
          <p className="truncate text-[11px] text-gray-400">
            確定 {recipes.length}品 ／ {servings}人前ぶん
          </p>
        </div>
        <button
          onClick={toggleAll}
          disabled={items.length === 0}
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
        >
          {allSelected ? 'すべて解除' : 'すべて選択'}
        </button>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-500"
        >
          ✕
        </button>
      </div>

      {/* 一覧 */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {loading && (
          <div className="space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-200" />
            ))}
          </div>
        )}
        {error && <p className="p-4 text-sm text-red-600">読み込みエラー：{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p className="p-8 text-center text-sm text-gray-400">追加できる材料がありません</p>
        )}

        {!loading && !error && inListCount > 0 && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            「リストにあり」の材料は、すでに買い物リストに入っているので最初はオフです。オンにすると数量が足されます。
          </p>
        )}

        {groups.map((g) => (
          <section key={g.category} className="mb-3">
            <div className="mb-1 px-1">
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-bold ${CATEGORY_BADGE[g.category] ?? CATEGORY_BADGE['その他']}`}
              >
                {g.category}
              </span>
            </div>
            <div className="space-y-1">
              {g.items.map((it) => (
                <div
                  key={it.key}
                  className={`flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow-sm ${
                    it.selected ? '' : 'opacity-50'
                  }`}
                >
                  {/* 選択 */}
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={(e) => patch(it.key, { selected: e.target.checked })}
                    aria-label={`${it.name}を追加する`}
                    className="h-5 w-5 shrink-0 accent-amber-500"
                  />

                  {/* 名前・使うレシピ */}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium text-gray-800">{it.name}</span>
                      {it.inList && (
                        <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">
                          リストにあり
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[10px] leading-tight text-gray-400">
                      {it.recipeNames.join('・')}
                    </div>
                  </div>

                  {/* 数量（変更できる） */}
                  <div className="flex shrink-0 items-center gap-1">
                    {(it.unit === '大さじ' || it.unit === '小さじ') && (
                      <span className="text-xs text-gray-500">{it.unit}</span>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={it.qty}
                      onChange={(e) => patch(it.key, { qty: e.target.value })}
                      placeholder="適量"
                      aria-label={`${it.name}の数量`}
                      className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-right text-sm focus:border-amber-500 focus:outline-none"
                    />
                    {it.unit && it.unit !== '大さじ' && it.unit !== '小さじ' && (
                      <span className="w-6 text-xs text-gray-500">{it.unit}</span>
                    )}
                  </div>

                  {/* 削除（この追加分から外す） */}
                  <button
                    onClick={() => remove(it.key)}
                    aria-label={`${it.name}を削除`}
                    className="shrink-0 rounded-full px-2 py-1 text-base leading-none text-gray-400 active:bg-gray-100"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* 下部：確定 */}
      <div
        className="border-t border-gray-200 bg-white px-3 pt-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-600 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={confirm}
            disabled={saving || selectedCount === 0}
            className="flex-[2] rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? '追加中…' : `確定して買い物リストへ追加（${selectedCount}件）`}
          </button>
        </div>
      </div>
    </div>
  )
}
