// src/pages/SettingsPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：「家族と1食の目安」「主食」の設定を追加（献立に追加したときの人数は「家族」の中へ）
// 前回の変更：「献立に追加したときの人数」（初期値）の設定を追加
// 前回の変更：
//  ・各項目を、タップで開閉するカードにした（最初は全部閉じている。買い物リストのカテゴリ順が場所をとっていたため）
//  ・「FaceID / パスキー」の登録ボタンを追加（第16版の画面構成変更で消えていた分）
//  ・「Gemini APIキー」の登録欄を追加（写真・テキストからレシピを取り込む機能用。各自が自分のキーを登録する）
//  ・ログイン中のメールアドレスを表示
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import SettingsSection from '../components/SettingsSection'
import PasskeySettings from '../components/PasskeySettings'
import GeminiKeySettings from '../components/GeminiKeySettings'
import ShoppingCategoryOrderSettings from '../components/ShoppingCategoryOrderSettings'
import FamilySettings from '../components/FamilySettings'
import StapleSettings from '../components/StapleSettings'

export default function SettingsPage() {
  const { session } = useOutletContext<{ session: Session }>()

  return (
    <div className="p-4">
      <h1 className="text-lg font-bold">⚙️ 設定</h1>
      <p className="mb-4 mt-0.5 truncate text-[11px] text-gray-400">ログイン中：{session.user.email ?? '―'}</p>

      <SettingsSection icon="🔐" title="FaceID / パスキー" description="顔認証・指紋でログインできるようにする">
        <PasskeySettings />
      </SettingsSection>

      <SettingsSection icon="✨" title="Gemini APIキー" description="写真・テキストからレシピを取り込むためのキー">
        <GeminiKeySettings />
      </SettingsSection>

      <SettingsSection icon="👨‍👩‍👧" title="家族と1食の目安" description="体格から1日に必要なカロリーを計算（献立の人数・分析で使う）">
        <FamilySettings />
      </SettingsSection>

      <SettingsSection icon="🍚" title="主食" description="献立の分析で足す、ごはん・パンなどと1人1食の量">
        <StapleSettings />
      </SettingsSection>

      <SettingsSection icon="🛒" title="買い物リストのカテゴリ順" description="カテゴリの並び順を変える">
        <ShoppingCategoryOrderSettings />
      </SettingsSection>

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-3 w-full rounded-xl border border-red-300 py-3 font-bold text-red-600 active:bg-red-50"
      >
        ログアウト
      </button>
    </div>
  )
}
