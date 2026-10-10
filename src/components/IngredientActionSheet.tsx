// src/components/IngredientActionSheet.tsx（新規作成）
// 材料を長押ししたときに下から出る、「編集」か「この材料を使うレシピを探す」を選ぶ画面
export default function IngredientActionSheet({
  name,
  category,
  onEdit,
  onFindRecipes,
  onClose,
}: {
  name: string
  category: string
  onEdit: () => void
  onFindRecipes: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-white px-4 pt-4 sm:max-w-sm sm:rounded-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] text-gray-400">{category}</p>
        <h3 className="mb-3 truncate text-base font-bold text-gray-900">{name}</h3>

        <button
          type="button"
          onClick={onEdit}
          className="mb-2 flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left active:bg-gray-50"
        >
          <span className="text-xl">✏️</span>
          <span>
            <span className="block text-sm font-bold text-gray-900">編集</span>
            <span className="block text-[11px] text-gray-400">栄養素・価格・旬・単位を直す（AIで再取得もできます）</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onFindRecipes}
          className="mb-2 flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left active:bg-gray-50"
        >
          <span className="text-xl">🍳</span>
          <span>
            <span className="block text-sm font-bold text-gray-900">この材料を使うレシピを探す</span>
            <span className="block text-[11px] text-gray-400">この材料が入っているレシピの一覧を見る</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600 active:bg-gray-200"
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}
