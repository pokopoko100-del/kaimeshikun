// src/lib/errorText.ts（新規作成）
// どんな形のエラーでも、画面に出せる文字列にする
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '不明なエラー'
}
