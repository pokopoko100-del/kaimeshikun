// src/lib/ingredientOrder.ts（新規作成）
// レシピ詳細の「材料」表の並び順の計算（画面に依存しない部品）
//   ・買い物リストのカテゴリ順（設定画面で変更できる順）に並べる。同じカテゴリの中は、レシピに書かれた順（sort_order）
//   ・カテゴリが変わる最初の行には startsGroup = true を付ける（画面では、そこだけ区切りの線を濃くする）
//   ・材料マスタに結び付いていない材料や、知らないカテゴリは「その他」の位置に並べる
import { categoryRank } from './categoryOrder'

export type OrderedRow<T> = {
  item: T
  rank: number // カテゴリ順での位置
  startsGroup: boolean // 1つ前の行とカテゴリが違う（先頭の行は false）
}

export function orderByCategory<T>(
  items: T[],
  order: string[],
  categoryOf: (item: T) => string | null | undefined,
  sortOf: (item: T) => number,
): OrderedRow<T>[] {
  const sorted = items
    .map((item, idx) => ({ item, idx, rank: categoryRank(order, categoryOf(item)) }))
    .sort((a, b) => a.rank - b.rank || sortOf(a.item) - sortOf(b.item) || a.idx - b.idx)

  return sorted.map((row, i) => ({
    item: row.item,
    rank: row.rank,
    startsGroup: i > 0 && sorted[i - 1].rank !== row.rank,
  }))
}
