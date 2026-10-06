// src/lib/dates.ts（新規作成）
// 日付まわりの共通部品（「作った日」の保存と表示に使う）

const pad = (n: number) => String(n).padStart(2, '0')

// 今日の日付を「2026-10-06」の形で返す（端末の現地時間。日本ならJST）
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 「2026-10-06」→「2026/10/06（火）」
// ※ new Date('2026-10-06') だとUTC扱いで日付がずれることがあるので、年月日を分解して作る
export function formatCookedDate(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ymd
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${m[1]}/${m[2]}/${m[3]}（${w}）`
}
