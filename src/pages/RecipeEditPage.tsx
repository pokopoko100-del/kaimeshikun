// src/pages/RecipeEditPage.tsx（新規作成）
// レシピの編集画面（URL：/recipes/:id/edit）。詳細画面の「✏️ 編集」から開く
//   ・取り込みの「確認・修正」画面と同じ見た目で、料理名・人数・時間・工程・材料・写真を直せる
//   ・材料マスタに無い材料を新しく書いたときは、その材料は「未計算」になる（材料ページで登録すると計算される）
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import ImportPreviewEditor from '../components/ImportPreviewEditor'
import { errorText } from '../lib/errorText'
import type { Draft, MasterOption } from '../lib/recipeImport'
import { fetchMasterOptions, validateDraft } from '../lib/recipeImport'
import type { EditSource, PhotoChange } from '../lib/recipeEdit'
import { fetchRecipeForEdit, recipeToDraft, updateRecipe } from '../lib/recipeEdit'
import { compressForDisplay } from '../lib/recipePhoto'
import { useRecipeImage } from '../lib/useRecipeImage'

export default function RecipeEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useOutletContext<{ session: Session }>()

  const [src, setSrc] = useState<EditSource | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initialJson, setInitialJson] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [masters, setMasters] = useState<MasterOption[]>([])
  const [mastersError, setMastersError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 写真：keep（そのまま）／replace（新しい写真）／remove（取り除く）
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' })
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const existingUrl = useRecipeImage(src?.recipe.image_path ?? null)
  const blobUrl = useMemo(() => (photo.kind === 'replace' ? URL.createObjectURL(photo.blob) : null), [photo])
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])
  const photoUrl = photo.kind === 'replace' ? blobUrl : photo.kind === 'remove' ? null : existingUrl

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetchRecipeForEdit(id)
      .then((s) => {
        if (cancelled) return
        const d = recipeToDraft(s)
        setSrc(s)
        setDraft(d)
        setInitialJson(JSON.stringify(d))
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setLoadError(errorText(e))
      })
    fetchMasterOptions()
      .then((m) => {
        if (!cancelled) setMasters(m)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setMastersError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const dirty = (draft !== null && JSON.stringify(draft) !== initialJson) || photo.kind !== 'keep'

  const back = () => {
    if (dirty && !window.confirm('編集した内容は保存されません。戻りますか？')) return
    navigate(`/recipes/${id}`, { replace: true })
  }

  const pickPhoto = async (file: File) => {
    setPhotoError(null)
    setPhotoBusy(true)
    try {
      setPhoto({ kind: 'replace', blob: await compressForDisplay(file) })
    } catch (e) {
      setPhotoError(errorText(e))
    } finally {
      setPhotoBusy(false)
    }
  }

  const save = async () => {
    if (!src || !draft || saving) return
    const msg = validateDraft(draft)
    if (msg) {
      setSaveError(msg)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const { photoError: pe } = await updateRecipe(src, draft, session.user.id, photo)
      if (pe) window.alert(`レシピは保存しました。\n写真の保存に失敗しました：${pe}`)
      navigate(`/recipes/${src.recipe.id}`, { replace: true })
    } catch (e) {
      console.error(e)
      setSaveError(errorText(e))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 flex items-center gap-2 bg-white px-3 py-2.5 shadow-sm">
        <button type="button" onClick={back} className="shrink-0 text-sm font-semibold text-gray-600">
          ← 戻る
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-bold">✏️ レシピを編集</h1>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !draft}
          className="shrink-0 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-bold text-white active:opacity-80 disabled:bg-gray-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </header>

      {loadError ? (
        <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">レシピを読み込めませんでした：{loadError}</p>
      ) : !draft ? (
        <div className="space-y-2 p-3">
          <div className="h-48 animate-pulse rounded-xl bg-gray-200" />
          <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
        </div>
      ) : (
        <ImportPreviewEditor
          draft={draft}
          onChange={setDraft}
          masters={masters}
          mastersError={mastersError}
          warnings={[]}
          saving={saving}
          error={saveError}
          onSave={() => void save()}
          photoUrl={photoUrl}
          photoBusy={photoBusy}
          photoError={photoError}
          onPickPhoto={(f) => void pickPhoto(f)}
          onClearPhoto={() => setPhoto(src?.recipe.image_path ? { kind: 'remove' } : { kind: 'keep' })}
        />
      )}
    </div>
  )
}
