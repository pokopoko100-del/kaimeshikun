// src/lib/callFunction.ts（ファイル全体。これで丸ごと置き換えてください）
// Supabase の関数（Edge Function）を呼ぶ共通部品。
// 想定内のエラー（キー未登録・上限到達など）は、日本語のメッセージとコードで返ってくる。
// 今回の変更：invoke の body の型エラー（TS2322）を直した（body を Record<string, unknown> として渡す）
import { supabase } from '../supabaseClient'
import { errorText } from './errorText'

export type CallFailure = { ok: false; code: string | null; message: string }
export type CallResult<T> = ({ ok: true } & T) | CallFailure

type Envelope = { ok?: boolean; code?: string; message?: string }

export async function callFunction<T>(name: string, body: unknown): Promise<CallResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> })

  if (error) {
    // ログイン切れ（401）などは、本文に理由が入っている
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        const j = (await ctx.json()) as Envelope
        if (typeof j.message === 'string') return { ok: false, code: j.code ?? null, message: j.message }
      } catch {
        /* 本文が読めなければ、下の文言を使う */
      }
    }
    return { ok: false, code: null, message: '通信に失敗しました：' + errorText(error) }
  }

  const r = data as (Envelope & T) | null
  if (!r?.ok) return { ok: false, code: r?.code ?? null, message: r?.message ?? '失敗しました' }
  return r as { ok: true } & T
}
