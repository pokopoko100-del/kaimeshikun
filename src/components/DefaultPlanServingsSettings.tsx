// src/components/DefaultPlanServingsSettings.tsx（新規作成）
// 設定画面の「献立に追加したときの人数」：レシピを献立に入れたときの「何人前つくるか」の初期値（家族で共通）
//   ・献立画面で、レシピごとに変えられる。ここで変えても、すでに献立にあるレシピの人数は変わらない
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import ServingsStepper from './ServingsStepper'
import {
  DEFAULT_PLAN_SERVINGS,
  MAX_PLAN_SERVINGS,
  MIN_PLAN_SERVINGS,
  fetchDefaultPlanServings,
  getHouseholdId,
  saveDefaultPlanServings,
} from '../lib/household'
import { errorText } from '../lib/errorText'

export default function DefaultPlanServingsSettings() {
  const { session } = useOutletContext<{ session: Session }>()
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [value, setValue] = useState(DEFAULT_PLAN_SERVINGS)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const id = await getHouseholdId(session.user.id)
        setHouseholdId(id)
        setValue(await fetchDefaultPlanServings(id))
      } catch (e) {
        setStatus('読み込みに失敗しました：' + errorText(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [session.user.id])

  const change = async (next: number) => {
    if (!householdId) return
    const prev = value
    setValue(next)
    setStatus('保存中…')
    try {
      await saveDefaultPlanServings(householdId, next)
      setStatus('保存しました')
    } catch (e) {
      setValue(prev)
      setStatus('保存に失敗しました：' + errorText(e) + '（13_servings_migration.sql を実行済みか確認してください）')
    }
  }

  return (
    <div className="text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-400">
        レシピを献立に入れたときの「何人前つくるか」の初期値です。献立画面で、レシピごとに変えられます。家族で共通の設定です。
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">初期値</span>
        <ServingsStepper
          value={value}
          onChange={(n) => void change(n)}
          min={MIN_PLAN_SERVINGS}
          max={MAX_PLAN_SERVINGS}
          disabled={loading || !householdId}
        />
      </div>
      {status && <p className="mt-2 text-[11px] text-gray-400">{status}</p>}
    </div>
  )
}
