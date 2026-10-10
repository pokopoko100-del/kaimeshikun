// 使い方(PowerShell。VS Codeのターミナルで、プロジェクトのフォルダにて):
//   $env:SUPABASE_URL="https://fgtzpdtmziiblpirlzxm.supabase.co"
//   $env:SUPABASE_KEY="(Publishable key)"
//   node test-analyze.mjs 自分のメール 自分のパスワード [自分のGeminiキー]
// 3つ目にキーを付けると、先にそのキーを自分のアカウントに登録します(登録済みなら省略可)。
// レシピは保存しません(解析結果を表示するだけ)。
import { createClient } from "@supabase/supabase-js";

const [email, password, geminiKey] = process.argv.slice(2);
if (!email || !password) {
  console.log("使い方: node test-analyze.mjs メール パスワード [Geminiキー]");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
if (signErr) { console.error("ログイン失敗:", signErr.message); process.exit(1); }

if (geminiKey) {
  const { data: k, error: kErr } = await supabase.functions.invoke("gemini-key", {
    body: { action: "save", api_key: geminiKey },
  });
  console.log("キー登録:", kErr ? kErr.message : JSON.stringify(k));
  if (kErr || !k?.ok) process.exit(1);
}

const sampleText = `鶏の照り焼き(2人前)
【材料】鶏もも肉 1枚(300g) / 醤油 大さじ2 / みりん 大さじ2 / 砂糖 小さじ1 / 酒 大さじ1 / サラダ油 少々
【作り方】
1. 鶏肉は余分な脂を取り、フォークで穴をあける。
2. フライパンに油を熱し、皮目から中火で5分焼く。
3. 裏返して3分焼いたら、醤油・みりん・砂糖・酒を混ぜたたれを加えて煮詰める。
ポイント:たれは最後に強火で一気に煮詰めると照りが出る。`;

const { data, error } = await supabase.functions.invoke("analyze-recipe", {
  body: { source: "text", text: sampleText },
});
if (error) {
  console.error("呼び出し失敗:", error.message);
  if (error.context?.text) console.error(await error.context.text());
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
