// src/components/IngredientUnitsEditor.tsx（新規作成）
// 材料マスタの「単位」の追加・編集・削除フォーム（テーブル: ingredient_units）。
//   ・1つの材料に、単位をいくつでも登録できる（大さじ・小さじ・個・枚・g・ml…）。「1単位が何gか」を入れる
//   ・「基準」は1材料に1つだけ。買い物リストの表示や、旧列（default_unit / unit_weight_g）の値に使われる
//   ・基準を変えたとき・基準の重さを直したときは、材料マスタの旧列（default_unit / unit_weight_g）も同じ値にそろえる
//   ・大さじ・小さじ・ml・cc は「大さじ＝15ml」の関係で、まとめて追加／まとめて直せる
//   ・基準の単位は削除できない（先に別の単位を基準にする）。レシピで使っている単位を消すときは確認を出す
import { useState } from 'react'
import { supabase } from '../supabaseClient'
import type { IngredientMaster } from '../types/ingredient'
import { normUnit } from '../lib/shoppingAggregate'
import { errorText } from '../lib/errorText'

export type UnitRow = {
  id: string
  ingredient_master_id: string
  unit: string
  weight_g: number
  is_default: boolean
  sort_order: number
}

const SUGGESTIONS = ['大さじ', '小さじ', '個', '枚', '本', '片', 'かけ', '玉', '束', '袋', 'パック', '缶', '丁', '切れ', '尾', 'つまみ', 'ml', 'cc', 'g']
const VOLUME_UNITS = ['大さじ', '小さじ', 'ml', 'cc']

// 容量の単位は「大さじ＝15ml・小さじ＝5ml・1ml＝1cc」。1mlあたりの重さ（g）に直す
function gramsPerMl(unit: string, weightG: number): number | null {
  if (unit === '大さじ') return weightG / 15
  if (unit === '小さじ') return weightG / 5
  if (unit === 'ml' || unit === 'cc') return weightG
  return null
}

// 1mlあたりの重さから、容量の単位それぞれの「1単位の重さ」を出す
function volumeWeight(unit: string, perMl: number): number {
  const v = unit === '大さじ' ? perMl * 15 : unit === '小さじ' ? perMl * 5 : perMl
  return Math.round(v * 1000) / 1000
}

function sortRows(rows: UnitRow[]): UnitRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order || a.unit.localeCompare(b.unit, 'ja'),
  )
}

export default function IngredientUnitsEditor({
  item,
  units,
  onUnitsChange,
  onDefaultChange,
}: {
  item: IngredientMaster
  units: UnitRow[] | undefined // undefined＝読み込みに失敗
  onUnitsChange: (masterId: string, units: UnitRow[]) => void
  onDefaultChange: (masterId: string, unit: string | null, weightG: number | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({}) // 重さの入力途中の値（unit.id → 文字）
  const [newUnit, setNewUnit] = useState('')
  const [newWeight, setNewWeight] = useState('')
  const [withVolume, setWithVolume] = useState(true) // 大さじ・小さじを足すとき、ml・cc などもまとめて足す
  const [message, setMessage] = useState<string | null>(null)

  if (units === undefined) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        単位の一覧を読み込めませんでした（ingredient_units テーブルを作成済みか確認してください）。
      </p>
    )
  }

  const rows = sortRows(units)

  // DBから取り直して画面に反映。基準単位が変わっていれば、材料マスタの旧列もそろえる
  const reload = async (syncLegacy: boolean) => {
    const { data, error } = await supabase
      .from('ingredient_units')
      .select('id, ingredient_master_id, unit, weight_g, is_default, sort_order')
      .eq('ingredient_master_id', item.id)
    if (error) throw error
    const list = ((data ?? []) as UnitRow[]).map((r) => ({ ...r, weight_g: Number(r.weight_g) }))
    onUnitsChange(item.id, list)
    setDrafts({})

    if (syncLegacy) {
      const def = list.find((r) => r.is_default)
      if (def) {
        const w = def.unit === 'g' ? 1 : def.weight_g
        if (item.default_unit !== def.unit || item.unit_weight_g !== w) {
          const { data: upd, error: updErr } = await supabase
            .from('ingredient_master')
            .update({ default_unit: def.unit, unit_weight_g: w })
            .eq('id', item.id)
            .select('id')
          if (updErr || !upd || upd.length === 0) throw updErr ?? new Error('材料マスタを更新できませんでした')
          onDefaultChange(item.id, def.unit, w)
        }
      }
    }
  }

  // 共通の実行ラッパ（二重タップ防止・エラー表示・失敗時は取り直して画面をDBに合わせる）
  const run = async (job: () => Promise<void>, syncLegacy = false) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await job()
      await reload(syncLegacy)
    } catch (e) {
      console.error(e)
      setMessage('失敗しました：' + errorText(e))
      try {
        await reload(false)
      } catch {
        /* 取り直せなくても、上のメッセージを優先 */
      }
    } finally {
      setBusy(false)
    }
  }

  // ---------- 追加 ----------
  const handleAdd = () =>
    run(async () => {
      const unit = normUnit(newUnit)
      if (!unit) throw new Error('単位を入力してください（例：個、枚、大さじ）')
      const w = unit === 'g' ? 1 : Number(newWeight)
      if (!Number.isFinite(w) || w <= 0) throw new Error('「1単位が何gか」を、0より大きい数字で入力してください')
      if (rows.some((r) => r.unit === unit)) throw new Error(`「${unit}」はすでに登録されています（重さを変えるなら下の一覧で直してください）`)

      let order = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)
      const inserts: { unit: string; weight_g: number }[] = [{ unit, weight_g: w }]

      // 大さじ・小さじ・ml・cc は、まだ無いものをまとめて足す
      const perMl = gramsPerMl(unit, w)
      if (withVolume && perMl != null) {
        for (const u of VOLUME_UNITS) {
          if (u !== unit && !rows.some((r) => r.unit === u)) inserts.push({ unit: u, weight_g: volumeWeight(u, perMl) })
        }
      }

      const isFirst = rows.length === 0 // 1つ目は自動で基準にする
      const payload = inserts.map((x, i) => ({
        ingredient_master_id: item.id,
        unit: x.unit,
        weight_g: x.weight_g,
        is_default: isFirst && i === 0,
        sort_order: ++order,
      }))
      const { data, error } = await supabase.from('ingredient_units').insert(payload).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('追加できませんでした（権限を確認してください）')
      setNewUnit('')
      setNewWeight('')
    }, true)

  // ---------- 重さを直す ----------
  const handleSaveWeight = (row: UnitRow) =>
    run(async () => {
      const w = Number(drafts[row.id])
      if (!Number.isFinite(w) || w <= 0) throw new Error('重さは、0より大きい数字で入力してください')
      const { data, error } = await supabase
        .from('ingredient_units')
        .update({ weight_g: w })
        .eq('id', row.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('更新できませんでした（権限を確認してください）')

      // 大さじ・小さじ・ml・cc は、ほかの容量単位も同じ比率に直すか確認する
      const perMl = gramsPerMl(row.unit, w)
      if (perMl != null) {
        const others = rows.filter(
          (r) =>
            r.id !== row.id &&
            VOLUME_UNITS.includes(r.unit) &&
            Math.abs(r.weight_g - volumeWeight(r.unit, perMl)) > 0.005,
        )
        if (others.length > 0) {
          const names = others.map((r) => r.unit).join('・')
          if (window.confirm(`${names} も、「${row.unit}」に合わせて直しますか？（大さじ＝15ml で換算）`)) {
            for (const r of others) {
              const { error: e2 } = await supabase
                .from('ingredient_units')
                .update({ weight_g: volumeWeight(r.unit, perMl) })
                .eq('id', r.id)
              if (e2) throw e2
            }
          }
        }
      }
    }, true)

  // ---------- 基準にする ----------
  const handleSetDefault = (row: UnitRow) =>
    run(async () => {
      if (row.is_default) return
      // 基準は1材料に1つだけ（DB側の制約）なので、先に今の基準を外してから付ける
      const current = rows.find((r) => r.is_default)
      if (current) {
        const { error: e1 } = await supabase.from('ingredient_units').update({ is_default: false }).eq('id', current.id)
        if (e1) throw e1
      }
      const { data, error } = await supabase
        .from('ingredient_units')
        .update({ is_default: true })
        .eq('id', row.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('更新できませんでした（権限を確認してください）')
    }, true)

  // ---------- 削除 ----------
  const handleDelete = (row: UnitRow) =>
    run(async () => {
      if (row.is_default) throw new Error('基準の単位は削除できません。先に別の単位を「基準」にしてください')

      // レシピの材料でこの単位を使っているか確認（消すと、その材料が「未計算」になる）
      const { count, error: cErr } = await supabase
        .from('ingredients')
        .select('id', { count: 'exact', head: true })
        .eq('ingredient_master_id', item.id)
        .eq('unit', row.unit)
      if (cErr) throw cErr
      const used = count ?? 0
      const text =
        used > 0
          ? `「${row.unit}」は、レシピの材料 ${used} 件で使われています。消すとその材料が「未計算」になります。それでも消しますか？`
          : `「${row.unit}」を削除しますか？`
      if (!window.confirm(text)) return

      const { data, error } = await supabase.from('ingredient_units').delete().eq('id', row.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('削除できませんでした（権限を確認してください）')
    })

  const volumeHint = ['大さじ', '小さじ', 'ml', 'cc'].includes(normUnit(newUnit) ?? '')

  return (
    <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-500">単位（1単位が何gか）</span>
        <span className="text-[10px] text-gray-400">●＝基準</span>
      </div>

      {rows.length === 0 ? (
        <p className="mb-2 text-[11px] text-gray-400">単位はまだ登録されていません。下から追加してください（1つ目が基準になります）。</p>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {rows.map((r) => {
            const isG = r.unit === 'g'
            const draft = drafts[r.id]
            const changed = !isG && draft !== undefined && Number(draft) !== r.weight_g
            return (
              <li key={r.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSetDefault(r)}
                  aria-label={r.is_default ? `${r.unit}は基準の単位` : `${r.unit}を基準にする`}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    r.is_default ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300 bg-white text-gray-300'
                  } disabled:opacity-50`}
                >
                  ●
                </button>
                <span className="w-14 shrink-0 truncate font-medium text-gray-800">{r.unit}</span>
                {isG ? (
                  <span className="flex-1 text-gray-400">＝ 1 g（固定）</span>
                ) : (
                  <>
                    <span className="text-gray-400">＝</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft ?? String(r.weight_g)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      disabled={busy}
                      className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-right text-gray-800 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-gray-400">g</span>
                    <div className="flex-1" />
                    {changed && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSaveWeight(r)}
                        className="rounded-full bg-amber-500 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  disabled={busy || r.is_default}
                  onClick={() => handleDelete(r)}
                  aria-label={`${r.unit}を削除`}
                  className="shrink-0 rounded-full border border-red-200 px-2 py-1 text-red-400 disabled:opacity-30"
                >
                  削除
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 追加フォーム */}
      <div className="flex items-center gap-1.5 border-t border-gray-200 pt-2">
        <input
          type="text"
          list={`unit-suggest-${item.id}`}
          value={newUnit}
          onChange={(e) => setNewUnit(e.target.value)}
          placeholder="単位（例：枚）"
          disabled={busy}
          className="w-24 rounded border border-gray-300 bg-white px-1.5 py-1 text-gray-800 focus:border-amber-500 focus:outline-none"
        />
        <datalist id={`unit-suggest-${item.id}`}>
          {SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <span className="text-gray-400">＝</span>
        <input
          type="text"
          inputMode="decimal"
          value={newUnit.trim() === 'g' ? '1' : newWeight}
          onChange={(e) => setNewWeight(e.target.value)}
          placeholder="重さ"
          disabled={busy || newUnit.trim() === 'g'}
          className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-right text-gray-800 focus:border-amber-500 focus:outline-none"
        />
        <span className="text-gray-400">g</span>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy || newUnit.trim() === ''}
          onClick={handleAdd}
          className="rounded-full bg-amber-500 px-3 py-1 font-semibold text-white disabled:opacity-40"
        >
          {busy ? '処理中…' : '追加'}
        </button>
      </div>
      {volumeHint && (
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500">
          <input type="checkbox" checked={withVolume} onChange={(e) => setWithVolume(e.target.checked)} />
          大さじ・小さじ・ml・cc もまとめて追加（大さじ＝15ml で換算）
        </label>
      )}

      {message && <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{message}</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        レシピや買い物リストの単位は、ここに登録した単位と同じ名前のときだけ、gに換算されます。
      </p>
    </div>
  )
}
