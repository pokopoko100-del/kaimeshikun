// src/components/ImportPreviewEditor.tsx（ファイル全体。これで丸ごと置き換えてください）
// レシピ取り込みの「確認・修正」画面の中身。AIが読み取った内容を、保存する前に直せる
// 今回の変更：レシピ詳細画面と同じ見た目にした（そのまま書き換えられる）
//   ・上から：料理写真（右下に登録／変更）→ 料理名・参考元・時間・標準の人前 → 作り方（各工程の中に、その工程の材料）
//   ・「材料」だけの一覧はなくした（作り方と重なるため）。工程に入っていない材料があるときだけ、作り方の上にまとめて出す
//   ・材料ごとに「未計算になるか」をバッジで表示。✎ を押すと、材料マスタ・使う工程・記号・下ごしらえを直せる
//   ・人数・調理時間をAIが推定したときは、その欄の横に「推定」と出す（自分で直すと消える）
//   ・保存ボタンは、画面上部の固定帯（RecipeImportPage）と、この画面の一番下にある
import { useMemo, useRef, useState } from 'react'
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

// 詳細画面の文字の見た目のまま書き換えられる入力欄（下に点線）
const INLINE =
  'min-w-0 border-0 border-b border-dashed border-gray-300 bg-transparent px-0.5 py-0.5 focus:border-amber-500 focus:outline-none focus:ring-0'
const BOX =
  'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

type Props = {
  draft: Draft
  onChange: (d: Draft) => void
  masters: MasterOption[]
  mastersError: string | null
  warnings: string[]
  saving: boolean
  error: string | null
  onSave: () => void
  // 料理写真（表示用）
  photoUrl: string | null
  photoBusy: boolean
  photoError: string | null
  onPickPhoto: (file: File) => void
  onClearPhoto: () => void
}

function EstimatedBadge() {
  return <span className="ml-0.5 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">AI推定</span>
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
  photoUrl,
  photoBusy,
  photoError,
  onPickPhoto,
  onClearPhoto,
}: Props) {
  const photoInput = useRef<HTMLInputElement>(null)
  const [openIng, setOpenIng] = useState<string | null>(null) // ✎ で開いている材料
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

  const addIngredient = (stepNo: number | null) => {
    const key = newKey()
    set({
      ingredients: [
        ...draft.ingredients,
        { key, name: '', masterId: null, quantity: '', unit: '', preparation: '', stepNo, group: '' },
      ],
    })
    setOpenIng(key)
  }

  // 工程を消す：その工程の材料は「工程に入っていない材料」へ。後ろの工程の番号を詰める
  const removeStep = (index: number) => {
    const no = index + 1
    const s = draft.steps[index]
    const used = draft.ingredients.filter((i) => i.stepNo === no && i.name.trim() !== '').length
    const msg = used > 0 ? `工程${no}を削除しますか？（この工程の材料${used}件は「工程に入っていない材料」に移ります）` : `工程${no}を削除しますか？`
    if ((s.name || s.description || s.tip || used > 0) && !window.confirm(msg)) return
    set({
      steps: draft.steps.filter((_, i) => i !== index),
      ingredients: draft.ingredients.map((i) =>
        i.stepNo === no ? { ...i, stepNo: null } : i.stepNo != null && i.stepNo > no ? { ...i, stepNo: i.stepNo - 1 } : i,
      ),
    })
  }

  // 工程ごとの材料・工程に入っていない材料（並びは読み取った順）
  const stepCount = draft.steps.length
  const byStep = useMemo(() => {
    const m = new Map<number, DraftIngredient[]>()
    const loose: DraftIngredient[] = []
    for (const i of draft.ingredients) {
      if (i.stepNo != null && i.stepNo >= 1 && i.stepNo <= stepCount) m.set(i.stepNo, [...(m.get(i.stepNo) ?? []), i])
      else loose.push(i)
    }
    return { m, loose }
  }, [draft.ingredients, stepCount])

  // 未計算になる材料の数（名前が空の行は数えない）
  const masterReady = masters.length > 0
  const statusOf = (i: DraftIngredient) => rowStatus(i.quantity, i.unit, i.masterId ? masterMap.get(i.masterId) : undefined)
  const unresolved = draft.ingredients.filter((i) => i.name.trim() !== '' && isUnresolved(statusOf(i))).length

  const errorBox = error && (
    <p className="mx-3 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</p>
  )

  // ---------- 材料1行（詳細画面の工程内の材料と同じ並び：名前／右に分量） ----------
  const renderIngredient = (ing: DraftIngredient) => {
    const master = ing.masterId ? masterMap.get(ing.masterId) : undefined
    const status = statusOf(ing)
    const info = STATUS_INFO[status]
    const opened = openIng === ing.key
    const unitInList = !!master && master.units.map(normUnit).includes(normUnit(ing.unit))
    const attention = masterReady && ing.name.trim() !== '' && isUnresolved(status)

    return (
      <li key={ing.key} className="py-1">
        <div className="flex items-center gap-1.5 text-sm">
          <input
            className={`${INLINE} flex-1 text-gray-700`}
            value={ing.name}
            placeholder="材料名"
            onChange={(e) => setIng(ing.key, { name: e.target.value })}
          />
          {masterReady && ing.name.trim() !== '' && status !== 'ok' && (
            <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${info.cls}`}>{info.label}</span>
          )}
          <input
            className={`${INLINE} w-12 shrink-0 text-right text-gray-500`}
            value={ing.quantity}
            placeholder="分量"
            onChange={(e) => setIng(ing.key, { quantity: e.target.value })}
          />
          {master ? (
            <select
              className={`${INLINE} w-16 shrink-0 text-gray-500`}
              value={ing.unit}
              onChange={(e) => setIng(ing.key, { unit: e.target.value })}
            >
              <option value="">（なし）</option>
              {master.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              {ing.unit !== '' && !unitInList && <option value={ing.unit}>{ing.unit}（登録なし）</option>}
            </select>
          ) : (
            <input
              className={`${INLINE} w-12 shrink-0 text-gray-500`}
              value={ing.unit}
              placeholder="単位"
              onChange={(e) => setIng(ing.key, { unit: e.target.value })}
            />
          )}
          <button
            type="button"
            onClick={() => setOpenIng(opened ? null : ing.key)}
            aria-label="この材料の詳細を直す"
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs ${
              opened ? 'bg-amber-500 text-white' : attention ? 'bg-amber-100 text-amber-700' : 'text-gray-400 active:bg-gray-100'
            }`}
          >
            ✎
          </button>
        </div>
        {(ing.preparation || ing.group) && !opened && (
          <p className="text-[11px] text-gray-400">
            {ing.group && <span className="mr-1 rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">{ing.group}</span>}
            {ing.preparation && `(${ing.preparation})`}
          </p>
        )}

        {opened && (
          <div className="mt-1.5 space-y-2 rounded-lg bg-gray-50 p-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold text-gray-500">材料マスタ（計算に使う材料）</span>
              <select
                className={BOX}
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
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold text-gray-500">使う工程</span>
                <select
                  className={BOX}
                  value={ing.stepNo ?? ''}
                  onChange={(e) => setIng(ing.key, { stepNo: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">（工程に入れない）</option>
                  {draft.steps.map((s, i) => (
                    <option key={s.key} value={i + 1}>
                      {circled(i + 1)} {s.name || '（工程名なし）'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold text-gray-500">記号</span>
                <input
                  className="w-14 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-center text-sm focus:border-amber-500 focus:outline-none"
                  value={ing.group}
                  maxLength={1}
                  placeholder="A"
                  autoCapitalize="characters"
                  onChange={(e) => setIng(ing.key, { group: e.target.value })}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold text-gray-500">下ごしらえ（みじん切り など）</span>
              <input
                className={BOX}
                value={ing.preparation}
                onChange={(e) => setIng(ing.key, { preparation: e.target.value })}
              />
            </label>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => {
                  set({ ingredients: draft.ingredients.filter((i) => i.key !== ing.key) })
                  setOpenIng(null)
                }}
                className="rounded-full border border-red-300 px-3 py-1 text-xs font-bold text-red-500 active:bg-red-50"
              >
                🗑 この材料を削除
              </button>
              <button
                type="button"
                onClick={() => setOpenIng(null)}
                className="rounded-full bg-gray-200 px-3 py-1 text-xs font-bold text-gray-600"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const addIngButton = (stepNo: number | null) => (
    <button
      type="button"
      onClick={() => addIngredient(stepNo)}
      className="mt-0.5 text-[11px] font-semibold text-amber-600 active:opacity-60"
    >
      ＋ 材料を追加
    </button>
  )

  return (
    <div className="pb-6">
      {/* 写真（右下で登録／変更。詳細画面と同じ位置） */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (photoInput.current) photoInput.current.value = '' // 同じ写真をもう一度選べるように
          if (f) onPickPhoto(f)
        }}
      />
      <div className="relative flex h-56 w-full items-center justify-center bg-gray-100">
        {photoUrl ? (
          <img src={photoUrl} alt="料理の写真" className="h-full w-full object-cover" />
        ) : (
          <div className="text-center text-gray-400">
            <div className="text-5xl">🍚</div>
            <p className="mt-1 text-[11px]">料理の写真（任意。読み取りに使った写真とは別）</p>
          </div>
        )}
        <div className="absolute bottom-2 right-2 flex gap-1.5">
          {photoUrl && (
            <button
              type="button"
              onClick={onClearPhoto}
              disabled={photoBusy}
              className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white active:opacity-80 disabled:opacity-50"
            >
              取り除く
            </button>
          )}
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            disabled={photoBusy}
            className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white active:opacity-80 disabled:opacity-50"
          >
            {photoBusy ? '変換中…' : photoUrl ? '📷 変更' : '📷 登録'}
          </button>
        </div>
      </div>
      {photoError && <p className="mx-3 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{photoError}</p>}

      {/* 料理名 ＋ 参考元・時間・標準の人前（詳細画面の上の帯と同じ並び） */}
      <div className="border-b border-gray-200 bg-white px-3 pb-2.5 pt-2">
        <input
          className={`${INLINE} w-full text-lg font-bold leading-tight text-gray-900`}
          value={draft.dishName}
          placeholder="料理名（必須）"
          onChange={(e) => set({ dishName: e.target.value })}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500">
          <input
            className={`${INLINE} w-28`}
            value={draft.sourceName}
            placeholder="参考元（必須）"
            onChange={(e) => set({ sourceName: e.target.value })}
          />
          <span className="flex items-center">
            ⏱
            <input
              className={`${INLINE} ml-0.5 w-9 text-right`}
              value={draft.cookingTime}
              inputMode="numeric"
              placeholder="―"
              onChange={(e) => set({ cookingTime: e.target.value, cookingTimeEstimated: false })}
            />
            分{draft.cookingTimeEstimated && <EstimatedBadge />}
          </span>
          <span className="flex items-center">
            標準
            <input
              className={`${INLINE} mx-0.5 w-7 text-center`}
              value={draft.servings}
              inputMode="numeric"
              onChange={(e) => set({ servings: e.target.value, servingsEstimated: false })}
            />
            人前{draft.servingsEstimated && <EstimatedBadge />}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
          <select
            className={`${INLINE} text-gray-500`}
            value={draft.genre}
            onChange={(e) => set({ genre: e.target.value })}
            aria-label="ジャンル"
          >
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          ・
          <select
            className={`${INLINE} text-gray-500`}
            value={draft.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="サブカテゴリ"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {(draft.servingsEstimated || draft.cookingTimeEstimated) && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">
            「AI推定」は、書かれていなかったためAIが推定した目安です（標準の人前は材料の分量から、時間は工程から）。直すと消えます。
          </p>
        )}
      </div>

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

        {/* 計算の状態 */}
        {masterReady ? (
          unresolved > 0 && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              ⚠️ {unresolved}件の材料が「未計算」になります。材料の ✎ から、材料マスタや単位を直せます。
            </p>
          )
        ) : (
          <p className="mb-3 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500">
            {mastersError
              ? `材料マスタを読み込めませんでした（${mastersError}）。未計算の判定は表示できません。`
              : '材料マスタを読み込み中…'}
          </p>
        )}

        {/* 工程に入っていない材料（あるときだけ） */}
        {byStep.loose.length > 0 && (
          <section className="mb-3 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-800">工程に入っていない材料</h2>
            <p className="text-[10px] text-gray-400">✎ の「使う工程」で、工程に入れられます（入れなくても保存できます）</p>
            <ul className="mt-1 divide-y divide-gray-100">{byStep.loose.map(renderIngredient)}</ul>
            {addIngButton(null)}
          </section>
        )}

        {/* 作り方（詳細画面の工程カードと同じ見た目） */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">作り方</h2>
            {byStep.loose.length === 0 && (
              <button
                type="button"
                onClick={() => addIngredient(null)}
                className="text-[11px] font-semibold text-gray-400 active:opacity-60"
              >
                ＋ 工程に入れない材料
              </button>
            )}
          </div>
          <ol className="space-y-3">
            {draft.steps.map((step, idx) => {
              const no = idx + 1
              const list = byStep.m.get(no) ?? []
              return (
                <li key={step.key} className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-semibold text-white">
                      {no}
                    </span>
                    <input
                      className={`${INLINE} flex-1 text-sm font-medium text-gray-800`}
                      value={step.name}
                      placeholder="工程名（例：下ごしらえ）"
                      onChange={(e) => setStep(step.key, { name: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      aria-label={`工程${no}を削除`}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-gray-300 active:bg-gray-100"
                    >
                      🗑
                    </button>
                  </div>

                  <div className="mb-1 pl-8">
                    {list.length > 0 && <ul className="divide-y divide-gray-100">{list.map(renderIngredient)}</ul>}
                    {addIngButton(no)}
                  </div>

                  <div className="flex gap-1 pl-8">
                    <span className="mt-1 shrink-0 text-sm font-bold text-amber-500">→</span>
                    <textarea
                      className="min-w-0 flex-1 resize-y rounded-md border border-dashed border-gray-300 bg-transparent px-1.5 py-1 text-sm leading-relaxed text-gray-600 focus:border-amber-500 focus:outline-none"
                      rows={3}
                      value={step.description}
                      placeholder="作り方の本文（[A] と書くと、記号Aの材料を指します）"
                      onChange={(e) => setStep(step.key, { description: e.target.value })}
                    />
                  </div>

                  <div className="ml-8 mt-2 flex items-center gap-1 rounded-lg bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800">
                    <span className="shrink-0 font-bold">💡 POINT</span>
                    <input
                      className={`${INLINE} flex-1 border-yellow-300 text-yellow-800 placeholder:text-yellow-600/50`}
                      value={step.tip}
                      placeholder="コツ（無ければ空欄）"
                      onChange={(e) => setStep(step.key, { tip: e.target.value })}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={() => set({ steps: [...draft.steps, { key: newKey(), name: '', description: '', tip: '' }] })}
            className="mt-2 w-full rounded-lg border border-dashed border-gray-300 bg-white py-2 text-sm font-semibold text-gray-500 active:bg-gray-50"
          >
            ＋ 工程を追加
          </button>
        </section>

        {/* 参考元の種別・URL（詳細画面の一番下の「参考元」と同じ位置） */}
        <section className="mt-5 space-y-1.5 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-gray-400">参考元の種類</span>
            <select
              className={`${INLINE} text-gray-600`}
              value={draft.sourceType}
              onChange={(e) => set({ sourceType: e.target.value })}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-gray-400">参考URL</span>
            <input
              className={`${INLINE} flex-1 text-gray-600`}
              value={draft.sourceUrl}
              inputMode="url"
              autoCapitalize="off"
              placeholder="https://…（あれば）"
              onChange={(e) => set({ sourceUrl: e.target.value })}
            />
          </div>
          <p className="text-[10px] text-gray-400">
            工程名・本文・POINTがすべて空の工程と、名前が空の材料は、保存するときに取り除かれます。
          </p>
        </section>

        <div className="mt-4">{errorBox}</div>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="w-full rounded-xl bg-amber-500 py-3.5 text-base font-bold text-white active:opacity-80 disabled:bg-gray-300"
        >
          {saving ? '保存中…' : 'このレシピを保存する'}
        </button>
      </div>
    </div>
  )
}

