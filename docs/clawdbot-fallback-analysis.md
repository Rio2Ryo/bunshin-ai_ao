# Clawdbot連携fallback問題の調査結果

## 問題の概要
LINE webhookでの画像生成が、Clawdbot経由ではなくfallback（manus-llm）を使用している。

## 原因分析

### 1. Gateway URL/Token/AgentIDの保存場所

#### ENV（環境変数）- システム全体のデフォルト
- **場所**: `server/_core/env.ts`
- **変数**:
  - `ENV.clawdbotGatewayUrl`: `process.env.CLAWDBOT_GATEWAY_URL || "https://893e80ba826e.ngrok-free.app"`
  - `ENV.clawdbotAuthToken`: `process.env.CLAWDBOT_AUTH_TOKEN || "e1f9299784aa90cc8d33e510557be3d0b86ba341ee51ab54"`
  - `ENV.clawdbotAgentId`: `process.env.CLAWDBOT_AGENT_ID || "main"`
- **用途**: システム全体のデフォルト設定（LINE webhook、画像生成など）

#### DB（clawdbot_connections）- ユーザーごとの設定
- **テーブル**: `clawdbot_connections`
- **カラム**:
  - `gatewayUrl`: ユーザーが設定したGateway URL
  - `authToken`: ユーザーが設定した認証トークン
  - `agentId`: ユーザーが設定したエージェントID
  - `status`: 接続状態（pending/testing/active/error/disconnected）
- **用途**: ユーザーごとのClawdbot連携設定（/clawdbot-link画面で設定）

### 2. 参照箇所と優先順位

#### LINE webhook（`server/line/webhook.ts`）
- **使用**: ENV（システム全体のデフォルト）
- **関数**: `sendToClawdbot()` → `ENV.clawdbotGatewayUrl`、`ENV.clawdbotAuthToken`
- **問題**: DBのユーザー設定を参照していない

#### Clawdbotチャット（`server/services/clawdbotService.ts`）
- **使用**: DB（ユーザーごとの設定）
- **関数**: `sendMessageToClawdbot()` → `connection.gatewayUrl`、`connection.authToken`
- **正常**: ユーザー設定を正しく参照

### 3. fallback原因の特定

**根本原因**: ENV vs DB vs UIの不一致

1. **ENV（システム全体）**:
   - `CLAWDBOT_GATEWAY_URL=https://893e80ba826e.ngrok-free.app`
   - ハードコードされたngrok URL

2. **DB（ユーザー設定）**:
   - ユーザーが`/clawdbot-link`で設定したGateway URL
   - 例: `http://localhost:4141`（本番では到達不可）

3. **UI（/clawdbot-link）**:
   - ユーザーが入力したGateway URL
   - localhostを入力してもバリデーションなし

**問題の流れ**:
1. ユーザーが`/clawdbot-link`で`localhost:4141`を設定
2. LINE webhookはENVの`https://893e80ba826e.ngrok-free.app`を使用
3. ngrok URLが古い/無効な場合、接続失敗
4. fallback（manus-llm）が使用される

### 4. 設計上の問題点

#### 問題1: ENV vs DBの二重管理
- LINE webhookはENVを参照
- ClawdbotチャットはDBを参照
- 設定が分散して混乱

#### 問題2: ENVのハードコード
```typescript
clawdbotGatewayUrl: process.env.CLAWDBOT_GATEWAY_URL || "https://893e80ba826e.ngrok-free.app",
```
- ngrok URLは頻繁に変わる
- ハードコードすると古いURLが残る

#### 問題3: UIバリデーション不足
- localhostを入力してもエラーなし
- 本番環境でlocalhostは到達不可
- 接続テストボタンが機能していない

#### 問題4: 接続ボタンのdisabled条件が不明確
- どの入力が必須か不明
- エラーメッセージがない
- ユーザーガイドがない

## 解決策

### 方針: DB優先、ENV削除

1. **ENVのハードコードを削除**
   - `server/_core/env.ts`からハードコードされたngrok URLを削除
   - 環境変数のみを使用（デフォルト値なし）

2. **LINE webhookをDB優先に変更**
   - ユーザーのDB設定を優先的に参照
   - DB設定がない場合のみENVを使用
   - 両方ない場合はfallback

3. **UIバリデーション追加**
   - localhost警告を表示
   - Gateway URL形式チェック
   - 接続テストを必須化

4. **エラーメッセージ改善**
   - 接続ボタンのdisabled理由を表示
   - 入力不足の項目を明示
   - 接続失敗時の詳細エラー

## 実装計画

### Phase 1: ENV削除
- `server/_core/env.ts`のハードコード削除
- 環境変数のみを使用

### Phase 2: DB優先ロジック
- `server/line/webhook.ts`を修正
- ユーザーのDB設定を優先的に参照

### Phase 3: UIバリデーション
- `client/src/pages/Clawdbot.tsx`を修正
- localhost警告、入力チェック、エラーメッセージ

### Phase 4: テスト
- LINEで画像生成→debugでclawdbotになったことを確認
- localhost入力時に警告が表示されることを確認

## 変更ファイル一覧

1. `server/_core/env.ts` - ENVのハードコード削除
2. `server/services/clawdbotGatewayService.ts` - DB優先ロジック追加
3. `server/line/webhook.ts` - DB設定参照に変更
4. `client/src/pages/Clawdbot.tsx` - UIバリデーション追加
5. `docs/clawdbot-fallback-analysis.md` - このドキュメント
