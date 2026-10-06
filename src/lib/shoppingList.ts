// src/lib/shoppingList.ts（新規作成）
// 買い物リストへ材料を追加する処理
//   ・すでにリストにある（未購入の）同じ材料・同じ単位は、数量を足して1行にまとめる
//   ・新しい材料は、カテゴリ順（設定画面の順）に合う位置に自動で差し込む
import { supabase } from '../supabaseClient'
import { fetchCategoryOrder, getHouseholdId, getOrCreateShoppingListId } from './household'
import { computeSortOrders } from './shoppingOrder'
import { itemKeyOf, normUnit, parseQty, roundQty } from './shoppingAggregate'

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

  // ① 既にある同じ材料（同じ単位）には数量を足す。それ以外は新しい行にする
  const toInsert: NewShoppingItem[] = []
  const updates = new Map<string, string>() // id → 新しい数量
  for (const it of items) {
    const key = itemKeyOf(it.masterId, it.name)
    const unit = normUnit(it.unit)
    const match = open.find(
      (e) => itemKeyOf(e.ingredient_master_id, e.item_name) === key && normUnit(e.unit) === unit,
    )
    const a = parseQty(match?.quantity)
    const b = parseQty(it.quantity)
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
