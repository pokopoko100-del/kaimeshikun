// src/lib/household.ts（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：献立に追加したときの人数の初期値は、家族が登録されていれば家族の人数にした
// 前回の変更：献立に追加したときの人数の初期値（households.default_plan_servings）の読み書きを追加
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

// ---------- 献立に追加したときの人数の初期値（設定画面で変える。家族で共通） ----------
export const DEFAULT_PLAN_SERVINGS = 2
export const MIN_PLAN_SERVINGS = 1
export const MAX_PLAN_SERVINGS = 20

let planCache: { householdId: string; value: number } | null = null

export async function fetchDefaultPlanServings(householdId: string): Promise<number> {
  if (planCache && planCache.householdId === householdId) return planCache.value
  const { data, error } = await supabase
    .from('households')
    .select('default_plan_servings')
    .eq('id', householdId)
    .maybeSingle()
  if (error) {
    // 13のSQLが未実行などで読めないときは、初期値を使う
    console.error(error)
    return DEFAULT_PLAN_SERVINGS
  }
  const v = Number((data as { default_plan_servings?: unknown } | null)?.default_plan_servings)
  const value = Number.isInteger(v) && v >= MIN_PLAN_SERVINGS && v <= MAX_PLAN_SERVINGS ? v : DEFAULT_PLAN_SERVINGS
  planCache = { householdId, value }
  return value
}

export async function saveDefaultPlanServings(householdId: string, value: number): Promise<void> {
  const { data, error } = await supabase
    .from('households')
    .update({ default_plan_servings: value })
    .eq('id', householdId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
  planCache = { householdId, value }
}

// ログイン中のユーザーの「献立に追加したときの人数」の初期値
//   家族（設定画面の「家族」）が登録されていれば、その人数。いなければ、設定画面の人数（初期値2）
export async function defaultPlanServingsFor(userId: string): Promise<number> {
  try {
    const householdId = await getHouseholdId(userId)
    const { count, error } = await supabase
      .from('household_people')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
    if (!error && count != null && count > 0) return Math.min(MAX_PLAN_SERVINGS, count)
    return await fetchDefaultPlanServings(householdId)
  } catch (e) {
    console.error(e)
    return DEFAULT_PLAN_SERVINGS
  }
}
