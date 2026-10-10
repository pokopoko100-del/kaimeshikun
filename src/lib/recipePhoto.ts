// src/lib/recipePhoto.ts（新規作成）
// レシピの「料理写真（表示用）」の共通部品：端末で縮める／保存する／差し替える
//   ・AIに読み取らせるための写真（取り込み用）とは別もの。こちらは、一覧や詳細に表示される写真
//   ・保存先：recipe-images バケット（非公開）の「世帯ID/recipes/レシピID-時刻.jpg」
//   ・レシピ側は recipes.image_path に、この保存先のパスを入れる
import { supabase } from '../supabaseClient'

const BUCKET = 'recipe-images'

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('この画像は読み込めませんでした（JPEG・PNG・WebPの写真を選んでください）'))
    }
    img.src = url
  })
}

// 長辺1280px・JPEG品質82%に縮める（一覧・詳細の表示には十分で、通信量も小さい）
export async function compressForDisplay(file: File, maxEdge = 1280, quality = 0.82): Promise<Blob> {
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
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の変換に失敗しました'))),
      'image/jpeg',
      quality,
    )
  })
}

// 写真を保存して、レシピの写真を差し替える。新しいパスを返す
//   ① アップロード → ② recipes.image_path を更新 → ③ 古い写真を消す（消せなくてもエラーにしない）
//   ②に失敗したら、アップロードした写真も消して元に戻す
export async function replaceRecipePhoto(args: {
  householdId: string
  recipeId: string
  oldPath: string | null
  blob: Blob
  userId: string
}): Promise<string> {
  const { householdId, recipeId, oldPath, blob, userId } = args
  const newPath = `${householdId}/recipes/${recipeId}-${Date.now()}.jpg`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('recipes')
    .update({ image_path: newPath, updated_by: userId })
    .eq('id', recipeId)
    .select('id')
  if (error || !data || data.length === 0) {
    await supabase.storage.from(BUCKET).remove([newPath])
    throw error ?? new Error('写真を保存できませんでした（権限を確認してください）')
  }

  if (oldPath && oldPath !== newPath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([oldPath])
    if (rmErr) console.error('古い写真を消せませんでした:', rmErr.message)
  }
  return newPath
}
