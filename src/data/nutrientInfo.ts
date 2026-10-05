import type { IngredientMaster } from '../types/ingredient';

// ソート・モーダル表示に使う「栄養素」の定義
// key: IngredientMasterの数値フィールド名 / label: 画面表示名 / unit: 単位
// effect: 主な働き（効果） / deficiency: 不足するとどうなるか
export interface NutrientInfo {
  key: keyof IngredientMaster;
  label: string;
  unit: string;
  effect: string;
  deficiency: string;
}

export const NUTRIENT_INFO_LIST: NutrientInfo[] = [
  {
    key: 'calorie_per_100g',
    label: 'カロリー',
    unit: 'kcal',
    effect:
      '体を動かすための熱量（エネルギー）のもと。体温維持や内臓の働き、運動のエネルギー源になる。',
    deficiency:
      '不足するとエネルギー不足になり、疲れやすい・体重減少・集中力低下につながる。逆に摂りすぎは体重増加や生活習慣病のリスクを高める。',
  },
  {
    key: 'protein_g_per_100g',
    label: 'たんぱく質',
    unit: 'g',
    effect:
      '筋肉・皮膚・髪・臓器・ホルモン・免疫抗体など、体のあらゆる部分の材料になる栄養素。',
    deficiency:
      '不足すると筋肉量の減少、免疫力の低下、肌や髪のトラブルにつながりやすい。摂りすぎは腎臓への負担になることがある。',
  },
  {
    key: 'fat_g_per_100g',
    label: '脂質',
    unit: 'g',
    effect:
      '細胞膜やホルモンの材料になるほか、効率のよいエネルギー源。ビタミンA・D・Eなど脂溶性ビタミンの吸収も助ける。',
    deficiency:
      '極端に不足すると肌の乾燥や抜け毛、ホルモンバランスの乱れにつながることがある。摂りすぎは肥満や脂質異常症のリスクを高める。',
  },
  {
    key: 'carbohydrate_g_per_100g',
    label: '炭水化物',
    unit: 'g',
    effect:
      '糖質と食物繊維の総称。糖質は脳と体の主要なエネルギー源、食物繊維は腸内環境を整える役割を持つ。',
    deficiency:
      '極端に減らすと疲労感・集中力低下・筋肉の分解につながることがある。摂りすぎは血糖値の急上昇や肥満のリスクを高める。',
  },
  {
    key: 'sugar_g_per_100g',
    label: '糖質',
    unit: 'g',
    effect:
      '体内でブドウ糖に分解され、脳や筋肉の即効性のあるエネルギー源になる。脳は1日に多くのブドウ糖を消費する。',
    deficiency:
      '極端に制限すると集中力の低下やイライラ、疲労感につながりやすい。摂りすぎは血糖値の急上昇や肥満・脂肪肝のリスクを高める。',
  },
  {
    key: 'dietary_fiber_g_per_100g',
    label: '食物繊維',
    unit: 'g',
    effect:
      '消化されずに腸まで届き、腸内環境を整える。便通改善、血糖値の上昇抑制、コレステロールの排出を助ける働きがある。',
    deficiency:
      '不足すると便秘になりやすく、生活習慣病のリスクが上がるとされる。日本人は目標量に対して不足しがちな栄養素。',
  },
  {
    key: 'salt_g_per_100g',
    label: '食塩相当量',
    unit: 'g',
    effect:
      '体内の水分バランスや血圧の調整、神経伝達に関わる（主にナトリウムの働き）。',
    deficiency:
      '通常の食生活で不足することは稀。むしろ摂りすぎによる高血圧・むくみ・胃への負担が注意点になる。',
  },
  {
    key: 'vitamin_a_ug_per_100g',
    label: 'ビタミンA',
    unit: 'µg',
    effect:
      '目の健康（暗い場所での見え方）を保ち、皮膚や粘膜を正常に保つ。免疫力にも関わる。',
    deficiency:
      '不足すると暗い場所で見えにくくなる「夜盲症」や、皮膚・粘膜の乾燥、感染症にかかりやすくなることがある。',
  },
  {
    key: 'vitamin_b1_mg_per_100g',
    label: 'ビタミンB1',
    unit: 'mg',
    effect:
      '糖質をエネルギーに変える代謝を助ける。特にご飯や糖質中心の食事で消費されやすい。',
    deficiency:
      '不足すると疲れやすくなったり、食欲不振、むくみ・しびれ（脚気）につながることがある。',
  },
  {
    key: 'vitamin_b2_mg_per_100g',
    label: 'ビタミンB2',
    unit: 'mg',
    effect:
      '糖質・脂質・たんぱく質のエネルギー代謝を助け、皮膚や粘膜の健康維持にも関わる。',
    deficiency:
      '不足すると口内炎・口角炎・舌炎ができやすくなったり、肌荒れ・目の充血が起こることがある。',
  },
  {
    key: 'vitamin_c_mg_per_100g',
    label: 'ビタミンC',
    unit: 'mg',
    effect:
      'コラーゲンの合成を助け、肌や血管の健康を保つ。抗酸化作用や、鉄の吸収を助ける働きもある。',
    deficiency:
      '不足すると歯茎から出血しやすくなったり、あざができやすくなる（毛細血管がもろくなる）ことがある。',
  },
  {
    key: 'vitamin_d_ug_per_100g',
    label: 'ビタミンD',
    unit: 'µg',
    effect:
      'カルシウムの吸収を助け、骨や歯を丈夫に保つ。日光に当たることで皮膚でも作られる。',
    deficiency:
      '不足すると骨が弱くなりやすく、骨密度の低下や骨粗しょう症のリスクにつながることがある。',
  },
  {
    key: 'vitamin_e_mg_per_100g',
    label: 'ビタミンE',
    unit: 'mg',
    effect:
      '抗酸化作用があり、細胞膜を酸化から守る。血行を保つ働きもあるとされる。',
    deficiency:
      '通常の食生活で不足することは少ないが、不足すると神経や筋肉の働きに影響が出ることがある。',
  },
  {
    key: 'calcium_mg_per_100g',
    label: 'カルシウム',
    unit: 'mg',
    effect:
      '骨や歯の材料になるほか、筋肉の収縮や神経の伝達にも関わる。体内に最も多いミネラル。',
    deficiency:
      '不足が続くと骨からカルシウムが溶け出し、骨密度の低下や骨粗しょう症につながりやすい。',
  },
  {
    key: 'iron_mg_per_100g',
    label: '鉄',
    unit: 'mg',
    effect:
      '赤血球（ヘモグロビン）の材料として、全身に酸素を運ぶ役割を持つ。',
    deficiency:
      '不足すると酸素が運ばれにくくなり、疲れやすさ・立ちくらみ・冷えなど「鉄欠乏性貧血」の症状につながりやすい。',
  },
  {
    key: 'zinc_mg_per_100g',
    label: '亜鉛',
    unit: 'mg',
    effect:
      '味覚を正常に保つほか、皮膚・粘膜の健康維持、免疫機能、多くの酵素の構成成分として働く。',
    deficiency:
      '不足すると味を感じにくくなったり、肌荒れ、感染症にかかりやすくなることがある。',
  },
  {
    key: 'potassium_mg_per_100g',
    label: 'カリウム',
    unit: 'mg',
    effect:
      '細胞内の水分バランスを調整し、ナトリウムとのバランスで血圧を正常に保つ働きがある。',
    deficiency:
      '不足するとむくみや血圧の上昇、脱力感につながることがある。',
  },
];

// MasterPage.tsx のソート用セレクトで参照するヘルパー
export function getNutrientInfo(key: keyof IngredientMaster) {
  return NUTRIENT_INFO_LIST.find((n) => n.key === key) ?? null;
}