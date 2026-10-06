// src/lib/household.ts（新規作成）
// 世帯（家族グループ）まわりのDB操作：世帯ID・買い物リストのID・カテゴリ順の読み書き
import { supabase } from '../supabaseClient'
import { normalizeCategoryOrder } from './categoryOrder'

let cached: { userId: string; householdId: string } | null = null

// ログイン中のユーザーが所属する世帯のIDを取得（1回取れたら覚えておく）
export async function getHouseholdId(userId: string): Promise<string> {
  if (cached && cached.userId === userId) return cached.householdId
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
  if (error) throw error
  const id = data?.[0]?.household_id as string | undefined
  if (!id) throw new Error('所属している世帯が見つかりませんでした')
  cached = { userId, householdId: id }
  return id
}

// 買い物リストの順（設定画面で変更）。未設定・読み込み失敗のときは初期の順
export async function fetchCategoryOrder(householdId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('households')
    .select('shopping_category_order')
    .eq('id', householdId)
    .maybeSingle()
  if (error) {
    console.error(error)
    return normalizeCategoryOrder(null)
  }
  return normalizeCategoryOrder((data?.shopping_category_order as string[] | null) ?? null)
}

export async function saveCategoryOrder(householdId: string, order: string[]): Promise<void> {
  const { data, error } = await supabase
    .from('households')
    .update({ shopping_category_order: order })
    .eq('id', householdId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
}

// 買い物リスト（世帯に1つ）のIDを探す。無ければ null
export async function findShoppingListId(householdId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return (data?.[0]?.id as string | undefined) ?? null
}

// 買い物リストのIDを取得。無ければ作る
export async function getOrCreateShoppingListId(householdId: string, userId: string): Promise<string> {
  const found = await findShoppingListId(householdId)
  if (found) return found
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ household_id: householdId, title: '買い物リスト', created_by: userId })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}
