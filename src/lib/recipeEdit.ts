// src/lib/recipeEdit.ts（新規作成）
// レシピの編集（詳細画面の「✏️ 編集」から開く）の共通部品
//   ・保存済みのレシピを、取り込みの確認画面と同じ形（Draft）にして読み込む
//   ・保存は「レシピ本体の更新 → 古い工程・材料を消す → 新しい工程・材料を入れる」の順
//     途中で失敗したら、消した工程・材料を元の内容で入れ直し、レシピ本体も元に戻す
//   ・料理写真は、変えたとき・取り除いたときだけ保存する（失敗してもレシピの保存は取り消さない）
import { supabase } from '../supabaseClient'
import { errorText } from './errorText'
import type { Recipe, Step } from '../types/recipe'
import type { Draft } from './recipeImport'
import { CATEGORIES, GENRES, SOURCE_TYPES, insertStepsAndIngredients, newKey, normUnit, validateDraft } from './recipeImport'
import { replaceRecipePhoto } from './recipePhoto'

const BUCKET = 'recipe-images'

type IngRow = {
  id: string
  sort_order: number
  ingredient_master_id: string | null
  ingredient_name: string
  quantity: string | null
  unit: string | null
  preparation: string | null
  step_id: string | null
  group_label: string | null
}

export type EditSource = { recipe: Recipe; steps: Step[]; ingredients: IngRow[] }

export async function fetchRecipeForEdit(recipeId: string): Promise<EditSource> {
  const [r, s, i] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', recipeId).single(),
    supabase.from('steps').select('*').eq('recipe_id', recipeId).order('step_number'),
    supabase.from('ingredients').select('*').eq('recipe_id', recipeId).order('sort_order'),
  ])
  if (r.error) throw r.error
  if (s.error) throw s.error
  if (i.error) throw i.error
  return { recipe: r.data as Recipe, steps: (s.data ?? []) as Step[], ingredients: (i.data ?? []) as IngRow[] }
}

const pick = (v: string | null | undefined, list: readonly string[], fallback: string) =>
  v && list.includes(v) ? v : fallback

export function recipeToDraft(src: EditSource): Draft {
  const { recipe, steps, ingredients } = src
  const noById = new Map(steps.map((s, i) => [s.id, i + 1]))
  return {
    dishName: recipe.dish_name ?? '',
    sourceName: recipe.source_name ?? '',
    sourceType: pick(recipe.source_type, SOURCE_TYPES, 'その他'),
    sourceUrl: recipe.source_url ?? '',
    genre: pick(recipe.genre, GENRES, 'その他'),
    category: pick(recipe.category, CATEGORIES, '主菜'),
    servings: String(recipe.servings ?? 2),
    servingsEstimated: false,
    cookingTime: recipe.cooking_time_minutes != null ? String(recipe.cooking_time_minutes) : '',
    cookingTimeEstimated: false,
    steps: steps.map((s) => ({
      key: newKey(),
      name: s.step_name ?? '',
      description: s.description ?? '',
      tip: s.tip ?? '',
    })),
    ingredients: ingredients.map((g) => ({
      key: newKey(),
      name: g.ingredient_name ?? '',
      masterId: g.ingredient_master_id,
      quantity: g.quantity ?? '',
      unit: normUnit(g.unit ?? ''),
      preparation: g.preparation ?? '',
      stepNo: g.step_id ? (noById.get(g.step_id) ?? null) : null,
      group: g.group_label ?? '',
    })),
  }
}

export type PhotoChange = { kind: 'keep' } | { kind: 'replace'; blob: Blob } | { kind: 'remove' }

// 編集を保存する。写真だけ失敗したときは、photoError に理由を入れて返す
export async function updateRecipe(
  src: EditSource,
  d: Draft,
  userId: string,
  photo: PhotoChange,
): Promise<{ photoError: string | null }> {
  const msg = validateDraft(d)
  if (msg) throw new Error(msg)
  const recipe = src.recipe
  const id = recipe.id

  // 元に戻すときのために、いま保存されている内容を取り直しておく（画面を開いたあとの家族の変更も含める）
  const [oldSteps, oldIngs] = await Promise.all([
    supabase.from('steps').select('*').eq('recipe_id', id),
    supabase.from('ingredients').select('*').eq('recipe_id', id),
  ])
  if (oldSteps.error) throw oldSteps.error
  if (oldIngs.error) throw oldIngs.error

  const patch = {
    dish_name: d.dishName.trim(),
    genre: d.genre,
    category: d.category,
    source_type: d.sourceType,
    source_name: d.sourceName.trim(),
    source_url: d.sourceUrl.trim() || null,
    servings: Number(d.servings),
    cooking_time_minutes: d.cookingTime.trim() === '' ? null : Number(d.cookingTime),
    updated_by: userId,
  }
  const before: Record<string, unknown> = {}
  const rec = recipe as unknown as Record<string, unknown>
  for (const k of Object.keys(patch)) before[k] = rec[k] ?? null

  // ① レシピ本体
  {
    const { data, error } = await supabase.from('recipes').update(patch).eq('id', id).select('id')
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new Error('同じ「料理名」と「参考元」のレシピが、すでにあります。どちらかを変えてください')
      }
      throw error
    }
    if (!data || data.length === 0) throw new Error('レシピを更新できませんでした（権限を確認してください）')
  }

  // ② 工程・材料を入れ替える
  let deleted = false
  try {
    const { error: e1 } = await supabase.from('ingredients').delete().eq('recipe_id', id)
    if (e1) throw e1
    const { error: e2 } = await supabase.from('steps').delete().eq('recipe_id', id)
    if (e2) throw e2
    deleted = true
    await insertStepsAndIngredients(id, d)
  } catch (e) {
    // 元に戻す：新しく入れた分を消し、元の工程 → 元の材料 の順に入れ直す。レシピ本体も戻す
    let failed = false
    try {
      if (deleted) {
        await supabase.from('ingredients').delete().eq('recipe_id', id)
        await supabase.from('steps').delete().eq('recipe_id', id)
        if ((oldSteps.data ?? []).length > 0) {
          const { error } = await supabase.from('steps').insert(oldSteps.data ?? [])
          if (error) throw error
        }
        if ((oldIngs.data ?? []).length > 0) {
          const { error } = await supabase.from('ingredients').insert(oldIngs.data ?? [])
          if (error) throw error
        }
      }
      const { error } = await supabase.from('recipes').update(before).eq('id', id)
      if (error) throw error
    } catch (e2) {
      console.error(e2)
      failed = true
    }
    if (failed) {
      throw new Error(`${errorText(e)}（元に戻す処理にも失敗しました。レシピを開き直して、内容を確認してください）`)
    }
    throw e
  }

  // ③ 料理写真
  let photoError: string | null = null
  try {
    if (photo.kind === 'replace') {
      await replaceRecipePhoto({
        householdId: recipe.household_id,
        recipeId: id,
        oldPath: recipe.image_path,
        blob: photo.blob,
        userId,
      })
    } else if (photo.kind === 'remove' && recipe.image_path) {
      const { data, error } = await supabase.from('recipes').update({ image_path: null }).eq('id', id).select('id')
      if (error || !data || data.length === 0) throw error ?? new Error('写真を取り除けませんでした')
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([recipe.image_path])
      if (rmErr) console.error('古い写真を消せませんでした:', rmErr.message)
    }
  } catch (e) {
    console.error(e)
    photoError = errorText(e)
  }
  return { photoError }
}
