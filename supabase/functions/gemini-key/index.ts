// supabase/functions/gemini-key/index.ts
// 自分のGemini APIキーを「確認・登録・削除」する。
// キーそのものは絶対に返さない(登録済みかどうかだけ返す)。
//   POST { action: "status" }                → { ok, has_key }
//   POST { action: "save", api_key: "..." }  → キーを検証してから保存
//   POST { action: "delete" }                → 削除

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
const fail = (code: string, message: string) => json({ ok: false, code, message });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD", message: "POSTで呼んでください" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが必要です" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return fail("NOT_CONFIGURED", "サーバーの設定が不足しています");

  // 呼んだ人の確認
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, code: "UNAUTHORIZED", message: "ログインが無効です" }, 401);
  }
  const userId = userData.user.id;

  // 家庭メンバーだけが使える(RLSで自分の所属が見えるかで判定)
  const { data: member, error: memErr } = await userClient
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .limit(1);
  if (memErr || !member || member.length === 0) {
    return json({ ok: false, code: "FORBIDDEN", message: "この家庭のメンバーではありません" }, 403);
  }

  const admin = createClient(url, serviceKey);

  let body: { action?: string; api_key?: string };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "リクエストの形式が正しくありません");
  }

  if (body.action === "status") {
    const { data, error } = await admin
      .from("user_gemini_keys")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return fail("DB_ERROR", error.message);
    return json({ ok: true, has_key: !!data });
  }

  if (body.action === "delete") {
    const { error } = await admin.from("user_gemini_keys").delete().eq("user_id", userId);
    if (error) return fail("DB_ERROR", error.message);
    return json({ ok: true, has_key: false });
  }

  if (body.action === "save") {
    const key = (body.api_key ?? "").trim();
    // 形のざっくりチェック(貼り付けミス・全角・改行の混入を防ぐ)。
    // キーには英数字・_・-・. が使われる(新形式の「AQ.」で始まるキーは . を含む)
    if (!/^[A-Za-z0-9_.\-]{20,200}$/.test(key)) {
      return fail("BAD_KEY_FORMAT", "キーの形式が正しくありません。コピーし直してください(前後の空白・改行・全角は入れないでください)");
    }

    // 保存前に、実際にGeminiで使えるかを軽く確認(モデル一覧の取得。生成はしないので枠をほぼ使わない)
    let check: Response;
    try {
      check = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": key },
      });
    } catch (e) {
      return fail("NETWORK", `Googleに接続できませんでした: ${(e as Error).message}`);
    }
    if (check.status === 400 || check.status === 401 || check.status === 403) {
      return fail("BAD_API_KEY", "このキーはGeminiで使えませんでした。AI Studioで作ったキーか確認してください");
    }
    if (!check.ok && check.status !== 429) {
      return fail("CHECK_FAILED", `キーの確認に失敗しました(${check.status})。少し待ってからもう一度お試しください`);
    }

    const { error } = await admin
      .from("user_gemini_keys")
      .upsert({ user_id: userId, api_key: key, updated_at: new Date().toISOString() });
    if (error) return fail("DB_ERROR", error.message);
    return json({ ok: true, has_key: true });
  }

  return fail("BAD_ACTION", "action は status / save / delete のどれかです");
});
