// src/pages/MasterPage.tsx（ファイル全体。これで丸ごと置き換えてください）
// 前提：ingredient_units テーブル（複数単位の対応）を作成済みであること
// 今回の変更：
//  ・検索ボックスの右に「＋」ボタン：材料名をテキストで入力して、AIで追加（栄養素・価格・旬・単位を推定。レシピ取り込みと同じ登録画面）
//  ・材料を長押しすると、「編集」か「この材料を使うレシピを探す」を選べる
//      編集：同じ画面で、今の値を直せる。「AIで再取得」で、栄養素・価格・旬・単位をAIの推定値に置き換えられる
//  ・追加・編集のあとは、一覧を読み込み直す
// 前回までの変更：
//  ・材料を開いたとき、「単位」の追加・編集・削除フォームを表示（大さじ・小さじ・個・枚…を何個でも登録）
//    基準の単位を変えたときは、材料マスタの default_unit / unit_weight_g も自動でそろえる（一覧の「1単位あたり」表示に反映）
// これまでの修正：
//  ① 一覧の左側を「分類＋旬」→「材料名」→「銘柄」の3段・左揃えに変更
//  ② 「100gあたり」を上部に固定表示し、各レコードの「/ 100g」を削除
//  ③ 右側の数値を「117kcal  40円」（大きめ）＋「（大さじ1：21kcal, 7.2円）」（小さめ）の2段表示に変更
//  ④ いつもの商品の画像を登録（詳細を開く→画像を登録）。一覧では小さく表示し、タップで拡大
//  ⑤ チップを2段に変更（1段目：すべて・旬のみ／2段目：カテゴリ）
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import type { IngredientCategory, IngredientMaster } from '../types/ingredient';
import { NUTRIENT_INFO_LIST, getNutrientInfo } from '../data/nutrientInfo';
import IngredientUnitsEditor from '../components/IngredientUnitsEditor';
import type { UnitRow } from '../components/IngredientUnitsEditor';
import LongPressArea from '../components/LongPressArea';
import IngredientActionSheet from '../components/IngredientActionSheet';
import RecipesUsingSheet from '../components/RecipesUsingSheet';
import MasterIngredientEditor from '../components/MasterIngredientEditor';

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

// いつもの商品の画像は、レシピ写真と同じ非公開バケットに保存する
// （既存のRLSポリシー：パスの先頭が household_id のフォルダ）
const BUCKET = 'recipe-images';

// ソートの選択肢。先頭は「並び替えなし（カテゴリ順）」
// プルダウンの表示文字列は栄養素名そのまま（「○○が多い順」のような接尾語は付けない）
type SortKey = 'default' | keyof IngredientMaster;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'カテゴリ順（既定）' },
  ...NUTRIENT_INFO_LIST.map((n) => ({ key: n.key as SortKey, label: n.label })),
];

// 拡大表示中の画像
type Lightbox = { url: string; title: string };

// 追加・編集の画面（null＝閉じている）
type EditorState = { mode: 'add' } | { mode: 'edit'; item: IngredientMaster } | null;

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
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  // 年またぎ対応：12月と1月の両方がある場合、「前の月が含まれない月」から始まるように並べ替える
  let ordered = sorted;
  if (sorted.includes(12) && sorted.includes(1) && sorted.length < 12) {
    const startIdx = sorted.findIndex((m) => !sorted.includes(m === 1 ? 12 : m - 1));
    ordered = [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
  }
  const ranges: string[] = [];
  let start = ordered[0];
  let prev = ordered[0];
  for (let i = 1; i <= ordered.length; i++) {
    const cur = ordered[i];
    const isConsecutive = cur !== undefined && cur === (prev % 12) + 1;
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

// ---------- 画像まわりのヘルパー ----------

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

// 端末側で長辺1024px・JPEG品質80%に圧縮してからアップロードする
async function compressImage(file: File, maxEdge = 1024, quality = 0.8): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像の変換に失敗しました');
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の変換に失敗しました'))),
      'image/jpeg',
      quality,
    );
  });
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return '不明なエラー';
}

export default function MasterPage() {
  const { session } = useOutletContext<{ session: Session }>();
  const [items, setItems] = useState<IngredientMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'すべて' | IngredientCategory>('すべて');
  const [seasonOnly, setSeasonOnly] = useState(false); // 旬の食材のみ表示するフラグ
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [infoModalKey, setInfoModalKey] = useState<keyof IngredientMaster | null>(null);
  // いつもの商品の画像：保存パス → 署名付きURL
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  // 材料ごとの単位表（材料ID → 単位の一覧）。読み込みに失敗したときは undefined のまま
  const [unitsByMaster, setUnitsByMaster] = useState<Record<string, UnitRow[]> | null>(null);
  const [unitsFailed, setUnitsFailed] = useState(false);
  // 長押しメニュー・追加／編集の画面・レシピ検索
  const [actionTarget, setActionTarget] = useState<IngredientMaster | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [usingTarget, setUsingTarget] = useState<IngredientMaster | null>(null);
  const [reloadKey, setReloadKey] = useState(0); // 増やすと、一覧を読み込み直す
  const [toast, setToast] = useState<string | null>(null);

  // 「登録しました」などのメッセージは、3秒で消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const fetchIngredients = async () => {
      if (reloadKey === 0) setLoading(true); // 読み込み直しのときは、一覧を出したままにする
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('ingredient_master')
        .select('*')
        .order('category', { ascending: true })
        .order('ingredient_name', { ascending: true });

      if (error) {
        setErrorMessage('材料マスタの読み込みに失敗しました。');
        console.error(error);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as IngredientMaster[];
      setItems(list);
      setLoading(false);

      // 単位表：読めなくても材料の一覧は表示する（開いたときに案内を出す）
      const { data: unitData, error: unitError } = await supabase
        .from('ingredient_units')
        .select('id, ingredient_master_id, unit, weight_g, is_default, sort_order')
        .range(0, 4999);
      if (unitError) {
        console.error(unitError);
        setUnitsFailed(true);
      } else {
        setUnitsFailed(false);
        const grouped: Record<string, UnitRow[]> = {};
        (unitData ?? []).forEach((u) => {
          const row = { ...(u as UnitRow), weight_g: Number((u as UnitRow).weight_g) };
          (grouped[row.ingredient_master_id] ??= []).push(row);
        });
        setUnitsByMaster(grouped);
      }

      // 非公開バケットなので、画像がある材料の署名付きURLをまとめて発行（1時間有効）
      const paths = list
        .map((i) => i.usual_product_image_path)
        .filter((p): p is string => !!p);
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        const map: Record<string, string> = {};
        signed?.forEach((s) => {
          if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
        });
        setImageUrls(map);
      }
    };
    fetchIngredients();
  }, [reloadKey]);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const result = items.filter((item) => {
      const matchesCategory =
        selectedCategory === 'すべて' || item.category === selectedCategory;
      if (!matchesCategory) return false;

      // 「旬のみ」がオンの時は、今が旬の食材だけに絞り込む
      if (seasonOnly && !isInSeason(item.peak_season_months)) return false;

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
  }, [items, searchText, selectedCategory, seasonOnly, sortKey]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // 「すべて」：カテゴリも旬のみも解除（リセット）
  const handleSelectAll = () => {
    setSelectedCategory('すべて');
    setSeasonOnly(false);
  };

  // 単位の編集後：この材料の単位一覧を差し替える
  const handleUnitsChange = (masterId: string, units: UnitRow[]) => {
    setUnitsByMaster((prev) => ({ ...(prev ?? {}), [masterId]: units }));
  };

  // 基準の単位が変わったとき：一覧の「1単位あたり」表示にも反映する
  const handleDefaultChange = (masterId: string, unit: string | null, weightG: number | null) => {
    setItems((prev) =>
      prev.map((i) => (i.id === masterId ? { ...i, default_unit: unit, unit_weight_g: weightG } : i)),
    );
  };

  // いつもの商品の画像を登録（圧縮→Storageへアップロード→DBにパス保存→旧画像を削除）
  const handleUploadImage = async (item: IngredientMaster, file: File) => {
    setUploadingId(item.id);
    try {
      const blob = await compressImage(file);
      const newPath = `${item.household_id}/usual-products/${item.id}-${Date.now()}.jpg`;

      const { error: upError } = await supabase.storage
        .from(BUCKET)
        .upload(newPath, blob, { contentType: 'image/jpeg' });
      if (upError) throw upError;

      const { data: updated, error: dbError } = await supabase
        .from('ingredient_master')
        .update({ usual_product_image_path: newPath })
        .eq('id', item.id)
        .select('id');
      if (dbError || !updated || updated.length === 0) {
        await supabase.storage.from(BUCKET).remove([newPath]);
        throw dbError ?? new Error('材料マスタを更新できませんでした（権限またはSQLを確認してください）');
      }

      // 旧画像があれば削除（失敗しても致命的ではない）
      const oldPath = item.usual_product_image_path;
      if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);

      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(newPath, 3600);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, usual_product_image_path: newPath } : i)),
      );
      if (signed?.signedUrl) {
        setImageUrls((prev) => ({ ...prev, [newPath]: signed.signedUrl }));
      }
    } catch (e) {
      console.error(e);
      alert('画像の登録に失敗しました：' + errorText(e));
    } finally {
      setUploadingId(null);
    }
  };

  const handleDeleteImage = async (item: IngredientMaster) => {
    const path = item.usual_product_image_path;
    if (!path) return;
    if (!window.confirm('いつもの商品の画像を削除しますか？')) return;
    setUploadingId(item.id);
    try {
      const { data: updated, error: dbError } = await supabase
        .from('ingredient_master')
        .update({ usual_product_image_path: null })
        .eq('id', item.id)
        .select('id');
      if (dbError || !updated || updated.length === 0) {
        throw dbError ?? new Error('材料マスタを更新できませんでした');
      }
      await supabase.storage.from(BUCKET).remove([path]);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, usual_product_image_path: null } : i)),
      );
    } catch (e) {
      console.error(e);
      alert('画像の削除に失敗しました：' + errorText(e));
    } finally {
      setUploadingId(null);
    }
  };

  // 材料の名前・カテゴリだけを持つ一覧（追加・編集の名前の重複チェックに使う）
  const masterOptions = useMemo(
    () => items.map((i) => ({ id: i.id, name: i.ingredient_name, category: i.category, units: [] as string[] })),
    [items],
  );

  // 追加・編集が終わったとき：画面を閉じて、一覧を読み込み直す
  const handleSaved = (message: string) => {
    setEditor(null);
    setToast(message);
    setReloadKey((k) => k + 1);
  };

  const infoNutrient = infoModalKey ? getNutrientInfo(infoModalKey) : null;
  // 現在プルダウンで選んでいる栄養素（カテゴリ順の時はnull）
  const selectedSortNutrient = sortKey !== 'default' ? getNutrientInfo(sortKey as keyof IngredientMaster) : null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 上部固定エリア：検索・絞り込み・並び替え・件数 */}
      <div className="sticky top-0 z-10 bg-white px-4 pt-4 pb-3 shadow-sm">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="材料名・銘柄で検索"
            className="min-w-0 flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          {/* 材料をAIで追加 */}
          <button
            type="button"
            onClick={() => setEditor({ mode: 'add' })}
            aria-label="材料をAIで追加"
            title="材料をAIで追加"
            className="shrink-0 rounded-full bg-orange-500 px-3.5 py-1.5 text-base font-bold leading-none text-white active:opacity-80"
          >
            ＋
          </button>
        </div>

        {/* 1段目：すべて・旬のみ */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSelectAll}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
              selectedCategory === 'すべて' && !seasonOnly
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            すべて
          </button>
          <button
            onClick={() => setSeasonOnly((prev) => !prev)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
              seasonOnly ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-600'
            }`}
          >
            🌸 旬のみ
          </button>
        </div>

        {/* 2段目：カテゴリ（横スクロール） */}
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
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

        {/* 件数（左）＋ 「100gあたり」の固定表示（右。各レコードの数値の真上に来る） */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>
            {loading ? '読み込み中…' : `${filteredItems.length}件`}
            {!loading && <span className="ml-2 text-[10px] text-gray-400">長押しで編集・レシピ検索</span>}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
            100gあたり
          </span>
        </div>
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
            {seasonOnly ? '今が旬の材料は見つかりませんでした' : '該当する材料が見つかりませんでした'}
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

              // 一覧右側の「1単位あたり」小さい表示（例：大さじ1：21kcal, 7.2円）
              const unitNutrientText = selectedSortNutrient
                ? pu(sortedValue, selectedSortNutrient.unit)
                : pu(item.calorie_per_100g, 'kcal');
              const unitPriceText = pu(item.price_per_100g, '円');
              const unitParts = [unitNutrientText, unitPriceText].filter(
                (v): v is string => !!v,
              );

              // いつもの商品の画像（あれば）
              const imagePath = item.usual_product_image_path;
              const imageUrl = imagePath ? imageUrls[imagePath] : undefined;
              const isUploading = uploadingId === item.id;
              const lightboxTitle = item.usual_product_name ?? item.brand_name ?? item.ingredient_name;

              return (
                <div key={item.id} className="rounded-xl bg-white shadow-sm">
                  {/* カード本体（ボタンの中にボタンを入れないよう div + role="button"） */}
                  <LongPressArea
                    onTap={() => toggleExpand(item.id)}
                    onLongPress={() => setActionTarget(item)}
                    className="flex w-full cursor-pointer items-center px-4 py-3 text-left"
                  >
                    {/* 左：①分類＋旬 ②材料名 ③銘柄（すべて左揃え） */}
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLOR[item.category]}`}
                        >
                          {item.category}
                        </span>
                        {isInSeason(item.peak_season_months) && (
                          <span className="shrink-0 rounded bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">
                            旬
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate font-medium text-gray-800">
                        {item.ingredient_name}
                      </div>
                      {item.brand_name && (
                        <div className="mt-0.5 truncate text-xs text-gray-400">
                          {item.brand_name}
                        </div>
                      )}
                    </div>

                    {/* 中央：いつもの商品の画像（小さく表示。タップで拡大） */}
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightbox({ url: imageUrl, title: lightboxTitle });
                        }}
                        className="mx-2 h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                        aria-label="画像を拡大"
                      >
                        <img
                          src={imageUrl}
                          alt={lightboxTitle}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    )}

                    {/* 右：上段＝100gあたりの値（大きめ）／下段＝1単位あたり（小さめ・括弧書き） */}
                    <div className="ml-2 shrink-0 whitespace-nowrap text-right">
                      <div className="flex items-baseline justify-end gap-3 text-sm font-semibold">
                        {selectedSortNutrient ? (
                          <span className="text-amber-600">
                            {selectedSortNutrient.label} {fmt(sortedValue, selectedSortNutrient.unit)}
                          </span>
                        ) : (
                          <span className="text-gray-700">{fmt(item.calorie_per_100g, 'kcal')}</span>
                        )}
                        <span className="text-gray-700">{fmt(item.price_per_100g, '円')}</span>
                      </div>
                      {unitParts.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-gray-400">
                          （{unitLabel}：{unitParts.join(', ')}）
                        </div>
                      )}
                    </div>
                  </LongPressArea>

                  {/* 展開時：栄養価・単価の詳細 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 text-sm">
                      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
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

                      {/* 単位の追加・編集・削除 */}
                      <div className="mb-2">
                        {unitsByMaster === null && !unitsFailed ? (
                          <p className="text-xs text-gray-400">単位を読み込み中…</p>
                        ) : (
                          <IngredientUnitsEditor
                            item={item}
                            units={unitsFailed ? undefined : (unitsByMaster?.[item.id] ?? [])}
                            onUnitsChange={handleUnitsChange}
                            onDefaultChange={handleDefaultChange}
                          />
                        )}
                      </div>

                      {/* いつもの商品の画像：登録・変更・削除 */}
                      <div className="mb-2 flex items-center gap-3 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                        {imageUrl ? (
                          <button
                            type="button"
                            onClick={() => setLightbox({ url: imageUrl, title: lightboxTitle })}
                            className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200"
                            aria-label="画像を拡大"
                          >
                            <img src={imageUrl} alt={lightboxTitle} className="h-full w-full object-cover" />
                          </button>
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-xl">
                            📷
                          </div>
                        )}
                        <div className="flex flex-1 flex-col gap-1.5">
                          <span className="font-semibold text-gray-500">いつもの商品の画像</span>
                          <div className="flex items-center gap-2">
                            <label
                              className={`cursor-pointer rounded-full px-3 py-1 font-medium text-white ${
                                isUploading ? 'bg-gray-400' : 'bg-amber-500'
                              }`}
                            >
                              {isUploading ? 'アップロード中…' : imagePath ? '画像を変更' : '画像を登録'}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={isUploading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = '';
                                  if (file) handleUploadImage(item, file);
                                }}
                              />
                            </label>
                            {imagePath && (
                              <button
                                type="button"
                                disabled={isUploading}
                                onClick={() => handleDeleteImage(item)}
                                className="rounded-full border border-red-300 px-3 py-1 font-medium text-red-500 disabled:opacity-50"
                              >
                                削除
                              </button>
                            )}
                          </div>
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

      {/* 長押しメニュー：編集／この材料を使うレシピを探す */}
      {actionTarget && (
        <IngredientActionSheet
          name={actionTarget.ingredient_name}
          category={actionTarget.category}
          onClose={() => setActionTarget(null)}
          onEdit={() => {
            setEditor({ mode: 'edit', item: actionTarget });
            setActionTarget(null);
          }}
          onFindRecipes={() => {
            setUsingTarget(actionTarget);
            setActionTarget(null);
          }}
        />
      )}

      {/* この材料を使うレシピ */}
      {usingTarget && (
        <RecipesUsingSheet
          master={{ id: usingTarget.id, name: usingTarget.ingredient_name }}
          onClose={() => setUsingTarget(null)}
        />
      )}

      {/* 材料の追加・編集（画面いっぱい） */}
      {editor && (
        <MasterIngredientEditor
          key={editor.mode === 'edit' ? editor.item.id : 'add'}
          mode={editor.mode}
          item={editor.mode === 'edit' ? editor.item : undefined}
          masters={masterOptions}
          userId={session.user.id}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      {/* 「登録しました」などのメッセージ */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-3"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>
        </div>
      )}

      {/* 画像の拡大表示（どこをタップしても閉じる） */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.url}
            alt={lightbox.title}
            className="max-h-[75vh] max-w-full rounded-xl object-contain"
          />
          <p className="mt-3 text-sm font-semibold text-white">{lightbox.title}</p>
          <p className="mt-1 text-xs text-white/60">タップで閉じる</p>
        </div>
      )}

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
