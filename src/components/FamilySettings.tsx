// src/components/FamilySettings.tsx（新規作成）
// 設定画面の「家族と1食の目安」
//   ・家族ひとりずつ：名前・性別・年齢・身長・体重・活動レベル。入れた値から「1日の目安カロリー」を出す（未入力は平均値で補う）
//   ・献立に追加したときの人数は、家族の人数になる（家族が0人のときだけ、下の人数を使う）
//   ・1食が1日の何割か（献立の分析で使う）
//   前提：15_family_staples_migration.sql を実行済み
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getHouseholdId } from '../lib/household'
import { errorText } from '../lib/errorText'
import type { PersonRow } from '../lib/family'
import { MEAL_SHARE_OPTIONS, addPerson, deletePerson, fetchMealShare, fetchPeople, saveMealShare, updatePerson } from '../lib/family'
import { dailyKcal } from '../lib/nutritionTarget'
import type { Activity, Sex } from '../lib/nutritionTarget'
import DefaultPlanServingsSettings from './DefaultPlanServingsSettings'

const INPUT = 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

type Draft = { name: string; sex: '' | Sex; age: string; height: string; weight: string; activity: Activity }

const toDraft = (p: PersonRow): Draft => ({
  name: p.name,
  sex: p.sex ?? '',
  age: p.age == null ? '' : String(p.age),
  height: p.height_cm == null ? '' : String(p.height_cm),
  weight: p.weight_kg == null ? '' : String(p.weight_kg),
  activity: p.activity,
})

function parseRange(s: string, min: number, max: number, label: string): number | null {
  const t = s.normalize('NFKC').trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}は${min}〜${max}の数字で入力してください`)
  return n
}

export default function FamilySettings() {
  const { session } = useOutletContext<{ session: Session }>()
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [people, setPeople] = useState<PersonRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [share, setShare] = useState(0.333)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const id = await getHouseholdId(session.user.id)
        setHouseholdId(id)
        const [list, s] = await Promise.all([fetchPeople(id), fetchMealShare(id)])
        setPeople(list)
        setDrafts(Object.fromEntries(list.map((p) => [p.id, toDraft(p)])))
        setShare(s)
      } catch (e) {
        setMessage({ ok: false, text: '読み込みに失敗しました：' + errorText(e) + '（15_family_staples_migration.sql を実行済みか確認してください）' })
      } finally {
        setLoading(false)
      }
    })()
  }, [session.user.id])

  const run = async (job: () => Promise<void>, ok?: string) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await job()
      if (ok) setMessage({ ok: true, text: ok })
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      if (!householdId) return
      const p = await addPerson(householdId, people.length)
      setPeople((l) => [...l, p])
      setDrafts((d) => ({ ...d, [p.id]: toDraft(p) }))
    })

  const save = (p: PersonRow) =>
    run(async () => {
      const d = drafts[p.id]
      const next: PersonRow = {
        ...p,
        name: d.name,
        sex: d.sex === '' ? null : d.sex,
        age: parseRange(d.age, 1, 120, '年齢'),
        height_cm: parseRange(d.height, 50, 250, '身長'),
        weight_kg: parseRange(d.weight, 10, 300, '体重'),
        activity: d.activity,
      }
      if (next.age != null) next.age = Math.round(next.age)
      await updatePerson(next)
      setPeople((l) => l.map((x) => (x.id === p.id ? next : x)))
    }, '保存しました')

  const remove = (p: PersonRow) =>
    run(async () => {
      if (!window.confirm(`「${p.name || '名前なし'}」を削除しますか？`)) return
      await deletePerson(p.id)
      setPeople((l) => l.filter((x) => x.id !== p.id))
    })

  const changeShare = (v: number) =>
    run(async () => {
      if (!householdId) return
      const prev = share
      setShare(v)
      try {
        await saveMealShare(householdId, v)
      } catch (e) {
        setShare(prev)
        throw e
      }
    }, '保存しました')

  const setD = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  if (loading) return <p className="text-xs text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-400">
        献立の「分析」で、1食の目安カロリー・栄養を計算するのに使います（日本人の食事摂取基準 2025年版）。未入力の項目は、平均的な体格の値で計算します。献立に追加したときの人数は、ここに登録した家族の人数になります。
      </p>

      {people.map((p, i) => {
        const d = drafts[p.id] ?? toDraft(p)
        const changed = JSON.stringify(d) !== JSON.stringify(toDraft(p))
        const kcal = Math.round(dailyKcal(p) / 10) * 10
        return (
          <div key={p.id} className="rounded-lg border border-gray-200 p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 text-xs font-bold text-gray-400">{i + 1}</span>
              <input className={INPUT} value={d.name} placeholder="名前（例：たくま）" onChange={(e) => setD(p.id, { name: e.target.value })} />
              <button
                type="button"
                onClick={() => void remove(p)}
                disabled={busy}
                className="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-sm active:bg-gray-100"
                aria-label="削除"
              >
                🗑
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="block">
                <span className="text-[10px] text-gray-500">性別</span>
                <select className={INPUT} value={d.sex} onChange={(e) => setD(p.id, { sex: e.target.value as Draft['sex'] })}>
                  <option value="">未入力</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">年齢</span>
                <input className={INPUT} value={d.age} inputMode="numeric" placeholder="歳" onChange={(e) => setD(p.id, { age: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">活動レベル</span>
                <select className={INPUT} value={d.activity} onChange={(e) => setD(p.id, { activity: e.target.value as Activity })}>
                  <option value="low">低い</option>
                  <option value="mid">ふつう</option>
                  <option value="high">高い</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">身長</span>
                <input className={INPUT} value={d.height} inputMode="decimal" placeholder="cm" onChange={(e) => setD(p.id, { height: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">体重</span>
                <input className={INPUT} value={d.weight} inputMode="decimal" placeholder="kg" onChange={(e) => setD(p.id, { weight: e.target.value })} />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void save(p)}
                  disabled={busy || !changed}
                  className="w-full rounded-lg bg-amber-500 py-1.5 text-sm font-bold text-white disabled:bg-gray-300"
                >
                  保存
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">1日の目安：約{kcal.toLocaleString()}kcal（保存した内容で計算）</p>
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || !householdId}
        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-semibold text-gray-500 active:bg-gray-50 disabled:opacity-50"
      >
        ＋ 家族を追加
      </button>

      <div className="rounded-lg bg-gray-50 p-2.5">
        <p className="text-xs font-semibold text-gray-600">
          献立に追加したときの人数：{people.length > 0 ? `家族の人数（${people.length}人）` : '家族が未登録のため、下の人数'}
        </p>
        {people.length === 0 && (
          <div className="mt-2">
            <DefaultPlanServingsSettings />
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">1食の量の目安（献立の分析で使う）</span>
        <select className={`${INPUT} mt-1`} value={share} onChange={(e) => void changeShare(Number(e.target.value))} disabled={busy}>
          {MEAL_SHARE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!MEAL_SHARE_OPTIONS.some((o) => o.value === share) && <option value={share}>{Math.round(share * 100)}%</option>}
        </select>
      </label>

      {message && (
        <p className={`rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{message.text}</p>
      )}
    </div>
  )
}
