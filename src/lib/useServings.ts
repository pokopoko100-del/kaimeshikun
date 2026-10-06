// src/lib/useServings.ts（新規作成）
// 「何人前で表示するか」を、レシピ一覧・レシピ詳細・献立で共通に使うためのフック。
// 選んだ人数は端末に保存され、次回も同じ人数で開きます（最初は1人前）。
import { useState } from 'react'

const KEY = 'kaimeshi.servings'
export const MIN_SERVINGS = 1
export const MAX_SERVINGS = 8

function read(): number {
  const v = Number(localStorage.getItem(KEY))
  return Number.isInteger(v) && v >= MIN_SERVINGS && v <= MAX_SERVINGS ? v : 1
}

export function useServings(): [number, (n: number) => void] {
  const [servings, setServings] = useState<number>(read)

  const change = (n: number) => {
    const next = Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)))
    setServings(next)
    localStorage.setItem(KEY, String(next))
  }

  return [servings, change]
}
