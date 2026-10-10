// src/components/CameraCapture.tsx（新規作成）
// アプリ内カメラ（レシピ取り込みの「読み取り用の写真」を、続けて撮る）
//   ・撮影 → 下のサムネイルに追加 → そのまま次を撮れる。「撮り直す」で直前の1枚を消す。「完了」で閉じる
//   ・撮った写真は、AIに送れる大きさ（長辺1600px・JPEG 80%）に縮めてから渡す
//   ・カメラが使えないとき（許可しなかった・対応していない端末）は、案内を出して「写真を選ぶ」に切り替えられる
//   ・閉じるときは、必ずカメラを止める（iPhoneのカメラ使用中の表示が消える）
import { useEffect, useRef, useState } from 'react'

export type Shot = { mime: string; data: string } // data は base64（先頭の data:… は付けない）

const MAX_EDGE = 1600
const QUALITY = 0.8

type Props = {
  room: number // あと何枚撮れるか
  onShot: (shot: Shot) => void
  onUndo: () => void // 直前の1枚を消す
  shots: Shot[] // このカメラで撮った写真（サムネイル表示用）
  onClose: () => void
  onFallback: () => void // 「写真を選ぶ」に切り替える
}

export default function CameraCapture({ room, onShot, onUndo, shots, onClose, onFallback }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('この端末・ブラウザでは、アプリ内カメラが使えません')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        setReady(true)
      } catch (e) {
        console.error(e)
        const name = (e as { name?: string }).name
        setError(
          name === 'NotAllowedError'
            ? 'カメラの使用が許可されませんでした（設定でカメラを許可するか、「写真を選ぶ」を使ってください）'
            : 'カメラを起動できませんでした',
        )
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const take = () => {
    const v = videoRef.current
    if (!v || !ready || room <= 0 || v.videoWidth === 0) return
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.round(v.videoWidth * scale)
    const h = Math.round(v.videoHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, w, h)
    const data = canvas.toDataURL('image/jpeg', QUALITY).split(',')[1]
    if (!data) return
    setFlash(true)
    window.setTimeout(() => setFlash(false), 120)
    onShot({ mime: 'image/jpeg', data })
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      {/* 上：閉じる・枚数 */}
      <div
        className="flex items-center justify-between px-4 pb-2"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold">
          ✕ 閉じる
        </button>
        <span className="text-xs text-white/70">
          撮影 {shots.length}枚{room > 0 ? `（あと${room}枚）` : '（上限）'}
        </span>
      </div>

      {/* 中央：カメラの映像 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video ref={videoRef} playsInline muted autoPlay className="max-h-full max-w-full object-contain" />
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {!ready && !error && <p className="absolute text-sm text-white/70">カメラを起動中…</p>}
        {error && (
          <div className="absolute inset-x-6 rounded-xl bg-white p-4 text-center text-sm text-gray-800">
            <p>{error}</p>
            <button
              type="button"
              onClick={onFallback}
              className="mt-3 w-full rounded-lg bg-amber-500 py-2.5 font-bold text-white"
            >
              🖼 写真を選ぶ
            </button>
          </div>
        )}
      </div>

      {/* 下：撮った写真・操作 */}
      <div className="px-4 pt-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="mb-3 flex h-14 gap-1.5 overflow-x-auto">
          {shots.map((s, i) => (
            <img
              key={i}
              src={`data:${s.mime};base64,${s.data}`}
              alt={`撮影${i + 1}`}
              className="h-14 w-14 shrink-0 rounded-md border border-white/40 object-cover"
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onUndo}
            disabled={shots.length === 0}
            className="w-24 rounded-full bg-white/15 py-2 text-sm font-bold disabled:opacity-30"
          >
            ↩ 撮り直す
          </button>
          <button
            type="button"
            onClick={take}
            disabled={!ready || room <= 0}
            aria-label="撮影する"
            className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/90 active:scale-95 disabled:opacity-30"
          />
          <button
            type="button"
            onClick={onClose}
            className="w-24 rounded-full bg-amber-500 py-2 text-sm font-bold text-white"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
