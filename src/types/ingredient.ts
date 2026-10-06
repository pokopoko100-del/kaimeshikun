export type IngredientCategory =
  | '野菜'
  | '肉'
  | '魚介'
  | '乳製品・卵'
  | '調味料'
  | '穀物・麺'
  | 'その他'
  | '日用品';

export type NutritionSource = 'standard_table' | 'label' | 'ai_estimate';

export interface IngredientMaster {
  id: string;
  household_id: string;
  ingredient_name: string;
  category: IngredientCategory;
  default_unit: string | null;
  usual_product_name: string | null;
  store_name: string | null;
  note: string | null;
  brand_name: string | null;
  unit_weight_g: number | null;
  price_per_100g: number | null;
  nutrition_source: NutritionSource | null;
  calorie_per_100g: number | null;
  protein_g_per_100g: number | null;
  fat_g_per_100g: number | null;
  carbohydrate_g_per_100g: number | null;
  sugar_g_per_100g: number | null;
  dietary_fiber_g_per_100g: number | null;
  salt_g_per_100g: number | null;
  vitamin_a_ug_per_100g: number | null;
  vitamin_b1_mg_per_100g: number | null;
  vitamin_b2_mg_per_100g: number | null;
  vitamin_c_mg_per_100g: number | null;
  vitamin_d_ug_per_100g: number | null;
  vitamin_e_mg_per_100g: number | null;
  calcium_mg_per_100g: number | null;
  iron_mg_per_100g: number | null;
  zinc_mg_per_100g: number | null;
  potassium_mg_per_100g: number | null;
  vitamin_b6_mg_per_100g: number | null;   // ← 追加
  vitamin_b12_ug_per_100g: number | null;  // ← 追加
  folate_ug_per_100g: number | null;       // ← 追加
  magnesium_mg_per_100g: number | null;    // ← 追加
  created_by: string | null;
  peak_season_months: number[] | null;
  usual_product_image_path: string | null;
  created_at: string;
  updated_at: string;
  
}