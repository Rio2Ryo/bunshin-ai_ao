# 分身AI (Bunshin AI)

デジタルツインAIシステム — あなたの分身AIを作成し、ビジネスマッチングを自動化

## 概要

分身AIは、ユーザーの性格・スキル・経験を学習したAI分身（デジタルツイン）を作成し、
分身AI同士の自動対話によるビジネスマッチングを実現するプラットフォームです。

### 主な機能

- **AIオンボーディング**: チャット形式で自然にプロフィールを構築
- **分身AI作成**: Big Five性格診断・MBTI・価値観シナリオから学習
- **AIマッチング**: 分身AI同士の自動対話→相性分析→スコアリング
- **波形互換性**: 独自の価値観波形による互換性分析
- **親密度システム**: 交流頻度に基づく親密度スコア
- **NPCチュートリアル**: ガイド太郎・案内花子がサービスを案内
- **信頼度スコア**: プロフィール充実度・活動量に基づくランキング
- **通知システム**: ポーリング型リアルタイム通知（ブラウザ通知対応）
- **対話エクスポート**: マッチング対話のCSV/PDFエクスポート
- **プランベース課金**: Free/Premium/Enterprise（Stripe連携）
- **GDPR準拠退会**: データエクスポート＋完全削除
- **マーケットプレイス**: AIペルソナテンプレートの売買
- **管理者ダッシュボード**: 収益・コンテンツモデレーション・ユーザー管理

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19 + Vite + Tailwind CSS 4 + shadcn/ui + wouter |
| API | Cloudflare Workers + Hono + tRPC v11 |
| データベース | Cloudflare D1 (SQLite) |
| ストレージ | Cloudflare R2 |
| 認証 | Email/Password + JWT (jose, PBKDF2) |
| LLM | Azure AI Foundry (Kimi-K2.5) + OpenAI/Gemini/Anthropic/xAI |
| 決済 | Stripe (Checkout + Webhooks) |
| ホスティング | Cloudflare Pages (frontend) + Workers (API) |

## 環境構成

### 本番環境

- **Frontend**: https://bunshin-ai.pages.dev
- **API**: https://bunshin-ai-api.common-gifted-tokyo.workers.dev
- **D1 Database ID**: 2d1ebbfb-5c34-48be-a48e-bb0fac6c676d

### 必要な環境変数 (Wrangler Secrets)

```env
JWT_SECRET=           # JWT署名シークレット
AZURE_FOUNDRY_API_KEY= # Azure AI Foundry APIキー
AZURE_FOUNDRY_RESOURCE= # Azure AI Foundryリソース名
STRIPE_SECRET_KEY=     # Stripe秘密鍵（オプション）
STRIPE_WEBHOOK_SECRET= # Stripeウェブフック署名シークレット（オプション）
SLACK_WEBHOOK_URL=     # Slack通知URL（オプション）
TAVILY_API_KEY=        # Web検索API（マッチング強化、オプション）
```

## セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. ローカル開発

```bash
# Worker（API）起動
npx wrangler dev --config wrangler.toml

# Client（フロントエンド）起動
npx vite dev
```

### 3. デプロイ

```bash
# Worker
npx wrangler deploy --config wrangler.toml

# Client
npx vite build
npx wrangler pages deploy dist/public --project-name bunshin-ai
```

## プロジェクト構造

```
bunshin-ai_ao/
├── client/                 # フロントエンド (React 19)
│   ├── src/
│   │   ├── pages/          # ページコンポーネント (36ページ)
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Onboarding.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── MatchingSession.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Plan.tsx
│   │   │   └── ... (他30ページ)
│   │   ├── components/     # 共通コンポーネント
│   │   │   ├── DashboardLayout.tsx  # メインレイアウト+認証ガード
│   │   │   └── ui/         # shadcn/ui
│   │   ├── _core/hooks/    # useAuth, useTranslation等
│   │   ├── lib/trpc.ts     # tRPCクライアント設定
│   │   └── App.tsx         # ルーティング
│   └── index.html
├── worker/                 # Cloudflare Worker (API)
│   ├── src/
│   │   ├── index.ts        # 全tRPCルーター + Honoミドルウェア (~6100行)
│   │   ├── db-helpers.ts   # D1スキーマ + マイグレーション + ヘルパー
│   │   └── llm.ts          # マルチプロバイダーLLM呼び出し
│   └── vitest.config.ts
├── e2e/                    # Playwright E2Eテスト (10グループ)
│   ├── playwright.config.ts
│   ├── auth.setup.ts
│   └── group1-10.spec.ts
├── wrangler.toml           # Worker設定
└── server/                 # レガシーExpressサーバー（未使用）
```

## API概要

### tRPCルーター (33ルーター)

| ルーター | 説明 |
|---------|------|
| `auth` | 認証 (register/login/me/logout/deleteAccount/exportMyData) |
| `profile` | プロフィール管理 |
| `myTwin` | 分身AI管理 (CRUD + 性格診断 + 波形) |
| `friends` | 友達管理 (申請/承認/一覧) |
| `chat` | AIチャット (セッション/メッセージ) |
| `matching` | マッチング (作成/対話/分析/エクスポート) |
| `points` | ポイントシステム |
| `quests` | デイリークエスト |
| `growth` | 分身成長システム |
| `trust` | 信頼度スコア |
| `marketplace` | ペルソナマーケットプレイス |
| `notification` | 通知管理 |
| `admin` | 管理者機能 (ユーザー管理/収益/モデレーション) |
| `plan` | プラン管理 + レート制限 |
| `stripe` | 決済連携 |
| `discover` | ユーザー検索 |
| `onboarding` | オンボーディングフロー |
| `scheduler` | 自動マッチングスケジューラー |

### REST エンドポイント

| パス | 説明 |
|------|------|
| `GET /api/health` | ヘルスチェック (DB疎通・応答時間) |
| `GET /api/health/detailed` | 詳細ヘルスチェック (管理者専用) |
| `GET /api/status` | サービスステータス + 統計 |
| `POST /api/auth/set-session` | セッションCookie設定 |
| `POST /api/auth/logout` | セッションCookie削除 |
| `GET /api/export/matching/:id/csv` | マッチング対話CSVエクスポート |
| `GET /api/export/matching/:id/pdf` | マッチング対話PDFレポート |
| `GET /assets/*` | R2ストレージファイル配信 |
| `POST /api/stripe/webhook` | Stripe Webhook |

## データベーステーブル (38テーブル)

users, user_profiles, digital_twins, friendships, knowledge_base, uploaded_files,
ai_api_configs, orchestration_roles, chat_sessions, chat_messages,
matching_sessions, matching_dialogues, matching_results, usage_tracking,
value_scenario_responses, cumulative_waveforms, other_perspective_waveforms,
intimacy_scores, user_points, point_transactions, redeemable_products,
point_redemptions, point_settings, line_connections, clawdbot_connections,
twin_growth_status, twin_skill_levels, twin_milestones, cards,
conversation_learning, ai_provider_settings, persona_templates,
persona_purchases, persona_reviews, trust_scores, trust_score_history,
matching_requests, auto_matching_schedules, notification_settings,
content_reports, moderation_actions, twin_visibility_rules, notifications

## テスト

```bash
# Workerユニットテスト
npx vitest run --config worker/vitest.config.ts

# E2Eテスト（全グループ）
npx playwright test --config e2e/playwright.config.ts

# 特定グループのみ
npx playwright test --config e2e/playwright.config.ts e2e/group1-core.spec.ts
```

## セキュリティ

- JWT Cookie認証 (HttpOnly, SameSite=None, Secure)
- PBKDF2 (100,000 iterations) パスワードハッシュ
- プランベースAPIレート制限 (Free: 30/min, Premium: 120/min, Enterprise: 600/min)
- 認証エンドポイント強化レート制限 (10/min)
- CORS ホワイトリスト
- CSP / X-Frame-Options / HSTS セキュリティヘッダー
- Stripe Webhook HMAC署名検証
- パラメータ化クエリ (D1 prepared statements)

## ライセンス

MIT License
