// src/pages/SettingsPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// ※ もしここに「パスキー（FaceID）登録ボタン」などを自分で追加済みなら、全文を置き換えずに
//    <ShoppingCategoryOrderSettings /> の1行と、その import だけを足してください。
import { supabase } from '../supabaseClient'
import ShoppingCategoryOrderSettings from '../components/ShoppingCategoryOrderSettings'

export default function SettingsPage() {
  return (
    <div className="p-4">
      <h1 className="mb-4 text-lg font-bold">⚙️ 設定</h1>

      {/* 買い物リストのカテゴリ順 */}
      <ShoppingCategoryOrderSettings />

      {/* ★ 今あるパスキー(FaceID)登録ボタンは、ここへ移動してください */}
      <button
        onClick={() => supabase.auth.signOut()}
        className="w-full rounded-xl border border-red-300 py-3 font-bold text-red-600 active:bg-red-50"
      >
        ログアウト
      </button>
    </div>
  )
}
