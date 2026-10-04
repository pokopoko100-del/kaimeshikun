// src/components/Layout.tsx（全体を置き換え）※前回版から修正：sessionをOutletのcontextとして配る
import { NavLink, Outlet } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

const tabs = [
  { to: '/recipes',  icon: '🍳', label: 'レシピ' },
  { to: '/shopping', icon: '🛒', label: '買い物' },
  { to: '/menu',     icon: '📅', label: '献立' },
  { to: '/master',   icon: '🥕', label: '材料' },
  { to: '/settings', icon: '⚙️', label: '設定' },
]

// ★修正点：sessionをpropsで受け取る
export default function Layout({ session }: { session: Session }) {
  return (
    <div className="min-h-screen bg-white">
      <main className="pb-20">
        {/* ★修正点：子画面(useOutletContext)へsessionを渡す */}
        <Outlet context={{ session }} />
      </main>

      <nav
        className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid grid-cols-5">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center h-14 text-[11px] ${
                    isActive ? 'text-orange-600 font-bold' : 'text-gray-500'
                  }`
                }
              >
                <span className="text-xl leading-none">{t.icon}</span>
                <span className="mt-1">{t.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
