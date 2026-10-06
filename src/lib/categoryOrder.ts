// src/lib/categoryOrder.ts（新規作成）
// 買い物リストのカテゴリ順（設定画面で変更できる）に関する共通部品

// 初期の並び順（材料マスタのカテゴリ8種）
export const DEFAULT_CATEGORY_ORDER: string[] = [
  '野菜',
  '肉',
  '魚介',
  '乳製品・卵',
  '調味料',
  '穀物・麺',
  'その他',
  '日用品',
]

// 保存されている順を検証して整える（知らないカテゴリは捨て、足りないカテゴリは初期順で後ろに足す）
export function normalizeCategoryOrder(saved: string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of saved ?? []) {
    if (DEFAULT_CATEGORY_ORDER.includes(c) && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  for (const c of DEFAULT_CATEGORY_ORDER) {
    if (!seen.has(c)) out.push(c)
  }
  return out
}

// そのカテゴリが何番目か（知らないカテゴリは「その他」扱い）
export function categoryRank(order: string[], category: string | null | undefined): number {
  const i = order.indexOf(category ?? 'その他')
  if (i !== -1) return i
  const other = order.indexOf('その他')
  return other !== -1 ? other : order.length
}

// カテゴリの見出し用の色
export const CATEGORY_BADGE: Record<string, string> = {
  野菜: 'bg-green-100 text-green-700',
  肉: 'bg-red-100 text-red-700',
  魚介: 'bg-blue-100 text-blue-700',
  '乳製品・卵': 'bg-yellow-100 text-yellow-700',
  調味料: 'bg-orange-100 text-orange-700',
  '穀物・麺': 'bg-amber-100 text-amber-700',
  その他: 'bg-gray-100 text-gray-700',
  日用品: 'bg-purple-100 text-purple-700',
}
