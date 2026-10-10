// src/pages/RecipeImportPage.tsx（新規作成）
// レシピの取り込み画面（URL：/recipes/new）。レシピ一覧の「＋」から開く
//   ① 入力：テキストを貼る／写真を選ぶ（最大4枚）→「AIで読み取る」
//   ② 確認・修正：AIが読み取った内容を、保存の前に直す（未計算になる材料も、ここで分かる）
//   ③ 保存：recipes → steps → ingredients の順に保存して、そのレシピの詳細画面へ移動する
// 前提：analyze-recipe 関数を公開済み／設定画面で、自分のGeminiキーを登録済み
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import ImportPreviewEditor from '../components/ImportPreviewEditor'
import { errorText } from '../lib/errorText'
import type { Draft, ImageItem, MasterOption } from '../lib/recipeImport'
import {
  MAX_IMAGES,
  MAX_TEXT_CHARS,
  analyzeRecipe,
  compressForAi,
  fetchMasterOptions,
  newKey,
  saveDraft,
  validateDraft,
} from '../lib/recipeImport'

type Tab = 'text' | 'photo'
type Stage = 'input' | 'preview'

export default function RecipeImportPage() {
  const { session } = useOutletContext<{ session: Session }>()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [stage, setStage] = useState<Stage>('input')
  const [tab, setTab] = useState<Tab>('text')

  // ① 入力
  const [text, setText] = useState('')
  const [note, setNote] = useState('') // 写真タブの補足（参考元の名前など）
  const [images, setImages] = useState<ImageItem[]>([])
  const [compressing, setCompressing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [inputError, setInputError] = useState<{ message: string; code: string | null } | null>(null)

  // ② 確認・修正
  const [draft, setDraft] = useState<Draft | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [masters, setMasters] = useState<MasterOption[]>([])
  const [mastersError, setMastersError] = useState<string | null>(null)

  // ③ 保存
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 材料マスタ（未計算の判定と、紐付けの候補に使う）を、先に読み込んでおく
  useEffect(() => {
    let cancelled = false
    fetchMasterOptions()
      .then((m) => {
        if (!cancelled) setMasters(m)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setMastersError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ----- 写真を選ぶ -----
  const onPick = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : []
    if (fileRef.current) fileRef.current.value = '' // 同じ写真をもう一度選べるように
    if (files.length === 0) return

    setInputError(null)
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setInputError({ message: `写真は${MAX_IMAGES}枚までです`, code: null })
      return
    }
    setCompressing(true)
    try {
      const added: ImageItem[] = []
      for (const f of files.slice(0, room)) {
        const c = await compressForAi(f)
        added.push({ id: newKey(), mime: c.mime, data: c.data })
      }
      setImages((prev) => [...prev, ...added])
      if (files.length > room) {
        setInputError({ message: `写真は${MAX_IMAGES}枚までです。${room}枚だけ追加しました`, code: null })
      }
    } catch (e) {
      setInputError({ message: errorText(e), code: null })
    } finally {
      setCompressing(false)
    }
  }

  // ----- AIで読み取る -----
  const canAnalyze =
    !analyzing && !compressing && (tab === 'text' ? text.trim() !== '' : images.length > 0)

  const runAnalyze = async () => {
    if (!canAnalyze) return
    setInputError(null)
    setAnalyzing(true)
    const r = await analyzeRecipe(
      tab === 'text'
        ? { source: 'text', text: text.trim(), images: [] }
        : { source: 'photo', text: note.trim(), images: images.map(({ mime, data }) => ({ mime, data })) },
    )
    setAnalyzing(false)
    if (!r.ok) {
      setInputError({ message: r.message, code: r.code })
      return
    }
    setDraft(r.draft)
    setWarnings(r.warnings)
    setSaveError(null)
    setStage('preview')
    window.scrollTo(0, 0)
  }

  // ----- 保存 -----
  const doSave = async () => {
    if (!draft || saving) return
    const msg = validateDraft(draft)
    if (msg) {
      setSaveError(msg)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const id = await saveDraft(draft, session.user.id)
      navigate(`/recipes/${id}`, { replace: true })
    } catch (e) {
      console.error(e)
      setSaveError(errorText(e))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving(false)
    }
  }

  const backToInput = () => {
    if (!window.confirm('編集した内容は破棄されます。読み取りの画面に戻りますか？')) return
    setStage('input')
    window.scrollTo(0, 0)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 上部固定の帯 */}
      <header className="sticky top-0 z-40 flex items-center gap-2 bg-white px-3 py-2.5 shadow-sm">
        {stage === 'input' ? (
          <Link to="/recipes" className="shrink-0 text-sm font-semibold text-gray-600">
            ← 戻る
          </Link>
        ) : (
          <button type="button" onClick={backToInput} className="shrink-0 text-sm font-semibold text-gray-600">
            ← 読み取りに戻る
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-bold">
          {stage === 'input' ? '✨ レシピを取り込む' : '確認・修正'}
        </h1>
        {stage === 'preview' ? (
          <button
            type="button"
            onClick={doSave}
            disabled={saving}
            className="shrink-0 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-bold text-white active:opacity-80 disabled:bg-gray-300"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        ) : (
          <span className="w-12 shrink-0" />
        )}
      </header>

      {stage === 'preview' && draft ? (
        <ImportPreviewEditor
          draft={draft}
          onChange={setDraft}
          masters={masters}
          mastersError={mastersError}
          warnings={warnings}
          saving={saving}
          error={saveError}
          onSave={doSave}
        />
      ) : (
        <div className="p-3">
          {/* タブ */}
          <div className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm font-bold">
            {(
              [
                ['text', '✍️ テキスト'],
                ['photo', '📷 写真'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t)
                  setInputError(null)
                }}
                className={`py-2.5 ${tab === t ? 'bg-amber-500 text-white' : 'text-gray-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'text' ? (
            <div>
              <p className="mb-1.5 text-xs leading-relaxed text-gray-500">
                レシピサイトの文章や、SNSの投稿をコピーして貼り付けます。材料と作り方がそろっていると、きれいに読み取れます。
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                maxLength={MAX_TEXT_CHARS}
                placeholder={'例：\n鶏の照り焼き（2人前）\n【材料】鶏もも肉 1枚 / 醤油 大さじ2 …\n【作り方】\n1. …'}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed focus:border-amber-500 focus:outline-none"
              />
              <p className="mt-1 text-right text-[11px] text-gray-400">
                {text.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}文字
              </p>
            </div>
          ) : (
            <div>
              <p className="mb-1.5 text-xs leading-relaxed text-gray-500">
                料理本のページや、レシピ画面のスクリーンショットを選びます（{MAX_IMAGES}枚まで）。文字が読める大きさで撮ってください。
              </p>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onPick(e.target.files)}
              />

              <div className="grid grid-cols-2 gap-2">
                {images.map((im, i) => (
                  <div key={im.id} className="relative overflow-hidden rounded-lg border border-gray-200 bg-white">
                    <img
                      src={`data:${im.mime};base64,${im.data}`}
                      alt={`選んだ写真${i + 1}`}
                      className="aspect-[4/3] w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((x) => x.id !== im.id))}
                      aria-label={`写真${i + 1}を取り除く`}
                      className="absolute right-1 top-1 h-7 w-7 rounded-full bg-black/60 text-sm font-bold text-white"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={compressing}
                    className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white text-gray-500 active:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="text-2xl leading-none">{compressing ? '⏳' : '📷'}</span>
                    <span className="mt-1 text-xs font-semibold">
                      {compressing ? '変換中…' : images.length === 0 ? '写真を選ぶ' : '写真を追加'}
                    </span>
                  </button>
                )}
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">
                  補足（任意。参考元の名前など。例：リュウジさんのレシピ）
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                />
              </label>
            </div>
          )}

          {/* エラー */}
          {inputError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">
              <p>{inputError.message}</p>
              {inputError.code === 'NO_API_KEY' && (
                <Link to="/settings" className="mt-1 inline-block font-bold underline">
                  設定を開いて、キーを登録する →
                </Link>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void runAnalyze()}
            disabled={!canAnalyze}
            className="mt-3 w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
          >
            {analyzing ? '読み取り中…（10〜30秒ほどかかります）' : '✨ AIで読み取る'}
          </button>

          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-gray-500">
            <p>・読み取りには、あなたが設定画面で登録したGeminiキーを使います。無料枠には回数の上限があります。</p>
            <p>・送った写真・文章は、読み取りのためにGoogleのAIへ送られます。無料枠では、サービス改善に使われることがあります。</p>
            <p>・顔・住所・レシートなどが写った写真は、送らないでください。</p>
            <p>・読み取った内容は、次の画面で直してから保存します（この時点では保存されません）。</p>
          </div>
        </div>
      )}
    </div>
  )
}
