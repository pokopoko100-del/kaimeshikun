// src/components/StapleSettings.tsx（新規作成）
// 設定画面の「主食」：献立の分析で、料理に足す主食（白米・パンなど）の候補と、1人1食の量
//   ・主食は、材料マスタの材料から選ぶ（栄養・カロリー・値段は、材料マスタの値を使う）
//   ・材料マスタに無いときは「＋ 主食をAIで登録」で、材料ページと同じ画面から登録できる
//   ・● の主食が、分析のときの初期値（無しも選べる）
//   前提：15_family_staples_migration.sql を実行済み
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getHouseholdId } from '../lib/household'
import { errorText } from '../lib/errorText'
import type { StapleRow } from '../lib/family'
import { addStaple, deleteStaple, fetchStaples, setDefaultStaple, updateStapleAmount } from '../lib/family'
import type { MasterOption } from '../lib/recipeImport'
import { fetchMasterOptions } from '../lib/recipeImport'
import MasterIngredientEditor from './MasterIngredientEditor'

const INPUT = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none'

export default function StapleSettings() {
  const { session } = useOutletContext<{ session: Session }>()
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [staples, setStaples] = useState<StapleRow[]>([])
  const [masters, setMasters] = useState<MasterOption[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [newMaster, setNewMaster] = useState('')
  const [newAmount, setNewAmount] = useState('150')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  const reload = async (id: string) => {
    const [s, m] = await Promise.all([fetchStaples(id), fetchMasterOptions()])
    setStaples(s)
    setMasters(m)
    setAmounts(Object.fromEntries(s.map((x) => [x.id, String(x.amount_g)])))
  }

  useEffect(() => {
    ;(async () => {
      try {
        const id = await getHouseholdId(session.user.id)
        setHouseholdId(id)
        await reload(id)
      } catch (e) {
        setMessage({ ok: false, text: '読み込みに失敗しました：' + errorText(e) + '（15_family_staples_migration.sql を実行済みか確認してください）' })
      } finally {
        setLoading(false)
      }
    })()
  }, [session.user.id])

  const byId = useMemo(() => new Map(masters.map((m) => [m.id, m])), [masters])
  // 主食の候補は「穀物・麺」を先に、そのほかの材料は後ろに
  const options = useMemo(() => {
    const used = new Set(staples.map((s) => s.ingredient_master_id))
    const free = masters.filter((m) => !used.has(m.id) && m.category !== '日用品')
    return [...free.filter((m) => m.category === '穀物・麺'), ...free.filter((m) => m.category !== '穀物・麺')]
  }, [masters, staples])

  const run = async (job: () => Promise<void>, ok?: string) => {
    if (busy || !householdId) return
    setBusy(true)
    setMessage(null)
    try {
      await job()
      await reload(householdId)
      if (ok) setMessage({ ok: true, text: ok })
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const parseAmount = (s: string): number => {
    const n = Number(s.normalize('NFKC').trim())
    if (!Number.isFinite(n) || n <= 0 || n > 2000) throw new Error('量は1〜2000gの数字で入力してください')
    return n
  }

  if (loading) return <p className="text-xs text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-400">
        献立の「分析」で、料理に足す主食の候補です。栄養・カロリー・値段は、材料マスタの値（100gあたり）から計算します。● が分析の初期値です。
      </p>

      {staples.length > 0 && (
        <ul className="space-y-1.5">
          {staples.map((s) => {
            const m = byId.get(s.ingredient_master_id)
            const changed = amounts[s.id] !== String(s.amount_g)
            return (
              <li key={s.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void run(() => setDefaultStaple(householdId as string, s.is_default ? null : s.id))}
                  disabled={busy}
                  aria-label={s.is_default ? '初期値を外す' : '初期値にする'}
                  className={`h-8 w-8 shrink-0 rounded-lg border text-base ${s.is_default ? 'border-amber-500 text-amber-600' : 'border-gray-300 text-gray-300'}`}
                >
                  {s.is_default ? '●' : '○'}
                </button>
                <span className="min-w-0 flex-1 truncate font-medium">{m?.name ?? '（削除された材料）'}</span>
                <span className="shrink-0 text-xs text-gray-400">1人1食</span>
                <input
                  className={`${INPUT} w-16 text-right`}
                  value={amounts[s.id] ?? ''}
                  inputMode="decimal"
                  onChange={(e) => setAmounts((a) => ({ ...a, [s.id]: e.target.value }))}
                />
                <span className="shrink-0 text-xs text-gray-400">g</span>
                {changed ? (
                  <button
                    type="button"
                    onClick={() => void run(() => updateStapleAmount(s.id, parseAmount(amounts[s.id])), '保存しました')}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-bold text-white"
                  >
                    保存
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void run(() => deleteStaple(s.id))}
                    disabled={busy}
                    aria-label="削除"
                    className="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    🗑
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="rounded-lg bg-gray-50 p-2.5">
        <p className="mb-1.5 text-xs font-semibold text-gray-600">主食を追加</p>
        <div className="flex items-center gap-1.5">
          <select className={`${INPUT} min-w-0 flex-1`} value={newMaster} onChange={(e) => setNewMaster(e.target.value)}>
            <option value="">材料マスタから選ぶ</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.category}）
              </option>
            ))}
          </select>
          <input className={`${INPUT} w-16 text-right`} value={newAmount} inputMode="decimal" onChange={(e) => setNewAmount(e.target.value)} />
          <span className="shrink-0 text-xs text-gray-400">g</span>
          <button
            type="button"
            disabled={busy || newMaster === ''}
            onClick={() =>
              void run(async () => {
                await addStaple(householdId as string, newMaster, parseAmount(newAmount), staples.length === 0, staples.length)
                setNewMaster('')
              }, '追加しました')
            }
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:bg-gray-300"
          >
            追加
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-400">例：ごはん（炊いた白米）150g、食パン 60g。量は「1人1食ぶん」です。</p>
        <button
          type="button"
          onClick={() => setShowEditor(true)}
          className="mt-2 text-xs font-bold text-amber-600 active:opacity-60"
        >
          ＋ 材料マスタに無い主食を、AIで登録する
        </button>
      </div>

      {message && (
        <p className={`rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{message.text}</p>
      )}

      {showEditor && (
        <MasterIngredientEditor
          mode="add"
          masters={masters}
          userId={session.user.id}
          onClose={() => setShowEditor(false)}
          onSaved={(msg) => {
            setShowEditor(false)
            setMessage({ ok: true, text: `${msg}。上の「材料マスタから選ぶ」で主食に追加してください` })
            if (householdId) void reload(householdId)
          }}
        />
      )}
    </div>
  )
}
