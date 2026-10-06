// src/lib/shoppingOrder.ts（新規作成）
// 買い物リストに新しい材料を足すときの「自動配置」の計算（画面に依存しない部品）
//   ・新しい材料は、カテゴリ順（設定画面の順）に合う位置に差し込む
//   ・既存の並び（手動で入れ替えた順も含む）は崩さない：前後の sort_order の真ん中の値を使う
import { categoryRank } from './categoryOrder'

export function computeSortOrders(
  existing: { sort_order: number; category: string }[], // いま画面に出ている（未購入の）材料
  newCategories: string[], // これから追加する材料のカテゴリ
  order: string[], // カテゴリ順
): number[] {
  const working = existing
    .map((e) => ({ s: e.sort_order, rank: categoryRank(order, e.category) }))
    .sort((a, b) => a.s - b.s)

  // カテゴリ順に並べて、1つずつ差し込む
  const idxs = newCategories
    .map((_, i) => i)
    .sort((a, b) => categoryRank(order, newCategories[a]) - categoryRank(order, newCategories[b]) || a - b)

  const result: number[] = new Array(newCategories.length).fill(0)

  for (const i of idxs) {
    const rank = categoryRank(order, newCategories[i])
    // 「自分以下のカテゴリ順」の最後の材料の直後に入れる
    let pos = -1
    for (let k = working.length - 1; k >= 0; k--) {
      if (working[k].rank <= rank) {
        pos = k
        break
      }
    }
    const prev = pos >= 0 ? working[pos].s : null
    const next = pos + 1 < working.length ? working[pos + 1].s : null

    let s: number
    if (prev == null && next == null) s = 1000
    else if (prev == null) s = (next as number) - 1000
    else if (next == null) s = prev + 1000
    else s = (prev + next) / 2

    result[i] = s
    working.splice(pos + 1, 0, { s, rank })
  }
  return result
}
