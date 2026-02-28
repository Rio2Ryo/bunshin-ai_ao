# bunshin-ai 品質確認レポート (2026-02-28)

## 1. デモデータ状態

### デモユーザー (3名)
| ID  | 名前       | 会社                    | 業種             | 信頼スコア | ランク |
|-----|-----------|------------------------|-----------------|-----------|--------|
| 100 | 田中太郎   | NextAI株式会社          | IT・テクノロジー  | 72        | Gold   |
| 101 | 佐藤花子   | Bloom Design Studio     | クリエイティブ    | 65        | Gold   |
| 102 | 鈴木一郎   | 富士通 AI研究所          | 研究開発         | 48        | Silver |

### デモマッチング (3セッション)
| ID  | ペア               | テーマ                          | スコア | 5次元合計 |
|-----|-------------------|---------------------------------|--------|----------|
| 200 | 田中×佐藤          | AI×デザインの融合による新UX       | 82     | 82 ✅    |
| 201 | 田中×鈴木          | LLM研究の事業化と技術移転        | 88     | 88 ✅    |
| 202 | 佐藤×鈴木          | ユーザー中心のAIプロダクト開発    | 79     | 79 ✅    |

### データ充足状況
- ユーザープロフィール: 全フィールド入力済み ✅
- デジタルツイン: 名前/説明/性格/tags/BigFive全て設定 ✅
- ナレッジベース: 各ユーザー2-3エントリ (計7件) ✅
- マッチング対話: 各セッション5ターン (15対話) ✅
- 友達関係: 3人が相互に友達 + NPC2人とも友達 ✅
- ポイント: 田中850pt, 佐藤420pt, 鈴木150pt ✅

## 2. マッチングAI品質

### 5次元スコア分布
全セッションで5次元（各0-20点、計100点）が正しく算出されている。

**検出した問題と修正:**
- Session 1, 22: 対話データ空のまま分析が実行され全次元0点
  - 原因: E2Eテスト時にLLM APIキー未設定で対話生成が失敗
  - 修正: `matching.ts`にスコア整合性バリデーション追加
    - 各次元を0-20にクランプ
    - 5次元の合計をcompatibilityScoreとして使用（LLM自己申告値より信頼性が高い）

### スコア偏り確認
- 実際のLLM生成: 78-88点 (適正範囲)
- スクリプトフォールバック（NPC）: 75点固定 → 問題なし
- スクリプトフォールバック（通常）: 65点固定 → 問題なし

## 3. 信頼スコアロジック

### ランク閾値
| ランク    | 最低スコア | 範囲   |
|----------|-----------|--------|
| beginner | N/A       | 未登録  |
| bronze   | 0         | 0-29   |
| silver   | 30        | 30-59  |
| gold     | 60        | 60-84  |
| platinum | 85        | 85-100 |

### ポイント加算ソース
| アクション              | ポイント | 備考        |
|------------------------|---------|------------|
| 表示名設定              | +2      | 1回のみ     |
| 自己紹介設定            | +3      | 1回のみ     |
| 会社名設定              | +2      | 1回のみ     |
| 業種設定               | +2      | 1回のみ     |
| 役職設定               | +2      | 1回のみ     |
| スキル設定              | +3      | 1回のみ     |
| 専門分野設定            | +3      | 1回のみ     |
| 経験設定               | +3      | 1回のみ     |
| アバター設定            | +5      | 1回のみ     |
| デイリーログイン         | +2      | 毎日       |
| マッチング完了          | +5      | 毎回       |
| ナレッジ追加            | +3      | 毎回       |

**修正:** auth.tsの未ログイン時デフォルトランクを `"bronze"` → `"beginner"` に統一 (profile.tsと整合)

### テストシナリオ
1. 新規登録 → trust_scores行なし → "beginner" ✅
2. プロフィール全入力 → +20pt → "bronze" ✅
3. +アバター+デイリーログイン2日+マッチング1回 → 34pt → "silver" ✅
4. +マッチング5回+ナレッジ3件 → 68pt → "gold" ✅

## 4. LINE Webhook環境変数

### 設定状況
| シークレット                  | 状態     |
|-----------------------------|---------|
| AZURE_FOUNDRY_API_KEY       | ✅ 設定済 |
| AZURE_FOUNDRY_RESOURCE      | ✅ 設定済 |
| JWT_SECRET                  | ✅ 設定済 |
| LINE_CHANNEL_SECRET         | ❌ 未設定 |
| LINE_CHANNEL_ACCESS_TOKEN   | ❌ 未設定 |
| STRIPE_SECRET_KEY           | ❌ 未設定 |
| STRIPE_WEBHOOK_SECRET       | ❌ 未設定 |
| RESEND_API_KEY              | ❌ 未設定 |
| TAVILY_API_KEY              | ❌ 未設定 |

### LINE Webhook設定手順

1. [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャネルを作成
2. チャネルシークレットとチャネルアクセストークン（長期）を取得
3. Worker secretsに設定:
```bash
# .dev.vars からCF_TOKENを読み込み
export CLOUDFLARE_API_TOKEN=<your-cf-token>

echo "<channel-secret>" | npx wrangler secret put LINE_CHANNEL_SECRET --config wrangler.toml
echo "<channel-access-token>" | npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config wrangler.toml
```
4. LINE Developers Consoleで Webhook URL を設定:
```
https://bunshin-ai-api.common-gifted-tokyo.workers.dev/api/line/webhook
```
5. 「Webhookの利用」をONに設定
6. 「応答メッセージ」をOFFに設定（Worker側で応答するため）

### その他のシークレット設定手順
```bash
# Stripe (決済機能)
echo "<stripe-secret-key>" | npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.toml
echo "<webhook-secret>" | npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.toml

# Resend (メール送信)
echo "<resend-api-key>" | npx wrangler secret put RESEND_API_KEY --config wrangler.toml

# Tavily (Web検索)
echo "<tavily-api-key>" | npx wrangler secret put TAVILY_API_KEY --config wrangler.toml
```
