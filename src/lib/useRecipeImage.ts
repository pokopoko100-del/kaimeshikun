// ファイル: src/lib/useRecipeImage.ts
// レシピ写真のURLを取得するReactフック(署名付きURLをstateで保持)

import { useEffect, useState } from 'react'
import { getRecipeImageUrl } from './supabaseStorage'

export function useRecipeImage(imagePath: string | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    if (!imagePath) {
      setUrl(null)
      return
    }

    getRecipeImageUrl(imagePath).then((result) => {
      if (!isCancelled) setUrl(result)
    })

    return () => {
      isCancelled = true
    }
  }, [imagePath])

  return url
}