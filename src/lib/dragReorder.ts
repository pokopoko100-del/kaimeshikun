// src/lib/dragReorder.ts（新規作成）
// 買い物リストの「長押しドラッグで並べ替え」の計算だけを切り出した部品（画面に依存しない）

// ドラッグ中の行が、全行の何番目に入るか（動かしている行を除いた並びの中での位置 0〜）
//   rects: 各行の位置（ページ全体での top と height）。動かす前の並び順
//   t: 動かしている行の移動量（translateY）
export function computeToIndex(rects: { id: string; top: number; height: number }[], dragId: string, t: number): number {
  const me = rects.find((r) => r.id === dragId)
  if (!me) return 0
  const center = me.top + t + me.height / 2
  let toIndex = 0
  for (const r of rects) {
    if (r.id !== dragId && r.top + r.height / 2 < center) toIndex++
  }
  return toIndex
}

// 動かしていない行が、場所を空けるためにずれる量（行の数 × (行の高さ＋すき間)）
//   idx: その行の今の位置、from: 動かしている行の元の位置、toIndex: 動かしている行の行き先
export function shiftSlots(idx: number, from: number, toIndex: number): number {
  const k = idx < from ? idx : idx - 1 // 動かしている行を除いた並びでの位置
  const newPos = k < toIndex ? k : k + 1 // 行き先が空くので、その位置以降は1つ後ろへ
  return newPos - idx
}

export type SortPlan =
  | { kind: 'none' }
  | { kind: 'single'; value: number } // 動かした行の並び順だけを更新
  | { kind: 'renumber'; orders: { id: string; sort_order: number }[] } // 全部振り直す

// ドロップしたとき、並び順をどう保存するか
//   list: いまの並び（並び順の小さい順）。動かした行を含む
export function planSortOrder(list: { id: string; sort_order: number }[], id: string, toIndex: number): SortPlan {
  const moved = list.find((i) => i.id === id)
  if (!moved) return { kind: 'none' }
  const others = list.filter((i) => i.id !== id)
  const prev = others[toIndex - 1]
  const next = others[toIndex]
  if (!prev && !next) return { kind: 'none' }
  if (!prev) return { kind: 'single', value: next.sort_order - 1000 }
  if (!next) return { kind: 'single', value: prev.sort_order + 1000 }
  if (next.sort_order - prev.sort_order > 1e-6) {
    return { kind: 'single', value: (prev.sort_order + next.sort_order) / 2 }
  }
  // 前後の値が近すぎる／同じ → 全部振り直す
  const ordered = [...others]
  ordered.splice(toIndex, 0, moved)
  return { kind: 'renumber', orders: ordered.map((it, i) => ({ id: it.id, sort_order: (i + 1) * 1000 })) }
}
