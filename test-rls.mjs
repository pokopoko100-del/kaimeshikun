/**
 * RLS(Row Level Security)の第三者アクセス拒否テスト用スクリプト
 *
 * 【使い方】
 * 1. このファイルを、かいめし君のReactプロジェクト直下(package.jsonがある場所)に置く
 *    (@supabase/supabase-js は既にプロジェクトにインストール済みのはずなので追加インストール不要)
 * 2. 下の「設定」部分を自分の情報で書き換える
 * 3. ターミナルでプロジェクトのフォルダに移動して実行
 *      node test-rls.mjs
 * 4. 結果を見て、判定欄を確認する
 *
 * 【テスト内容】
 * - テストA: 誰もログインしていない状態(anonキーのみ)でテーブルを見る
 * - テストB: household_membersに登録されていない「第三者ユーザー」でログインしてテーブルを見る
 * - テストC(任意・比較用): 正規メンバー(1人目)でログインして、自分の家庭データが見えるか確認
 * - テストD: 第三者ユーザーで、既存の買い物リストにデータをINSERTできるか試す
 *
 * 期待する結果(正常):
 * - テストA, B → 全テーブルで件数 0(空配列)
 * - テストC → 自分の家庭(我が家)のデータが件数 1以上で見える
 * - テストD → エラー、または影響件数 0
 */

import { createClient } from '@supabase/supabase-js';

// ========== 設定(ここを書き換える) ==========
const SUPABASE_URL = 'https://fgtzpdtmziiblpirlzxm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UbG6t7c5SgLq-zx2_iDitA_dj0_uOxT';

// ①で作った「第三者ユーザー」の情報
const OUTSIDER_EMAIL = 'rls-test@example.com';
const OUTSIDER_PASSWORD = 'pokemon';

// (任意・比較用)1人目の正規ユーザーの情報。わからなければ空のままでOK(テストCはスキップされる)
const OWNER_EMAIL = ''; // 例: 'pokopoko100@gmail.com'
const OWNER_PASSWORD = '';

// チェック対象テーブル
const TABLES = ['recipes', 'households', 'household_members', 'shopping_lists', 'shopping_items', 'ingredient_master'];
// ===============================================

function judge(label, count) {
  if (count === 0) {
    console.log(`  → 判定: OK ✅ (0件・見えない)`);
  } else {
    console.log(`  → 判定: NG ❌ (${count}件見えてしまっている。RLSが効いていない可能性)`);
  }
}

async function checkTables(client, label) {
  console.log(`\n--- ${label} ---`);
  for (const table of TABLES) {
    const { data, error } = await client.from(table).select('*');
    if (error) {
      console.log(`[${table}] エラー: ${error.message}`);
    } else {
      console.log(`[${table}] 取得件数: ${data.length}`);
      judge(table, data.length);
    }
  }
}

async function main() {
  // ---------- テストA: 未ログイン(anon) ----------
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await checkTables(anonClient, 'テストA: 未ログイン(anon)でアクセス');

  // ---------- テストB: 第三者ユーザーでログイン ----------
  if (OUTSIDER_EMAIL.includes('ここに')) {
    console.log('\n--- テストB: スキップ(OUTSIDER_EMAIL/PASSWORDが未設定) ---');
  } else {
    const outsiderClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInError } = await outsiderClient.auth.signInWithPassword({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
    });
    if (signInError) {
      console.log(`\n--- テストB: ログイン失敗 ---\nエラー: ${signInError.message}`);
    } else {
      console.log(`\n第三者ユーザーとしてログイン成功。UID: ${signInData.user.id}`);
      await checkTables(outsiderClient, 'テストB: 第三者ユーザーでアクセス');

      // ---------- テストD: 第三者ユーザーがshopping_itemsにINSERTを試みる ----------
      console.log('\n--- テストD: 第三者ユーザーがshopping_itemsへINSERTを試みる ---');
      const { data: insertData, error: insertError } = await outsiderClient
        .from('shopping_items')
        .insert({
          shopping_list_id: '00000000-0000-0000-0000-000000000000', // 存在しないダミーID
          item_name: 'RLSテスト用の侵入データ',
        })
        .select();
      if (insertError) {
        console.log(`エラー(想定通り): ${insertError.message}`);
        console.log('  → 判定: OK ✅ (書き込み拒否された)');
      } else if (!insertData || insertData.length === 0) {
        console.log('影響件数: 0件');
        console.log('  → 判定: OK ✅ (書き込まれなかった)');
      } else {
        console.log('挿入結果:', insertData);
        console.log('  → 判定: NG ❌ (第三者なのに書き込めてしまった)');
      }
    }
  }

  // ---------- テストC(任意): 正規メンバー(1人目)でログイン ----------
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('\n--- テストC: スキップ(OWNER_EMAIL/PASSWORDが未設定) ---');
  } else {
    const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInError } = await ownerClient.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    });
    if (signInError) {
      console.log(`\n--- テストC: ログイン失敗 ---\nエラー: ${signInError.message}`);
    } else {
      console.log(`\n正規ユーザーとしてログイン成功。UID: ${signInData.user.id}`);
      console.log('--- テストC: 正規メンバーでアクセス(自分のデータは見えるはずなので0件でもOKだが、householdsだけは1件以上見えるはず) ---');
      for (const table of TABLES) {
        const { data, error } = await ownerClient.from(table).select('*');
        if (error) {
          console.log(`[${table}] エラー: ${error.message}`);
        } else {
          console.log(`[${table}] 取得件数: ${data.length}(自分の家庭データなので見えてOK)`);
        }
      }
    }
  }

  console.log('\n=== テスト完了 ===');
}

main();
