// src/types/shopping.ts（新規作成）
// 買い物リストの型定義（テーブル: shopping_items）
export type ShoppingItem = {
  id: string
  shopping_list_id: string
  ingredient_master_id: string | null
  recipe_id: string | null
  item_name: string
  quantity: string | null
  unit: string | null
  is_checked: boolean
  checked_by: string | null
  checked_at: string | null
  created_by: string | null
  updated_by: string | null
  category: string // 野菜・肉・魚介…（材料マスタのカテゴリ）
  sort_order: number // 並び順（小さいほど上。手動で入れ替えられる）
  note: string | null // どのレシピ用か（例：肉じゃが・カレーライス）
  created_at: string
}
