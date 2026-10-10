// src/components/GeminiKeySettings.tsx（新規作成）
// 設定画面の「Gemini APIキー」：自分のキーを登録・入れ替え・削除する
//   ・キーは Supabase の関数（gemini-key）を通して、あなた専用に保存される。画面にキーが返ってくることはない
//   ・家族それぞれが、自分のGoogleアカウントで作ったキーを、自分のスマホから登録する
//   ・前提：gemini-key 関数を公開済み（npx supabase functions deploy gemini-key）／テーブル user_gemini_keys を作成済み
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { errorText } from '../lib/errorText'

type KeyBody = { action: 'status' } | { action: 'delete' } | { action: 'save'; api_key: string }
type KeyResult = { ok: true; hasKey: boolean } | { ok: false; message: string }

// gemini-key 関数を呼ぶ。想定内のエラー（形式違い・無効なキーなど）は日本語のメッセージで返ってくる
async function callGeminiKey(body: KeyBody): Promise<KeyResult> {
  const { data, error } = await supabase.functions.invoke('gemini-key', { body })
  if (error) {
    // ログイン切れ（401）・家庭メンバー外（403）などは、本文に理由が入っている
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        const j = (await ctx.json()) as { message?: unknown }
        if (typeof j.message === 'string') return { ok: false, message: j.message }
      } catch {
        /* 本文が読めなければ、下の文言を使う */
      }
    }
    return { ok: false, message: '通信に失敗しました：' + errorText(error) }
  }
  const r = data as { ok?: boolean; has_key?: boolean; message?: string } | null
  if (r?.ok) return { ok: true, hasKey: !!r.has_key }
  return { ok: false, message: r?.message ?? '失敗しました' }
}

type Status = 'loading' | 'registered' | 'none' | 'unknown'

export default function GeminiKeySettings() {
  const [status, setStatus] = useState<Status>('loading')
  const [input, setInput] = useState('')
  const [show, setShow] = useState(false) // 貼り付けたキーを見えるようにする
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // 開いたときに、登録済みかどうかを確認
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await callGeminiKey({ action: 'status' })
      if (cancelled) return
      if (r.ok) {
        setStatus(r.hasKey ? 'registered' : 'none')
      } else {
        setStatus('unknown')
        setMessage({ type: 'error', text: '登録状況を確認できませんでした：' + r.message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    const key = input.trim()
    if (!key || busy) return
    setBusy(true)
    setMessage(null)
    const r = await callGeminiKey({ action: 'save', api_key: key })
    setBusy(false)
    if (r.ok) {
      setInput('')
      setShow(false)
      setStatus('registered')
      setMessage({ type: 'ok', text: '登録しました。このキーは、あなたのアカウントだけで使われます' })
    } else {
      setMessage({ type: 'error', text: r.message })
    }
  }

  const remove = async () => {
    if (busy) return
    if (!window.confirm('登録したGemini APIキーを削除しますか？（レシピの自動取り込みが使えなくなります）')) return
    setBusy(true)
    setMessage(null)
    const r = await callGeminiKey({ action: 'delete' })
    setBusy(false)
    if (r.ok) {
      setStatus('none')
      setMessage({ type: 'ok', text: '削除しました' })
    } else {
      setMessage({ type: 'error', text: r.message })
    }
  }

  const registered = status === 'registered'

  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-400">
        写真やテキストからレシピを読み取る機能で使います。自分のGoogleアカウントで作ったキーを登録してください。キーは家族それぞれが自分のものを登録し、お互いには見えません。
      </p>

      {/* 登録状況 */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">状態：</span>
        {status === 'loading' && <span className="text-gray-400">確認中…</span>}
        {status === 'registered' && <span className="font-bold text-green-600">✅ 登録済み</span>}
        {status === 'none' && <span className="font-bold text-amber-600">未登録</span>}
        {status === 'unknown' && <span className="text-gray-400">確認できませんでした</span>}
      </div>

      {/* キーの入力（見えないようにして入力。👁で確認できる） */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          {registered ? '新しいキーに入れ替える' : 'Gemini APIキー'}
        </label>
        <div className="flex items-center gap-2">
          <input
            type={show ? 'text' : 'password'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="キーを貼り付け"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'キーを隠す' : 'キーを表示する'}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-base active:bg-gray-100"
          >
            {show ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || input.trim() === ''}
          className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white active:opacity-80 disabled:bg-gray-300"
        >
          {busy ? '処理中…' : registered ? '入れ替える' : '登録する'}
        </button>
        {registered && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="shrink-0 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-bold text-red-500 active:bg-red-50 disabled:opacity-50"
          >
            削除
          </button>
        )}
      </div>

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            message.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
        <p>
          キーは Google AI Studio（
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-amber-600 underline">
            aistudio.google.com/apikey
          </a>
          ）で作れます。
        </p>
        <p className="mt-1">・お支払い（課金）の設定は進めないでください。無料枠のまま使えます。</p>
        <p>・無料枠では、送った内容がGoogleのサービス改善に使われることがあります。レシピの写真・文章だけを送ってください。</p>
      </div>
    </div>
  )
}
