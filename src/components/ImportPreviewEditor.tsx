// src/components/ImportPreviewEditor.tsx（新規作成）
// レシピ取り込みの「確認・修正」画面の中身。AIが読み取った内容を、保存する前に直せる
//   ・基本情報（料理名・参考元・ジャンル…）／材料／作り方
//   ・材料ごとに「未計算になるか」を、材料マスタと照らして、その場で表示する
//     （マスタに無い・単位が合わない・分量が数値でない、のどれか）
//   ・保存ボタンは、画面上部の固定帯（RecipeImportPage）と、この画面の一番下にある
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Draft, DraftIngredient, DraftStep, MasterOption } from '../lib/recipeImport'
import {
  CATEGORIES,
  GENRES,
  SOURCE_TYPES,
  STATUS_INFO,
  circled,
  isUnresolved,
  newKey,
  normUnit,
  rowStatus,
} from '../lib/recipeImport'
import { DEFAULT_CATEGORY_ORDER } from '../lib/categoryOrder'

// 入力欄の見た目（幅は含めない。幅は使う場所で決める）
const INPUT_BASE =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none'
const INPUT = `w-full ${INPUT_BASE}`

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-gray-500">
        {label}
        {required && <span className="ml-1 text-red-500">必須</span>}
      </span>
      {children}
    </label>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 rounded-xl bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-sm font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

type Props = {
  draft: Draft
  onChange: (d: Draft) => void
  masters: MasterOption[]
  mastersError: string | null
  warnings: string[]
  saving: boolean
  error: string | null
  onSave: () => void
}

export default function ImportPreviewEditor({
  draft,
  onChange,
  masters,
  mastersError,
  warnings,
  saving,
  error,
  onSave,
}: Props) {
  const masterMap = useMemo(() => new Map(masters.map((m) => [m.id, m])), [masters])

  // 材料マスタを、カテゴリごとにまとめる（選択肢の並び用）
  const grouped = useMemo(() => {
    const by = new Map<string, MasterOption[]>()
    for (const m of masters) by.set(m.category, [...(by.get(m.category) ?? []), m])
    const cats = [
      ...DEFAULT_CATEGORY_ORDER.filter((c) => by.has(c)),
      ...[...by.keys()].filter((c) => !DEFAULT_CATEGORY_ORDER.includes(c)),
    ]
    return cats.map((c) => [c, by.get(c) ?? []] as const)
  }, [masters])

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setIng = (key: string, patch: Partial<DraftIngredient>) =>
    set({ ingredients: draft.ingredients.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  const setStep = (key: string, patch: Partial<DraftStep>) =>
    set({ steps: draft.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) })

  // 未計算になる材料の数（名前が空の行は数えない）
  const masterReady = masters.length > 0
  const unresolved = draft.ingredients.filter(
    (i) => i.name.trim() !== '' && isUnresolved(rowStatus(i.quantity, i.unit, i.masterId ? masterMap.get(i.masterId) : undefined)),
  ).length
  const ingCount = draft.ingredients.filter((i) => i.name.trim() !== '').length

  const errorBox = error && (
    <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</p>
  )

  return (
    <div className="p-3">
      {errorBox}

      {/* AIからの注意 */}
      {warnings.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          <p className="mb-1 font-bold">⚠️ 読み取りの注意（保存の前に確認してください）</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 基本情報 */}
      <Card title="基本情報">
        <div className="space-y-2.5">
          <Field label="料理名" required>
            <input className={INPUT} value={draft.dishName} onChange={(e) => set({ dishName: e.target.value })} />
          </Field>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="参考元（人の名前・本・サイトなど）" required>
              <input
                className={INPUT}
                value={draft.sourceName}
                placeholder="例：リュウジ／自作"
                onChange={(e) => set({ sourceName: e.target.value })}
              />
            </Field>
            <Field label="種別">
              <select className={INPUT} value={draft.sourceType} onChange={(e) => set({ sourceType: e.target.value })}>
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="参考URL（あれば）">
            <input
              className={INPUT}
              value={draft.sourceUrl}
              inputMode="url"
              autoCapitalize="off"
              placeholder="https://…"
              onChange={(e) => set({ sourceUrl: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="ジャンル">
              <select className={INPUT} value={draft.genre} onChange={(e) => set({ genre: e.target.value })}>
                {GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="サブカテゴリ">
              <select className={INPUT} value={draft.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="何人前の分量か" required>
              <input
                className={INPUT}
                value={draft.servings}
                inputMode="numeric"
                onChange={(e) => set({ servings: e.target.value })}
              />
            </Field>
            <Field label="調理時間（分）">
              <input
                className={INPUT}
                value={draft.cookingTime}
                inputMode="numeric"
                placeholder="わからなければ空欄"
                onChange={(e) => set({ cookingTime: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* 材料 */}
      <Card title={`材料（${ingCount}件）`}>
        {masterReady ? (
          <p
            className={`mb-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              unresolved === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {unresolved === 0
              ? '✅ すべての材料が、カロリー・費用の計算に使えます。'
              : `⚠️ ${unresolved}件が「未計算」になります。材料マスタを選び直すか、単位を直してください。単位がマスタに無いときは、保存したあとで材料マスタ画面から追加できます。`}
          </p>
        ) : (
          <p className="mb-2 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500">
            {mastersError
              ? `材料マスタを読み込めませんでした（${mastersError}）。未計算の判定は表示できません。`
              : '材料マスタを読み込み中…'}
          </p>
        )}

        <ul className="space-y-2">
          {draft.ingredients.map((ing) => {
            const master = ing.masterId ? masterMap.get(ing.masterId) : undefined
            const status = rowStatus(ing.quantity, ing.unit, master)
            const info = STATUS_INFO[status]
            const needsAttention = masterReady && isUnresolved(status)
            const unitInList = !!master && master.units.map(normUnit).includes(normUnit(ing.unit))

            return (
              <li key={ing.key} className="rounded-lg border border-gray-200 p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    className={`${INPUT_BASE} min-w-0 flex-1`}
                    value={ing.name}
                    placeholder="材料名"
                    onChange={(e) => setIng(ing.key, { name: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => set({ ingredients: draft.ingredients.filter((i) => i.key !== ing.key) })}
                    aria-label="この材料を削除"
                    className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-2 text-sm active:bg-gray-100"
                  >
                    🗑
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    className={`${INPUT_BASE} w-20 shrink-0`}
                    value={ing.quantity}
                    placeholder="分量"
                    onChange={(e) => setIng(ing.key, { quantity: e.target.value })}
                  />
                  {master ? (
                    <select
                      className={`${INPUT_BASE} w-28 shrink-0`}
                      value={ing.unit}
                      onChange={(e) => setIng(ing.key, { unit: e.target.value })}
                    >
                      <option value="">（単位なし）</option>
                      {master.units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      {ing.unit !== '' && !unitInList && <option value={ing.unit}>{ing.unit}（登録なし）</option>}
                    </select>
                  ) : (
                    <input
                      className={`${INPUT_BASE} w-28 shrink-0`}
                      value={ing.unit}
                      placeholder="単位"
                      onChange={(e) => setIng(ing.key, { unit: e.target.value })}
                    />
                  )}
                  {masterReady && ing.name.trim() !== '' && (
                    <span className={`min-w-0 truncate rounded px-1.5 py-0.5 text-[11px] font-bold ${info.cls}`}>
                      {info.label}
                    </span>
                  )}
                </div>

                <details open={needsAttention} className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-semibold text-gray-500">
                    詳細（マスタ・工程・記号・下ごしらえ）
                  </summary>
                  <div className="mt-1.5 space-y-2">
                    <Field label="材料マスタ（計算に使う材料）">
                      <select
                        className={INPUT}
                        value={ing.masterId ?? ''}
                        onChange={(e) => setIng(ing.key, { masterId: e.target.value || null })}
                      >
                        <option value="">（紐付けない → 未計算になります）</option>
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

                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Field label="使う工程">
                        <select
                          className={INPUT}
                          value={ing.stepNo ?? ''}
                          onChange={(e) => setIng(ing.key, { stepNo: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          <option value="">（工程に紐付けない）</option>
                          {draft.steps.map((s, i) => (
                            <option key={s.key} value={i + 1}>
                              {circled(i + 1)} {s.name || '（工程名なし）'}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="記号">
                        <input
                          className={`${INPUT_BASE} w-16 text-center`}
                          value={ing.group}
                          maxLength={1}
                          placeholder="A"
                          autoCapitalize="characters"
                          onChange={(e) => setIng(ing.key, { group: e.target.value })}
                        />
                      </Field>
                    </div>

                    <Field label="下ごしらえ（みじん切り など）">
                      <input
                        className={INPUT}
                        value={ing.preparation}
                        onChange={(e) => setIng(ing.key, { preparation: e.target.value })}
                      />
                    </Field>
                  </div>
                </details>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          onClick={() =>
            set({
              ingredients: [
                ...draft.ingredients,
                { key: newKey(), name: '', masterId: null, quantity: '', unit: '', preparation: '', stepNo: null, group: '' },
              ],
            })
          }
          className="mt-2 w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-semibold text-gray-500 active:bg-gray-50"
        >
          ＋ 材料を追加
        </button>
      </Card>

      {/* 作り方 */}
      <Card title={`作り方（${draft.steps.length}工程）`}>
        <ol className="space-y-2">
          {draft.steps.map((s, i) => (
            <li key={s.key} className="rounded-lg border border-gray-200 p-2.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-lg font-bold leading-none text-amber-600">{circled(i + 1)}</span>
                <input
                  className={INPUT}
                  value={s.name}
                  placeholder="工程名（例：下ごしらえ）"
                  onChange={(e) => setStep(s.key, { name: e.target.value })}
                />
              </div>
              <textarea
                className={`${INPUT} mt-1.5`}
                rows={3}
                value={s.description}
                placeholder="作り方の本文（[A] と書くと、グループ記号Aの材料を指します）"
                onChange={(e) => setStep(s.key, { description: e.target.value })}
              />
              <input
                className={`${INPUT} mt-1.5`}
                value={s.tip}
                placeholder="💡 POINT（コツ。無ければ空欄）"
                onChange={(e) => setStep(s.key, { tip: e.target.value })}
              />
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          工程名・本文・POINTをすべて空にした工程は、保存するときに取り除かれます。
        </p>
        <button
          type="button"
          onClick={() => set({ steps: [...draft.steps, { key: newKey(), name: '', description: '', tip: '' }] })}
          className="mt-2 w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-semibold text-gray-500 active:bg-gray-50"
        >
          ＋ 工程を追加
        </button>
      </Card>

      {errorBox}

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="mb-6 w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
      >
        {saving ? '保存中…' : 'このレシピを保存する'}
      </button>
    </div>
  )
}
