// ファイル: src/lib/supabaseStorage.ts
// recipe-images バケット(非公開)から、期限付きの閲覧URLを取得する

import { supabase } from '../supabaseClient'

const BUCKET_NAME = 'recipe-images'
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 // 1時間

// image_pathから署名付きURLを取得する。image_pathがnullならnullを返す
export async function getRecipeImageUrl(imagePath: string | null): Promise<string | null> {
  if (!imagePath) return null

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(imagePath, SIGNED_URL_EXPIRY_SECONDS)

  if (error || !data) {
    console.error('画像URLの取得に失敗しました:', error?.message)
    return null
  }

  return data.signedUrl
}