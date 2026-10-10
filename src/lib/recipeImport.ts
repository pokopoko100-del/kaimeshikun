// src/lib/recipeImport.ts（ファイル全体。これで丸ごと置き換えてください）
// レシピ取り込み（テキスト・写真 → AIで読み取り → 材料の登録 → 確認・修正 → 保存）の共通部品
//   ・AIの解析は Supabase の関数 analyze-recipe（自分のGeminiキーで動く）。この関数は「読み取るだけ」で保存はしない
//   ・保存は、この画面から recipes → steps → ingredients の順に行う（途中で失敗したら、作りかけのレシピを消して元に戻す）
//   ・「未計算になるか」の判定は、レシピ詳細・サーバー側の関数（recipe_nutrition ビュー）と同じルール
// 今回の変更：工程・材料の保存を insertStepsAndIngredients にまとめた（レシピの編集でも使う）
// 前回の変更：
//   ・何人前をAIが推定したときのフラグ（servingsEstimated）を追加。人数は1〜20
//   ・AIの推定（調理時間・人数）の注意は、確認画面の欄の横に出すので、注意の一覧からは外す
// 前回の変更：
//   ・材料名の末尾の（　）が下ごしらえのときは、名前から外して「下ごしらえ」欄へ移す（splitPrep。ハム（千切り）→ ハム＋千切り）
//   ・名前が材料マスタと同じ材料は、自動で結び付ける（relinkByName）
// 前回の変更：
//   ・調理時間をAIが推定したときのフラグ（cookingTimeEstimated）を追加
//   ・保存のときに、料理写真（表示用）も一緒に保存できるようにした（saveDraft の3つ目の引数）
//   ・関数の呼び出しを callFunction にまとめた／写真を縮める処理は recipePhoto に移した
import { supabase } from '../supabaseClient'
import { callFunction } from './callFunction'
import type { CallFailure } from './callFunction'
import { errorText } from './errorText'
import { getHouseholdId } from './household'
import { loadImage, replaceRecipePhoto } from './recipePhoto'

// ---------- 選択肢（DBの値と同じ） ----------
export const GENRES = ['和食', '洋食', '中華', 'エスニック', 'その他'] as const
export const CATEGORIES = ['主菜', '副菜・つまみ', '汁物・スープ', '麺・丼・ワンプレート', 'デザート', 'ソース・調味料'] as const
export const SOURCE_TYPES = ['Webサイト', '動画', '書籍・雑誌', 'テレビ', '自作', 'その他'] as const

export const MAX_IMAGES = 4
export const MAX_TEXT_CHARS = 20000

// ---------- 型 ----------
export type RowStatus = 'ok' | 'skip' | 'no_master' | 'unit_unknown' | 'qty_unknown'

// 材料マスタ（紐付けの候補。units は「gと、登録済みの単位」）
export type MasterOption = { id: string; name: string; category: string; units: string[] }

// 確認・修正画面で編集する内容（数字の欄も、入力しやすいように文字で持つ）
export type DraftIngredient = {
  key: string
  name: string
  masterId: string | null
  quantity: string
  unit: string
  preparation: string
  stepNo: number | null // 何番目の工程で使うか（1始まり。draft.steps の並び順）
  group: string // グループ記号（A・B…。無ければ空）
}
export type DraftStep = { key: string; name: string; description: string; tip: string }
export type Draft = {
  dishName: string
  sourceName: string
  sourceType: string
  sourceUrl: string
  genre: string
  category: string
  servings: string
  servingsEstimated: boolean // AIが推定した人数か（直すと false になる）
  cookingTime: string
  cookingTimeEstimated: boolean // AIが推定した調理時間か（直すと false になる）
  steps: DraftStep[]
  ingredients: DraftIngredient[]
}

export type ImageItem = { id: string; mime: string; data: string } // data は base64（先頭の data:… は付けない）

export type AnalyzeInput = {
  source: 'text' | 'photo'
  text: string
  images: { mime: string; data: string }[]
}
export type AnalyzeResult = { ok: true; draft: Draft; warnings: string[] } | CallFailure

let seq = 0
export const newKey = () => `k${++seq}`

// ① ② ③ … の丸数字（20まで。それ以上は「21.」）
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}.`
}

// 名前の比較用（全角半角・空白・大文字小文字をそろえる）
export function normName(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

// 材料名の末尾の（　）が「下ごしらえ」なら、名前から外して下ごしらえの欄へ移す
//   例：「ハム（千切り）」→ 名前「ハム」・下ごしらえ「千切り」。「有塩」「白」など、材料の種類を表すものは名前に残す
const KEEP_IN_NAME =
  /^(有塩|無塩|無調整|国産|白|赤|黒|青|黄|生|乾燥|粉|粉末|顆粒|液体|チューブ|缶|缶詰|瓶|絹|木綿|薄口|濃口|合わせ|赤だし|白だし)$/

export function splitPrep(name: string, prep: string | null | undefined): { name: string; preparation: string } {
  let base = (name ?? '').trim()
  const preps: string[] = []
  for (let i = 0; i < 3; i++) {
    const m = base.match(/^(.+?)\s*[（(]([^）)]*)[）)]\s*$/)
    if (!m) break
    const inner = m[2].trim()
    if (inner === '') {
      base = m[1].trim()
      continue
    }
    if (KEEP_IN_NAME.test(inner.normalize('NFKC'))) break
    preps.unshift(inner)
    base = m[1].trim()
  }
  const own = (prep ?? '').trim()
  const all = [...preps, ...(own && !preps.includes(own) ? [own] : [])]
  return { name: base, preparation: all.join('・') }
}

// 名前が材料マスタと同じ（全角半角・空白の違いは無視）で、まだ結び付いていない材料を、自動で結び付ける
export function relinkByName(d: Draft, masters: MasterOption[]): Draft {
  if (masters.length === 0) return d
  const byName = new Map(masters.map((m) => [normName(m.name), m]))
  return {
    ...d,
    ingredients: d.ingredients.map((i) => {
      if (i.masterId) return i
      const hit = byName.get(normName(i.name))
      return hit ? { ...i, masterId: hit.id, name: hit.name } : i
    }),
  }
}

// 分量の表記（大さじ・小さじは単位を先頭に：大さじ2／それ以外は数量を先頭に：300g）
export function fmtUsage(quantity: string, unit: string): string {
  const q = quantity.trim()
  const u = unit.trim()
  return u === '大さじ' || u === '小さじ' ? `${u}${q}` : `${q}${u}`
}

// ---------- 未計算の判定（サーバー側・詳細画面と同じルール） ----------
const SKIP_WORDS = ['少々', '適量', '適宜', 'ひとつまみ', '少量', 'お好みで', 'お好み']

export function normUnit(u: string): string {
  const n = (u ?? '').normalize('NFKC').trim()
  return ['g', 'gram', 'グラム'].includes(n.toLowerCase()) ? 'g' : n
}

function isNumericQty(q: string): boolean {
  const n = q.normalize('NFKC').trim()
  return /^\d+(\.\d+)?$/.test(n) || /^\d+\/\d+$/.test(n)
}

export function rowStatus(quantity: string, unit: string, master: MasterOption | undefined): RowStatus {
  const q = quantity.normalize('NFKC').trim()
  if (q === '' || SKIP_WORDS.some((w) => q.includes(w))) return 'skip'
  if (!master) return 'no_master'
  if (!isNumericQty(q)) return 'qty_unknown'
  if (!master.units.map(normUnit).includes(normUnit(unit))) return 'unit_unknown'
  return 'ok'
}

// 表示用（ok のときも「✓」を出す）
export const STATUS_INFO: Record<RowStatus, { label: string; cls: string }> = {
  ok: { label: '✓', cls: 'bg-green-100 text-green-700' },
  skip: { label: '計算しない', cls: 'bg-gray-100 text-gray-500' },
  no_master: { label: 'マスタに無い', cls: 'bg-red-100 text-red-600' },
  unit_unknown: { label: '単位が合わない', cls: 'bg-amber-100 text-amber-700' },
  qty_unknown: { label: '分量が数値でない', cls: 'bg-amber-100 text-amber-700' },
}

export function isUnresolved(s: RowStatus): boolean {
  return s === 'no_master' || s === 'unit_unknown' || s === 'qty_unknown'
}

// ---------- 材料マスタの読み込み ----------
type MasterRaw = {
  id: string
  ingredient_name: string
  category: string
  ingredient_units: { unit: string; is_default: boolean }[] | null
}

export async function fetchMasterOptions(): Promise<MasterOption[]> {
  const { data, error } = await supabase
    .from('ingredient_master')
    .select('id, ingredient_name, category, ingredient_units(unit, is_default)')
    .order('category')
    .order('ingredient_name')
  if (error) throw error
  return ((data ?? []) as unknown as MasterRaw[]).map((m) => {
    const regs = [...(m.ingredient_units ?? [])]
      .sort((a, b) => Number(b.is_default) - Number(a.is_default))
      .map((u) => u.unit)
      .filter((u) => normUnit(u) !== 'g')
    return { id: m.id, name: m.ingredient_name, category: m.category, units: ['g', ...regs] }
  })
}

// ---------- AIで読み取る（analyze-recipe を呼ぶ） ----------
type ServerIngredient = {
  ingredient_name: string
  ingredient_master_id: string | null
  quantity: string
  unit: string
  preparation: string | null
  step_number: number | null
  group_label: string | null
}
type ServerStep = { step_number: number; step_name: string; description: string; tip: string | null }
type ServerRecipe = {
  dish_name: string
  source_name: string | null
  genre: string
  category: string
  servings: number
  servings_estimated?: boolean
  cooking_time_minutes: number | null
  cooking_time_estimated?: boolean
  steps: ServerStep[]
  ingredients: ServerIngredient[]
}

// 材料の登録（次の画面）で解決するので、確認画面では出さない注意
const STALE_WARNING = /材料マスタに無い材料が|単位がマスタの単位表に無い材料が|AIが材料と工程から推定した目安|AIが材料の分量から推定した目安/

function toDraft(r: ServerRecipe): Draft {
  // 工程は 1,2,3… に振り直し、材料の「使う工程」も同じ番号に直す
  const sorted = [...(r.steps ?? [])].sort((a, b) => a.step_number - b.step_number)
  const noMap = new Map<number, number>()
  sorted.forEach((s, i) => noMap.set(s.step_number, i + 1))

  const hasTime = r.cooking_time_minutes != null
  return {
    dishName: r.dish_name ?? '',
    sourceName: r.source_name ?? '',
    sourceType: 'その他',
    sourceUrl: '',
    genre: r.genre,
    category: r.category,
    servings: String(r.servings ?? 2),
    servingsEstimated: r.servings_estimated === true,
    cookingTime: hasTime ? String(r.cooking_time_minutes) : '',
    cookingTimeEstimated: hasTime && r.cooking_time_estimated === true,
    steps: sorted.map((s) => ({
      key: newKey(),
      name: s.step_name ?? '',
      description: s.description ?? '',
      tip: s.tip ?? '',
    })),
    ingredients: (r.ingredients ?? []).map((i) => {
      const sp = splitPrep(i.ingredient_name ?? '', i.preparation)
      return {
        key: newKey(),
        name: sp.name,
        masterId: i.ingredient_master_id ?? null,
        quantity: i.quantity ?? '',
        unit: normUnit(i.unit ?? ''),
        preparation: sp.preparation,
        stepNo: i.step_number != null ? (noMap.get(i.step_number) ?? null) : null,
        group: i.group_label ?? '',
      }
    }),
  }
}

export async function analyzeRecipe(input: AnalyzeInput): Promise<AnalyzeResult> {
  const r = await callFunction<{ recipe?: ServerRecipe; warnings?: string[] }>('analyze-recipe', input)
  if (!r.ok) return r
  if (!r.recipe) return { ok: false, code: null, message: '読み取りに失敗しました' }
  return {
    ok: true,
    draft: toDraft(r.recipe),
    warnings: (r.warnings ?? []).filter((w) => !STALE_WARNING.test(w)),
  }
}

// ---------- 写真（AIに読み取らせる用）を、AIに送れる大きさに縮める ----------
// 長辺1600px・JPEG品質80%。文字が読めるよう、設計書の1280pxより少し大きめにしてある
export async function compressForAi(file: File, maxEdge = 1600, quality = 0.8): Promise<{ mime: string; data: string }> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください')
  const img = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像の変換に失敗しました')
  ctx.fillStyle = '#ffffff' // 透明なPNGが黒くならないように
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const data = dataUrl.split(',')[1]
  if (!data) throw new Error('画像の変換に失敗しました')
  return { mime: 'image/jpeg', data }
}

// ---------- 保存 ----------
export function validateDraft(d: Draft): string | null {
  if (!d.dishName.trim()) return '料理名を入力してください'
  if (!d.sourceName.trim()) return '参考元を入力してください（例：リュウジ、自作、料理本の名前）'
  const servings = Number(d.servings)
  if (!Number.isInteger(servings) || servings < 1 || servings > 20) return '標準の人前は、1〜20の整数で入力してください'
  if (d.cookingTime.trim() !== '') {
    const t = Number(d.cookingTime)
    if (!Number.isInteger(t) || t < 0 || t > 1440) return '調理時間は0以上の整数（分）で入力してください'
  }
  const url = d.sourceUrl.trim()
  if (url !== '' && !/^https?:\/\//i.test(url)) return '参考URLは http:// か https:// で始めてください'
  if (!d.ingredients.some((i) => i.name.trim() !== '')) return '材料が1件もありません。材料を追加してください'
  return null
}

// 工程・材料を保存する（新規の保存と、編集の保存で共通）
//   ・空の工程・名前が空の材料は捨てる。工程は 1,2,3… に振り直し、材料の「使う工程」も合わせる
export async function insertStepsAndIngredients(recipeId: string, d: Draft): Promise<void> {
  const noMap = new Map<number, number>() // 画面上の工程番号 → 保存する工程番号
  const keptSteps: DraftStep[] = []
  d.steps.forEach((s, i) => {
    if (s.name.trim() || s.description.trim() || s.tip.trim()) {
      keptSteps.push(s)
      noMap.set(i + 1, keptSteps.length)
    }
  })
  const keptIngs = d.ingredients.filter((i) => i.name.trim() !== '')

  const stepIdByNo = new Map<number, string>()
  if (keptSteps.length > 0) {
    const { data: stepRows, error: stepErr } = await supabase
      .from('steps')
      .insert(
        keptSteps.map((s, i) => ({
          recipe_id: recipeId,
          step_number: i + 1,
          step_name: s.name.trim() || null,
          description: s.description.trim() || null,
          tip: s.tip.trim() || null,
        })),
      )
      .select('id, step_number')
    if (stepErr) throw stepErr
    for (const r of (stepRows ?? []) as { id: string; step_number: number }[]) {
      stepIdByNo.set(r.step_number, r.id)
    }
  }

  if (keptIngs.length === 0) return
  const { error: ingErr } = await supabase.from('ingredients').insert(
    keptIngs.map((ing, i) => {
      const newNo = ing.stepNo != null ? noMap.get(ing.stepNo) : undefined
      const group = ing.group.normalize('NFKC').trim().toUpperCase()
      return {
        recipe_id: recipeId,
        sort_order: i,
        ingredient_master_id: ing.masterId,
        ingredient_name: ing.name.trim(),
        quantity: ing.quantity.normalize('NFKC').trim() || null,
        unit: normUnit(ing.unit) || null,
        preparation: ing.preparation.trim() || null,
        step_id: newNo != null ? (stepIdByNo.get(newNo) ?? null) : null,
        group_label: /^[A-Z]$/.test(group) ? group : null,
      }
    }),
  )
  if (ingErr) throw ingErr
}

// 保存の結果。写真だけ失敗したときは、レシピは保存できているので photoError に理由を入れて返す
export type SaveResult = { id: string; photoError: string | null }

export async function saveDraft(d: Draft, userId: string, photo: Blob | null = null): Promise<SaveResult> {
  const msg = validateDraft(d)
  if (msg) throw new Error(msg)

  const householdId = await getHouseholdId(userId)

  // ① レシピ本体
  const { data: rec, error: recErr } = await supabase
    .from('recipes')
    .insert({
      household_id: householdId,
      dish_name: d.dishName.trim(),
      genre: d.genre,
      category: d.category,
      source_type: d.sourceType,
      source_name: d.sourceName.trim(),
      source_url: d.sourceUrl.trim() || null,
      servings: Number(d.servings),
      cooking_time_minutes: d.cookingTime.trim() === '' ? null : Number(d.cookingTime),
      registration_method: 'ai',
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()
  if (recErr) {
    if ((recErr as { code?: string }).code === '23505') {
      throw new Error('同じ「料理名」と「参考元」のレシピが、すでにあります。どちらかを変えてください')
    }
    throw recErr
  }
  const recipeId = rec.id as string

  try {
    await insertStepsAndIngredients(recipeId, d)
  } catch (e) {
    // 作りかけのレシピを消して、元に戻す（工程・材料はレシピと一緒に消える）
    const { error: delErr } = await supabase.from('recipes').delete().eq('id', recipeId)
    if (delErr) {
      throw new Error(
        `${errorText(e)}（作りかけのレシピを消せませんでした。レシピ一覧を確認してください）`,
      )
    }
    throw e
  }

  // ④ 料理写真（表示用）。失敗しても、保存したレシピは消さない
  let photoError: string | null = null
  if (photo) {
    try {
      await replaceRecipePhoto({ householdId, recipeId, oldPath: null, blob: photo, userId })
    } catch (e) {
      console.error(e)
      photoError = errorText(e)
    }
  }

  return { id: recipeId, photoError }
}
