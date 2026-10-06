// src/components/ServingsStepper.tsx（新規作成）
// 「－ 2人前 ＋」の人数切替ボタン
import { MAX_SERVINGS, MIN_SERVINGS } from '../lib/useServings'

export default function ServingsStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-full border border-gray-300 bg-white text-xs font-bold text-gray-700">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= MIN_SERVINGS}
        aria-label="人数を減らす"
        className="px-2.5 py-1 text-base leading-none active:bg-gray-100 disabled:opacity-30"
      >
        −
      </button>
      <span className="min-w-[3.2rem] text-center">{value}人前</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= MAX_SERVINGS}
        aria-label="人数を増やす"
        className="px-2.5 py-1 text-base leading-none active:bg-gray-100 disabled:opacity-30"
      >
        ＋
      </button>
    </div>
  )
}
