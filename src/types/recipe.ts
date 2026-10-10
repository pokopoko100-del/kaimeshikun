// src/types/recipe.ts（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：Recipe型に planned_servings（献立で何人前つくるか）を追加（13_servings_migration.sql に対応）
// 前回の変更点：Ingredient型に step_id・group_label、Step型に tip を追加（12_ingredients_by_step.sql に対応）
// （以前の変更点：Recipe型に plan_confirmed を追加）
// ファイル: src/types/recipe.ts
// レシピ関連の型定義

export type Recipe = {
  id: string
  household_id: string
  dish_name: string
  genre: string | null
  category: string | null
  source_type: string | null
  source_name: string | null
  source_url: string | null
  source_detail: string | null
  servings: number
  original_servings: number | null
  calories_per_serving: number | null
  cost_per_serving: number | null
  cooking_time_minutes: number | null // 調理時間(分)
  cook_count: number                  // 作成回数
  image_path: string | null
  is_planned: boolean                 // 献立に入っている（候補 or 確定）
  plan_confirmed: boolean             // ★追加：献立に確定済み（is_planned が true のときだけ意味を持つ）
  planned_by: string | null
  planned_at: string | null
  planned_servings: number | null    // 献立で何人前つくるか（献立に入れたときに初期値が入る）
  registration_method: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type Ingredient = {
  id: string
  recipe_id: string
  sort_order: number
  ingredient_master_id: string | null
  ingredient_name: string
  quantity: string | null
  unit: string | null
  note: string | null
  preparation: string | null
  step_id: string | null // どの工程で使うか（空なら工程に紐付いていない）
  group_label: string | null // グループ記号（A・B…）。空なら記号なし
}

export type Step = {
  id: string
  recipe_id: string
  step_number: number
  step_name: string | null
  description: string | null
  tip: string | null // POINT（コツ）
}

export type RecipeWithDetail = Recipe & {
  ingredients: Ingredient[]
  steps: Step[]
}
