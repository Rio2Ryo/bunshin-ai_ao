# 分身AI (Bunshin AI)

デジタルツインAIシステム - あなたの分身AIをLINEやWebで対話可能に。

## 概要

分身AIは、ユーザーの性格・スキル・経験を学習し、LINE公式アカウントやWebチャットで対話できるデジタルツインAIシステムです。

### 主な機能

- **分身AI作成**: ユーザーの性格・スキル・経験を設定
- **LINE連携**: LINE公式アカウントと連携して会話
- **Clawdbot連携**: 外部Clawdbot Gatewayと連携
- **名刺・カード管理**: OCR解析で名刺を自動登録
- **AI API統合**: OpenAI/Gemini/Anthropic/xAI対応
- **画像生成**: Gemini Vision APIで画像生成

## 技術スタック

- **フロントエンド**: React 19 + Vite + Tailwind CSS 4 + shadcn/ui
- **バックエンド**: Express 4 + tRPC 11 + TypeScript
- **データベース**: MySQL/TiDB (Drizzle ORM)
- **認証**: Manus OAuth (メール/Googleログイン)
- **LLM**: Gemini API, Clawdbot Gateway
- **LINE**: LINE Messaging API

## 必要な環境変数

以下の環境変数が必要です。`.env.example`を参考に`.env`ファイルを作成してください。

### システム必須

```env
# データベース
DATABASE_URL=mysql://user:password@host:port/database

# 認証（Manus OAuth）
JWT_SECRET=your-jwt-secret
VITE_APP_ID=your-manus-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://portal.manus.im
OWNER_OPEN_ID=owner-open-id
OWNER_NAME=owner-name

# Manus Built-in APIs
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=your-forge-api-key
VITE_FRONTEND_FORGE_API_KEY=your-frontend-forge-api-key
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im

# アプリ設定
VITE_APP_TITLE=分身AI
VITE_APP_LOGO=https://your-logo-url.com/logo.png
VITE_ANALYTICS_WEBSITE_ID=your-analytics-id
VITE_ANALYTICS_ENDPOINT=https://analytics.manus.im
```

### LINE連携（オプション）

```env
LINE_CHANNEL_ID=your-line-channel-id
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-line-access-token
LINE_DEBUG_MODE=false
```

### Clawdbot連携（オプション）

```env
CLAWDBOT_GATEWAY_URL=https://your-clawdbot-gateway.com
CLAWDBOT_AUTH_TOKEN=your-clawdbot-auth-token
CLAWDBOT_AGENT_ID=main
```

### AI API（オプション）

```env
GEMINI_API_KEY=your-gemini-api-key
```

### Stripe決済（オプション）

```env
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
VITE_STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
```

## セットアップ手順

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

```.env.example`を`.env`にコピーして、必要な値を設定してください。

```bash
cp .env.example .env
# .envファイルを編集
```

### 3. データベースのマイグレーション

```bash
pnpm db:push
```

このコマンドは、Drizzle ORMを使用してデータベーススキーマを同期します。

### 4. 開発サーバーの起動

```bash
pnpm dev
```

- フロントエンド: http://localhost:3000
- バックエンドAPI: http://localhost:3000/api

## 主要URL

### ユーザー向け画面

- `/` - ホーム
- `/profile` - プロフィール設定
- `/twins` - 分身AI管理
- `/line` - LINE連携
- `/clawdbot-link` - Clawdbot連携
- `/ai-api` - AI API設定
- `/cards` - 名刺・カード管理

### API エンドポイント

- `/api/trpc/*` - tRPC API（全機能）
- `/api/oauth/callback` - Manus OAuth コールバック
- `/api/line/webhook` - LINE Webhook
- `/api/stripe/webhook` - Stripe Webhook

## データベーススキーマ

主要なテーブル：

- `users` - ユーザー情報
- `digital_twins` - 分身AI情報
- `line_connections` - LINE連携情報
- `clawdbot_connections` - Clawdbot連携情報
- `cards` - 名刺・カード情報
- `chat_sessions` - チャットセッション
- `chat_messages` - チャットメッセージ

スキーマ定義: `drizzle/schema.ts`

## 開発コマンド

```bash
# 開発サーバー起動
pnpm dev

# ビルド
pnpm build

# 本番サーバー起動
pnpm start

# テスト実行
pnpm test

# TypeScriptチェック
pnpm typecheck

# データベーススキーマ同期
pnpm db:push

# データベーススキーマ生成
pnpm db:generate
```

## プロジェクト構造

```
/home/ubuntu/bunshin-ai/
├── client/          # フロントエンド（React + Vite）
│   ├── src/
│   │   ├── pages/   # ページコンポーネント
│   │   ├── components/ # 共通コンポーネント
│   │   ├── contexts/   # Reactコンテキスト
│   │   ├── hooks/      # カスタムフック
│   │   ├── lib/        # ユーティリティ
│   │   ├── App.tsx     # ルーティング
│   │   └── main.tsx    # エントリーポイント
│   ├── public/      # 静的ファイル
│   └── index.html   # HTMLテンプレート
├── server/          # バックエンド（Express + tRPC）
│   ├── routers.ts   # tRPC API定義
│   ├── db.ts        # データベース操作
│   ├── services/    # ビジネスロジック
│   ├── line/        # LINE連携
│   └── _core/       # フレームワーク（認証、環境変数等）
├── drizzle/         # データベーススキーマ
│   └── schema.ts    # テーブル定義
├── shared/          # 共通型・定数
├── docs/            # ドキュメント
└── package.json     # 依存関係
```

## LINE連携の設定

### 1. LINE Developers でチャネルを作成

1. [LINE Developers](https://developers.line.biz/)にアクセス
2. 新規チャネルを作成（Messaging API）
3. Channel ID, Channel Secret, Channel Access Tokenを取得

### 2. Webhook URLを設定

LINE Developersコンソールで、Webhook URLを設定：

```
https://your-domain.com/api/line/webhook
```

### 3. 環境変数を設定

`.env`ファイルに以下を追加：

```env
LINE_CHANNEL_ID=your-channel-id
LINE_CHANNEL_SECRET=your-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-access-token
```

### 4. LINE公式アカウントを友だち追加

QRコードまたはLINE IDで友だち追加すると、6桁の連携コードが送信されます。

### 5. Webアプリで連携コードを入力

`/line`画面で6桁のコードを入力して連携完了。

## Clawdbot連携の設定

### 1. Clawdbot Gatewayを起動

Clawdbot Gatewayを別途起動し、URLを確認（例: `http://localhost:4141`）

### 2. 環境変数を設定（オプション）

システム全体のデフォルトとして設定する場合：

```env
CLAWDBOT_GATEWAY_URL=https://your-clawdbot-gateway.com
CLAWDBOT_AUTH_TOKEN=your-auth-token
CLAWDBOT_AGENT_ID=main
```

### 3. Webアプリで設定

`/clawdbot-link`画面で個別に設定することも可能：

- Gateway URL: Clawdbot GatewayのURL
- 認証トークン: Bearer トークン（オプション）
- エージェントID: デフォルトは `main`

**注意**: 本番環境では`localhost`は使用できません。ngrokなどで公開URLを取得してください。

## テスト

```bash
# 全テスト実行
pnpm test

# 特定のテストファイルを実行
pnpm test server/cards.test.ts

# テストカバレッジ
pnpm test --coverage
```

主要なテストファイル：

- `server/auth.logout.test.ts` - 認証テスト
- `server/cards.test.ts` - カード管理テスト
- `server/line/linkByCode.test.ts` - LINE連携テスト
- `server/clawdbot.test.ts` - Clawdbot接続テスト

## Phase2 ゲート運用メモ（Cloudflare）

`pnpm check` / `pnpm build` / `pnpm exec wrangler deploy --dry-run` の3ゲートを Phase2 の標準確認手順とする。

### build warning（chunk size）の扱い

- `(!) Some chunks are larger than 500 kB` は **警告** であり、単体ではリリースブロッカーではない。
- ただし以下を満たす場合は改善タスクを切る：
  - メインバンドル（`index-*.js`）が前回安定値から **+15%以上** 増加
  - 体感初期表示劣化（LCP悪化・初回遅延）が確認される
  - 同一警告が3回以上連続し、増加トレンドが続く

### 監視ポイント

- `pnpm build` 出力の `index-*.js` サイズ（gzip含む）
- `wrangler deploy --dry-run` の binding 認識（特に `DB`）
- `pnpm check` の再発有無（TS2339 / TS7006）

### 対応トリガー時の優先順位

1. ルート単位の遅延読込（dynamic import）
2. 重い表示機能（図表・エディタ・可視化）の分割
3. `rollupOptions.output.manualChunks` の導入

## トラブルシューティング

### データベース接続エラー

`DATABASE_URL`が正しく設定されているか確認してください。

```bash
# データベース接続テスト
pnpm db:push
```

### LINE Webhook エラー

1. Webhook URLが正しく設定されているか確認
2. `LINE_CHANNEL_SECRET`が正しいか確認
3. サーバーログを確認（`/api/line/webhook`）

### Clawdbot 接続エラー

1. Gateway URLが到達可能か確認（`localhost`は本番では使用不可）
2. 認証トークンが正しいか確認
3. `/clawdbot-link`画面で接続テストを実行

## ライセンス

MIT License

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## サポート

問題や質問がある場合は、GitHubのissueを作成してください。
