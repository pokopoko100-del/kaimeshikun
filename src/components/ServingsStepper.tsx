// src/components/ServingsStepper.tsx（ファイル全体。これで丸ごと置き換えてください）
// 「－ 2人前 ＋」の人数切替ボタン
// 今回の変更：単位の文字（suffix）を変えられるようにした（例：献立の分析の「○回」）
// 前回の変更：最小・最大の人数を、使う場所ごとに変えられるようにした（min / max。省略すると 1〜20）
export default function ServingsStepper({
  value,
  onChange,
  min = 1,
  max = 20,
  disabled = false,
  suffix = '人前',
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  disabled?: boolean
  suffix?: string
}) {
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-full border border-gray-300 bg-white text-xs font-bold text-gray-700">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label="人数を減らす"
        className="px-2.5 py-1 text-base leading-none active:bg-gray-100 disabled:opacity-30"
      >
        −
      </button>
      <span className="min-w-[3.2rem] text-center">{value}{suffix}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label="人数を増やす"
        className="px-2.5 py-1 text-base leading-none active:bg-gray-100 disabled:opacity-30"
      >
        ＋
      </button>
    </div>
  )
}
