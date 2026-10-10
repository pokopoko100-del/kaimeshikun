// src/App.tsx（ファイル全体。これで丸ごと置き換えてください）
// 今回の変更：レシピの編集画面（/recipes/:id/edit）を追加
// 前回の変更：レシピ取り込み画面（/recipes/new）を追加
// （以前の変更：Layoutにsessionを渡すようにした）
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import LoginPage from './components/LoginPage'
import Layout from './components/Layout'
import RecipeListPage from './pages/RecipeListPage'
import RecipeDetailPage from './pages/RecipeDetailPage' // ← 既存の詳細画面。ファイル名が違えば合わせる
import RecipeImportPage from './pages/RecipeImportPage'
import RecipeEditPage from './pages/RecipeEditPage'
import ShoppingPage from './pages/ShoppingPage'
import MenuPage from './pages/MenuPage'
import MasterPage from './pages/MasterPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="p-6 text-center text-gray-400">読み込み中…</div>
  if (!session) return <LoginPage />

  return (
    <BrowserRouter>
      <Routes>
        {/* ★修正点：Layoutにsessionをpropsで渡す */}
        <Route element={<Layout session={session} />}>
          {/* ホームなし：起動したらいきなりレシピ */}
          <Route path="/" element={<Navigate to="/recipes" replace />} />
          <Route path="/recipes" element={<RecipeListPage />} />
          <Route path="/recipes/new" element={<RecipeImportPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditPage />} />
          <Route path="/shopping" element={<ShoppingPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/master" element={<MasterPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/recipes" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
