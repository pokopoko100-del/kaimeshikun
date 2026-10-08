
// src/lib/shoppingList.ts（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：すでにリストにある材料と単位が違っても、材料マスタの単位表（ingredient_units）で換算できれば、既存の行に足す
//   例：リストに「卵 2個」→ 追加「卵 100g」→ 「卵 4個」にまとめる
// 買い物リストへ材料を追加する処理
//   ・すでにリストにある（未購入の）同じ材料・同じ単位は、数量を足して1行にまとめる
//   ・新しい材料は、カテゴリ順（設定画面の順）に合う位置に自動で差し込む
import { supabase } from '../supabaseClient'
import { fetchCategoryOrder, getHouseholdId, getOrCreateShoppingListId } from './household'
import { computeSortOrders } from './shoppingOrder'
import { buildUnitWeights, itemKeyOf, normUnit, parseQty, roundQty } from './shoppingAggregate'
import type { MasterUnit } from './shoppingAggregate'

export type NewShoppingItem = {
  masterId: string | null
  name: string
  category: string
  quantity: string | null
  unit: string | null
  note: string | null // どのレシピ用か
  recipeId: string | null // 1つのレシピ用のときだけ
}

type ExistingRow = {
  id: string
  ingredient_master_id: string | null
  item_name: string
  quantity: string | null
  unit: string | null
  category: string
  sort_order: number
  is_checked: boolean
}

export async function addItemsToShoppingList(params: {
  userId: string
  items: NewShoppingItem[]
}): Promise<{ inserted: number; merged: number }> {
  const { userId, items } = params
  const householdId = await getHouseholdId(userId)
  const listId = await getOrCreateShoppingListId(householdId, userId)
  const order = await fetchCategoryOrder(householdId)

  const { data, error } = await supabase
    .from('shopping_items')
    .select('id, ingredient_master_id, item_name, quantity, unit, category, sort_order, is_checked')
    .eq('shopping_list_id', listId)
  if (error) throw error
  const open = ((data ?? []) as ExistingRow[]).filter((e) => !e.is_checked) // 未購入だけが対象

  // 追加する材料の単位表（材料ID → 単位 → 1単位のg）。読めなくても、従来どおり「同じ単位だけ」合算する
  const weightsByMaster = new Map<string, Map<string, number>>()
  const masterIds = Array.from(new Set(items.map((i) => i.masterId).filter((x): x is string => !!x)))
  if (masterIds.length > 0) {
    const { data: uData, error: uErr } = await supabase
      .from('ingredient_units')
      .select('ingredient_master_id, unit, weight_g, is_default')
      .in('ingredient_master_id', masterIds)
    if (uErr) {
      console.error(uErr)
    } else {
      const grouped = new Map<string, MasterUnit[]>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(uData ?? []).forEach((u: any) => {
        const id = u.ingredient_master_id as string
        grouped.set(id, [
          ...(grouped.get(id) ?? []),
          { unit: u.unit as string, weight_g: Number(u.weight_g), is_default: !!u.is_default },
        ])
      })
      grouped.forEach((list, id) => weightsByMaster.set(id, buildUnitWeights(list)))
    }
  }

  // ① 既にある同じ材料（同じ単位）には数量を足す。それ以外は新しい行にする
  const toInsert: NewShoppingItem[] = []
  const updates = new Map<string, string>() // id → 新しい数量
  for (const it of items) {
    const key = itemKeyOf(it.masterId, it.name)
    const unit = normUnit(it.unit)
    const sameItem = open.filter((e) => itemKeyOf(e.ingredient_master_id, e.item_name) === key)
    // ① 同じ単位の行があれば、そこへ足す
    let match = sameItem.find((e) => normUnit(e.unit) === unit)
    let b = parseQty(it.quantity)
    // ② 無ければ、単位表で換算できる行へ、換算して足す（数量が数値の行だけ）
    if (!match && it.masterId && unit != null) {
      const w = weightsByMaster.get(it.masterId)
      const from = w?.get(unit)
      if (w && from != null) {
        const target = sameItem.find((e) => {
          const eu = normUnit(e.unit)
          return eu != null && w.has(eu) && parseQty(e.quantity) != null
        })
        if (target && b != null) {
          match = target
          b = (b * from) / (w.get(normUnit(target.unit) as string) as number)
        }
      }
    }
    const a = parseQty(match?.quantity)
    if (match && a != null && b != null) {
      const sum = roundQty(a + b)
      match.quantity = sum // 同じ行に2回足すときのため、手元の値も更新
      updates.set(match.id, sum)
    } else {
      toInsert.push(it)
    }
  }

  // ② 新しい行は、カテゴリ順に合う位置に自動で差し込む
  const orders = computeSortOrders(
    open.map((e) => ({ sort_order: e.sort_order, category: e.category })),
    toInsert.map((i) => i.category),
    order,
  )

  if (toInsert.length > 0) {
    const rows = toInsert.map((it, i) => ({
      shopping_list_id: listId,
      ingredient_master_id: it.masterId,
      recipe_id: it.recipeId,
      item_name: it.name,
      quantity: it.quantity,
      unit: it.unit,
      is_checked: false,
      created_by: userId,
      updated_by: userId,
      category: it.category,
      sort_order: orders[i],
      note: it.note,
    }))
    const { error: insErr } = await supabase.from('shopping_items').insert(rows)
    if (insErr) throw insErr
  }

  const results = await Promise.all(
    Array.from(updates.entries()).map(([id, quantity]) =>
      supabase.from('shopping_items').update({ quantity, updated_by: userId }).eq('id', id),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error

  return { inserted: toInsert.length, merged: updates.size }
}
