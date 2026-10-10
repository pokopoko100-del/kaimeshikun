// src/components/MenuAnalysisSheet.tsx（新規作成）
// 献立の「分析」画面（画面いっぱいに重ねて表示する）
//   ① 食事回数（主菜・麺・丼の数から推定。＋−で直せる）と、食事ごとの主食（設定画面の主食から選ぶ／なし）
//   ② 計算：1人1食あたりのカロリー・値段と、栄養の過不足（日本人の食事摂取基準 2025年版の目安と比べる）
//   ③ 足りない栄養素をタップ → その栄養素が多いレシピ・材料（それぞれ上位5件）
//   ④ 「AIに提案してもらう」を押したときだけ、Gemini を1回使って、補い方を短く提案
//   ・結果は端末に保存され、確定の料理が変わるまで残る（MenuPage が管理）
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ServingsStepper from './ServingsStepper'
import { errorText } from '../lib/errorText'
import type { AnalysisContext, AnalysisItem, AnalysisResult, DishInput, TopIngredient, TopRecipe } from '../lib/menuAnalysis'
import {
  computeAnalysis,
  estimateMeals,
  fetchAnalysisContext,
  fetchDishNutrition,
  requestAiAdvice,
  topIngredients,
  topRecipes,
} from '../lib/menuAnalysis'

const SELECT = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

const STATUS_STYLE: Record<AnalysisItem['status'], { label: string; cls: string }> = {
  short: { label: '不足', cls: 'border-red-300 bg-red-50 text-red-700' },
  low: { label: 'やや不足', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  ok: { label: '足りている', cls: 'border-green-200 bg-green-50 text-green-700' },
  over: { label: 'とりすぎ', cls: 'border-purple-300 bg-purple-50 text-purple-700' },
}

function fmt(v: number, digits = 0): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
}

type Props = {
  userId: string
  dishes: DishInput[]
  saved: AnalysisResult | null
  onResult: (r: AnalysisResult) => void
  onClose: () => void
}

export default function MenuAnalysisSheet({ userId, dishes, saved, onResult, onClose }: Props) {
  const navigate = useNavigate()
  const [ctx, setCtx] = useState<AnalysisContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'setup' | 'result'>(saved ? 'result' : 'setup')
  const [result, setResult] = useState<AnalysisResult | null>(saved)
  const [meals, setMeals] = useState(() => saved?.meals ?? Math.max(1, estimateMeals(dishes)))
  const [choice, setChoice] = useState<(string | null)[]>([])
  const [calcBusy, setCalcBusy] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AnalysisItem | null>(null)
  const [tops, setTops] = useState<{ recipes: TopRecipe[]; ingredients: TopIngredient[] } | null>(null)
  const [topsError, setTopsError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<{ message: string; code: string | null } | null>(null)

  const estimated = useMemo(() => estimateMeals(dishes), [dishes])

  useEffect(() => {
    let cancelled = false
    fetchAnalysisContext(userId)
      .then((c) => {
        if (cancelled) return
        setCtx(c)
        const def = c.staples.find((s) => s.is_default)?.id ?? null
        setChoice((prev) => (prev.length > 0 ? prev : Array.from({ length: 30 }, () => def)))
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setLoadError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // 保存してあった主食の選び方を、名前から戻す
  useEffect(() => {
    if (!ctx || !saved) return
    const byName = new Map(ctx.staples.map((s) => [s.name, s.id]))
    setChoice(Array.from({ length: 30 }, (_, i) => (saved.stapleNames[i] ? (byName.get(saved.stapleNames[i]) ?? null) : null)))
  }, [ctx, saved])

  const calculate = async () => {
    if (!ctx || calcBusy) return
    setCalcBusy(true)
    setCalcError(null)
    try {
      const nutrition = await fetchDishNutrition(dishes.map((d) => d.id))
      const r = computeAnalysis({ dishes, nutrition, ctx, meals, stapleChoice: choice.slice(0, meals) })
      setResult(r)
      onResult(r)
      setSelected(null)
      setTops(null)
      setMode('result')
    } catch (e) {
      console.error(e)
      setCalcError(errorText(e))
    } finally {
      setCalcBusy(false)
    }
  }

  const openItem = async (item: AnalysisItem) => {
    if (selected?.key === item.key) {
      setSelected(null)
      return
    }
    setSelected(item)
    setTops(null)
    setTopsError(null)
    try {
      const [recipes, ingredients] = await Promise.all([topRecipes(item.col), topIngredients(item.col)])
      setTops({ recipes, ingredients })
    } catch (e) {
      console.error(e)
      setTopsError(errorText(e))
    }
  }

  const askAi = async () => {
    if (!result || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    const r = await requestAiAdvice(result)
    setAiBusy(false)
    if (!r.ok) {
      setAiError({ message: r.message, code: r.code })
      return
    }
    const next = { ...result, ai: r.advice }
    setResult(next)
    onResult(next)
  }

  const shortages = result?.items.filter((i) => i.status === 'short' || i.status === 'low').sort((a, b) => a.ratio - b.ratio) ?? []
  const overs = result?.items.filter((i) => i.status === 'over') ?? []
  const oks = result?.items.filter((i) => i.status === 'ok') ?? []

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-white px-3 py-2.5 shadow-sm">
        <button type="button" onClick={onClose} className="shrink-0 text-sm font-semibold text-gray-600">
          ← 閉じる
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-bold">📊 献立の分析</h1>
        <span className="w-12 shrink-0" />
      </header>

      <div className="space-y-3 p-3 pb-10">
        {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">読み込みに失敗しました：{loadError}</p>}

        {/* ① 食事回数と主食 */}
        {mode === 'setup' && (
          <>
            <section className="rounded-xl bg-white p-3 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">① 食事回数</h2>
              <p className="mt-0.5 text-[11px] text-gray-400">
                確定の料理 {dishes.length}品から、主菜・麺・丼の数で推定：{estimated}回（とりめし・餃子＆チャーハンなどは、ここで直してください）
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-gray-600">
                  {ctx ? `${ctx.peopleCount}人${ctx.familyRegistered ? '（家族）' : '（設定画面の人数）'}で食べる` : '…'}
                </span>
                <div className="flex items-center gap-1">
                  <ServingsStepper value={meals} onChange={setMeals} min={1} max={30} suffix="回" />
                </div>
              </div>
            </section>

            <section className="rounded-xl bg-white p-3 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">② 主食</h2>
              {!ctx ? (
                <p className="mt-1 text-xs text-gray-400">読み込み中…</p>
              ) : ctx.staples.length === 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  主食が登録されていません（主食なしで計算します）。
                  <Link to="/settings" className="ml-1 font-bold text-amber-600 underline">
                    設定画面の「主食」で登録 →
                  </Link>
                </p>
              ) : (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-xs text-gray-500">まとめて</span>
                    <select
                      className={`${SELECT} min-w-0 flex-1`}
                      value=""
                      onChange={(e) => {
                        const v = e.target.value === '__none' ? null : e.target.value
                        setChoice((c) => c.map((x, i) => (i < meals ? v : x)))
                      }}
                    >
                      <option value="">選ぶ…</option>
                      <option value="__none">すべて「なし」</option>
                      {ctx.staples.map((s) => (
                        <option key={s.id} value={s.id}>
                          すべて「{s.name} {s.amount_g}g」
                        </option>
                      ))}
                    </select>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {Array.from({ length: meals }, (_, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-xs text-gray-500">{i + 1}食目</span>
                        <select
                          className={`${SELECT} min-w-0 flex-1`}
                          value={choice[i] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value || null
                            setChoice((c) => c.map((x, j) => (j === i ? v : x)))
                          }}
                        >
                          <option value="">なし</option>
                          {ctx.staples.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}（1人{s.amount_g}g）
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {calcError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">計算に失敗しました：{calcError}</p>}
            <button
              type="button"
              onClick={() => void calculate()}
              disabled={!ctx || calcBusy || dishes.length === 0}
              className="w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
            >
              {calcBusy ? '計算中…' : '計算する（AIは使いません）'}
            </button>
          </>
        )}

        {/* ② 結果 */}
        {mode === 'result' && result && (
          <>
            <section className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900">1人1食あたり</h2>
                <button
                  type="button"
                  onClick={() => setMode('setup')}
                  className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 active:bg-gray-50"
                >
                  回数・主食を変えて再計算
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] text-gray-400">カロリー</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(result.perMeal.kcal)}kcal</p>
                  <p className="text-[10px] text-gray-400">目安 約{fmt(Math.round(result.targetKcal / 10) * 10)}kcal</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] text-gray-400">値段</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(result.perMeal.price)}円</p>
                  <p className="text-[10px] text-gray-400">主食込み</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                食事{result.meals}回 × {result.peopleCount}人 ／ 主食：
                {[...new Set(result.stapleNames)].join('・') || 'なし'}
                {!result.familyRegistered && '（家族が未登録のため、成人の平均で計算）'}
              </p>
              {result.uncertain && (
                <p className="mt-1 text-[10px] text-amber-700">※ 値が無い料理や、未計算の材料があります。その分は含まれていません。</p>
              )}
            </section>

            <section className="rounded-xl bg-white p-3 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">栄養のチェック</h2>
              <p className="mt-0.5 text-[11px] text-gray-400">
                日本人の食事摂取基準（2025年版）をもとにした1食の目安と比べています。栄養素をタップすると、多く含むレシピ・材料を表示します。
              </p>
              {shortages.length === 0 && overs.length === 0 ? (
                <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">目安の範囲におさまっています 👍</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...shortages, ...overs].map((i) => (
                    <button
                      key={i.key}
                      type="button"
                      onClick={() => void openItem(i)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[i.status].cls} ${
                        selected?.key === i.key ? 'ring-2 ring-gray-800' : ''
                      }`}
                    >
                      {i.label}
                      <span className="ml-1 font-normal">{STATUS_STYLE[i.status].label}</span>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="mt-3 rounded-lg bg-gray-50 p-2.5">
                  <p className="text-xs font-bold text-gray-700">
                    {selected.label}が多い{selected.status === 'over' ? '（とりすぎのときは、これらを控えめに）' : ''}
                  </p>
                  {topsError ? (
                    <p className="mt-1 text-xs text-red-600">読み込めませんでした：{topsError}</p>
                  ) : !tops ? (
                    <p className="mt-1 text-xs text-gray-400">読み込み中…</p>
                  ) : (
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold text-gray-500">レシピ（1人前）</p>
                        {tops.recipes.length === 0 ? (
                          <p className="text-[11px] text-gray-400">なし</p>
                        ) : (
                          <ol className="space-y-1">
                            {tops.recipes.map((r, n) => (
                              <li key={r.id}>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/recipes/${r.id}`)}
                                  className="w-full truncate text-left text-xs text-amber-700 underline"
                                >
                                  {n + 1}. {r.name}
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold text-gray-500">材料（100gあたり）</p>
                        {tops.ingredients.length === 0 ? (
                          <p className="text-[11px] text-gray-400">なし</p>
                        ) : (
                          <ol className="space-y-1">
                            {tops.ingredients.map((g, n) => (
                              <li key={g.id} className="truncate text-xs text-gray-700">
                                {n + 1}. {g.name}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {oks.length > 0 && (
                <p className="mt-2 text-[11px] text-gray-400">足りている：{oks.map((i) => i.label).join('・')}</p>
              )}
            </section>

            {/* ④ AIの提案（選んだときだけ） */}
            <section className="rounded-xl bg-white p-3 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">✨ AIの提案</h2>
              {result.ai ? (
                <div className="mt-2 space-y-1.5 text-sm text-gray-700">
                  <p className="font-semibold">{result.ai.summary}</p>
                  {result.ai.items.length > 0 && (
                    <ul className="space-y-1">
                      {result.ai.items.map((it, n) => (
                        <li key={n} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs leading-relaxed">
                          <b>{it.nutrient}</b>：{it.advice}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[10px] text-gray-400">※ AIによる一般的な提案です。医療的な助言ではありません。</p>
                </div>
              ) : (
                <>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    足りない栄養素の補い方を、AIが短く提案します（あなたのGeminiキーを1回使います。送るのは料理名と栄養素の過不足だけです）。
                  </p>
                  {aiError && (
                    <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                      <p>{aiError.message}</p>
                      {aiError.code === 'NO_API_KEY' && (
                        <Link to="/settings" className="mt-1 inline-block font-bold underline">
                          設定を開いて、キーを登録する →
                        </Link>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void askAi()}
                    disabled={aiBusy}
                    className="mt-2 w-full rounded-xl border border-amber-400 bg-amber-50 py-2.5 text-sm font-bold text-amber-700 active:bg-amber-100 disabled:opacity-60"
                  >
                    {aiBusy ? 'AIが考え中…（10〜20秒ほど）' : 'AIに提案してもらう'}
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
