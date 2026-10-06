// src/types/cookLog.ts（新規作成）
// 「作った」履歴の型定義（テーブル: cook_logs）
export type CookLog = {
  id: string
  household_id: string
  recipe_id: string
  cooked_on: string // 作った日（2026-10-06 の形）
  cooked_by: string | null
  created_at: string
}
