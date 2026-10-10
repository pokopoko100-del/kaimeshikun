// src/lib/amount.ts（新規作成）
// 分量の表示用の部品（レシピ詳細で使う）
//   ・0.333 → 1/3、1.5 → 1と1/2 のように、よく使う分数（1/2・1/3・2/3・1/4・3/4）に近ければ分数で表示する
//   ・g・ml・cc や、10以上の数は、分数にせず小数で表示する（例：12.5g）
//   ・大さじ・小さじは単位を先頭に（大さじ1と1/2）、それ以外は数量を先頭に（300g・2個）

// 分量(text)を数値に変換："2" "0.5" "1/2" "1と1/2" に対応。それ以外は null
export function parseAmount(t: string | null | undefined): number | null {
  if (t == null) return null
  const s = t.normalize('NFKC').trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  let m = s.match(/^(\d+)\/(\d+)$/)
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2])
  m = s.match(/^(\d+)と(\d+)\/(\d+)$/)
  if (m && Number(m[3]) !== 0) return Number(m[1]) + Number(m[2]) / Number(m[3])
  return null
}

const FRACTIONS: [number, string][] = [
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [1 / 2, '1/2'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
]
const NO_FRACTION_UNITS = ['g', 'ｇ', 'グラム', 'ml', 'mL', 'cc', 'kg', 'l', 'L']

function roundDecimal(v: number): string {
  const r = v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100
  return String(r)
}

// 数値を、表示用の文字にする（分数にできるものは分数）
export function formatNumber(v: number, unit: string | null | undefined): string {
  const u = (unit ?? '').trim()
  if (NO_FRACTION_UNITS.includes(u) || v >= 10) return roundDecimal(v)
  const whole = Math.floor(v + 1e-9)
  const frac = v - whole
  if (frac < 0.04) return String(whole)
  if (frac > 0.96) return String(whole + 1)
  for (const [f, label] of FRACTIONS) {
    if (Math.abs(frac - f) <= 0.02) return whole === 0 ? label : `${whole}と${label}`
  }
  return roundDecimal(v)
}

// 「大さじ3」「小さじ1/2」は単位が先頭、それ以外は数量が先頭（300g・2個）
export function joinAmount(quantity: string | null, unit: string | null): string {
  const q = quantity ?? ''
  const u = unit ?? ''
  if (u === '大さじ' || u === '小さじ') return `${u}${q}`
  return `${q}${u}`
}

// 人数に合わせて分量を増減して、表示用の文字にする（「適量」などはそのまま）
export function scaledAmount(quantity: string | null, unit: string | null, factor: number): string {
  const n = parseAmount(quantity)
  if (n == null) return joinAmount(quantity, unit)
  return joinAmount(formatNumber(n * factor, unit), unit)
}
