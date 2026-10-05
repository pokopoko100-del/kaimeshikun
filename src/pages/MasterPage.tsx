import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { IngredientCategory, IngredientMaster } from '../types/ingredient';

const CATEGORIES: IngredientCategory[] = [
  '野菜',
  '肉',
  '魚介',
  '乳製品・卵',
  '調味料',
  '穀物・麺',
  'その他',
  '日用品',
];

const CATEGORY_COLOR: Record<IngredientCategory, string> = {
  野菜: 'bg-green-100 text-green-700',
  肉: 'bg-red-100 text-red-700',
  魚介: 'bg-blue-100 text-blue-700',
  '乳製品・卵': 'bg-yellow-100 text-yellow-700',
  調味料: 'bg-orange-100 text-orange-700',
  '穀物・麺': 'bg-amber-100 text-amber-700',
  その他: 'bg-gray-100 text-gray-700',
  日用品: 'bg-purple-100 text-purple-700',
};

// 数値を「値がある時だけ」表示するための小さなヘルパー
function fmt(value: number | null, unit: string) {
  if (value === null || value === undefined) return '―';
  return `${value}${unit}`;
}

export default function MasterPage() {
  const [items, setItems] = useState<IngredientMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'すべて' | IngredientCategory>('すべて');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchIngredients = async () => {
      setLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('ingredient_master')
        .select('*')
        .order('category', { ascending: true })
        .order('ingredient_name', { ascending: true });

      if (error) {
        setErrorMessage('材料マスタの読み込みに失敗しました。');
        console.error(error);
      } else if (data) {
        setItems(data as IngredientMaster[]);
      }
      setLoading(false);
    };

    fetchIngredients();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        selectedCategory === 'すべて' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!keyword) return true;

      const haystack = [item.ingredient_name, item.brand_name, item.usual_product_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [items, searchText, selectedCategory]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 検索バー */}
      <div className="sticky top-0 z-10 bg-white px-4 pt-4 pb-3 shadow-sm">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="材料名・銘柄で検索"
          className="w-full rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />

        {/* カテゴリ絞り込みチップ */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {(['すべて', ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 件数表示 */}
      <div className="px-4 pt-3 text-xs text-gray-500">
        {loading ? '読み込み中…' : `${filteredItems.length}件`}
      </div>

      {/* エラー表示 */}
      {errorMessage && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* 一覧 */}
      <div className="px-4 pt-2">
        {loading ? (
          // 読み込み中の仮カード
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-200" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            該当する材料が見つかりませんでした
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-xl bg-white shadow-sm"
                >
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLOR[item.category]}`}
                        >
                          {item.category}
                        </span>
                        <span className="truncate font-medium text-gray-800">
                          {item.ingredient_name}
                        </span>
                      </div>
                      {item.brand_name && (
                        <div className="mt-0.5 truncate text-xs text-gray-400">
                          {item.brand_name}
                        </div>
                      )}
                    </div>
                    <div className="ml-3 shrink-0 text-right text-xs text-gray-500">
                      <div>{fmt(item.calorie_per_100g, 'kcal')} / 100g</div>
                      <div>¥{fmt(item.price_per_100g, '')} / 100g</div>
                    </div>
                  </button>

                  {/* 展開時：栄養価・単価の詳細 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 text-sm">
                      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                        <div>既定の単位：{item.default_unit ?? '―'}</div>
                        <div>
                          1単位の重さ：{fmt(item.unit_weight_g, 'g')}
                        </div>
                        <div>いつもの商品：{item.usual_product_name ?? '―'}</div>
                        <div>購入店：{item.store_name ?? '―'}</div>
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <div className="mb-1 text-xs font-semibold text-gray-500">
                          栄養価（100gあたり）
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                          <div>カロリー：{fmt(item.calorie_per_100g, 'kcal')}</div>
                          <div>たんぱく質：{fmt(item.protein_g_per_100g, 'g')}</div>
                          <div>脂質：{fmt(item.fat_g_per_100g, 'g')}</div>
                          <div>炭水化物：{fmt(item.carbohydrate_g_per_100g, 'g')}</div>
                          <div>　糖質：{fmt(item.sugar_g_per_100g, 'g')}</div>
                          <div>　食物繊維：{fmt(item.dietary_fiber_g_per_100g, 'g')}</div>
                          <div>食塩相当量：{fmt(item.salt_g_per_100g, 'g')}</div>
                        </div>
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <div className="mb-1 text-xs font-semibold text-gray-500">
                          ビタミン・ミネラル（100gあたり）
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                          <div>ビタミンA：{fmt(item.vitamin_a_ug_per_100g, 'µg')}</div>
                          <div>ビタミンB1：{fmt(item.vitamin_b1_mg_per_100g, 'mg')}</div>
                          <div>ビタミンB2：{fmt(item.vitamin_b2_mg_per_100g, 'mg')}</div>
                          <div>ビタミンC：{fmt(item.vitamin_c_mg_per_100g, 'mg')}</div>
                          <div>ビタミンD：{fmt(item.vitamin_d_ug_per_100g, 'µg')}</div>
                          <div>ビタミンE：{fmt(item.vitamin_e_mg_per_100g, 'mg')}</div>
                          <div>カルシウム：{fmt(item.calcium_mg_per_100g, 'mg')}</div>
                          <div>鉄：{fmt(item.iron_mg_per_100g, 'mg')}</div>
                          <div>亜鉛：{fmt(item.zinc_mg_per_100g, 'mg')}</div>
                          <div>カリウム：{fmt(item.potassium_mg_per_100g, 'mg')}</div>
                        </div>
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">
                        単価：¥{fmt(item.price_per_100g, '')} / 100g
                        {item.nutrition_source && (
                          <>
                            {' '}
                            ・ データ出典：
                            {item.nutrition_source === 'standard_table'
                              ? '食品成分表'
                              : item.nutrition_source === 'label'
                              ? '商品ラベル'
                              : 'AI推定'}
                          </>
                        )}
                      </div>

                      {item.note && (
                        <div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
                          メモ：{item.note}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
