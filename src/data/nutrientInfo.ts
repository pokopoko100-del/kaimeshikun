
import type { IngredientMaster } from '../types/ingredient';

// ソート・常時表示欄・情報モーダルで共通して使う「栄養素」の定義
// key: IngredientMasterの数値フィールド名 / label: 画面表示名（プルダウンにもそのまま使う）
// effect / deficiency: 詳細説明（展開カード内のⓘモーダル用、文章）
// effectTags / deficiencyTags: 短い単語を「、」区切りにした配列（常時表示欄の＋－用）
export interface NutrientInfo {
  key: keyof IngredientMaster;
  label: string;
  unit: string;
  effect: string;
  deficiency: string;
  effectTags: string[];
  deficiencyTags: string[];
}

export const NUTRIENT_INFO_LIST: NutrientInfo[] = [
  {
    key: 'calorie_per_100g',
    label: 'カロリー',
    unit: 'kcal',
    effect: '体を動かすための熱量（エネルギー）のもと。体温維持や内臓の働き、運動のエネルギー源になる。',
    deficiency: '不足するとエネルギー不足になり、疲れやすい・体重減少・集中力低下につながる。摂りすぎは体重増加のリスクを高める。',
    effectTags: ['活動のエネルギー源', '体温維持'],
    deficiencyTags: ['疲労', '体重減少', '集中力低下'],
  },
  {
    key: 'protein_g_per_100g',
    label: 'たんぱく質',
    unit: 'g',
    effect: '筋肉・皮膚・髪・臓器・ホルモン・免疫抗体など、体のあらゆる部分の材料になる栄養素。',
    deficiency: '不足すると筋肉量の減少、免疫力の低下、肌や髪のトラブルにつながりやすい。',
    effectTags: ['筋肉・皮膚・臓器の材料', '免疫維持'],
    deficiencyTags: ['筋力低下', '免疫力低下', '肌・髪のトラブル'],
  },
  {
    key: 'fat_g_per_100g',
    label: '脂質',
    unit: 'g',
    effect: '細胞膜やホルモンの材料になるほか、効率のよいエネルギー源。脂溶性ビタミンの吸収も助ける。',
    deficiency: '極端に不足すると肌の乾燥や抜け毛、ホルモンバランスの乱れにつながることがある。',
    effectTags: ['細胞膜・ホルモンの材料', '脂溶性ビタミン吸収促進'],
    deficiencyTags: ['肌の乾燥', '抜け毛', 'ホルモンバランスの乱れ'],
  },
  {
    key: 'carbohydrate_g_per_100g',
    label: '炭水化物',
    unit: 'g',
    effect: '糖質と食物繊維の総称。糖質は脳と体の主要なエネルギー源、食物繊維は腸内環境を整える。',
    deficiency: '極端に減らすと疲労感・集中力低下・筋肉の分解につながることがある。',
    effectTags: ['脳・体のエネルギー源', '腸内環境を整える'],
    deficiencyTags: ['疲労感', '集中力低下', '筋肉の分解'],
  },
  {
    key: 'sugar_g_per_100g',
    label: '糖質',
    unit: 'g',
    effect: '体内でブドウ糖に分解され、脳や筋肉の即効性のあるエネルギー源になる。',
    deficiency: '極端に制限すると集中力の低下やイライラ、疲労感につながりやすい。',
    effectTags: ['脳の即効エネルギー源', '筋肉のエネルギー源'],
    deficiencyTags: ['集中力低下', 'イライラ', '疲労感'],
  },
  {
    key: 'dietary_fiber_g_per_100g',
    label: '食物繊維',
    unit: 'g',
    effect: '消化されずに腸まで届き、腸内環境を整える。便通改善、血糖値の上昇抑制、コレステロール排出を助ける。',
    deficiency: '不足すると便秘になりやすく、生活習慣病のリスクが上がるとされる。',
    effectTags: ['腸内環境を整える', '血糖値上昇を抑える', 'コレステロール排出'],
    deficiencyTags: ['便秘', '生活習慣病リスク上昇'],
  },
  {
    key: 'salt_g_per_100g',
    label: '食塩相当量',
    unit: 'g',
    effect: '体内の水分バランスや血圧の調整、神経伝達に関わる（主にナトリウムの働き）。',
    deficiency: '通常の食生活で不足することは稀。摂りすぎによる高血圧・むくみが主な注意点。',
    effectTags: ['水分バランス調整', '神経伝達'],
    deficiencyTags: ['通常は不足しにくい', '摂りすぎは高血圧・むくみ'],
  },
  {
    key: 'vitamin_a_ug_per_100g',
    label: 'ビタミンA',
    unit: 'µg',
    effect: '目の健康（暗い場所での見え方）を保ち、皮膚や粘膜を正常に保つ。免疫力にも関わる。',
    deficiency: '不足すると暗い場所で見えにくくなる「夜盲症」や、皮膚・粘膜の乾燥につながることがある。',
    effectTags: ['視力維持', '皮膚・粘膜の健康', '免疫維持'],
    deficiencyTags: ['夜盲症', '皮膚・粘膜の乾燥', '感染症にかかりやすい'],
  },
  {
    key: 'vitamin_b1_mg_per_100g',
    label: 'ビタミンB1',
    unit: 'mg',
    effect: '糖質をエネルギーに変える代謝を助ける。ご飯や糖質中心の食事で消費されやすい。',
    deficiency: '不足すると疲れやすくなったり、食欲不振、むくみ・しびれ（脚気）につながることがある。',
    effectTags: ['糖質代謝を助ける'],
    deficiencyTags: ['疲労', '食欲不振', 'むくみ・しびれ'],
  },
  {
    key: 'vitamin_b2_mg_per_100g',
    label: 'ビタミンB2',
    unit: 'mg',
    effect: '糖質・脂質・たんぱく質のエネルギー代謝を助け、皮膚や粘膜の健康維持にも関わる。',
    deficiency: '不足すると口内炎・口角炎・舌炎ができやすくなったり、肌荒れ・目の充血が起こることがある。',
    effectTags: ['三大栄養素の代謝を助ける', '皮膚・粘膜の健康'],
    deficiencyTags: ['口内炎・口角炎', '肌荒れ', '目の充血'],
  },
  {
    key: 'vitamin_c_mg_per_100g',
    label: 'ビタミンC',
    unit: 'mg',
    effect: 'コラーゲンの合成を助け、肌や血管の健康を保つ。抗酸化作用や、鉄の吸収を助ける働きもある。',
    deficiency: '不足すると歯茎から出血しやすくなったり、あざができやすくなる（毛細血管がもろくなる）ことがある。',
    effectTags: ['コラーゲン生成', '抗酸化作用', '鉄の吸収促進'],
    deficiencyTags: ['疲労', '筋力低下', '皮膚・粘膜の不調', '歯茎出血', 'あざ'],
  },
  {
    key: 'vitamin_d_ug_per_100g',
    label: 'ビタミンD',
    unit: 'µg',
    effect: 'カルシウムの吸収を助け、骨や歯を丈夫に保つ。日光に当たることで皮膚でも作られる。',
    deficiency: '不足すると骨が弱くなりやすく、骨密度の低下や骨粗しょう症のリスクにつながることがある。',
    effectTags: ['カルシウム吸収促進', '骨・歯を丈夫にする'],
    deficiencyTags: ['骨密度低下', '骨粗しょう症リスク'],
  },
  {
    key: 'vitamin_e_mg_per_100g',
    label: 'ビタミンE',
    unit: 'mg',
    effect: '抗酸化作用があり、細胞膜を酸化から守る。血行を保つ働きもあるとされる。',
    deficiency: '通常の食生活で不足することは少ないが、不足すると神経や筋肉の働きに影響が出ることがある。',
    effectTags: ['抗酸化作用', '血行維持'],
    deficiencyTags: ['通常は不足しにくい', '神経・筋肉の不調'],
  },
  {
    key: 'calcium_mg_per_100g',
    label: 'カルシウム',
    unit: 'mg',
    effect: '骨や歯の材料になるほか、筋肉の収縮や神経の伝達にも関わる。体内に最も多いミネラル。',
    deficiency: '不足が続くと骨からカルシウムが溶け出し、骨密度の低下や骨粗しょう症につながりやすい。',
    effectTags: ['骨・歯の材料', '筋肉の収縮', '神経伝達'],
    deficiencyTags: ['骨密度低下', '骨粗しょう症リスク'],
  },
  {
    key: 'iron_mg_per_100g',
    label: '鉄',
    unit: 'mg',
    effect: '赤血球（ヘモグロビン）の材料として、全身に酸素を運ぶ役割を持つ。',
    deficiency: '不足すると酸素が運ばれにくくなり、疲れやすさ・立ちくらみ・冷えなど鉄欠乏性貧血の症状につながりやすい。',
    effectTags: ['赤血球の材料', '酸素運搬'],
    deficiencyTags: ['貧血', '疲れやすさ', '立ちくらみ', '冷え'],
  },
  {
    key: 'zinc_mg_per_100g',
    label: '亜鉛',
    unit: 'mg',
    effect: '味覚を正常に保つほか、皮膚・粘膜の健康維持、免疫機能、多くの酵素の構成成分として働く。',
    deficiency: '不足すると味を感じにくくなったり、肌荒れ、感染症にかかりやすくなることがある。',
    effectTags: ['味覚維持', '皮膚・粘膜の健康', '免疫維持'],
    deficiencyTags: ['味覚障害', '肌荒れ', '感染症にかかりやすい'],
  },
  {
    key: 'potassium_mg_per_100g',
    label: 'カリウム',
    unit: 'mg',
    effect: '細胞内の水分バランスを調整し、ナトリウムとのバランスで血圧を正常に保つ働きがある。',
    deficiency: '不足するとむくみや血圧の上昇、脱力感につながることがある。',
    effectTags: ['水分バランス調整', '血圧を正常に保つ'],
    deficiencyTags: ['むくみ', '血圧上昇', '脱力感'],
  },
  {
    key: 'vitamin_b6_mg_per_100g',
    label: 'ビタミンB6',
    unit: 'mg',
    effect: 'たんぱく質の分解・合成を助ける。皮膚や粘膜の健康維持、神経伝達物質の合成にも関わる。',
    deficiency: '不足すると肌荒れや口内炎、貧血、神経の不調（イライラ・集中力低下）につながることがある。',
    effectTags: ['たんぱく質代謝を助ける', '皮膚・粘膜の健康'],
    deficiencyTags: ['肌荒れ', '口内炎', '貧血', 'イライラ'],
  },
  {
    key: 'vitamin_b12_ug_per_100g',
    label: 'ビタミンB12',
    unit: 'µg',
    effect: '赤血球の生成を助け、神経の働きを正常に保つ。葉酸と協力して働く。',
    deficiency: '不足すると貧血（悪性貧血）や手足のしびれ、記憶力の低下につながることがある。植物性食品にはほぼ含まれない。',
    effectTags: ['赤血球の生成', '神経機能の維持'],
    deficiencyTags: ['貧血', '手足のしびれ', '記憶力低下'],
  },
  {
    key: 'folate_ug_per_100g',
    label: '葉酸',
    unit: 'µg',
    effect: '赤血球の生成やDNAの合成を助ける。細胞分裂が盛んな妊娠期には特に重要とされる。',
    deficiency: '不足すると貧血（巨赤芽球性貧血）につながることがある。妊娠を考える時期は不足に注意。',
    effectTags: ['赤血球の生成', 'DNA合成'],
    deficiencyTags: ['貧血', '妊娠期は特に注意'],
  },
  {
    key: 'magnesium_mg_per_100g',
    label: 'マグネシウム',
    unit: 'mg',
    effect: '骨の形成を助けるほか、筋肉の収縮・弛緩、神経の興奮を調整する多くの酵素の働きに関わる。',
    deficiency: '不足すると筋肉のけいれん（こむら返り）、疲労感、不整脈につながることがある。',
    effectTags: ['骨の形成', '筋肉の収縮・弛緩', '神経の調整'],
    deficiencyTags: ['こむら返り', '疲労感', '不整脈'],
  },
];

// key から NutrientInfo を引くヘルパー
export function getNutrientInfo(key: keyof IngredientMaster) {
  return NUTRIENT_INFO_LIST.find((n) => n.key === key) ?? null;
}

