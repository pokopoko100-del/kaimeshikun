// src/components/LongPressArea.tsx（新規作成）
// 「タップ」と「長押し」を見分ける、クリックできる領域
//   ・約0.5秒押し続けると onLongPress を呼ぶ（そのあとの「指を離したときのタップ」は無視する）
//   ・押している間に10px以上動いたら（スクロール・スワイプのとき）、長押しは取り消す
//   ・iPhoneの長押しで出る、文字選択・コピーのメニューが出ないようにしてある
//   ・パソコンでは、右クリックでも onLongPress が呼ばれる
import { useRef } from 'react'
import type { ReactNode } from 'react'

const MOVE_LIMIT = 10 // この距離（px）以上動いたら、長押しをやめる

export default function LongPressArea({
  onTap,
  onLongPress,
  children,
  className = '',
  ms = 500,
}: {
  onTap: () => void
  onLongPress: () => void
  children: ReactNode
  className?: string
  ms?: number
}) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false) // 長押しが成立した（このあとのクリックは無視する）

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    origin.current = null
  }

  const fire = () => {
    fired.current = true
    clear()
    if ('vibrate' in navigator) navigator.vibrate(15) // 対応している端末だけ、ブッと震える
    onLongPress()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`select-none [-webkit-touch-callout:none] ${className}`}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        fired.current = false // 新しい操作の始まり（前回の取りこぼしを、ここで解除する）
        clear()
        origin.current = { x: e.clientX, y: e.clientY }
        timer.current = window.setTimeout(fire, ms)
      }}
      onPointerMove={(e) => {
        const o = origin.current
        if (!o || timer.current === null) return
        if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_LIMIT) clear()
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        e.preventDefault() // 端末のメニューは出さない
        if (!fired.current) fire()
      }}
      // 長押しが成立したあとのクリックは、中の部品（画像など）にも届かないようにして、無視する
      onClickCapture={(e) => {
        if (fired.current) {
          e.stopPropagation()
          e.preventDefault()
          fired.current = false
        }
      }}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTap()
        }
      }}
    >
      {children}
    </div>
  )
}
