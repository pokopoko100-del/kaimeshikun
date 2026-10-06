// src/components/SwipeRow.tsx（ファイル全体。これで丸ごと置き換えてください）
// 左右にスワイプできる行。離したときに一定以上動いていたら、その向きの操作を実行する。
//   左スワイプ（指を右→左）… onSwipeLeft  を実行（右側にラベルが現れる）
//   右スワイプ（指を左→右）… onSwipeRight を実行（左側にラベルが現れる）
// 使わない向きは省略できます（その向きには動きません）。
// ・縦スクロールを邪魔しない（横の動きがはっきり大きいときだけ反応）
// ・スワイプ直後のタップで、リンク先へ飛ばないようにする
// ・iPhoneの「画面の左端から右へスワイプ＝戻る」と重ならないよう、左端24pxからの右スワイプは無視
// ・disabled を true にすると、スワイプを一時的に無効にできる（長押しドラッグ中など）
import { useRef, useState } from 'react'

export type SwipeAction = {
  label: string // 通常時のラベル
  readyLabel: string // 十分に引いたとき（離せば実行される）のラベル
  className: string // 背景色（Tailwind）。例: 'bg-red-500'
}

const ACTION_W = 104 // 現れる操作エリアの幅(px)
const COMMIT_W = 72 // これ以上動かして離すと実行(px)
const EDGE_GUARD = 24 // 画面の左端から、この範囲で始まったタッチは右スワイプとして扱わない(px)

export default function SwipeRow({
  left,
  right,
  onSwipeLeft,
  onSwipeRight,
  disabled,
  children,
}: {
  left?: SwipeAction // 左スワイプしたとき（右側）に出す表示
  right?: SwipeAction // 右スワイプしたとき（左側）に出す表示
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const axisRef = useRef<'h' | 'v' | null>(null)
  const movedRef = useRef(false)

  const canLeft = !!onSwipeLeft
  const canRight = !!onSwipeRight

  const reset = () => {
    startRef.current = null
    axisRef.current = null
    setDragging(false)
    setDx(0)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    startRef.current = { x: e.clientX, y: e.clientY }
    axisRef.current = null
    movedRef.current = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const s = startRef.current
    if (!s) return
    const mx = e.clientX - s.x
    const my = e.clientY - s.y

    // 向きが決まるまで様子を見る。縦のほうが大きければ、スワイプとは扱わない（縦スクロール優先）
    if (axisRef.current === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      const horizontal = Math.abs(mx) > Math.abs(my) * 1.5
      const okDir =
        (mx < 0 && canLeft) || (mx > 0 && canRight && !(e.pointerType === 'touch' && s.x < EDGE_GUARD))
      if (horizontal && okDir) {
        axisRef.current = 'h'
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      } else {
        axisRef.current = 'v'
        startRef.current = null
        return
      }
    }

    if (axisRef.current === 'h') {
      movedRef.current = true
      const min = canLeft ? -ACTION_W : 0
      const max = canRight ? ACTION_W : 0
      setDx(Math.max(min, Math.min(max, mx)))
    }
  }

  const onPointerUp = () => {
    const wasHorizontal = axisRef.current === 'h'
    const current = dx
    reset()
    if (!wasHorizontal) return
    if (current <= -COMMIT_W) onSwipeLeft?.()
    else if (current >= COMMIT_W) onSwipeRight?.()
  }

  // スワイプしたあとの「指を離した瞬間のタップ」で詳細画面へ飛ばないようにする
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (movedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      movedRef.current = false
    }
  }

  const showLeftAction = dx < 0 && left // 左へ動かしている → 右側に left を表示
  const showRightAction = dx > 0 && right // 右へ動かしている → 左側に right を表示

  return (
    <div className="relative select-none overflow-hidden rounded-xl">
      {/* 背面（右側）：左スワイプで現れる */}
      {showLeftAction && left && (
        <div
          className={`absolute inset-y-0 right-0 flex items-center justify-center px-1 text-center text-sm font-bold leading-tight text-white ${left.className}`}
          style={{ width: ACTION_W }}
        >
          {dx <= -COMMIT_W ? left.readyLabel : left.label}
        </div>
      )}
      {/* 背面（左側）：右スワイプで現れる */}
      {showRightAction && right && (
        <div
          className={`absolute inset-y-0 left-0 flex items-center justify-center px-1 text-center text-sm font-bold leading-tight text-white ${right.className}`}
          style={{ width: ACTION_W }}
        >
          {dx >= COMMIT_W ? right.readyLabel : right.label}
        </div>
      )}

      {/* 前面：カード本体（縦スクロールはブラウザに任せ、横の動きだけ受け取る） */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
        className="relative bg-white"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease-out',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
}
