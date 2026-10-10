// src/lib/nutritionTarget.ts（新規作成）
// 1日・1食の「栄養の目安」を計算する（献立の分析で使う）
//   出典：厚生労働省「日本人の食事摂取基準（2025年版）」
//   ・1日のカロリー＝基礎代謝量 × 身体活動レベル
//       基礎代謝量：国立健康・栄養研究所の式（Ganpule の式）
//         男性 (0.0481×体重 + 0.0234×身長 − 0.0138×年齢 − 0.4235) × 1000 ÷ 4.186
//         女性 (0.0481×体重 + 0.0234×身長 − 0.0138×年齢 − 0.9708) × 1000 ÷ 4.186
//       身体活動レベル：18〜64歳 低い1.50／ふつう1.75／高い2.00、65〜74歳 1.50／1.70／1.90、75歳以上 1.40／1.70／（高いは1.70を使う）
//   ・たんぱく質・炭水化物は、カロリーに対する割合（目標量の下限）から計算する
//       たんぱく質 13%（50〜64歳 14%、65歳以上 15%）／炭水化物 50%／脂質 20〜30%
//   ・ビタミン・ミネラル・食物繊維・食塩は、18〜29歳の基準値（推奨量・目安量・目標量）を、成人の目安として使う
//       ※年齢区分ごとの細かい違いは入れていない（分析は「足りているか」をざっくり見るため）
//   ・未入力の項目は、参照体位（性別・年齢区分ごとの標準の身長・体重）や成人の値で補う
//   ・ここでの値は目安で、医療的な判断に使うものではない

export type Sex = 'male' | 'female'
export type Activity = 'low' | 'mid' | 'high'

export type Person = {
  sex: Sex | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  activity: Activity
}

// 分析で使う栄養素（材料マスタ・recipe_nutrition の列名の先頭部分）
export type NutrientKey =
  | 'protein_g'
  | 'carbohydrate_g'
  | 'fat_g'
  | 'dietary_fiber_g'
  | 'salt_g'
  | 'vitamin_a_ug'
  | 'vitamin_b1_mg'
  | 'vitamin_b2_mg'
  | 'vitamin_b6_mg'
  | 'vitamin_b12_ug'
  | 'vitamin_c_mg'
  | 'vitamin_d_ug'
  | 'vitamin_e_mg'
  | 'folate_ug'
  | 'calcium_mg'
  | 'iron_mg'
  | 'zinc_mg'
  | 'potassium_mg'
  | 'magnesium_mg'

// 18〜29歳の基準値（1日あたり）。食物繊維は目標量（下限）、食塩は目標量（上限）
const ADULT: Record<Sex, Record<Exclude<NutrientKey, 'protein_g' | 'carbohydrate_g' | 'fat_g'>, number>> = {
  male: {
    dietary_fiber_g: 20,
    salt_g: 7.5,
    vitamin_a_ug: 850,
    vitamin_b1_mg: 1.1,
    vitamin_b2_mg: 1.6,
    vitamin_b6_mg: 1.5,
    vitamin_b12_ug: 4.0,
    vitamin_c_mg: 100,
    vitamin_d_ug: 9.0,
    vitamin_e_mg: 6.5,
    folate_ug: 240,
    calcium_mg: 800,
    iron_mg: 7.0,
    zinc_mg: 9.0,
    potassium_mg: 2500,
    magnesium_mg: 340,
  },
  female: {
    dietary_fiber_g: 18,
    salt_g: 6.5,
    vitamin_a_ug: 650,
    vitamin_b1_mg: 0.8,
    vitamin_b2_mg: 1.2,
    vitamin_b6_mg: 1.2,
    vitamin_b12_ug: 4.0,
    vitamin_c_mg: 100,
    vitamin_d_ug: 9.0,
    vitamin_e_mg: 5.0,
    folate_ug: 240,
    calcium_mg: 650,
    iron_mg: 6.0,
    zinc_mg: 7.5,
    potassium_mg: 2000,
    magnesium_mg: 280,
  },
}

// 参照体位（身長cm・体重kg）
const REF_BODY: { maxAge: number; male: [number, number]; female: [number, number] }[] = [
  { maxAge: 29, male: [172.0, 63.0], female: [158.0, 51.0] },
  { maxAge: 49, male: [171.8, 70.0], female: [158.5, 53.3] },
  { maxAge: 64, male: [169.7, 69.1], female: [156.4, 54.0] },
  { maxAge: 74, male: [165.3, 64.4], female: [152.2, 52.6] },
  { maxAge: 200, male: [162.0, 61.0], female: [148.3, 49.3] },
]
const DEFAULT_AGE = 40

function pal(age: number, activity: Activity): number {
  if (age >= 75) return activity === 'low' ? 1.4 : 1.7
  if (age >= 65) return activity === 'low' ? 1.5 : activity === 'mid' ? 1.7 : 1.9
  return activity === 'low' ? 1.5 : activity === 'mid' ? 1.75 : 2.0
}

function bmrFor(sex: Sex, age: number, h: number, w: number): number {
  const c = sex === 'male' ? 0.4235 : 0.9708
  return ((0.0481 * w + 0.0234 * h - 0.0138 * age - c) * 1000) / 4.186
}

// 1日に必要なカロリー（性別が未入力なら、男女の平均）
export function dailyKcal(p: Person): number {
  const age = p.age ?? DEFAULT_AGE
  const calc = (sex: Sex) => {
    const ref = REF_BODY.find((r) => age <= r.maxAge) ?? REF_BODY[REF_BODY.length - 1]
    const [rh, rw] = ref[sex]
    return bmrFor(sex, age, p.height_cm ?? rh, p.weight_kg ?? rw) * pal(age, p.activity)
  }
  if (p.sex) return calc(p.sex)
  return (calc('male') + calc('female')) / 2
}

function proteinShare(age: number): number {
  if (age >= 65) return 0.15
  if (age >= 50) return 0.14
  return 0.13
}

export type Target = { kind: 'min' | 'max'; value: number }

// 1日の目安（性別が未入力なら、男女の平均）
export function dailyTargets(p: Person): { kcal: number; nutrients: Record<NutrientKey, Target>; fatMax: number } {
  const kcal = dailyKcal(p)
  const age = p.age ?? DEFAULT_AGE
  const base = p.sex
    ? ADULT[p.sex]
    : (Object.fromEntries(
        Object.keys(ADULT.male).map((k) => [
          k,
          (ADULT.male[k as keyof typeof ADULT.male] + ADULT.female[k as keyof typeof ADULT.female]) / 2,
        ]),
      ) as (typeof ADULT)['male'])

  const nutrients = {
    protein_g: { kind: 'min', value: (kcal * proteinShare(age)) / 4 },
    carbohydrate_g: { kind: 'min', value: (kcal * 0.5) / 4 },
    fat_g: { kind: 'max', value: (kcal * 0.3) / 9 },
  } as Record<NutrientKey, Target>
  for (const [k, v] of Object.entries(base)) {
    nutrients[k as NutrientKey] = { kind: k === 'salt_g' ? 'max' : 'min', value: v }
  }
  return { kcal, nutrients, fatMax: (kcal * 0.3) / 9 }
}

// 家族みんなの「1人1食」の目安の平均（家族が未登録なら、成人の平均）
export function perMealTargets(people: Person[], mealShare: number): { kcal: number; nutrients: Record<NutrientKey, Target> } {
  const list = people.length > 0 ? people : [{ sex: null, age: null, height_cm: null, weight_kg: null, activity: 'mid' as Activity }]
  const all = list.map((p) => dailyTargets(p))
  const avg = (f: (t: ReturnType<typeof dailyTargets>) => number) => all.reduce((s, t) => s + f(t), 0) / all.length
  const nutrients = {} as Record<NutrientKey, Target>
  for (const k of Object.keys(all[0].nutrients) as NutrientKey[]) {
    nutrients[k] = { kind: all[0].nutrients[k].kind, value: avg((t) => t.nutrients[k].value) * mealShare }
  }
  return { kcal: avg((t) => t.kcal) * mealShare, nutrients }
}

// 表示名・単位・材料マスタの列名
export const ANALYSIS_NUTRIENTS: { key: NutrientKey; label: string; unit: string; col: string }[] = [
  { key: 'protein_g', label: 'たんぱく質', unit: 'g', col: 'protein_g_per_100g' },
  { key: 'carbohydrate_g', label: '炭水化物', unit: 'g', col: 'carbohydrate_g_per_100g' },
  { key: 'fat_g', label: '脂質', unit: 'g', col: 'fat_g_per_100g' },
  { key: 'dietary_fiber_g', label: '食物繊維', unit: 'g', col: 'dietary_fiber_g_per_100g' },
  { key: 'salt_g', label: '食塩相当量', unit: 'g', col: 'salt_g_per_100g' },
  { key: 'vitamin_a_ug', label: 'ビタミンA', unit: 'µg', col: 'vitamin_a_ug_per_100g' },
  { key: 'vitamin_b1_mg', label: 'ビタミンB1', unit: 'mg', col: 'vitamin_b1_mg_per_100g' },
  { key: 'vitamin_b2_mg', label: 'ビタミンB2', unit: 'mg', col: 'vitamin_b2_mg_per_100g' },
  { key: 'vitamin_b6_mg', label: 'ビタミンB6', unit: 'mg', col: 'vitamin_b6_mg_per_100g' },
  { key: 'vitamin_b12_ug', label: 'ビタミンB12', unit: 'µg', col: 'vitamin_b12_ug_per_100g' },
  { key: 'vitamin_c_mg', label: 'ビタミンC', unit: 'mg', col: 'vitamin_c_mg_per_100g' },
  { key: 'vitamin_d_ug', label: 'ビタミンD', unit: 'µg', col: 'vitamin_d_ug_per_100g' },
  { key: 'vitamin_e_mg', label: 'ビタミンE', unit: 'mg', col: 'vitamin_e_mg_per_100g' },
  { key: 'folate_ug', label: '葉酸', unit: 'µg', col: 'folate_ug_per_100g' },
  { key: 'calcium_mg', label: 'カルシウム', unit: 'mg', col: 'calcium_mg_per_100g' },
  { key: 'iron_mg', label: '鉄', unit: 'mg', col: 'iron_mg_per_100g' },
  { key: 'zinc_mg', label: '亜鉛', unit: 'mg', col: 'zinc_mg_per_100g' },
  { key: 'potassium_mg', label: 'カリウム', unit: 'mg', col: 'potassium_mg_per_100g' },
  { key: 'magnesium_mg', label: 'マグネシウム', unit: 'mg', col: 'magnesium_mg_per_100g' },
]
