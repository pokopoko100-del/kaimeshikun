// ---------- src/pages/SettingsPage.tsx ----------
import { supabase } from '../supabaseClient'

export default function SettingsPage() {
  return (
    <div className="p-4">
      <h1 className="mb-4 text-lg font-bold">⚙️ 設定</h1>

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
