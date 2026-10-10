// supabase/functions/analyze-menu/index.ts（新規作成）
// 献立の分析で「足りない栄養素」を補う提案を、AIに短く書いてもらう（保存はしない）
//   ・数値の計算はアプリ側で済ませてあり、ここには「料理名・足りない栄養素・とりすぎの栄養素」だけを渡す
//   ・回答は「まとめ1文」と「栄養素ごとのひとこと（最大4つ）」。細かい数値は出さない
// 必要なSecrets: GEMINI_MODEL（モデル名。全員共通）
// APIキーは、呼んだ人が設定画面で登録したもの（user_gemini_keys）を使う。

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(code: string, message: string) {
  return json({ ok: false, code, message });
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nutrient: { type: "STRING" }, advice: { type: "STRING" } },
        required: ["nutrient", "advice"],
      },
    },
  },
  required: ["summary", "items"],
};

const SYSTEM_PROMPT = `あなたは、日本の家庭の献立づくりを手伝うアシスタントです。
渡された献立(料理名・食事回数・主食)と、足りない栄養素・とりすぎの栄養素をもとに、
次の献立で取り入れやすい工夫を、やさしい日本語で短く提案してください。

# ルール
- summary は、献立全体のひとこと(40文字程度まで)。
- items は、足りない栄養素(「不足」を優先)ととりすぎの栄養素について、最大4つ。advice は1〜2文(60文字程度まで)。
- 具体的な食材・料理・調理の工夫(例:副菜にほうれん草のおひたしを足す、汁物を具だくさんにする)を書く。
- 数値(mg・g・%など)は書かない。病気の診断・治療・サプリメントの勧めはしない。
- 足りない栄養素ととりすぎの栄養素が無いときは、items を空にして、summary でよい点を伝える。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD", message: "POSTで呼んでください" }, 405);

  const model = Deno.env.get("GEMINI_MODEL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!model || !serviceKey) return fail("NOT_CONFIGURED", "サーバーの設定(GEMINI_MODEL など)が未登録です");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが必要です" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが無効です" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const { data: keyRow, error: keyErr } = await admin
    .from("user_gemini_keys")
    .select("api_key")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (keyErr) return fail("DB_ERROR", `キーを読めませんでした: ${keyErr.message}`);
  if (!keyRow?.api_key) return fail("NO_API_KEY", "Gemini APIキーが未登録です。設定画面で、自分のキーを登録してください");
  const apiKey: string = keyRow.api_key;

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "リクエストの形式が正しくありません");
  }
  const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const input = {
    meals: Math.max(0, Math.min(50, Math.round(Number(body?.meals) || 0))),
    people: Math.max(1, Math.min(20, Math.round(Number(body?.people) || 1))),
    // deno-lint-ignore no-explicit-any
    dishes: (Array.isArray(body?.dishes) ? body.dishes : []).slice(0, 40).map((d: any) => ({
      name: str(d?.name, 60),
      category: str(d?.category, 20),
    })),
    staples: (Array.isArray(body?.staples) ? body.staples : []).slice(0, 50).map((s: unknown) => str(s, 30)),
    // deno-lint-ignore no-explicit-any
    shortages: (Array.isArray(body?.shortages) ? body.shortages : []).slice(0, 20).map((s: any) => ({
      nutrient: str(s?.nutrient, 20),
      level: str(s?.level, 10),
    })),
    excess: (Array.isArray(body?.excess) ? body.excess : []).slice(0, 20).map((s: unknown) => str(s, 20)),
  };
  if (input.dishes.length === 0) return fail("EMPTY", "分析する料理がありません");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `次の献立について提案してください。\n\n${JSON.stringify(input)}` }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema },
      }),
    },
  ).catch((e) => e as Error);
  if (res instanceof Error) return fail("NETWORK", `AIに接続できませんでした: ${res.message}`);
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
    console.error("Gemini error", res.status, (await res.text()).slice(0, 300));
    return fail("AI_ERROR", `AIの呼び出しに失敗しました(${res.status})`);
  }

  const gem = await res.json();
  const raw = (gem?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("BAD_JSON", "AIの結果を読み取れませんでした。もう一度お試しください");
  }
  const advice = {
    summary: str(parsed?.summary, 120),
    // deno-lint-ignore no-explicit-any
    items: (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 4).map((i: any) => ({
      nutrient: str(i?.nutrient, 20),
      advice: str(i?.advice, 160),
    })).filter((i: { nutrient: string; advice: string }) => i.nutrient && i.advice),
  };
  return json({ ok: true, advice });
});
