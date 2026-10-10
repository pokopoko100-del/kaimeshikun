// src/components/SettingsSection.tsx（新規作成）
// 設定画面の「開閉できるカード」。最初は閉じていて、タップすると中身が開く（ワンクッション用）。
//   ・中身は、開いたときに初めて表示される（開くまで、データの読み込みもしない）
import { useState } from 'react'
import type { ReactNode } from 'react'

export default function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: string
  title: string
  description?: string // 閉じているときも見える、1行の説明
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="mb-3 overflow-hidden rounded-xl bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
      >
        <span className="text-xl leading-none">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-900">{title}</span>
          {description && <span className="block truncate text-[11px] text-gray-400">{description}</span>}
        </span>
        <span className={`shrink-0 text-xs text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="border-t border-gray-100 px-4 pb-4 pt-3">{children}</div>}
    </section>
  )
}
