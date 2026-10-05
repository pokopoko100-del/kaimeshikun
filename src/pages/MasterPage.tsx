import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { IngredientCategory, IngredientMaster } from '../types/ingredient';
import { NUTRIENT_INFO_LIST, getNutrientInfo } from '../data/nutrientInfo';

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

// ソートの選択肢。先頭は「並び替えなし（カテゴリ順）」
// プルダウンの表示文字列は栄養素名そのまま（「○○が多い順」のような接尾語は付けない）
type SortKey = 'default' | keyof IngredientMaster;
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'カテゴリ順（既定）' },
  ...NUTRIENT_INFO_LIST.map((n) => ({ key: n.key as SortKey, label: n.label })),
];

// 数値を「値がある時だけ」表示するための小さなヘルパー
function fmt(value: number | null, unit: string) {
  if (value === null || value === undefined) return '―';
  return `${value}${unit}`;
}

// 現在の月(1〜12)が、その食材の旬の月に含まれているかを判定
function isInSeason(months: number[] | null, now: Date = new Date()): boolean {
  if (!months || months.length === 0) return false;
  const currentMonth = now.getMonth() + 1; // JSのgetMonth()は0始まりなので+1
  return months.includes(currentMonth);
}

// 旬の月の配列を「11月〜2月」のような表示用文字列に変換（年またぎにも対応）
function formatSeasonMonths(months: number[] | null): string {
  if (!months || months.length === 0) return '';
  const sorted = [...months].sort((a, b) => a - b);

  // 年またぎ（12→1のつながり）を考慮して、12月始まりに回転させる
  const rotated: number[] = [...sorted];
  while (rotated.length > 1 && rotated[rotated.length - 1] === 12 && rotated[0] === 1) {
    rotated.unshift(rotated.pop()!);
    if (rotated[0] !== 12) break;
  }

  const ranges: string[] = [];
  let start = rotated[0];
  let prev = rotated[0];
  for (let i = 1; i <= rotated.length; i++) {
    const cur = rotated[i];
    const isConsecutive = cur !== undefined && (cur === prev + 1 || (prev === 12 && cur === 1));
    if (!isConsecutive) {
      ranges.push(start === prev ? `${start}月` : `${start}月〜${prev}月`);
      start = cur;
    }
    prev = cur;
  }
  return ranges.join('・');
}

// 「大さじ」「小さじ」は単位が先頭に来る言い方、それ以外は数字が先頭に来る言い方にする
function formatUnitLabel(defaultUnit: string | null): string {
  if (!defaultUnit) return '';
  if (defaultUnit === '大さじ' || defaultUnit === '小さじ') return `${defaultUnit}1`;
  return `1${defaultUnit}`;
}

// 小さい数値は小数点を残し、大きい数値は整数に丸める（表示を見やすくするため）
function roundSmart(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0) return 0;
  if (abs >= 10) return Math.round(value);
  if (abs >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

// 100gあたりの値 → 1単位(大さじ1・1個など)あたりの値に換算
function perUnitValue(value: number | null, unitWeightG: number | null): number | null {
  if (value == null || unitWeightG == null) return null;
  return (value * unitWeightG) / 100;
}

function fmtPerUnit(value: number | null, unitWeightG: number | null, unit: string): string | null {
  const per = perUnitValue(value, unitWeightG);
  if (per == null) return null;
  return `${roundSmart(per)}${unit}`;
}

export default function MasterPage() {
  const [items, setItems] = useState<IngredientMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'すべて' | IngredientCategory>('すべて');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [infoModalKey, setInfoModalKey] = useState<keyof IngredientMaster | null>(null);

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
    const result = items.filter((item) => {
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

    if (sortKey !== 'default') {
      return [...result].sort((a, b) => {
        const va = a[sortKey] as number | null;
        const vb = b[sortKey] as number | null;
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va;
      });
    }
    return result;
  }, [items, searchText, selectedCategory, sortKey]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const infoNutrient = infoModalKey ? getNutrientInfo(infoModalKey) : null;
  // 現在プルダウンで選んでいる栄養素（カテゴリ順の時はnull）
  const selectedSortNutrient = sortKey !== 'default' ? getNutrientInfo(sortKey as keyof IngredientMaster) : null;

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

        {/* カテゴリ絞り込みチップ（ギャラリー） */}
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

        {/* ギャラリーとプルダウンの間：選択中の栄養素の働き・不足症状を常時表示 */}
        {selectedSortNutrient && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
            <p className="font-semibold text-amber-700">多い順：{selectedSortNutrient.label}</p>
            <p className="mt-0.5">
              <span className="font-bold text-green-600">　＋　</span>
              {selectedSortNutrient.effectTags.join('、')}
            </p>
            <p>
              <span className="font-bold text-red-500">　－　</span>
              {selectedSortNutrient.deficiencyTags.join('、')}
            </p>
          </div>
        )}

        {/* 並び替えプルダウン */}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">多い順：</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-amber-500 focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
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
              const sortedValue = sortKey !== 'default' ? (item[sortKey] as number | null) : null;

              // この材料の「1単位あたり」換算に使う共通情報
              const unitLabel = formatUnitLabel(item.default_unit);
              const showUnit = item.unit_weight_g != null && unitLabel !== '';
              const pu = (value: number | null, unit: string) =>
                showUnit ? fmtPerUnit(value, item.unit_weight_g, unit) : null;

              return (
                <div key={item.id} className="rounded-xl bg-white shadow-sm">
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
                        {isInSeason(item.peak_season_months) && (
                          <span className="shrink-0 rounded bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">
                            旬
                          </span>
                        )}
                      </div>
                      {item.brand_name && (
                        <div className="mt-0.5 truncate text-xs text-gray-400">
                          {item.brand_name}
                        </div>
                      )}
                    </div>
                    <div className="ml-3 shrink-0 text-right text-xs text-gray-500">
                      {selectedSortNutrient ? (
                        <div className="font-semibold text-amber-600">
                          <div>
                            {selectedSortNutrient.label} {fmt(sortedValue, selectedSortNutrient.unit)} / 100g
                          </div>
                          {pu(sortedValue, selectedSortNutrient.unit) && (
                            <div className="font-normal text-amber-500">
                              （{unitLabel}：{pu(sortedValue, selectedSortNutrient.unit)}）
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div>{fmt(item.calorie_per_100g, 'kcal')} / 100g</div>
                          {pu(item.calorie_per_100g, 'kcal') && (
                            <div className="text-gray-400">
                              （{unitLabel}：{pu(item.calorie_per_100g, 'kcal')}）
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-1">
                        <div>¥{fmt(item.price_per_100g, '')} / 100g</div>
                        {pu(item.price_per_100g, '') && (
                          <div className="text-gray-400">
                            （{unitLabel}：¥{pu(item.price_per_100g, '')}）
                          </div>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* 展開時：栄養価・単価の詳細 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 text-sm">
                      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                        <div>既定の単位：{item.default_unit ?? '―'}</div>
                        <div>1単位の重さ：{fmt(item.unit_weight_g, 'g')}</div>
                        <div>いつもの商品：{item.usual_product_name ?? '―'}</div>
                        <div>購入店：{item.store_name ?? '―'}</div>
                        <div className="col-span-2">
                          旬：
                          {item.peak_season_months && item.peak_season_months.length > 0 ? (
                            <>
                              {formatSeasonMonths(item.peak_season_months)}
                              {isInSeason(item.peak_season_months) && (
                                <span className="ml-1 rounded bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">
                                  今が旬
                                </span>
                              )}
                            </>
                          ) : (
                            '通年（特になし）'
                          )}
                        </div>
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <div className="mb-1 flex items-baseline justify-between text-xs font-semibold text-gray-500">
                          <span>栄養価（左：100gあたり／右：{unitLabel || '1単位'}あたり）</span>
                        </div>
                        <NutrientRow label="カロリー" value={fmt(item.calorie_per_100g, 'kcal')} perUnitText={pu(item.calorie_per_100g, 'kcal')} onInfo={() => setInfoModalKey('calorie_per_100g')} />
                        <NutrientRow label="たんぱく質" value={fmt(item.protein_g_per_100g, 'g')} perUnitText={pu(item.protein_g_per_100g, 'g')} onInfo={() => setInfoModalKey('protein_g_per_100g')} />
                        <NutrientRow label="脂質" value={fmt(item.fat_g_per_100g, 'g')} perUnitText={pu(item.fat_g_per_100g, 'g')} onInfo={() => setInfoModalKey('fat_g_per_100g')} />
                        <NutrientRow label="炭水化物" value={fmt(item.carbohydrate_g_per_100g, 'g')} perUnitText={pu(item.carbohydrate_g_per_100g, 'g')} onInfo={() => setInfoModalKey('carbohydrate_g_per_100g')} />
                        <NutrientRow label="　糖質" value={fmt(item.sugar_g_per_100g, 'g')} perUnitText={pu(item.sugar_g_per_100g, 'g')} onInfo={() => setInfoModalKey('sugar_g_per_100g')} />
                        <NutrientRow label="　食物繊維" value={fmt(item.dietary_fiber_g_per_100g, 'g')} perUnitText={pu(item.dietary_fiber_g_per_100g, 'g')} onInfo={() => setInfoModalKey('dietary_fiber_g_per_100g')} />
                        <NutrientRow label="食塩相当量" value={fmt(item.salt_g_per_100g, 'g')} perUnitText={pu(item.salt_g_per_100g, 'g')} onInfo={() => setInfoModalKey('salt_g_per_100g')} />
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <div className="mb-1 text-xs font-semibold text-gray-500">
                          ビタミン・ミネラル（左：100gあたり／右：{unitLabel || '1単位'}あたり）
                        </div>
                        <NutrientRow label="ビタミンA" value={fmt(item.vitamin_a_ug_per_100g, 'µg')} perUnitText={pu(item.vitamin_a_ug_per_100g, 'µg')} onInfo={() => setInfoModalKey('vitamin_a_ug_per_100g')} />
                        <NutrientRow label="ビタミンB1" value={fmt(item.vitamin_b1_mg_per_100g, 'mg')} perUnitText={pu(item.vitamin_b1_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('vitamin_b1_mg_per_100g')} />
                        <NutrientRow label="ビタミンB2" value={fmt(item.vitamin_b2_mg_per_100g, 'mg')} perUnitText={pu(item.vitamin_b2_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('vitamin_b2_mg_per_100g')} />
                        <NutrientRow label="ビタミンB6" value={fmt(item.vitamin_b6_mg_per_100g, 'mg')} perUnitText={pu(item.vitamin_b6_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('vitamin_b6_mg_per_100g')} />
                        <NutrientRow label="ビタミンB12" value={fmt(item.vitamin_b12_ug_per_100g, 'µg')} perUnitText={pu(item.vitamin_b12_ug_per_100g, 'µg')} onInfo={() => setInfoModalKey('vitamin_b12_ug_per_100g')} />
                        <NutrientRow label="葉酸" value={fmt(item.folate_ug_per_100g, 'µg')} perUnitText={pu(item.folate_ug_per_100g, 'µg')} onInfo={() => setInfoModalKey('folate_ug_per_100g')} />
                        <NutrientRow label="ビタミンC" value={fmt(item.vitamin_c_mg_per_100g, 'mg')} perUnitText={pu(item.vitamin_c_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('vitamin_c_mg_per_100g')} />
                        <NutrientRow label="ビタミンD" value={fmt(item.vitamin_d_ug_per_100g, 'µg')} perUnitText={pu(item.vitamin_d_ug_per_100g, 'µg')} onInfo={() => setInfoModalKey('vitamin_d_ug_per_100g')} />
                        <NutrientRow label="ビタミンE" value={fmt(item.vitamin_e_mg_per_100g, 'mg')} perUnitText={pu(item.vitamin_e_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('vitamin_e_mg_per_100g')} />
                        <NutrientRow label="カルシウム" value={fmt(item.calcium_mg_per_100g, 'mg')} perUnitText={pu(item.calcium_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('calcium_mg_per_100g')} />
                        <NutrientRow label="鉄" value={fmt(item.iron_mg_per_100g, 'mg')} perUnitText={pu(item.iron_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('iron_mg_per_100g')} />
                        <NutrientRow label="亜鉛" value={fmt(item.zinc_mg_per_100g, 'mg')} perUnitText={pu(item.zinc_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('zinc_mg_per_100g')} />
                        <NutrientRow label="カリウム" value={fmt(item.potassium_mg_per_100g, 'mg')} perUnitText={pu(item.potassium_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('potassium_mg_per_100g')} />
                        <NutrientRow label="マグネシウム" value={fmt(item.magnesium_mg_per_100g, 'mg')} perUnitText={pu(item.magnesium_mg_per_100g, 'mg')} onInfo={() => setInfoModalKey('magnesium_mg_per_100g')} />
                      </div>

                      <div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">
                        単価：¥{fmt(item.price_per_100g, '')} / 100g
                        {pu(item.price_per_100g, '') && ` （${unitLabel}：¥${pu(item.price_per_100g, '')}）`}
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

      {/* 栄養素の詳しい効果・不足症状を表示するモーダル（ⓘタップ時） */}
      {infoNutrient && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center"
          onClick={() => setInfoModalKey(null)}
        >
          <div
            className="w-full rounded-t-2xl bg-white p-5 sm:max-w-sm sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">{infoNutrient.label}</h3>
              <button
                onClick={() => setInfoModalKey(null)}
                className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500"
              >
                閉じる
              </button>
            </div>
            <div className="mb-3">
              <div className="mb-1 text-xs font-semibold text-amber-600">どんな効果があるか</div>
              <p className="text-sm leading-relaxed text-gray-700">{infoNutrient.effect}</p>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-red-500">不足するとどうなるか</div>
              <p className="text-sm leading-relaxed text-gray-700">{infoNutrient.deficiency}</p>
            </div>
            <p className="mt-4 text-[10px] leading-relaxed text-gray-400">
              ※一般的な栄養知識の紹介であり、医療的な診断やアドバイスではありません。体調が気になる場合は医師・管理栄養士にご相談ください。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// 栄養価の1行表示（値 ＋ ⓘ情報ボタン ＋ 1単位あたりの値）
function NutrientRow({
  label,
  value,
  perUnitText,
  onInfo,
}: {
  label: string;
  value: string;
  perUnitText: string | null;
  onInfo: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-gray-700">
      <button onClick={onInfo} className="flex items-center gap-1 text-left">
        <span>{label}</span>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] text-gray-500">
          i
        </span>
      </button>
      <span className="flex items-baseline gap-2">
        <span>{value}</span>
        {perUnitText && <span className="text-[11px] text-gray-400">（{perUnitText}）</span>}
      </span>
    </div>
  );
}
