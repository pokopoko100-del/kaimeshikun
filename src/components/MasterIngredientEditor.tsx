// src/components/MasterIngredientEditor.tsx（新規作成）
// 材料ページの「材料を追加」「材料を編集」の画面（画面いっぱいに重ねて表示する）
//   ・追加：材料名をテキストで入力 → 「AIで分析」→ 登録画面（レシピ取り込みと同じ画面）→ 登録
//   ・編集：今の値が入った登録画面。「AIで再取得」で、栄養素・価格・旬・単位をAIの推定値に置き換えられる → 保存
//   ・前提：analyze-ingredients 関数を公開済み／設定画面で、自分のGeminiキーを登録済み
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { IngredientMaster } from '../types/ingredient'
import { errorText } from '../lib/errorText'
import type { RegisterPlan } from '../lib/ingredientRegister'
import { analyzeIngredients, applyPlan, mergeAnalysis, validatePlan } from '../lib/ingredientRegister'
import type { UnitDbRow } from '../lib/ingredientMasterEdit'
import {
  MAX_ADD_ITEMS,
  buildAddPlan,
  fetchUnitsFor,
  masterToRegItem,
  nearMasters,
  refetchItem,
  saveEdit,
} from '../lib/ingredientMasterEdit'
import type { MasterOption } from '../lib/recipeImport'
import IngredientRegisterStep from './IngredientRegisterStep'
import type { AiStatus } from './IngredientRegisterStep'

type Props = {
  mode: 'add' | 'edit'
  item?: IngredientMaster // 編集する材料（mode="edit" のとき）
  masters: MasterOption[] // いま材料マスタにある材料（名前の重複チェックに使う）
  userId: string
  onClose: () => void
  onSaved: (message: string) => void
}

type Stage = 'loading' | 'input' | 'register'

export default function MasterIngredientEditor({ mode, item, masters, userId, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit'
  const [stage, setStage] = useState<Stage>(isEdit ? 'loading' : 'input')
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<RegisterPlan | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus>('ready')
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiErrorCode, setAiErrorCode] = useState<string | null>(null)
  const [inputError, setInputError] = useState<{ message: string; code: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchingKey, setRefetchingKey] = useState<string | null>(null)

  const root = useRef<HTMLDivElement>(null) // 画面いっぱいに重ねた領域（この中がスクロールする）
  const toTop = (smooth = false) => root.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })

  const originalUnits = useRef<UnitDbRow[]>([]) // 編集を開いたときの、DBの単位の一覧
  const initialJson = useRef('') // 編集を開いたときの内容（直したかどうかの判定用）
  const run = useRef(0) // AIの呼び出しの何回目か（画面を戻ったあとの、古い結果を捨てるため）

  // ----- 編集：最新の単位をDBから読んで、今の値を入れる -----
  useEffect(() => {
    if (!isEdit || !item) return
    let cancelled = false
    fetchUnitsFor(item.id)
      .then((units) => {
        if (cancelled) return
        originalUnits.current = units
        const reg = masterToRegItem(item, units)
        initialJson.current = JSON.stringify(reg)
        setPlan({ items: [reg], unitAdds: [] })
        setAiStatus('ready')
        setStage('register')
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setError('単位を読み込めませんでした：' + errorText(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- 追加：入力した名前を読み取る（入力しながら、すぐ確認できる） -----
  const parsed = useMemo(() => buildAddPlan(text, masters.map((m) => ({ id: m.id, name: m.name }))), [text, masters])
  const newNames = parsed.plan.items.map((i) => i.name)
  const nearHints = useMemo(
    () =>
      newNames
        .map((n) => ({ name: n, near: nearMasters(n, masters) }))
        .filter((x) => x.near.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, masters],
  )

  // ----- 追加：AIで分析する -----
  const startAnalysis = async (p: RegisterPlan) => {
    const id = ++run.current
    setAiStatus('analyzing')
    setAiError(null)
    setAiErrorCode(null)
    const r = await analyzeIngredients(p, '')
    if (id !== run.current) return
    if (r.ok) {
      setPlan(mergeAnalysis(p, r.analysis))
      setAiStatus('ready')
    } else {
      setPlan(p)
      setAiStatus('failed')
      setAiError(r.message)
      setAiErrorCode(r.code)
    }
  }

  const runAnalyze = () => {
    setInputError(null)
    if (parsed.plan.items.length === 0) {
      setInputError({ message: '追加する材料の名前を入力してください', code: null })
      return
    }
    setError(null)
    setPlan(parsed.plan)
    setStage('register')
    toTop()
    void startAnalysis(parsed.plan)
  }

  // ----- 編集：AIで再取得 -----
  const handleRefetch = async (key: string) => {
    if (!plan || refetchingKey) return
    const cur = plan.items.find((i) => i.key === key)
    if (!cur) return
    if (!window.confirm('栄養素・価格・旬・単位を、AIの推定値で置き換えます。今の入力内容は上書きされます。よろしいですか？')) return
    setRefetchingKey(key)
    setError(null)
    const r = await refetchItem(cur)
    setRefetchingKey(null)
    if (!r.ok) {
      setError('AIの再取得に失敗しました：' + r.message)
      setAiErrorCode(r.code)
      return
    }
    setAiErrorCode(null)
    setPlan((p) => (p ? { ...p, items: p.items.map((i) => (i.key === key ? r.item : i)) } : p))
  }

  // ----- 登録・保存 -----
  const apply = async () => {
    if (!plan || saving) return
    const msg = validatePlan(plan, masters)
    if (msg) {
      setError(msg)
      toTop(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isEdit && item) {
        const r = await saveEdit(plan.items[0], { master: item, units: originalUnits.current }, (m) => window.confirm(m))
        if (r === 'cancelled') return
        onSaved(`「${plan.items[0].name.trim()}」を保存しました`)
      } else {
        const n = plan.items.filter((i) => i.checked).length
        await applyPlan(plan, userId)
        onSaved(`${n}件の材料を登録しました`)
      }
    } catch (e) {
      console.error(e)
      setError(errorText(e))
      toTop(true)
    } finally {
      setSaving(false)
    }
  }

  // ----- 戻る・閉じる -----
  const dirty = isEdit
    ? plan !== null && JSON.stringify(plan.items[0]) !== initialJson.current
    : stage === 'register' || text.trim() !== ''

  const close = () => {
    if (saving) return
    if (dirty && !window.confirm('入力した内容は破棄されます。閉じますか？')) return
    run.current++
    onClose()
  }

  const backToInput = () => {
    if (!window.confirm('分析した内容は破棄されます。入力に戻りますか？')) return
    run.current++
    setStage('input')
    setPlan(null)
    setError(null)
    toTop()
  }

  const title = isEdit ? `✏️ 材料を編集：${item?.ingredient_name ?? ''}` : stage === 'register' ? '🥕 材料の登録' : '✨ 材料をAIで追加'

  return (
    <div ref={root} className="fixed inset-0 z-[70] overflow-y-auto bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-white px-3 py-2.5 shadow-sm">
        {!isEdit && stage === 'register' ? (
          <button type="button" onClick={backToInput} className="shrink-0 text-sm font-semibold text-gray-600">
            ← 入力に戻る
          </button>
        ) : (
          <button type="button" onClick={close} className="shrink-0 text-sm font-semibold text-gray-600">
            ← 閉じる
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-bold">{title}</h1>
        <span className="w-12 shrink-0" />
      </header>

      {stage === 'loading' && (
        <div className="p-4">
          {error ? (
            <div className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-600">
              <p>{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-bold"
              >
                閉じる
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-xl bg-gray-200" />
              <div className="h-40 animate-pulse rounded-xl bg-gray-200" />
            </div>
          )}
        </div>
      )}

      {stage === 'input' && (
        <div className="p-3">
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-gray-900">追加したい材料の名前</span>
              <span className="mb-2 block text-xs leading-relaxed text-gray-500">
                複数あるときは、改行かカンマ（、）で区切って入力します（一度に{MAX_ADD_ITEMS}件まで）。栄養素・価格・旬・単位は、AIが推定します。
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={'例：\nハム\nしょうが\nマヨネーズ'}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed focus:border-amber-500 focus:outline-none"
              />
            </label>

            {/* 読み取った名前の確認 */}
            {newNames.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-semibold text-gray-500">登録する材料（{newNames.length}件）</p>
                <div className="flex flex-wrap gap-1.5">
                  {newNames.map((n) => (
                    <span key={n} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {parsed.existing.length > 0 && (
              <p className="mt-2 rounded-lg bg-gray-100 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
                すでに材料マスタにあるので、登録しません：{parsed.existing.map((x) => x.masterName).join('、')}
                （直したいときは、一覧で材料を長押しして「編集」を選んでください）
              </p>
            )}
            {nearHints.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                <p className="font-bold">近い名前の材料がすでにあります（二重に登録しないように、確認してください）</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {nearHints.map((h) => (
                    <li key={h.name}>
                      {h.name} ← {h.near.map((m) => m.name).join('、')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {parsed.tooMany && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">
                材料が多すぎます。最初の{MAX_ADD_ITEMS}件だけを分析します。残りは、あとでもう一度入力してください。
              </p>
            )}
          </div>

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
            onClick={runAnalyze}
            disabled={newNames.length === 0}
            className="mt-3 w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
          >
            ✨ AIで分析する{newNames.length > 0 ? `（${newNames.length}件）` : ''}
          </button>

          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-gray-500">
            <p>・分析には、あなたが設定画面で登録したGeminiキーを使います（AIの呼び出しは1回です）。</p>
            <p>・分析した内容は、次の画面で直してから登録します（この時点では登録されません）。</p>
          </div>
        </div>
      )}

      {stage === 'register' && plan && (
        <IngredientRegisterStep
          plan={plan}
          onChange={setPlan}
          masters={masters}
          aiStatus={aiStatus}
          aiError={aiError}
          aiErrorCode={aiErrorCode}
          onRetry={() => void startAnalysis(plan)}
          saving={saving}
          error={error}
          onApply={() => void apply()}
          variant={isEdit ? 'edit' : 'master'}
          onRefetch={isEdit ? (k) => void handleRefetch(k) : undefined}
          refetchingKey={refetchingKey}
        />
      )}

      {/* 編集：AIの再取得でキー未登録のとき */}
      {stage === 'register' && isEdit && aiErrorCode === 'NO_API_KEY' && (
        <div className="px-3 pb-6">
          <Link to="/settings" className="text-xs font-bold text-red-600 underline">
            設定を開いて、Geminiキーを登録する →
          </Link>
        </div>
      )}
    </div>
  )
}
