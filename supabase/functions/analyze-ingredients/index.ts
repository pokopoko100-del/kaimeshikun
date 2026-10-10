// supabase/functions/analyze-ingredients/index.ts
// 材料の「栄養素・カロリー・価格・旬・単位(1単位が何gか)」をAIで推定して返す(保存はしない)。
// レシピ取り込みで、材料マスタに無い材料を登録するときに使う。
//   items         : 新しく登録する材料（名前と、レシピでの使い方）
//   unit_requests : すでにある材料に、単位を1つ足したいとき（「鶏もも肉 1枚」の「枚」が何gか、など）
// 必要なSecrets: GEMINI_MODEL（モデル名。全員共通）
// APIキーは、呼んだ人が設定画面で登録したもの（user_gemini_keys）を使う。

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORIES = ["野菜", "肉", "魚介", "乳製品・卵", "調味料", "穀物・麺", "その他", "日用品"] as const;

// 材料マスタの列名・表示名・入力できる最大値(超えたら空欄にして警告)
const NUTRIENTS = [
  { col: "calorie_per_100g", label: "カロリー", max: 950 },
  { col: "protein_g_per_100g", label: "たんぱく質", max: 100 },
  { col: "fat_g_per_100g", label: "脂質", max: 100 },
  { col: "carbohydrate_g_per_100g", label: "炭水化物", max: 100 },
  { col: "sugar_g_per_100g", label: "糖質", max: 100 },
  { col: "dietary_fiber_g_per_100g", label: "食物繊維", max: 100 },
  { col: "salt_g_per_100g", label: "食塩相当量", max: 100 },
  { col: "vitamin_a_ug_per_100g", label: "ビタミンA", max: 30000 },
  { col: "vitamin_b1_mg_per_100g", label: "ビタミンB1", max: 50 },
  { col: "vitamin_b2_mg_per_100g", label: "ビタミンB2", max: 50 },
  { col: "vitamin_b6_mg_per_100g", label: "ビタミンB6", max: 50 },
  { col: "vitamin_b12_ug_per_100g", label: "ビタミンB12", max: 200 },
  { col: "vitamin_c_mg_per_100g", label: "ビタミンC", max: 2000 },
  { col: "vitamin_d_ug_per_100g", label: "ビタミンD", max: 200 },
  { col: "vitamin_e_mg_per_100g", label: "ビタミンE", max: 200 },
  { col: "folate_ug_per_100g", label: "葉酸", max: 5000 },
  { col: "calcium_mg_per_100g", label: "カルシウム", max: 3000 },
  { col: "iron_mg_per_100g", label: "鉄", max: 200 },
  { col: "zinc_mg_per_100g", label: "亜鉛", max: 200 },
  { col: "potassium_mg_per_100g", label: "カリウム", max: 10000 },
  { col: "magnesium_mg_per_100g", label: "マグネシウム", max: 3000 },
] as const;

// 容量の単位 → ml 換算（大さじ=15ml、小さじ=5ml、1ml=1cc）
const VOLUME_ML: Record<string, number> = { "大さじ": 15, "小さじ": 5, "ml": 1, "cc": 1 };

const MAX_ITEMS = 30;
const MAX_UNIT_REQUESTS = 30;

type ReqItem = { key: string; name: string; usages: { quantity: string; unit: string }[] };
type ReqUnit = { key: string; master_name: string; unit: string; quantity: string };

// ---------- 共通の返し方 ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function fail(code: string, message: string) {
  return json({ ok: false, code, message });
}

// ---------- 数値・単位の整え方 ----------
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).normalize("NFKC"));
  return Number.isFinite(n) ? n : null;
}
function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function unitName(u: unknown): string {
  return String(u ?? "").normalize("NFKC").trim();
}
function isGram(u: string): boolean {
  return ["g", "グラム", "gram", "grams"].includes(u.toLowerCase());
}
// 容量の単位なら、決まった表記（大さじ / 小さじ / ml / cc）を返す
function volKey(u: string): string | null {
  const n = u.normalize("NFKC").trim().toLowerCase();
  return Object.hasOwn(VOLUME_ML, n) ? n : null;
}
function validWeight(v: unknown): number | null {
  const n = toNum(v);
  return n !== null && n > 0 && n <= 5000 ? round(n, 1) : null;
}

// ---------- Gemini に渡すスキーマ ----------
// 栄養素と価格は「必須の数値」にして、AIが null（不明）で逃げられないようにする
const nutrientProps = Object.fromEntries(
  NUTRIENTS.map((n) => [n.col, { type: "NUMBER" }]),
);

const responseSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING" },
          category: { type: "STRING", enum: [...CATEGORIES] },
          price_per_100g: { type: "NUMBER" },
          peak_season_months: { type: "ARRAY", items: { type: "INTEGER" } },
          default_unit: { type: "STRING" },
          units: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                unit: { type: "STRING" },
                weight_g: { type: "NUMBER", nullable: true },
              },
              required: ["unit"],
            },
          },
          ...nutrientProps,
        },
        required: [
          "key",
          "category",
          "price_per_100g",
          "peak_season_months",
          "default_unit",
          "units",
          ...NUTRIENTS.map((n) => n.col),
        ],
      },
    },
    unit_results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING" },
          weight_g: { type: "NUMBER", nullable: true },
        },
        required: ["key"],
      },
    },
  },
  required: ["items", "unit_results"],
};

const SYSTEM_PROMPT = `あなたは、日本の家庭向け料理アプリの「食材データ作成」担当です。
渡された食材ごとに、栄養・価格・単位の目安を、指定のJSONスキーマで出力してください。

# 栄養素(すべて「その食材100gあたり」。21項目すべてに、必ず数値を入れる)
- 日本食品標準成分表(八訂)の値を基準に、近い食材の値から推定して答える。生鮮食品は「生」、調味料や加工品は市販の一般的なもの。
- 成分表で「Tr(微量)」「-(未測定)」の項目や、含まれないはずの項目は 0 を入れる。分からないからといって、空にしない。
- 正確な値が分からないときは、同じ種類の食材(例:ハム→ロースハム、しょうが→しょうが生、きのこ→しいたけ)の値を参考に、もっともらしい値を入れる。目安でよい。
- 単位:calorie=kcal / protein・fat・carbohydrate・sugar・dietary_fiber・salt=g / vitamin_a=µg(レチノール活性当量) / vitamin_b1・b2・b6・c・e=mg / vitamin_b12・d・folate=µg / calcium・iron・zinc・potassium・magnesium=mg
- sugar は糖質(炭水化物から食物繊維を引いた値)。salt は食塩相当量(ナトリウムmg×2.54÷1000)。
- たんぱく質+脂質+炭水化物は100gを超えない。糖質と食物繊維は炭水化物を超えない。カロリーは、たんぱく質×4+脂質×9+炭水化物(食物繊維を除く)×4 の近くにする。
- 水・お茶・塩など、栄養がほぼ無い食材は、全項目 0 に近い値でよい。

# 価格(必ず数値を入れる)
- price_per_100g は、日本のスーパーでの一般的な価格を、100gあたりの円(整数)で推定する。必ず1以上の数値を入れる。
- 液体・調味料は「容量あたりの価格 ÷ 重さ」で100gあたりに換算する(例:醤油1L約400円・約1.2kg → 約33円)。
- 1個・1本・1パックで売られる食材は、1個あたりの価格 ÷ 重さ(g) × 100 で換算する。
- 分からないときも、近い食材から推定した値を入れる(0や空にしない)。

# 旬
- peak_season_months は、日本で旬の月(1〜12の整数)。通年出回るもの・加工品・調味料は空の配列。

# 単位(units)
- 「1単位が何gか」の表。g は書かない(g は常に1g)。
- usages(レシピでの使い方)に出てくる単位は、必ず units に含める。
- 液体・粉・調味料は、大さじ・小さじも含める(大さじ=15ml、小さじ=5ml、1ml=1cc。重さは密度から)。
- 数えられる食材は、個・枚・本・片など、買い物や調理で使う単位を含める(例:鶏もも肉1枚=約250g)。
- 重さは、日本の一般的なサイズの目安。usages の分量と矛盾しないこと。
- default_unit は、units の中から、いちばん使いやすい単位を1つ。units が空なら空文字。

# category
- 野菜 / 肉 / 魚介 / 乳製品・卵 / 調味料 / 穀物・麺 / その他 / 日用品 から1つ。

# 既存の材料に単位を足す依頼(unit_requests)
- master_name の材料について、指定の単位1つぶんが何gかを weight_g で答える。分からなければ null。

# その他
- items と unit_results の key は、入力の key をそのまま返す。入力の全件に答える。`;

// ---------- 1件ぶんの整形(AIの返事を鵜呑みにしない) ----------
// deno-lint-ignore no-explicit-any
function cleanItem(raw: any, req: ReqItem) {
  const warnings: string[] = [];

  const category = (CATEGORIES as readonly string[]).includes(raw?.category) ? raw.category : "その他";

  // 栄養素：範囲外は空欄にする
  const nutrients: Record<string, number | null> = {};
  for (const n of NUTRIENTS) {
    const v = toNum(raw?.[n.col]);
    if (v === null) {
      nutrients[n.col] = null;
    } else if (v < 0 || v > n.max) {
      nutrients[n.col] = null;
      warnings.push(`${n.label}の値(${v})が範囲外のため、空欄にしました`);
    } else {
      nutrients[n.col] = round(v, 2);
    }
  }
  const emptyCount = NUTRIENTS.filter((n) => nutrients[n.col] === null).length;
  if (emptyCount >= 5) warnings.push(`栄養素のうち${emptyCount}項目が空欄です。必要なら入力してください`);
  const p = nutrients.protein_g_per_100g;
  const f = nutrients.fat_g_per_100g;
  const c = nutrients.carbohydrate_g_per_100g;
  const sugar = nutrients.sugar_g_per_100g;
  const fiber = nutrients.dietary_fiber_g_per_100g;
  if (p !== null && f !== null && c !== null && p + f + c > 100.5) {
    warnings.push("たんぱく質・脂質・炭水化物の合計が100gを超えています。値を確認してください");
  }
  if (c !== null && sugar !== null && sugar > c + 0.01) {
    warnings.push("糖質が炭水化物より多くなっています。値を確認してください");
  }
  if (c !== null && fiber !== null && fiber > c + 0.01) {
    warnings.push("食物繊維が炭水化物より多くなっています。値を確認してください");
  }

  // 価格
  const priceRaw = toNum(raw?.price_per_100g);
  const price = priceRaw !== null && priceRaw > 0 && priceRaw <= 100000 ? Math.round(priceRaw) : null;
  if (price === null) warnings.push("価格をAIが推定できませんでした。入力してください");

  // 旬（12か月すべて・空は通年として扱う）
  const months = [
    ...new Set(
      (Array.isArray(raw?.peak_season_months) ? raw.peak_season_months : [])
        .map((m: unknown) => toNum(m))
        .filter((m: number | null): m is number => m !== null && Number.isInteger(m) && m >= 1 && m <= 12),
    ),
  ].sort((a, b) => (a as number) - (b as number)) as number[];
  const peak = months.length === 0 || months.length === 12 ? [] : months;

  // 単位
  const seen = new Set<string>();
  const units: { unit: string; weight_g: number | null }[] = [];
  for (const u of Array.isArray(raw?.units) ? raw.units : []) {
    let name = unitName(u?.unit);
    if (!name || isGram(name) || name.length > 10) continue;
    const vk = volKey(name);
    if (vk) name = vk;
    if (seen.has(name)) continue;
    seen.add(name);
    units.push({ unit: name, weight_g: validWeight(u?.weight_g) });
    if (units.length >= 8) break;
  }

  // 容量の単位が1つでも分かれば、同じ密度で、足りない容量単位（大さじ・小さじ・ml・cc）を補う
  const baseVol = units.find((u) => volKey(u.unit) !== null && u.weight_g !== null);
  if (baseVol) {
    const density = (baseVol.weight_g as number) / VOLUME_ML[baseVol.unit];
    for (const k of ["大さじ", "小さじ", "ml", "cc"]) {
      if (seen.has(k)) continue;
      const w = validWeight(density * VOLUME_ML[k]);
      seen.add(k);
      units.push({ unit: k, weight_g: w });
    }
  }

  // レシピで使われている単位が無ければ、重さ空欄の行を足して、入力してもらう
  const usageUnits: string[] = [];
  for (const us of req.usages) {
    let name = unitName(us.unit);
    if (!name || isGram(name)) continue;
    const vk = volKey(name);
    if (vk) name = vk;
    if (!usageUnits.includes(name)) usageUnits.push(name);
    if (!seen.has(name)) {
      seen.add(name);
      units.push({ unit: name, weight_g: null });
      warnings.push(`「${name}」の重さ(g)をAIが出せませんでした。入力してください`);
    }
  }

  // 基準の単位：AIの指定 → レシピで使う単位 → 先頭、の順に、重さが入っているものを選ぶ
  const aiDefault = (() => {
    const n = unitName(raw?.default_unit);
    return volKey(n) ?? n;
  })();
  const candidates = [aiDefault, ...usageUnits, ...units.map((u) => u.unit)];
  let defUnit = candidates.find((name) => units.some((u) => u.unit === name && u.weight_g !== null));
  if (!defUnit && units.length > 0) defUnit = units[0].unit;

  return {
    key: req.key,
    ai_ok: true,
    category,
    price_per_100g: price,
    peak_season_months: peak,
    units: units.map((u) => ({ unit: u.unit, weight_g: u.weight_g, is_default: u.unit === defUnit })),
    nutrients,
    warnings,
  };
}

// ---------- メイン ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD", message: "POSTで呼んでください" }, 405);

  const model = Deno.env.get("GEMINI_MODEL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!model || !serviceKey) {
    return fail("NOT_CONFIGURED", "サーバーの設定(GEMINI_MODEL など)が未登録です");
  }

  // --- ログイン確認 ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが必要です" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが無効です" }, 401);
  }

  // --- 呼んだ人自身のGeminiキーを取得 ---
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const { data: keyRow, error: keyErr } = await admin
    .from("user_gemini_keys")
    .select("api_key")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (keyErr) return fail("DB_ERROR", `キーを読めませんでした: ${keyErr.message}`);
  if (!keyRow?.api_key) {
    return fail("NO_API_KEY", "Gemini APIキーが未登録です。設定画面で、自分のキーを登録してください");
  }
  const apiKey: string = keyRow.api_key;

  // --- 入力チェック ---
  let body: { recipe_name?: string; items?: unknown; unit_requests?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "リクエストの形式が正しくありません");
  }

  const items: ReqItem[] = (Array.isArray(body.items) ? body.items : [])
    // deno-lint-ignore no-explicit-any
    .map((x: any) => ({
      key: String(x?.key ?? "").slice(0, 100),
      name: String(x?.name ?? "").trim().slice(0, 60),
      usages: (Array.isArray(x?.usages) ? x.usages : []).slice(0, 5).map(
        // deno-lint-ignore no-explicit-any
        (u: any) => ({ quantity: String(u?.quantity ?? "").slice(0, 20), unit: String(u?.unit ?? "").slice(0, 20) }),
      ),
    }))
    .filter((x: ReqItem) => x.key && x.name);
  const unitReqs: ReqUnit[] = (Array.isArray(body.unit_requests) ? body.unit_requests : [])
    // deno-lint-ignore no-explicit-any
    .map((x: any) => ({
      key: String(x?.key ?? "").slice(0, 100),
      master_name: String(x?.master_name ?? "").trim().slice(0, 60),
      unit: unitName(x?.unit).slice(0, 10),
      quantity: String(x?.quantity ?? "").slice(0, 20),
    }))
    .filter((x: ReqUnit) => x.key && x.master_name && x.unit);

  if (items.length === 0 && unitReqs.length === 0) return fail("EMPTY", "分析する材料がありません");
  if (items.length > MAX_ITEMS || unitReqs.length > MAX_UNIT_REQUESTS) {
    return fail("TOO_MANY", `一度に分析できる材料は${MAX_ITEMS}件までです`);
  }

  // --- Gemini 呼び出し ---
  const userText = JSON.stringify(
    {
      recipe_name: String(body.recipe_name ?? "").slice(0, 100),
      items,
      unit_requests: unitReqs,
    },
    null,
    1,
  );

  const geminiBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `次の食材について答えてください。\n\n${userText}` }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(geminiBody),
    });
  } catch (e) {
    return fail("NETWORK", `AIに接続できませんでした: ${(e as Error).message}`);
  }

  if (res.status === 429) {
    return fail("RATE_LIMIT", "あなたのキーの、本日(または今の1分間)の上限に達しました。少し待つか、明日もう一度お試しください");
  }
  if (res.status === 400 || res.status === 403) {
    const t = (await res.clone().text()).slice(0, 400);
    if (/API key|API_KEY|PERMISSION_DENIED/i.test(t)) {
      return fail("BAD_API_KEY", "登録されたAPIキーが使えませんでした。設定画面でキーを入れ直してください");
    }
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error("Gemini error", res.status, detail);
    return fail("AI_ERROR", `AIの呼び出しに失敗しました(${res.status})`);
  }

  const gem = await res.json();
  if (gem?.promptFeedback?.blockReason) {
    return fail("BLOCKED", "入力の内容がAIに受け付けられませんでした");
  }
  const raw = (gem?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!raw) return fail("EMPTY_RESPONSE", "AIから結果が返りませんでした。もう一度お試しください");

  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("BAD_JSON", "AIの結果を読み取れませんでした(出力が途中で切れた可能性があります)。もう一度お試しください");
  }

  // --- 後処理 ---
  // deno-lint-ignore no-explicit-any
  const rawItems = new Map<string, any>();
  for (const it of Array.isArray(parsed?.items) ? parsed.items : []) {
    if (it && typeof it.key === "string") rawItems.set(it.key, it);
  }
  // deno-lint-ignore no-explicit-any
  const rawUnits = new Map<string, any>();
  for (const it of Array.isArray(parsed?.unit_results) ? parsed.unit_results : []) {
    if (it && typeof it.key === "string") rawUnits.set(it.key, it);
  }

  const outItems = items.map((req) => {
    const r = rawItems.get(req.key);
    if (!r) {
      return { key: req.key, ai_ok: false, warnings: [`「${req.name}」はAIが結果を返しませんでした。手で入力してください`] };
    }
    return cleanItem(r, req);
  });

  const outUnits = unitReqs.map((req) => {
    const r = rawUnits.get(req.key);
    const w = r ? validWeight(r.weight_g) : null;
    return { key: req.key, ai_ok: w !== null, weight_g: w };
  });

  return json({ ok: true, items: outItems, unit_results: outUnits });
});
