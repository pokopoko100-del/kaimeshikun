// src/components/IngredientRegisterStep.tsx（新規作成）
// レシピ取り込みの「材料の登録」画面の中身
//   ・AIが読み取ったレシピに、材料マスタに無い材料（や、マスタに無い単位）があるとき、確認・修正の前に表示する
//   ・栄養素・カロリー・価格・旬・単位（1単位が何gか）は、AIが推定した値が入っている。直してから登録できる
//   ・名前が同じ意味の材料がすでにあるときは、「既存の材料にまとめる」で選ぶ（二重に登録しない）
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { MasterOption } from '../lib/recipeImport'
import { newKey } from '../lib/recipeImport'
import type { RegisterPlan, RegItem, RegUnit, UnitAddItem } from '../lib/ingredientRegister'
import { CATEGORY_OPTIONS, NUTRIENTS, similarMasters } from '../lib/ingredientRegister'

export type AiStatus = 'analyzing' | 'ready' | 'failed'

const INPUT_BASE =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none'
const INPUT = `w-full ${INPUT_BASE}`

const UNIT_SUGGESTIONS = ['個', '枚', '本', '片', 'かけ', '玉', '束', '袋', 'パック', '缶', '丁', '切れ', '尾', 'つまみ', '大さじ', '小さじ', 'ml', 'cc']

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-gray-500">{label}</span>
      {children}
    </label>
  )
}

type Props = {
  plan: RegisterPlan
  onChange: (p: RegisterPlan) => void
  masters: MasterOption[]
  aiStatus: AiStatus
  aiError: string | null
  aiErrorCode: string | null
  onRetry: () => void
  saving: boolean
  error: string | null
  onApply: () => void
  onSkip: () => void
}

export default function IngredientRegisterStep({
  plan,
  onChange,
  masters,
  aiStatus,
  aiError,
  aiErrorCode,
  onRetry,
  saving,
  error,
  onApply,
  onSkip,
}: Props) {
  // 材料マスタを、カテゴリごとにまとめる（「既存の材料にまとめる」の選択肢）
  const grouped = useMemo(() => {
    const by = new Map<string, MasterOption[]>()
    for (const m of masters) by.set(m.category, [...(by.get(m.category) ?? []), m])
    const cats = [
      ...CATEGORY_OPTIONS.filter((c) => by.has(c)),
      ...[...by.keys()].filter((c) => !CATEGORY_OPTIONS.includes(c)),
    ]
    return cats.map((c) => [c, by.get(c) ?? []] as const)
  }, [masters])

  const patchItem = (key: string, patch: Partial<RegItem>) =>
    onChange({ ...plan, items: plan.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  const patchUnitAdd = (key: string, patch: Partial<UnitAddItem>) =>
    onChange({ ...plan, unitAdds: plan.unitAdds.map((u) => (u.key === key ? { ...u, ...patch } : u)) })

  const newCount = plan.items.filter((i) => i.checked && !i.linkTo).length
  const linkCount = plan.items.filter((i) => i.checked && i.linkTo).length
  const unitCount = plan.unitAdds.filter((u) => u.checked).length
  const total = newCount + linkCount + unitCount

  const errorBox = error && (
    <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</p>
  )

  return (
    <div className="p-3">
      <datalist id="unit-suggest">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <div className="mb-3 rounded-xl bg-white p-3 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">🥕 材料マスタに無い材料があります</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          カロリー・費用は、材料マスタの値から計算します。先にここで登録しておくと、このレシピも計算できます。栄養素・価格・旬・単位は、AIが推定した目安です（食品成分表の値とは少し違うことがあります）。内容を確認してから登録してください。
        </p>
      </div>

      {errorBox}

      {/* AIの分析状況 */}
      {aiStatus === 'analyzing' && (
        <div className="mb-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-bold">✨ AIが、栄養素・価格・単位を分析中です…（10〜30秒ほど）</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {plan.items.map((i) => (
              <li key={i.key}>{i.name}</li>
            ))}
            {plan.unitAdds.map((u) => (
              <li key={u.key}>
                {u.masterName}の「{u.unit}」
              </li>
            ))}
          </ul>
        </div>
      )}

      {aiStatus === 'failed' && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">
          <p>AIの分析に失敗しました：{aiError}</p>
          {aiErrorCode === 'NO_API_KEY' && (
            <Link to="/settings" className="mt-1 inline-block font-bold underline">
              設定を開いて、キーを登録する →
            </Link>
          )}
          <p className="mt-1 text-gray-500">もう一度分析するか、下の欄に手で入力して登録できます。</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-600 active:bg-red-50"
          >
            もう一度AIで分析する
          </button>
        </div>
      )}

      {aiStatus !== 'analyzing' && (
        <>
          {/* 新しく登録する材料 */}
          {plan.items.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-2 px-1 text-sm font-bold text-gray-900">新しく登録する材料（{plan.items.length}件）</h3>
              <ul className="space-y-3">
                {plan.items.map((it) => (
                  <ItemCard key={it.key} it={it} masters={masters} grouped={grouped} onPatch={(p) => patchItem(it.key, p)} />
                ))}
              </ul>
            </section>
          )}

          {/* 既存の材料に足す単位 */}
          {plan.unitAdds.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-1 px-1 text-sm font-bold text-gray-900">材料マスタにある材料に、単位を追加（{plan.unitAdds.length}件）</h3>
              <p className="mb-2 px-1 text-[11px] text-gray-400">レシピで使われている単位が、マスタの単位表に無い材料です。</p>
              <ul className="space-y-2">
                {plan.unitAdds.map((ua) => (
                  <li key={ua.key} className="rounded-xl bg-white p-3 shadow-sm">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={ua.checked}
                        onChange={(e) => patchUnitAdd(ua.key, { checked: e.target.checked })}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="text-sm font-bold text-gray-900">
                        {ua.masterName}
                        <span className="ml-1 text-xs font-normal text-gray-400">（レシピ：{ua.usage}）</span>
                      </span>
                    </label>
                    <div className="mt-2 flex items-center gap-2 pl-6 text-sm text-gray-700">
                      <span className="shrink-0">1{ua.unit} ＝</span>
                      <input
                        className={`${INPUT_BASE} w-24`}
                        value={ua.weight}
                        inputMode="decimal"
                        placeholder="重さ"
                        disabled={!ua.checked}
                        onChange={(e) => patchUnitAdd(ua.key, { weight: e.target.value })}
                      />
                      <span className="shrink-0">g</span>
                    </div>
                    {ua.note && <p className="mt-1 pl-6 text-[11px] text-amber-700">{ua.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {errorBox}

      <button
        type="button"
        onClick={onApply}
        disabled={saving || aiStatus === 'analyzing'}
        className="w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
      >
        {saving ? '登録中…' : total > 0 ? `登録して次へ（${total}件）` : 'このまま次へ'}
      </button>
      <button
        type="button"
        onClick={onSkip}
        disabled={saving}
        className="mb-6 mt-2 w-full rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-600 active:bg-gray-50 disabled:opacity-50"
      >
        登録せずに進む（これらの材料は「未計算」になります）
      </button>
    </div>
  )
}

// ---------- 新しく登録する材料1件ぶんのカード ----------
function ItemCard({
  it,
  masters,
  grouped,
  onPatch,
}: {
  it: RegItem
  masters: MasterOption[]
  grouped: (readonly [string, MasterOption[]])[]
  onPatch: (p: Partial<RegItem>) => void
}) {
  const similar = useMemo(() => similarMasters(it.name, masters), [it.name, masters])
  const linked = it.linkTo !== ''
  const disabled = !it.checked

  const setUnit = (key: string, patch: Partial<RegUnit>) =>
    onPatch({ units: it.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) })
  const setDefault = (key: string) => onPatch({ units: it.units.map((u) => ({ ...u, isDefault: u.key === key })) })
  const removeUnit = (key: string) => {
    const left = it.units.filter((u) => u.key !== key)
    // 基準の単位を消したときは、先頭を基準にする
    if (left.length > 0 && !left.some((u) => u.isDefault)) left[0] = { ...left[0], isDefault: true }
    onPatch({ units: left })
  }
  const toggleMonth = (m: number) =>
    onPatch({
      peakMonths: it.peakMonths.includes(m) ? it.peakMonths.filter((x) => x !== m) : [...it.peakMonths, m].sort((a, b) => a - b),
    })

  return (
    <li className={`rounded-xl bg-white p-3 shadow-sm ${disabled ? 'opacity-60' : ''}`}>
      {/* 1行目：登録する／名前 */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={it.checked}
          onChange={(e) => onPatch({ checked: e.target.checked })}
          aria-label="この材料を登録する"
          className="h-4 w-4 shrink-0"
        />
        <input
          className={`${INPUT_BASE} min-w-0 flex-1 font-bold`}
          value={it.name}
          disabled={disabled || linked}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
      </div>
      <p className="mt-1 pl-6 text-[11px] text-gray-400">レシピでの使い方：{it.usage || '（分量なし）'}</p>

      {/* 既存の材料にまとめる */}
      <div className="mt-2 pl-6">
        <Field label="すでに同じ材料があるときは、ここで選ぶ（二重に登録しません）">
          <select className={INPUT} value={it.linkTo} disabled={disabled} onChange={(e) => onPatch({ linkTo: e.target.value })}>
            <option value="">（新しい材料として登録する）</option>
            {similar.length > 0 && (
              <optgroup label="名前が近い材料">
                {similar.map((m) => (
                  <option key={`s-${m.id}`} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
            {grouped.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {linked && (
          <p className="mt-1 text-[11px] text-green-700">
            選んだ材料に結び付けます。レシピの分量の単位が合わないときは、次の画面で単位を選び直してください。
          </p>
        )}
      </div>

      {!linked && (
        <div className={`mt-3 space-y-3 pl-6 ${disabled ? 'pointer-events-none' : ''}`}>
          {it.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-lg bg-amber-50 py-2 pl-6 pr-3 text-[11px] leading-relaxed text-amber-800">
              {it.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="カテゴリ">
              <select className={INPUT} value={it.category} onChange={(e) => onPatch({ category: e.target.value })}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="100gあたりの価格（円）">
              <input className={INPUT} value={it.price} inputMode="decimal" placeholder="例：98" onChange={(e) => onPatch({ price: e.target.value })} />
            </Field>
          </div>

          {/* 単位 */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-gray-500">単位（1単位が何gか）　● ＝ 基準の単位</p>
            {it.units.length === 0 && <p className="mb-1 text-[11px] text-gray-400">単位なし（gで計算します）</p>}
            <ul className="space-y-1.5">
              {it.units.map((u) => (
                <li key={u.key} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDefault(u.key)}
                    aria-label={`${u.unit || '単位'}を基準にする`}
                    className={`h-9 w-9 shrink-0 rounded-lg border text-base ${u.isDefault ? 'border-amber-500 text-amber-600' : 'border-gray-300 text-gray-300'}`}
                  >
                    {u.isDefault ? '●' : '○'}
                  </button>
                  <input
                    className={`${INPUT_BASE} w-20 shrink-0`}
                    list="unit-suggest"
                    value={u.unit}
                    placeholder="単位"
                    onChange={(e) => setUnit(u.key, { unit: e.target.value })}
                  />
                  <span className="shrink-0 text-xs text-gray-500">1 ＝</span>
                  <input
                    className={`${INPUT_BASE} min-w-0 flex-1`}
                    value={u.weight}
                    inputMode="decimal"
                    placeholder="重さ"
                    onChange={(e) => setUnit(u.key, { weight: e.target.value })}
                  />
                  <span className="shrink-0 text-xs text-gray-500">g</span>
                  <button
                    type="button"
                    onClick={() => removeUnit(u.key)}
                    aria-label="この単位を削除"
                    className="h-9 w-9 shrink-0 rounded-lg border border-gray-300 text-sm active:bg-gray-100"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                onPatch({ units: [...it.units, { key: newKey(), unit: '', weight: '', isDefault: it.units.length === 0 }] })
              }
              className="mt-1.5 w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-xs font-semibold text-gray-500 active:bg-gray-50"
            >
              ＋ 単位を追加
            </button>
          </div>

          {/* 栄養素・旬 */}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-gray-600">
              栄養素（100gあたり）・旬を確認する
              {it.nutrients.calorie_per_100g !== '' && (
                <span className="ml-1 font-normal text-gray-400">　{it.nutrients.calorie_per_100g}kcal</span>
              )}
            </summary>

            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
              {NUTRIENTS.map((n) => (
                <label key={n.col} className="block">
                  <span className="mb-0.5 block text-[11px] text-gray-500">
                    {n.label}（{n.unit}）
                  </span>
                  <input
                    className={INPUT}
                    value={it.nutrients[n.col]}
                    inputMode="decimal"
                    placeholder="不明は空欄"
                    onChange={(e) => onPatch({ nutrients: { ...it.nutrients, [n.col]: e.target.value } })}
                  />
                </label>
              ))}
            </div>

            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold text-gray-500">旬の月（選ばなければ「通年」）</p>
              <div className="grid grid-cols-6 gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMonth(m)}
                    className={`rounded-md border py-1.5 text-xs font-bold ${
                      it.peakMonths.includes(m) ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'
                    }`}
                  >
                    {m}月
                  </button>
                ))}
              </div>
            </div>
          </details>
        </div>
      )}
    </li>
  )
}
