// supabase/functions/analyze-recipe/index.ts
// 写真・テキストからレシピを解析して、プレビュー用のJSONを返す(保存はしない)。
// 必要なSecrets: GEMINI_MODEL(モデル名。全員共通)
// APIキーは「呼んだ人」ごとに user_gemini_keys テーブルから読む(各自が自分のキーを登録)。
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡す。

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENRES = ["和食", "洋食", "中華", "エスニック", "その他"] as const;
const CATEGORIES = [
  "主菜",
  "副菜・つまみ",
  "汁物・スープ",
  "麺・丼・ワンプレート",
  "デザート",
  "ソース・調味料",
] as const;

const MAX_TEXT_CHARS = 20000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_CHARS = 5_000_000; // 約3.7MB。端末側で1280px/JPEG80%に圧縮済みの想定
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const SKIP_QTY = ["少々", "適量", "適宜", "ひとつまみ", "少量", "お好みで", "お好み"];

type MasterRow = {
  id: string;
  ingredient_name: string;
  category: string;
  ingredient_units: { unit: string; weight_g: number; is_default: boolean }[];
};

// ---------- 共通の返し方 ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
// 想定内のエラーは 200 で返す(ブラウザ側で中身を読みやすくするため)
function fail(code: string, message: string) {
  return json({ ok: false, code, message });
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

function normUnit(u: string): string {
  const n = (u ?? "").normalize("NFKC").trim();
  if (["g", "gram", "グラム", "ｇ"].includes(n.toLowerCase())) return "g";
  return n;
}

function isNumericQty(q: string): boolean {
  const n = q.normalize("NFKC").trim();
  return /^\d+(\.\d+)?$/.test(n) || /^\d+\/\d+$/.test(n);
}

// 工程の本文の角かっこを整える。
// アプリは [A] のような「英大文字1文字」だけをグループ記号のバッジにする。
// それ以外の [サラダ油] などは、角かっこを外して中身だけ残す。
function cleanBrackets(text: string | null | undefined): string {
  return String(text ?? "").replace(/[\[［]([^\]］]*)[\]］]/g, (_m, inner: string) => {
    const t = inner.normalize("NFKC").trim();
    return /^[A-Z]$/.test(t) ? `[${t}]` : inner;
  });
}

// ---------- Gemini に渡すスキーマ ----------
const responseSchema = {
  type: "OBJECT",
  properties: {
    dish_name: { type: "STRING" },
    source_name: { type: "STRING", nullable: true },
    genre: { type: "STRING", enum: [...GENRES] },
    category: { type: "STRING", enum: [...CATEGORIES] },
    servings: { type: "INTEGER" },
    cooking_time_minutes: { type: "INTEGER", nullable: true },
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          step_number: { type: "INTEGER" },
          step_name: { type: "STRING" },
          description: { type: "STRING" },
          tip: { type: "STRING", nullable: true },
        },
        required: ["step_number", "step_name", "description"],
      },
    },
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ingredient_name: { type: "STRING" },
          master_name: { type: "STRING", nullable: true },
          quantity: { type: "STRING" },
          unit: { type: "STRING" },
          preparation: { type: "STRING", nullable: true },
          step_number: { type: "INTEGER", nullable: true },
          group_label: { type: "STRING", nullable: true },
        },
        required: ["ingredient_name", "quantity", "unit"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "dish_name",
    "genre",
    "category",
    "servings",
    "steps",
    "ingredients",
    "warnings",
  ],
};

function buildSystemPrompt(masterLines: string): string {
  return `あなたは家庭向けレシピ管理アプリの、レシピ抽出担当です。
入力(画像またはテキスト)に書かれたレシピを、指定のJSONスキーマで出力してください。

# 基本ルール
- 入力に書かれていない情報を作らない。読み取れない・書かれていない項目は null か空にし、warnings に理由を書く。
- 文章は原文の言葉をできるだけそのまま使う。言い換えたり、材料名を勝手に詳しくしたりしない(例:原文が「油」なら「油」のまま。「サラダ油」にしない)。
- dish_name は料理名のみ(「簡単!」などの装飾は除く)。
- servings は入力に書かれた人数(○人前・○人分)をそのまま整数で。換算しない。書かれていなければ 2 にして warnings に書く。
- genre は ${GENRES.join(" / ")} から1つ。category は ${CATEGORIES.join(" / ")} から1つ。
- source_name は、投稿者・著者・店名など作った人が分かるときだけ。分からなければ null。
- cooking_time_minutes は料理全体の調理時間が書かれているときだけ整数で。無ければ null。

# 材料
- ingredient_name は入力に書かれた名前。master_name は下の「材料マスタ」の名前と完全一致するものがあるときだけ入れる。似ているだけ・無いときは null(無理に合わせない)。
- quantity は半角数字だけの文字列にする(例:"2" "0.5" "1/2")。「1と1/2」は "1.5"、「2〜3」は中間の "2.5" にして warnings に書く。
- 「少々」「適量」「適宜」「ひとつまみ」はそのまま quantity に入れ、unit は空文字。
- unit は単位だけ(例:"g" "大さじ" "小さじ" "個" "ml")。「大さじ1」は quantity="1", unit="大さじ"。マスタに該当材料があるときは、その材料の単位の中から選ぶ。合う単位が無いときは書かれたままの単位にする。
- 「A:」「Aの材料」のようにまとめて書かれた材料は group_label="A"(B, C...も同様)。それ以外は null。
- preparation は「みじん切り」「皮をむく」などの下ごしらえ。無ければ null。
- step_number は、その材料を最初に使う工程の番号。判断できなければ null。

# 工程
- step_number は 1 から連番。step_name は短い見出し(例:「下ごしらえ」「炒める」)。description は本文。
- 本文は原文のまま。材料名を [ ] で囲んではいけない。
- [ ] を使ってよいのは、グループ記号を指すときだけ。アルファベット大文字1文字に限る(例:[A] [B])。それ以外の言葉には [ ] を付けない。
- tip は「ポイント」「コツ」と書かれているときだけ。無ければ null。

# warnings
- 画像が不鮮明、分量が読めない、人数が不明、範囲を中間値にした、などユーザーが確認すべき点を日本語の短い文で。

# 材料マスタ(「材料名 | 使える単位」)
${masterLines}`;
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

  // --- ログイン確認(呼んだ人のJWTでDBを読む → RLSがそのまま効く) ---
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

  // --- 呼んだ人自身のGeminiキーを取得(サービスロールで読む。キーは画面には返さない) ---
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
  let body: {
    source?: string;
    text?: string;
    images?: { mime: string; data: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "リクエストの形式が正しくありません");
  }

  const text = (body.text ?? "").trim();
  const images = body.images ?? [];

  if (!text && images.length === 0) return fail("EMPTY", "テキストか画像を入れてください");
  if (text.length > MAX_TEXT_CHARS) return fail("TOO_LONG", `テキストが長すぎます(${MAX_TEXT_CHARS}文字まで)`);
  if (images.length > MAX_IMAGES) return fail("TOO_MANY_IMAGES", `画像は${MAX_IMAGES}枚までです`);
  for (const img of images) {
    if (!ALLOWED_MIME.includes(img.mime)) return fail("BAD_IMAGE", "画像は JPEG / PNG / WebP だけ使えます");
    if (!img.data || img.data.length > MAX_IMAGE_BASE64_CHARS) {
      return fail("IMAGE_TOO_LARGE", "画像が大きすぎます。小さくしてからもう一度お試しください");
    }
  }

  // --- 材料マスタ(名前+単位)を取得 ---
  const { data: masterData, error: masterErr } = await supabase
    .from("ingredient_master")
    .select("id, ingredient_name, category, ingredient_units(unit, weight_g, is_default)")
    .order("category")
    .order("ingredient_name");
  if (masterErr) return fail("DB_ERROR", `材料マスタを読めませんでした: ${masterErr.message}`);

  const masters = (masterData ?? []) as MasterRow[];
  const masterLines = masters
    .map((m) => {
      const units = [...(m.ingredient_units ?? [])]
        .sort((a, b) => Number(b.is_default) - Number(a.is_default))
        .map((u) => u.unit)
        .join(",");
      return `${m.ingredient_name} | ${units}`;
    })
    .join("\n");

  // --- Gemini 呼び出し ---
  const parts: Record<string, unknown>[] = [];
  parts.push({
    text: text
      ? `次の入力からレシピを抽出してください。\n\n${text}`
      : "添付の画像からレシピを抽出してください。",
  });
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }

  const geminiBody = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(masterLines) }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
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
    // 404=モデル名違い・提供終了、400/403=キー違い
    console.error("Gemini error", res.status, detail);
    return fail("AI_ERROR", `AIの呼び出しに失敗しました(${res.status})`);
  }

  const gem = await res.json();
  if (gem?.promptFeedback?.blockReason) {
    return fail("BLOCKED", "入力の内容がAIに受け付けられませんでした。別の写真・テキストでお試しください");
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

  // --- 後処理:マスタ照合・単位チェック(AIの返事を鵜呑みにしない) ---
  const byName = new Map<string, MasterRow>();
  for (const m of masters) byName.set(norm(m.ingredient_name), m);

  const warnings: string[] = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];

  const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).map(
    // deno-lint-ignore no-explicit-any
    (s: any, i: number) => ({
      step_number: Number.isInteger(s.step_number) ? s.step_number : i + 1,
      step_name: String(s.step_name ?? ""),
      description: cleanBrackets(s.description),
      tip: s.tip ? cleanBrackets(s.tip) : null,
    }),
  );
  const stepNumbers = new Set(steps.map((s: { step_number: number }) => s.step_number));

  const ingredients = (Array.isArray(parsed.ingredients) ? parsed.ingredients : []).map(
    // deno-lint-ignore no-explicit-any
    (ing: any, i: number) => {
      const name = String(ing.ingredient_name ?? "").trim();
      const quantity = String(ing.quantity ?? "").normalize("NFKC").trim();
      const unit = normUnit(String(ing.unit ?? ""));

      // マスタ照合:AIが選んだ名前 → 無ければ材料名そのもの
      let master: MasterRow | undefined;
      if (ing.master_name) master = byName.get(norm(String(ing.master_name)));
      if (!master && name) master = byName.get(norm(name));

      const availableUnits = master
        ? ["g", ...(master.ingredient_units ?? []).map((u) => u.unit).filter((u) => u !== "g")]
        : [];

      const isSkip = SKIP_QTY.some((w) => quantity.includes(w)) || quantity === "";
      let status: "ok" | "skip" | "no_master" | "unit_unknown" | "qty_unknown" = "ok";
      if (isSkip) status = "skip";
      else if (!master) status = "no_master";
      else if (!isNumericQty(quantity)) status = "qty_unknown";
      else if (!availableUnits.map(normUnit).includes(unit)) status = "unit_unknown";

      const stepNo = Number.isInteger(ing.step_number) && stepNumbers.has(ing.step_number)
        ? ing.step_number
        : null;
      const group = typeof ing.group_label === "string" && /^[A-Z]$/.test(ing.group_label.trim())
        ? ing.group_label.trim()
        : null;

      return {
        sort_order: i,
        ingredient_name: master ? master.ingredient_name : name,
        ingredient_master_id: master ? master.id : null,
        quantity,
        unit,
        preparation: ing.preparation ? String(ing.preparation) : null,
        step_number: stepNo,
        group_label: group,
        status,
        available_units: availableUnits,
      };
    },
  );

  const countOf = (s: string) =>
    ingredients.filter((x: { status: string }) => x.status === s).length;
  const noMaster = countOf("no_master");
  const unitUnknown = countOf("unit_unknown");
  const qtyUnknown = countOf("qty_unknown");
  if (noMaster > 0) warnings.push(`材料マスタに無い材料が${noMaster}件あります(このまま保存すると「未計算」になります)`);
  if (unitUnknown > 0) warnings.push(`単位がマスタの単位表に無い材料が${unitUnknown}件あります(単位を選び直してください)`);
  if (qtyUnknown > 0) warnings.push(`分量が数値でない材料が${qtyUnknown}件あります(「未計算」になります)`);
  if (ingredients.length === 0) warnings.push("材料が1件も読み取れませんでした");
  if (steps.length === 0) warnings.push("作り方が1件も読み取れませんでした");

  const recipe = {
    dish_name: String(parsed.dish_name ?? "").trim(),
    source_name: parsed.source_name ? String(parsed.source_name).trim() : null,
    genre: (GENRES as readonly string[]).includes(parsed.genre) ? parsed.genre : "その他",
    category: (CATEGORIES as readonly string[]).includes(parsed.category) ? parsed.category : "主菜",
    servings: Number.isInteger(parsed.servings) && parsed.servings > 0 ? parsed.servings : 2,
    cooking_time_minutes: Number.isInteger(parsed.cooking_time_minutes) ? parsed.cooking_time_minutes : null,
    registration_method: "ai",
    steps,
    ingredients,
  };

  return json({
    ok: true,
    recipe,
    warnings,
    summary: {
      ingredient_count: ingredients.length,
      no_master: noMaster,
      unit_unknown: unitUnknown,
      qty_unknown: qtyUnknown,
      step_count: steps.length,
    },
  });
});
