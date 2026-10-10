// src/components/PasskeySettings.tsx（新規作成）
// 設定画面の「FaceID / パスキー」：この端末でパスキーを登録する
//   ・登録は端末ごと・URLごとに1回。登録すると、ログイン画面の「FaceID / パスキーでログイン」が使える
//   ・パスワードでのログインは、そのまま残る
//   ・パスキーは Supabase の実験機能（API が予告なく変わる可能性がある）。
//     型に頼らず「あれば呼ぶ」書き方にしてあるので、ライブラリが変わってもビルドは止まらず、画面に案内が出る
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { errorText } from '../lib/errorText'

// supabase.auth のうち、パスキーに関する部分だけを、必要な形で書いたもの
type PasskeyAuth = {
  registerPasskey?: () => Promise<unknown>
  passkey?: { list?: () => Promise<unknown> }
}
const passkeyAuth = () => supabase.auth as unknown as PasskeyAuth

// 結果から error を取り出す
function errorOf(res: unknown): unknown {
  return (res as { error?: unknown } | null)?.error ?? null
}

// 一覧の結果から件数を数える（形が分からなければ null）
function countOf(res: unknown): number | null {
  if (Array.isArray(res)) return res.length
  const data = (res as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data.length
  const inner = (data as { passkeys?: unknown } | null)?.passkeys
  return Array.isArray(inner) ? inner.length : null
}

export default function PasskeySettings() {
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const supported = typeof window !== 'undefined' && 'PublicKeyCredential' in window

  // 登録済みの件数（読めなければ表示しない）
  const refreshCount = useCallback(async () => {
    try {
      const res = await passkeyAuth().passkey?.list?.()
      if (res !== undefined && !errorOf(res)) setCount(countOf(res))
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  const register = async () => {
    if (busy) return
    setMessage(null)
    const fn = passkeyAuth().registerPasskey
    if (typeof fn !== 'function') {
      setMessage({ type: 'error', text: 'このバージョンのアプリでは、パスキーの登録に対応していません' })
      return
    }
    setBusy(true)
    try {
      const res = await passkeyAuth().registerPasskey?.()
      const err = errorOf(res)
      if (err) throw err
      setMessage({ type: 'ok', text: '登録しました。次回から、ログイン画面の「FaceID / パスキーでログイン」が使えます' })
      void refreshCount()
    } catch (e) {
      console.error(e)
      const text = errorText(e)
      // 顔認証の画面を閉じた・キャンセルした場合
      if (/NotAllowed|cancel|abort|ceremony/i.test(text)) {
        setMessage({ type: 'error', text: 'キャンセルされました。もう一度、登録ボタンを押してください' })
      } else {
        setMessage({ type: 'error', text: '登録に失敗しました：' + text })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-400">
        FaceID（顔認証）や指紋でログインできるようになります。登録は、使う端末ごとに1回です（iPhoneとパソコンは、それぞれ登録します）。パスワードでのログインも、そのまま使えます。
      </p>

      {count != null && (
        <p className="text-xs text-gray-500">
          あなたのアカウントに登録済み：<b className="text-gray-800">{count}</b>件
        </p>
      )}

      {!supported ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          この端末・ブラウザは、パスキーに対応していません。
        </p>
      ) : (
        <button
          type="button"
          onClick={register}
          disabled={busy}
          className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white active:opacity-80 disabled:opacity-50"
        >
          {busy ? '登録中…（画面の案内に従ってください）' : 'この端末にパスキーを登録'}
        </button>
      )}

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            message.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="text-[10px] leading-relaxed text-gray-400">
        ※ パスキーは、URLごとに別々に登録されます。ふだん使っているURLで登録してください。
      </p>
    </div>
  )
}
