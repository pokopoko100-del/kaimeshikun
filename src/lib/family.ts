// src/lib/family.ts（新規作成）
// 家族の体格（household_people）・主食（household_staples）・1食の割合（households.meal_share）の読み書き
//   前提：15_family_staples_migration.sql を実行済み
import { supabase } from '../supabaseClient'
import type { Activity, Sex } from './nutritionTarget'

export type PersonRow = {
  id: string
  household_id: string
  name: string
  sex: Sex | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  activity: Activity
  sort_order: number
}

export type StapleRow = {
  id: string
  household_id: string
  ingredient_master_id: string
  amount_g: number
  is_default: boolean
  sort_order: number
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export async function fetchPeople(householdId: string): Promise<PersonRow[]> {
  const { data, error } = await supabase
    .from('household_people')
    .select('id, household_id, name, sex, age, height_cm, weight_kg, activity, sort_order')
    .eq('household_id', householdId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as PersonRow[]).map((p) => ({
    ...p,
    age: num(p.age),
    height_cm: num(p.height_cm),
    weight_kg: num(p.weight_kg),
  }))
}

export async function addPerson(householdId: string, sortOrder: number): Promise<PersonRow> {
  const { data, error } = await supabase
    .from('household_people')
    .insert({ household_id: householdId, name: '', activity: 'mid', sort_order: sortOrder })
    .select('id, household_id, name, sex, age, height_cm, weight_kg, activity, sort_order')
    .single()
  if (error) throw error
  return data as PersonRow
}

export async function updatePerson(p: PersonRow): Promise<void> {
  const { data, error } = await supabase
    .from('household_people')
    .update({
      name: p.name.trim(),
      sex: p.sex,
      age: p.age,
      height_cm: p.height_cm,
      weight_kg: p.weight_kg,
      activity: p.activity,
    })
    .eq('id', p.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
}

export async function deletePerson(id: string): Promise<void> {
  const { error } = await supabase.from('household_people').delete().eq('id', id)
  if (error) throw error
}

// 家族の人数（読めないときは null。15のSQLが未実行など）
export async function countPeople(householdId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('household_people')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
  if (error) {
    console.error(error)
    return null
  }
  return count ?? 0
}

// ---------- 主食 ----------
export async function fetchStaples(householdId: string): Promise<StapleRow[]> {
  const { data, error } = await supabase
    .from('household_staples')
    .select('id, household_id, ingredient_master_id, amount_g, is_default, sort_order')
    .eq('household_id', householdId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as StapleRow[]).map((s) => ({ ...s, amount_g: Number(s.amount_g) }))
}

export async function addStaple(
  householdId: string,
  masterId: string,
  amountG: number,
  makeDefault: boolean,
  sortOrder: number,
): Promise<void> {
  const { error } = await supabase.from('household_staples').insert({
    household_id: householdId,
    ingredient_master_id: masterId,
    amount_g: amountG,
    is_default: makeDefault,
    sort_order: sortOrder,
  })
  if (error) throw error
}

export async function updateStapleAmount(id: string, amountG: number): Promise<void> {
  const { data, error } = await supabase.from('household_staples').update({ amount_g: amountG }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
}

// 初期値の主食を変える（1家庭に1つだけなので、先に今の初期値を外す）。id が null なら「初期値なし（主食なし）」
export async function setDefaultStaple(householdId: string, id: string | null): Promise<void> {
  const { error: e1 } = await supabase
    .from('household_staples')
    .update({ is_default: false })
    .eq('household_id', householdId)
    .eq('is_default', true)
  if (e1) throw e1
  if (!id) return
  const { data, error } = await supabase.from('household_staples').update({ is_default: true }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
}

export async function deleteStaple(id: string): Promise<void> {
  const { error } = await supabase.from('household_staples').delete().eq('id', id)
  if (error) throw error
}

// ---------- 1食の割合 ----------
export const MEAL_SHARE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.333, label: '1日の1/3（初期値）' },
  { value: 0.35, label: '1日の35%' },
  { value: 0.4, label: '1日の40%（夕食を多めに）' },
]

export async function fetchMealShare(householdId: string): Promise<number> {
  const { data, error } = await supabase.from('households').select('meal_share').eq('id', householdId).maybeSingle()
  if (error) {
    console.error(error)
    return 0.333
  }
  const v = Number((data as { meal_share?: unknown } | null)?.meal_share)
  return Number.isFinite(v) && v >= 0.2 && v <= 0.6 ? v : 0.333
}

export async function saveMealShare(householdId: string, value: number): Promise<void> {
  const { data, error } = await supabase.from('households').update({ meal_share: value }).eq('id', householdId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('保存できませんでした（権限を確認してください）')
}
