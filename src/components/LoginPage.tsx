import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMessage('メールアドレスまたはパスワードが正しくありません。')
    }
    // ログイン成功時は、App.tsx側のonAuthStateChangeが検知して
    // 自動的に画面が切り替わるので、ここでは何もしなくてOK
  }

  const handlePasskeyLogin = async () => {
    setErrorMessage(null)
    setPasskeyLoading(true)

    const { error } = await supabase.auth.signInWithPasskey()

    setPasskeyLoading(false)

    if (error) {
      setErrorMessage('FaceID / パスキーでのログインに失敗しました。パスワードでログイン後、パスキーを登録してください。')
    }
    // 成功時はApp.tsx側が自動検知するので、ここでは何もしなくてOK
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-6">
        <h1 className="text-2xl font-bold text-center text-amber-700 mb-1">
          かいめし君
        </h1>
        <p className="text-center text-sm text-gray-500 mb-6">
          ログインしてください
        </p>

        {/* FaceID / パスキーでログイン */}
        <button
          onClick={handlePasskeyLogin}
          disabled={passkeyLoading}
          className="w-full rounded-lg bg-gray-900 text-white font-semibold py-2.5 mb-4 hover:bg-gray-800 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {passkeyLoading ? 'パスキー確認中...' : 'FaceID / パスキーでログイン'}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">または</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="••••••••"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-red-600 text-center">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-500 text-white font-semibold py-2.5 hover:bg-amber-600 transition disabled:opacity-50"
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}