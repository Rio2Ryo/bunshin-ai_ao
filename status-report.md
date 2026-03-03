# bunshin-ai ステータスレポート (2026-03-03)
生成日: 2026-03-03 (更新: Phase 43 — Dashboard Widget Integration + Bulk Export/Archive + Embed Card)
| 最新コミット | 7a5c3a5 feat: Phase 43 — Dashboard Widget Integration + Bulk Export/Archive + Embed Card |

## 完成済み機能一覧

### コア機能
- [x] 認証: メール/パスワード登録・ログイン・JWT Cookie セッション
- [x] メール認証: RESEND_API_KEY未設定時は自動認証にフォールバック
- [x] パスワードリセット: トークン生成・メール送信・リセット画面
- [x] AIオンボーディング: 5ステップ会話形式、ツイン自動作成
- [x] デジタルツイン: 作成・編集・性格分析・BigFive・MBTI
- [x] LLMチャット: マルチプロバイダー (OpenAI/Gemini/Anthropic/Grok/Azure Foundry)
- [x] ナレッジベース: テキスト入力・ファイルアップロード・チャット/マッチング連携
- [x] マッチングAI: ツイン対話・5次元スコア・スコア整合性バリデーション
- [x] 友達機能: リクエスト送受信・承認・ブロック
- [x] ポイント/クエスト: 信頼スコア・ランク・マイルストーン・リワード交換
- [x] 通知: アプリ内 + Slack + LINE push (friend/matching request連動)
- [x] LINE連携: Webhook受信・署名検証・フォロー/メッセージ/グループ処理・AI応答・会話履歴保存・tRPC API 10エンドポイント (本番稼働中)
- [x] カード: 名刺画像アップロード・OCR分析 (Vision API)

### SaaS/課金
- [x] Stripe Billing: Checkout Session (月額/年額)・Customer Portal・Webhook (HMAC検証)
- [x] プラン制限: 友達数・チャット数/日・マッチング数/月・月次リセット (cron)
- [x] レート制限UI: Plan画面にプログレスバー・残量表示(残りX)・リセットタイマー・警告バナー(80%黄/100%赤)・アップグレードCTA

### UI/UX
- [x] ランディングページ: Hero「5分で作れる、あなたのデジタル分身」・LINE CTAボタン・3ユースケースカード・具体例ステップ
- [x] LINE連携ページ: 大きな緑CTA・QRコードプレースホルダー・3ステップビジュアルカード
- [x] ダッシュボード: 状態別アクションカード・サイドバーグループ化
- [x] プロフィール: アバターアップロード (R2)・公開プロフィールページ (/users/:id)
- [x] Discover: ツイン検索・詳細ダイアログ・プロフィールリンク
- [x] SEO: 全22ページにusePageMeta (title/description/OGP)
- [x] アクセシビリティ: aria-label・role・keyboard nav・focus-visible (全主要ページ)
- [x] PWA: manifest.json・Service Worker・アイコン各サイズ・オフライン対応強化

### インフラ/品質
- [x] Cloudflare Workers + D1 + R2 本番デプロイ
- [x] CORS: bunshin-ai.pages.dev + localhost制限
- [x] セキュリティヘッダー: CSP・HSTS・X-Frame-Options・Referrer-Policy
- [x] レートリミッター: プラン別 (free:60/min, premium:120, enterprise:600)
- [x] TypeScript: `tsc --noEmit` エラー0件
- [x] 統合テスト: 94/94パス (本番API直結)
- [x] Lighthouse CI: GitHub Actions PR コメント
- [x] Worker分割: index.ts 6,800行 → 847行 + 20ルーターファイル
- [x] Legacy server/ディレクトリ削除済み
- [x] デモデータ: 3ユーザー・3マッチング・ナレッジ・友達関係

### セッション比較レポート + テンプレートギャラリー + アクションプラン（Phase 42: 2026-03-03）
- **マッチング・セッション比較レポート**: 2セッションの詳細比較分析レポート生成
- **ツイン・テンプレートギャラリー**: テンプレートのブラウズ・プレビュー・適用UI
- **マッチング・アクションプラン**: セッション結果からアクションプラン自動生成

### ダッシュボードウィジェット統合 + 一括エクスポート/アーカイブ + 埋め込みカード（Phase 43: 2026-03-03）
- **ダッシュボードウィジェット統合**: ブックマーク/ブリーフィング/品質トレンドの3ウィジェット追加
  - BookmarksWidget.tsx, BriefingWidget.tsx, QualityTrendWidget.tsx
  - useDashboardLayout に3ウィジェット追加、Dashboard.tsx に統合
- **マッチング・一括エクスポート/アーカイブ**: セッション一括CSV/JSONエクスポート + アーカイブ管理
  - matching.bulkExport / matching.archiveSession / matching.listArchived / matching.restoreSession
  - SessionArchive.tsx ページ（/session-archive）
- **ツイン・埋め込みカード生成**: 外部サイト用の埋め込みカードHTML/URLジェネレーター
  - myTwin.generateEmbedCard: ツインプロフィール埋め込みカード生成
  - TwinEmbedCard.tsx ページ（/embed-card）

## 本番環境状態 (2026-02-28 確認済み)

### API: 正常
- `/api/health`: DB/R2/LLM全正常, v2.3.0, DB latency 22ms
- tRPC: system.health OK, auth.me OK, 認証エンドポイント401正常

### フロントエンド: 全20ルートHTTP 200
/, /login, /register, /dashboard, /profile, /twins, /chat, /matching,
/friends, /plan, /discover, /terms, /privacy, /verify-email,
/forgot-password, /reset-password, /onboarding, /users/:id,
/session-archive, /embed-card

### 静的アセット: 全正常
manifest.json, sw.js, icons (7種)

### セキュリティヘッダー: 全正常
CORS, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy

## Cloudflare Worker Secrets

| シークレット | 状態 |
|---|---|
| AZURE_FOUNDRY_API_KEY | ✅ 設定済 |
| AZURE_FOUNDRY_RESOURCE | ✅ 設定済 |
| JWT_SECRET | ✅ 設定済 |
| LINE_CHANNEL_SECRET | ✅ 設定済 (2026-02-28) |
| LINE_CHANNEL_ACCESS_TOKEN | ✅ 設定済 (2026-02-28) |
| STRIPE_SECRET_KEY | ❌ 未設定 (要Stripeアカウント) |
| STRIPE_WEBHOOK_SECRET | ❌ 未設定 (要Stripeアカウント) |
| RESEND_API_KEY | ❌ 未設定 (メール認証自動フォールバック中) |
| TAVILY_API_KEY | ❌ 未設定 (マッチングWeb検索無効) |

## 未対応タスク (優先度付き)

### HIGH (ビジネスインパクト大)
| # | タスク | 理由 |
|---|--------|------|
| ~~H1~~ | ~~CLAUDE.md の server/ 参照削除~~ | ✅ 修正済み |
| ~~H2~~ | ~~LINE連携を本番稼働させる~~ | ✅ シークレット設定済み・Webhook検証OK・E2Eテスト13/13パス (2026-02-28) |
| H3 | Stripe課金を本番稼働させる | STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET 未設定。アオ対応待ち |
| H4 | E2Eブラウザテスト整備 | e2e/ にPlaywright設定あるが実行されていない。UI回帰テスト不足 |

### MEDIUM (品質向上)
| # | タスク | 理由 |
|---|--------|------|
| M1 | 401レスポンスからスタックトレース除去 | 本番でTRPCError のstackが返る。情報漏洩リスク (低) |
| M2 | レートリミットヘッダー値修正 | status-report.mdに `x-ratelimit-limit: 10` 記録があるが、実際は30に修正済み。本番再確認要 |
| M3 | エラーバウンダリ強化 | フロントエンドのグローバルエラーバウンダリ有無確認、catch-all UX改善 |
| M4 | i18n基盤整備 | 現在全テキストが日本語ハードコード。将来的に英語対応が必要な場合のコスト増 |

### LOW (改善候補)
| # | タスク | 理由 |
|---|--------|------|
| L1 | `as any` 削減 | ルーターファイル全体に `as any` 多数。型安全性を段階的に改善 |
| L2 | 空catchブロックへのログ追加 | index.tsに9箇所の空catch。サイレント失敗のデバッグ困難 |
| L3 | Playwright E2E自動化CI | GitHub Actionsに追加して回帰検出を自動化 |
| L4 | line.ts 994行のさらなる分割 | 最大のルーターファイル。LINE Bot ロジックが複雑 |

## 8. LINE連携セットアップ手順 (2026-02-28)

### 現状 (2026-02-28 更新)
- **コード実装**: ✅ 完了 (`worker/src/routers/line.ts` 994行)
- **Webhookエンドポイント**: ✅ 稼働中 (GET/POST 確認済み)
- **本番URL**: `https://bunshin-ai-api.common-gifted-tokyo.workers.dev/api/line/webhook`
- **シークレット**: ✅ LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN 設定済み
- **署名検証**: ✅ 不正署名 → 403 (Invalid signature)
- **Webhook URL検証**: ✅ LINE Developers Consoleから検証OK
- **E2Eテスト**: ✅ 13/13パス (Webhook 3 + Auth保護 2 + tRPC API 8)

### 実装済み機能 (シークレット設定後に自動的に有効化)
- フォローイベント: ウェルカムメッセージ + 連携コード発行 (10分有効)
- メッセージイベント (未リンク): 連携コード再発行
- メッセージイベント (リンク済み): ツイン人格 + ナレッジベースでAI応答 (Clawdbot → LLM fallback)
- グループメッセージ: ナレッジベースへの自動学習
- アンフォロー: 切断処理
- tRPC API: getConnection, linkByCode, disconnect, updateSettings, toggleStatus, getMessageHistory, sendMessage, getProfile
- 会話履歴保存: chat_sessions / chat_messages に自動記録
- ツイン成長: LINE会話1回につき経験値+5

### STEP 1: LINE Developers Console でチャネル作成
1. https://developers.line.biz/ にログイン
2. プロバイダー作成 (例: "bunshin-ai")
3. **Messaging API チャネル** を新規作成
   - チャネル名: 分身AI (Bunshin AI)
   - チャネル説明: あなたのデジタルツインAIアシスタント
   - カテゴリ: ウェブサービス
4. チャネル設定画面で以下を取得:
   - **チャネルシークレット** (Channel secret) → `LINE_CHANNEL_SECRET` に使用
   - **チャネルアクセストークン** (Channel access token) → 「発行」ボタンで長期トークン生成 → `LINE_CHANNEL_ACCESS_TOKEN` に使用

### STEP 2: Webhook URL 設定
LINE Developers Console のチャネル設定 > Messaging API:
1. **Webhook URL**: `https://bunshin-ai-api.common-gifted-tokyo.workers.dev/api/line/webhook`
2. **Webhookの利用**: ON
3. **「検証」ボタン**: クリックして成功を確認
4. **応答メッセージ**: OFF (ボットが応答するため)
5. **あいさつメッセージ**: OFF (カスタムウェルカムメッセージ使用)

### STEP 3: Cloudflare Worker にシークレット設定
```bash
# LINE_CHANNEL_SECRET (チャネルシークレット)
echo "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | CLOUDFLARE_API_TOKEN=wPYPF6_-IbPFe-tiofdjGJFLKLS2eGGhgDv-kKsT npx wrangler secret put LINE_CHANNEL_SECRET --config wrangler.toml

# LINE_CHANNEL_ACCESS_TOKEN (チャネルアクセストークン)
echo "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | CLOUDFLARE_API_TOKEN=wPYPF6_-IbPFe-tiofdjGJFLKLS2eGGhgDv-kKsT npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config wrangler.toml
```

### STEP 4: E2Eテスト手順
1. LINEアプリでボットのQRコードを読み取り、友達追加
2. ウェルカムメッセージ受信を確認: "分身AIへようこそ！" + 連携コード (例: `ABCDEF`)
3. Webアプリにログインし、LINE連携画面でコードを入力 → リンク完了
4. LINEでメッセージ送信 → ツインAIの応答を確認
5. Webアプリのチャット履歴にLINE会話が保存されることを確認

### E2Eテスト結果 (2026-02-28)
| # | テスト | 結果 |
|---|--------|------|
| 1 | GET /api/line/webhook 検証 | ✅ 200, status:active |
| 2 | POST 不正署名 → 403 | ✅ PASS |
| 3 | POST 署名なし → 403 | ✅ PASS |
| 4 | line.getConnection 未認証 → 401 | ✅ PASS |
| 5 | line.sendMessage 未認証 → 401 | ✅ PASS |
| 7 | line.getConnection 認証済み → null | ✅ PASS |
| 8 | line.getProfile 認証済み → null | ✅ PASS |
| 9 | line.getMessageHistory → [] | ✅ PASS |
| 10 | line.sendMessage (未連携) → NOT_FOUND | ✅ PASS |
| 11 | line.linkByCode (無効コード) → NOT_FOUND | ✅ PASS |
| 12 | line.disconnect (冪等) → success | ✅ PASS |
| 13 | line.toggleStatus (未連携) → NOT_FOUND | ✅ PASS |

### ステータス
✅ **LINE連携は本番稼働中。** シークレット設定済み、Webhook検証済み、全tRPCエンドポイント正常動作確認。

## 修正済みの問題 (2026-02-28)
- ✅ メール認証バグ: RESEND_API_KEY未設定時は自動認証
- ✅ レートリミット: free 30→60/分, 未認証 10→30/分
- ✅ twin_milestones スキーマ: name/description列追加 + マイグレーション
- ✅ points.checkMilestones: twinId列のINSERT修正
- ✅ getRateLimits: レート値を実際のリミッターと同期
- ✅ Plan UI: RateLimitCardの配置修正 + プログレスバー + ステータスバッジ
- ✅ server/ディレクトリ: Legacy Express完全削除
- ✅ アクセシビリティ: 主要ページにaria-label/role追加
- ✅ アクセシビリティ強化: 全主要ページにrole="main"、focus-visible全体スタイル、aria-expanded/live/label追加
- ✅ PWAオフライン強化: SPAシェルプリキャッシュ、APIデータキャッシュ(LRU 100件/1時間)、復帰バナー
- ✅ LINE連携コードレビュー完了: Webhookハンドラー(994行)、署名検証、tRPC API全10エンドポイント正常。GET /api/line/webhook 本番200確認。シークレット未設定時の安全なフォールバック確認

## 7. PWAオフライン機能 (2026-02-28)

### Service Worker (sw.js v5)
- **プリキャッシュ**: `/` (SPAシェル), offline.html, manifest.json, アイコン
- **静的アセット**: stale-while-revalidate (JS/CSS/画像/フォント — 初回アクセスでキャッシュ)
- **tRPC API (GET)**: network-first (5秒タイムアウト) + 専用APIキャッシュ
  - `bunshin-ai-api-v1` キャッシュに保存、タイムスタンプヘッダー付き
  - LRU: 最大100エントリ、1時間有効期限 (期限切れでもオフライン時は返却)
- **ナビゲーション**: オフライン時 SPAシェル (`/`) をフォールバック → React Router描画
  - SPAシェルもなければ offline.html にフォールバック

### オフラインUIバナー
- オフライン時: 琥珀色バー「オフラインです — キャッシュデータを表示中」
- 復帰時: 緑色バー「オンラインに復帰しました」→ 3秒後に自動消去
- `aria-live="polite"` でスクリーンリーダー対応

---

## 未実装・改善必要（Phase 44以降）

### H1. グローバル検索（コマンドパレット）未実装 [HIGH]
- cmdk ライブラリはインストール済み、command.tsx UIコンポーネントも存在するが完全に未使用
- 109+サイドバー項目・140ルートの中にページ検索手段がゼロ
- モバイル「もっと」シートに105+アイコンの4カラムグリッドで検索不可

### H2. Stripe決済失敗（ダニング）未処理 [HIGH]
- invoice.payment_failed, customer.subscription.past_due Webhookイベント未処理
- 決済失敗時のユーザー通知・バナー表示なし
- 解約リテンションフロー（割引/一時停止/退会理由）なし

### M1. サイドバー・ナビゲーション過負荷 [MEDIUM]
- 「つながる」53項目 + 「もっと」48項目がフラットリスト
- 折りたたみ/サブグループなし、アイコン重複9種
- Suspense境界がビューポート全体を置換（レイアウトシフト）

### M2. ライフサイクル通知自動化なし [MEDIUM]
- 全通知がトランザクショナルのみ（ユーザーアクション起因）
- リエンゲージメントメール/週次ダイジェスト/チャーン検知の自動化ゼロ
- デイリーブリーフィング/ダイジェストはオンデマンドのみ（プッシュ配信なし）

### L1. matching.ts(8,511行)/twins.ts(4,956行)が巨大 [LOW]
- テスタビリティ・保守性に影響
- 9ルーターに統合テストカバレッジなし
- クライアント側ユニットテスト0件

---

## バグ・セキュリティ問題（Phase 45深層分析で発見、2026-03-03）

### BUG-1. matchingsThisMonth カウンター未インクリメント [CRITICAL]
- matching.ts L282/662/1675で参照されるが、どこでも+1しない
- 月間マッチング上限が実質無制限

### BUG-2. exportReport 認可バグ [HIGH]
- matching.exportReport (L814) にオーナーシップチェックなし
- 任意の認証済みユーザーが他人のマッチングレポートをsessionId推測でエクスポート可能

### BUG-3. admin ban/warn 未実装 [HIGH]
- admin.reviewReport の warn_user / ban_user アクションはDB記録のみ
- 実際の警告送信・アカウント停止処理なし（bannedユーザーが通常利用可能）

### SEC-1. アカウント削除不完全 (GDPR Article 17) [CRITICAL]
- auth.deleteAccountが37テーブルのみ削除、残り130+テーブルのユーザーデータが孤立
- R2オブジェクト(avatars/uploads/cards)も未削除

### SEC-2. JWTセッション無効化手段なし [HIGH]
- JWT 1年有効で失効手段なし（logoutはcookie削除のみ、token自体は有効のまま）
- パスワード変更後も既存セッション無効化なし

### SEC-3. JWT_SECRETハードコードフォールバック [HIGH]
- trpc.ts L46 に `JWT_SECRET || "bunshin-ai-dev-secret-..."` — 設定ミスで認証バイパスリスク

### SEC-4. friends.searchUsers メールアドレス漏洩 [HIGH]
- email カラムを返却 — 認証済みユーザーが全ユーザーのメールアドレスを収集可能

### SEC-5. SELECT * による機密フィールドメモリロード [MEDIUM]
- 複数ルーターでSELECT * FROM users → passwordHash, stripeCustomerId等がメモリにロード

### SEC-6. 監査ログゼロ [MEDIUM]
- ログイン試行/パスワード変更/データエクスポート/管理者操作の記録なし

### PERF-1. ログイン/登録にブルートフォース保護なし [HIGH]
- ロックアウト/CAPTCHA/IP制限ゼロ

### PERF-2. LLMトークン使用量破棄 [MEDIUM]
- invokeLLM から返却されるがコスト可視性ゼロ

### PERF-3. error_logs テーブル書き込みゼロ [MEDIUM]
- admin.getErrorStats が error_logs テーブルを参照するが書き込みがゼロ — 常に空データ返却

---

## インフラ・UX・テスト問題（Phase 46深層分析で発見、2026-03-03）

### INFRA-1. Service Worker がViteアセット未プリキャッシュ [HIGH]
- sw.js がViteのハッシュ付きJS/CSSを一切プリキャッシュしない（STATIC_ASSETSに6静的ファイルのみ）
- APIキャッシュが異ドメイン(pages.dev↔workers.dev)でバイパスされ無効
- キャッシュ有効期限チェックコードがゼロ — 永久にstaleデータを返却

### INFRA-2. Webhook配信関数がゼロ [HIGH]
- webhooksテーブルは登録のみ — triggerWebhook等の配信関数が不在
- failCountカラムは存在するがインクリメントされない
- APIキーのpermissionsフィールドが保存のみでチェックなし

### INFRA-3. APIキー認証コード重複 [MEDIUM]
- index.ts L920-931 / L936-947 にコピペ重複

### UX-1. オンボーディングステップ永続化なし [HIGH]
- sessionStorageのみ保存 — ブラウザを閉じるとstep 0に戻る
- NPCのuser_profiles/knowledge_baseが未作成（マッチングプロンプトのコンテキスト空）
- ダッシュボード "おかえりなさい" が初回訪問でも表示

### UX-2. 画像最適化ゼロ [MEDIUM]
- img タグに loading="lazy" / srcset / decoding="async" がゼロ
- 512px PWAアイコンが375KB PNG（WebP未変換）

### I18N-1. 132/136ページがハードコード日本語 [MEDIUM]
- t()を使っているのは4ページのみ（Home, Login, Register, Marketplace）
- 推定1,500+の翻訳キーが必要（300既存 + 1,200新規）

### TEST-1. Phase 39-43の全機能にE2Eテストゼロ [HIGH]
- VoiceNotes, TwinFaq, DailyBriefing, SessionBookmarks, BrainstormMode等
- E2Eテストが本番環境に直接アクセス（テストデータ蓄積）

### TEST-2. クライアントサイドユニットテスト0件 [MEDIUM]
- @testing-library/react 未インストール
- CI/CDにLint/セキュリティスキャンなし

### API-1. 公開APIが2エンドポイントのみ [MEDIUM]
- GET /api/v1/twin と GET /api/v1/matchings のみ

### PERF-4. バックグラウンド再検証がevent.waitUntil()未使用 [LOW]
- SW停止でキャッシュ更新が途中終了する可能性

---

## WebSocket/DO信頼性・R2・LINE問題（Phase 47深層分析で発見、2026-03-03）

### WS-1. Chat isStreamingスタック (P0) [CRITICAL]
- WS切断時にisStreamingがtrueのまま永久固定 → ユーザーロックアウト

### WS-2. メッセージ消失 (P0) [CRITICAL]
- WS sendが成功→直後にソケット閉じた場合、メッセージは未到達だがエラーなし

### WS-3. ハートビート/ping-pong不在 (P1) [HIGH]
- 全3フックにハートビートなし。NAT 60秒アイドルタイムアウトでstale接続

### WS-4. 再接続時の状態復旧なし (P1) [HIGH]
- 切断中にサーバーで完了したLLMストリームは永久に失われる

### WS-5. 固定3秒再接続間隔 (P1) [HIGH]
- 指数バックオフ/ジッターなし。thundering herd発生リスク

### DO-1. dialogueStartedフラグ消失 (P0) [CRITICAL]
- matching-room.ts — インメモリのみ。hibernation wakeで false にリセット → 2重対話生成

### DO-2. Workspace永続化なし (P0) [CRITICAL]
- workspace-room.ts — アイテム変更がブロードキャスト専用で永続化なし。OT/CRDTも不在

### DO-3. 全3 DOにアラーム未使用 [HIGH]
- 放棄セッション(running状態+接続者ゼロ)が永遠に残存

### R2-1. 孤立ファイル蓄積 [MEDIUM]
- アバター更新時に旧ファイルがR2に残存、一時ファイルも永久保存
- 使用量モニタリング/管理UIなし

### LINE-1. LINE Bot実用化未完了 [MEDIUM]
- テキストのみ対応（画像/スタンプ/位置情報無視）、Flex Message未使用
- グループチャットでメンションフィルタなし（全メッセージにLLM応答）

---

## DB設計・エラーハンドリング・バンドル問題（Phase 48深層分析で発見、2026-03-03）

### DB-1. 95+テーブルにインデックスゼロ [CRITICAL]
- 160テーブル中95+テーブルにインデックスなし。フルテーブルスキャン常態化
- マイグレーション追跡なし。40+ ALTER TABLEが毎コールドスタートで実行→サイレント失敗

### DB-2. FK制約ゼロ + 孤立レコード蓄積 [CRITICAL]
- 160テーブルにFOREIGN KEY制約がゼロ。PRAGMA foreign_keys = ONもなし
- twins削除時にknowledge_base/chat_sessions等が孤立

### DB-3. N+1クエリパターン [HIGH]
- friends.ts: 友達ごとに4クエリ（20友達=80クエリ）
- matching.ts: ループ内SELECT複数箇所

### ERR-1. tRPCエラーハンドリング不統一 [MEDIUM]
- 27ルーターでtry/catchパターン不統一
- D1エラー/LLM障害のエラー型が場所ごとに異なる
- グローバルエラーミドルウェア不在

### BUNDLE-1. フロントエンドバンドル最適化不足 [MEDIUM]
- DashboardLayout.tsxが94アイコンをlucide-reactからインポート
- Dashboardウィジェット10個が全て静的import
- rechartsがmanual chunkに含まれていない

---

## 型安全性・CF Pages・状態管理・a11y問題（Phase 49深層分析で発見、2026-03-03）

### TYPE-1. 199個のas any（73ファイル） [CRITICAL]
- 12ページが `const t = trpc as any;` でtRPCクライアント全体をanyキャスト
- auth.me戻り型にonboardingCompleted/tosAcceptedAt/avatarUrl未含有

### TYPE-2. vite-env.d.ts不在 [HIGH]
- import.meta.envの7つのVITE_*変数にTypeScript型定義なし
- API_BASEが7ファイルでコピペ重複

### PAGES-1. Cloudflare Pages セキュリティヘッダー不在 [CRITICAL]
- client/public/_headersファイル不在 — フロントエンドHTML/JS/CSSにCSP/HSTS/X-Frame-Optionsがゼロ
- Viteハッシュ付きアセットにCache-Control未設定

### STATE-1. 巨大useState問題 [MEDIUM]
- Twins.tsx: 27個のuseState（1,400行単一コンポーネント）
- WorkspaceDetail.tsx: 26個のuseState
- 全体で667個のuseState、useReducer使用ゼロ

### A11Y-1. 95+ページにARIA属性ゼロ [MEDIUM]
- aria-live領域が全アプリで4箇所のみ
- alt属性13箇所のみ、sr-onlyテキスト17箇所のみ

### FORM-1. クライアントサイドバリデーション不在 [MEDIUM]
- react-hook-formがインストール済みだが全9フォームで未使用
- zodスキーマがサーバーサイドのみでクライアント未再利用

---

## Stripe本番運用・SEO・モバイル・プライバシー問題（Phase 50深層分析で発見、2026-03-03）

### STRIPE-1. 3重複チェックアウトパス [CRITICAL]
- planRouter.createCheckoutSession / stripeRouter.createCheckoutSession / REST /api/billing/checkout が重複コピペ
- stripeRouter版はyearly未対応、REST版はsuccess_url異なる

### STRIPE-2. 冪等性/顧客重複防止/レース条件 [HIGH]
- Idempotency-Keyヘッダーなし（ダブルクリックで複数セッション生成可能）
- Stripe顧客作成時にメールベース既存顧客チェックなし
- check→create→storeにロック/トランザクションなし

### SEO-1. 偽AggregateRating構造化データ [CRITICAL]
- index.html L52-56にaggregateRating "4.5/50件" がハードコード
- Google構造化データガイドライン違反 → 手動ペナルティリスク

### SEO-2. クライアントサイドのみのmeta tags [HIGH]
- usePageMetaフックが全てclient-side JS — 検索クローラー/ソーシャルプレビューが取得不能
- sitemap.xmlが11件の静的URLのみ（動的URLなし）

### MOBILE-1. 50+ページにレスポンシブブレークポイントゼロ [MEDIUM]
- useIsMobileフックがDashboardLayout以外で使用ゼロ
- 「もっと」モバイルシートに76+アイテムの4カラムグリッド（検索/グルーピングなし）
- Rechartsチャートがモバイルでオーバーフロー

### PRIVACY-1. Cookie同意不在 + Sentry無同意トラッキング [CRITICAL]
- Cookie同意バナーが完全不在
- Sentryのbrowser tracing/session replayが同意なしで自動開始（GDPR/ePrivacy違反リスク）
- PrivacyPolicy.tsx L115の「トラッキングCookieなし」記述とSentry実装が矛盾

### MONITOR-1. Core Web Vitals + Worker側モニタリング不在 [HIGH]
- web-vitalsライブラリ未導入、Googleの検索ランキングシグナル不可視
- Worker側にSentry/モニタリングがゼロ（APIエラー/レイテンシ/D1クエリ遅延の可視化なし）

---

## メールXSS・認証・チャットUX・ロギング問題（Phase 51深層分析で発見、2026-03-03）

### EMAIL-1. メール12箇所にXSS脆弱性 [CRITICAL]
- auth.ts, notifications.ts, matching.ts, twins.tsの12箇所でユーザー制御値(name/theme/twin.name)がエスケープなしでHTML内に直接挿入
- escapeHtml()関数はtrpc.tsに存在するが12箇所全てで未使用
- 8/12箇所でResend APIレスポンスを完全無視（サイレント失敗）

### EMAIL-2. CAN-SPAM/特定電子メール法違反 [HIGH]
- Unsubscribeメカニズムがゼロ（List-Unsubscribeヘッダーなし、配信停止リンクなし）
- 物理住所なし、送信者識別不十分
- fromアドレス不統一（noreply@bunshin-ai.com vs noreply@bunshin-ai.pages.dev）
- バウンス/コンプレイント処理なし（Resend Webhookエンドポイントなし）

### AUTH-1. パスワードバリデーション不一致 [CRITICAL]
- サーバー: z.string().min(8)、クライアント: password.length < 6、UI: 「6文字以上」
- 6-7文字パスワードでクライアントは通過するがサーバーで500エラー
- 複雑性チェック(大小英数記号/辞書チェック)ゼロ — "12345678"が通る

### AUTH-2. MFA/2FAゼロ [HIGH]
- ビジネスマッチングプラットフォームにemail+passwordのみ
- InputOTPコンポーネントはUI showcaseに存在するが未接続
- TOTPシークレット保存/バックアップコード/MFA登録フローなし

### AUTH-3. Cronジョブ冪等性なし [HIGH]
- handleScheduled()でauto-matchingのnextRunAtは処理完了後に更新
- Cron二重実行でマッチングセッションが重複生成される
- password_reset_tokens/email_verification_tokensの期限切れクリーンアップなし

### CHAT-1. メッセージ検索・削除・エクスポートなし [HIGH]
- chat.tsに検索エンドポイントなし、Chat.tsxに検索UIなし
- 個別メッセージ削除不可（セッション一括削除のみ）
- チャットセッションのエクスポート機能なし

### SEARCH-1. D1 FTS5完全未使用 [HIGH]
- 全search系がLIKE '%query%'（インデックス利用不可・O(n)スキャン）
- FTS仮想テーブルゼロ
- twins.searchPublicがqueryパラメータを完全無視（Discoverページ検索が機能しない）

### MODERATION-1. コンテンツフィルタリングゼロ [HIGH]
- chat.sendMessage/chat-room.tsでユーザーメッセージがバリデーションなしでDB直挿入
- LLM出力の安全チェックなし
- ban_userアクションがprotectedProcedureで未チェック（bannedユーザーがAPI利用可能）
- ユーザー向けReportボタンがUIに不在

### LOG-1. 構造化ロガーが27ルーターで未使用 [HIGH]
- logger.ts + middleware.tsが存在するがtRPCルーターで使用ゼロ
- requestIdがtRPCコンテキストに未伝播
- 17,000行のWorkerコードに4つのconsole.log文のみ

### EXPORT-1. GDPRデータエクスポート不完全 [HIGH]
- auth.exportMyDataがchat_messages/matching_dialogues/knowledge_base/matching_results等を除外
- セッションCOUNTのみ返却（実質データなし）
- GDPR Article 20（データポータビリティ）不完全

---

## LLMコスト・品質・並行性・マーケットプレイス問題（Phase 52深層分析で発見、2026-03-03）

### LLM-1. 134箇所のinvokeLLM()でトークン使用量を完全破棄 [CRITICAL]
- LLMResult.usageフィールド(promptTokens/completionTokens)が全呼び出し元で未参照
- コスト可視性ゼロ、ユーザー別/機能別のコスト帰属不能
- evaluateByAllTwins()で最大180回/runPersonaABTest()で35回のLLMコールが単一リクエスト内で発生（バジェット制限なし）

### LLM-2. リトライ/サーキットブレーカー/フォールバックゼロ [CRITICAL]
- 全LLMプロバイダー呼び出しが単発fetch()で障害時に即エラー
- クロスプロバイダーフォールバックなし（User優先プロバイダー障害→全機能停止）
- Azure Foundryダウン時にフリーティア全ユーザーの全LLM機能が停止

### LLM-3. プロンプトインジェクション脆弱性（クロスユーザー） [CRITICAL]
- twinDesc/personality/bio等のユーザー制御テキストがsanitize無しでLLMシステムプロンプトに直接挿入
- マッチングではUser Aのツイン人格がUser Bに影響するクロスユーザーベクター
- 134箇所全てのプロンプトがインラインハードコード（バージョニング/テンプレート管理なし）

### LLM-4. JSON出力パース脆弱・maxTokens過大 [HIGH]
- `content.match(/\{[\s\S]*\}/)` の貪欲マッチ → スキーマバリデーションなし
- ~40箇所がデフォルトmaxTokens=4096（期待出力256トークン以下でも）
- 構造化出力モード(OpenAI response_format/Gemini responseMimeType)未使用

### RACE-1. ポイント二重消費（レース条件） [CRITICAL]
- points.redeemProduct / marketplace.purchase にread-then-writeレース条件
- 2並行リクエストで残高以上の消費が可能
- アトミックUPDATE未使用、D1トランザクションなし

### LEAK-1. APIキー平文フロントエンド露出 [CRITICAL]
- ai-config.list がSELECT * → OpenAI/Gemini/Anthropic/GrokのAPIキーが平文でブラウザに到達
- XSS経由で全ユーザーのLLM APIキーが窃取可能

### LEAK-2. SELECT * によるpasswordHash/stripeCustomerId露出 [HIGH]
- twins.searchPublic / getPublicTwin がSELECT * FROM users → 全認証ユーザーに機密データ露出

### XSS-1. 埋め込みカード(/api/embed/:twinId)にescapeHtml()未適用 [HIGH]
- name/company/desc/tagsがHTMLにエスケープなしで挿入
- escapeHtml()は同ファイルに存在するが未使用

### SSRF-1. Clawdbot gatewayUrl にURL/ドメインバリデーションなし [HIGH]
- z.string()のみでプライベートIP/内部エンドポイントへのアクセスが可能

### MARKET-1. 3重複テンプレート/マーケットプレイスシステム [HIGH]
- ペルソナテンプレート(marketplace) / マッチングシナリオ(scenario) / ツインテンプレート(gallery) が各自の購入/レビュー/承認フローを持つ
- marketplace.purchaseでクリエイター収益分配ゼロ（scenario.purchaseは70%分配済み）
- scenario.publishが管理者承認なし（isApproved=1即時設定）

### FEED-1. フィードN+1クエリ（20アイテム=60追加クエリ） [HIGH]
- feed.listがアイテムごとにlikeCount/commentCount/likedを3クエリ
- フィード自動投稿(auto-publish)が未接続（matching完了/アチーブメント時にトリガーなし）

### TIMEOUT-1. 全外部API fetch()にタイムアウトゼロ [HIGH]
- LLM/LINE/Slack/Stripe/Tavily/Resend/Clawdbot/WebPush全てにAbortControllerなし
- 外部APIハングでWorkerが30秒CPU制限まで無応答

---

## Cron自動化・Admin管理・CI/CD・デッドコード問題（Phase 53深層分析で発見、2026-03-03）

### CRON-1. auto-matchingがプラン制限を完全バイパス [HIGH]
- matching.createはmatchingsThisMonthを検証するがcronハンドラ(index.ts L1350-1438)は未チェック
- フリーユーザーがdaily scheduleで無制限マッチング可能

### CRON-2. briefing SQLのカラム名バグ [HIGH]
- matching.generateBriefing (matching.ts L8052) が userId1/userId2 を参照するが friendships テーブルは userId/friendId
- 友達数が常に0で不正確なブリーフィング

### CRON-3. Cron二重実行で重複マッチング [MEDIUM]
- nextRunAtを処理完了後に更新 → 並行invocationで同一scheduleが2回実行
- ScheduledEvent.cronを無視（daily/weeklyで同一ロジック実行）

### CRON-4. stale 'running' セッション未クリーンアップ [MEDIUM]
- Worker crash/タイムアウト後にmatching_sessionsが永久running状態
- 期限切れトークン/既読通知のクリーンアップなし（D1ストレージ肥大化）

### CRON-5. WebPush暗号化なし [MEDIUM]
- notifications.ts L46-117 がペイロードをプレーンテキスト送信（Web Push protocolはECDH暗号化必須）
- 全プッシュ通知がサイレント失敗

### ADMIN-1. warn_user/ban_userが未実装 [HIGH]
- admin.reviewReportがアクション受理するがDB更新/通知/ログイン阻止なし
- usersテーブルにisBanned/bannedAtカラムなし
- AdminReview.tsxにwarn/banボタン非表示

### ADMIN-2. adminルートにフロントエンドガードなし [HIGH]
- /admin/*に認証済み全ユーザーがURL直アクセス可能
- バックエンド403返却するがAdminGuardコンポーネントなし

### AUTH-4. パスワード変更機能ゼロ [HIGH]
- auth.changePasswordエンドポイントなし
- ログイン済みユーザーがパスワード変更不可（リセットメール経由のみ）

### ROUTE-1. ProtectedRoute/PlanGateコンポーネントなし [HIGH]
- 140+ルートの保護がDashboardLayout依存のみ
- プレミアム機能にフロントエンドゲートなし
- onboardingCompleted=0でも/dashboardにURL直アクセス可能

### ERR-2. ErrorBoundaryが本番でstacktrace表示 [HIGH]
- error.stackが<pre>で全ユーザーに露出
- ページ/コンポーネント単位のErrorBoundaryなし（全アプリ単一）

### CICD-1. 自動デプロイなし [CRITICAL]
- Worker/Pagesの全デプロイが手動（CDステップゼロ）
- PRプレビューデプロイなし

### CICD-2. パッケージマネージャー不整合 [HIGH]
- packageManager: pnpm宣言だがCIはnpm ci
- package-lock.jsonとpnpm-lock.yaml両方存在

### CICD-3. 未使用依存関係14件 [HIGH]
- express, mysql2, axios, dotenv, @aws-sdk/client-s3, pptxgenjs, drizzle-orm等
- 推定200MB+のnode_modules肥大化

### CICD-4. Lintなし + E2Eが本番URL [HIGH]
- ESLint/Biome未設定、CIにPrettierチェックなし
- E2Eテストがhttps://bunshin-ai.pages.devに直接アクセス（PRブランチ変更をテストせず）

### DEAD-1. drizzle/ディレクトリ (45+ファイル) がデッドコード [MEDIUM]
- MySQL用スキーマ/マイグレーション、ManusDialog.tsx, Map.tsx等の未使用コンポーネント
- .env.exampleがMySQL/Manus Oauthの陳腐化した変数を参照
- 7個のWorker環境変数がwrangler.tomlに未記載

### BUILD-1. mermaid 3.1MB + shiki ~1.5MB がビルド肥大化 [HIGH]
- ComponentShowcase (261KB) が本番ビルドに含まれる
- rechartsが独立チャンクに未分離

### NPC-DATA. NPC品質不足 [MEDIUM]
- NPCにuser_profiles/knowledge_base/personality_profiles未作成
- マッチング対話でプロフィール/知識/人格コンテキストが全て空
- テーマ切替無効化(switchable=false)、プリファレンスのサーバー保存なし

---

## Phase 83: 監視基盤 + WebPush修復 + i18n拡張 + DO永続化 + テスト基盤（2026-03-03）

### 調査概要
3並列エージェントで以下を調査:
- Agent 1: Sentry / WebPush / Durable Objects ctx.storage
- Agent 2: i18n カバレッジ / a11y / テストインフラ
- Agent 3: （前セッションコンテキスト限界により未起動、Agent 1-2 の発見で5件充足）

### 発見事項一覧

| ID | カテゴリ | 重要度 | 発見内容 |
|---|---|---|---|
| SENTRY-1 | 監視 | HIGH | @sentry/react インストール済み、initSentry() 実装済みだが VITE_SENTRY_DSN が未設定 → 全エラー捕捉ゼロ |
| SENTRY-2 | 監視 | HIGH | Worker 側に @sentry/cloudflare 未導入 → サーバーサイドエラー完全不可視 |
| WEBPUSH-1 | 通知 | HIGH | sendWebPush() が aes128gcm を宣言するがペイロード暗号化処理なし → Web Push RFC 8291 違反 |
| WEBPUSH-2 | 通知 | HIGH | Buffer.from() を5箇所で使用 → CF Workers ランタイムエラー → 全プッシュ通知サイレント失敗 |
| I18N-1 | 国際化 | MEDIUM | 137ページ中4ページのみ useTranslation() 使用（カバレッジ3%）、133ページが日本語ハードコード |
| I18N-2 | 国際化 | MEDIUM | ja.json/en.json に299キー存在するが主要ページ（Dashboard, Twins, Matching）が未対応 |
| DO-1 | 永続化 | MEDIUM | ChatRoom/MatchingRoom/WorkspaceRoom で ctx.storage 使用ゼロ、全状態がインメモリ |
| DO-2 | 永続化 | MEDIUM | new_sqlite_classes 宣言済みだが SQLite 永続化未活用 → DO 再起動で全状態消失 |
| A11Y-1 | アクセシビリティ | MEDIUM | 137ページ中118ページで aria 属性ゼロ、キーボードナビゲーション非対応 |
| TEST-1 | テスト | MEDIUM | @testing-library/react 未インストール、コンポーネントテスト0件 |
| TEST-2 | テスト | MEDIUM | 27ルーターにユニットテスト0件（94テストは全て結合テスト） |
| TEST-3 | テスト | MEDIUM | E2E テストが本番 URL に直接アクセス、ステージング環境なし |

### タスク対応表

| タスク# | 優先度 | 対応する発見 | 内容 |
|---|---|---|---|
| #187 | HIGH | SENTRY-1, SENTRY-2 | Sentry 有効化（クライアント DSN 設定 + Worker 側導入） |
| #188 | HIGH | WEBPUSH-1, WEBPUSH-2 | WebPush 暗号化修復（aes128gcm 実装 + Buffer.from 置換） |
| #189 | MEDIUM | I18N-1, I18N-2 | i18n カバレッジ拡張（主要20ページの翻訳キー抽出） |
| #190 | MEDIUM | DO-1, DO-2 | DO 状態永続化（ctx.storage 活用、3 DO 全て） |
| #191 | MEDIUM | TEST-1, TEST-2, TEST-3 | テスト基盤構築（コンポーネントテスト + ステージング環境） |

### Wave 実装順序（Phase 78〜83 統合）

| Wave | タスク | 並列度 | 理由 |
|---|---|---|---|
| Wave 1 | #164(JWT), #169(IDOR), #177(API暗号化) | 3並列 | セキュリティ CRITICAL — 認証バイパス・データ漏洩の即時修正 |
| Wave 2 | #165(QueryClient), #170(LLM), #187(Sentry) | 3並列 | 可観測性 + 安定性 — エラー監視とLLMリトライで障害対応可能に |
| Wave 3 | #171(バリデーション), #178(データ漏洩), #188(WebPush) | 3並列 | 入力検証 + 通知修復 — ユーザー対面機能の修正 |
| Wave 4 | #166(壊れた機能), #179(プロンプトインジェクション), #182(デッドコード) | 3並列 | 機能修正 + セキュリティ + クリーンアップ |
| Wave 5 | #172(Stripe), #180(God-router), #183(tRPCエラー) | 3並列 | 課金安定化 + 保守性改善 |
| Wave 6 | #173(ensureSchema), #181(Webhook+SW), #190(DO永続化) | 3並列 | インフラ最適化 — コールドスタート・状態永続化 |
| Wave 7 | #167(コマンドパレット), #184(ESLint), #191(テスト基盤) | 3並列 | DX + 品質ゲート — 開発体験と自動チェック |
| Wave 8 | #168(NPC), #185(devスクリプト), #186(ダークモード), #189(i18n) | 3-4並列 | UX 改善 — NPC品質・テーマ・多言語化 |

---

## Phase 84: GDPR削除補完 + 課金カウンター修復 + CI/CD復旧 + バンドル最適化 + 壊れた機能修復（2026-03-03）

### 調査概要
3並列エージェント（opus）で以下を調査:
- Agent 1: deleteAccount GDPR 補完 / E2Eフロー整合性 / コミット済みシークレット / error_logs テーブル
- Agent 2: CI/CD パイプライン / バンドルサイズ / Service Worker / パッケージマネージャー不整合 / デッドコード
- Agent 3: NegotiationSimulator / twin_skill_levels / twin_growth_status / quests.checkDailyLogin / レート制限 / Cron

### 発見事項一覧

| ID | カテゴリ | 重要度 | 発見内容 |
|---|---|---|---|
| GDPR-1 | プライバシー | HIGH | deleteAccount が 41/171 テーブル (24%) のみ削除。130テーブルにユーザーデータ残留（感情日記、性格診断、ツイン記憶、SNS活動、ワークスペース等） |
| GDPR-2 | プライバシー | HIGH | 各 DELETE が個別 try/catch でエラー握り潰し → 削除失敗を検知不能 |
| BILLING-1 | 課金 | CRITICAL | matchingsThisMonth がコードベース全体でインクリメントされない → free プラン月3件制限が完全非機能 |
| BILLING-2 | 課金 | MEDIUM | register フローで usage_tracking 初期行が作成されない可能性 |
| CICD-1 | CI/CD | CRITICAL | .github/workflows/ が存在しない（ci.yml 削除済み）→ 自動テスト/型チェック/ビルド検証ゼロ |
| CICD-2 | CI/CD | HIGH | package-lock.json と pnpm-lock.yaml が両方存在。packageManager: pnpm@10.4.1 だが devDeps に pnpm@^10.15.1 も重複 |
| BUNDLE-1 | パフォーマンス | HIGH | mermaid 3.1MB チャンクが client/src/ に直接 import ゼロなのにビルドに含まれる（間接依存）+ KaTeX フォント 1.2MB |
| BUNDLE-2 | パフォーマンス | MEDIUM | ComponentShowcase (261KB) が /dev/showcase ルートで本番ビルドに含まれる |
| BUNDLE-3 | パフォーマンス | MEDIUM | recharts (291KB) が manualChunks 未設定で最適分割されていない |
| BUNDLE-4 | パフォーマンス | LOW | framer-motion (5.7MB node_modules) が import ゼロ。drizzle/ (47ファイル/1.9MB) がデッドコード |
| SW-1 | パフォーマンス | HIGH | SW の apiStaleWhileRevalidate で fetchPromise が waitUntil() に渡されていない → バックグラウンド更新がサイレント停止 |
| NEGO-1 | 壊れた機能 | CRITICAL | NegotiationSimulator: フロント↔バックエンドのフィールド名が5箇所で不一致（sessionId↔id, opponentMessage↔openingMessage 等） |
| SKILL-1 | 壊れた機能 | CRITICAL | completeLesson/completeRoleplay が skillName/xp を参照するが DB カラムは skillType/level |
| SKILL-2 | 壊れた機能 | HIGH | getIdentityCard が s.skill/s.experience を参照（存在しないカラム） |
| LINE-1 | 壊れた機能 | HIGH | LINE handler が totalExperience カラムを参照するが実際は experience |
| QUEST-1 | 壊れた機能 | MEDIUM | quests.checkDailyLogin がポイント返却するが永続化しない（フロントは points.checkDailyLogin を呼ぶので実害限定的） |
| REG-1 | 整合性 | MEDIUM | register フローが 7+ DB操作を batch() なしで順次実行 → 途中失敗で不整合データ発生 |
| RATE-1 | 信頼性 | MEDIUM | レート制限が in-memory Map → Worker 再起動でリセット、エッジロケーション間で共有されない |

### タスク対応表

| タスク# | 優先度 | 対応する発見 | 内容 |
|---|---|---|---|
| #192 | HIGH | GDPR-1, GDPR-2 | deleteAccount GDPR 補完（130テーブル追加 + batch() 統合） |
| #193 | HIGH | BILLING-1, BILLING-2 | matchingsThisMonth インクリメント修復（3箇所 + UPSERT） |
| #194 | HIGH | CICD-1, CICD-2 | CI/CD パイプライン復旧（pnpm ベース GHA + lockfile 統一） |
| #195 | MEDIUM | BUNDLE-1〜4, SW-1 | バンドル最適化（mermaid除去 + Showcase除外 + recharts分離 + デッド依存削除） |
| #196 | MEDIUM | NEGO-1, SKILL-1〜2, LINE-1, QUEST-1 | 壊れた機能一括修復（フィールド名不一致5箇所 + カラム名修正4箇所） |

### Wave 実装順序（Phase 78〜84 統合・更新版）

| Wave | タスク | 並列度 | 理由 |
|---|---|---|---|
| Wave 1 | #164(JWT), #169(IDOR), #177(API暗号化) | 3並列 | セキュリティ CRITICAL — 認証バイパス・データ漏洩の即時修正 |
| Wave 2 | #193(課金カウンター), #192(GDPR), #196(壊れた機能) | 3並列 | 課金非機能 + GDPR違反 + 完全に壊れた機能の即時修復 |
| Wave 3 | #165(QueryClient), #170(LLM), #187(Sentry) | 3並列 | 可観測性 + 安定性 — エラー監視とLLMリトライ |
| Wave 4 | #194(CI/CD), #171(バリデーション), #178(データ漏洩) | 3並列 | 品質ゲート復旧 + 入力検証 |
| Wave 5 | #188(WebPush), #179(プロンプトインジェクション), #182(デッドコード) | 3並列 | 通知修復 + セキュリティ + クリーンアップ |
| Wave 6 | #195(バンドル最適化), #172(Stripe), #180(God-router) | 3並列 | パフォーマンス + 課金安定化 + 保守性 |
| Wave 7 | #173(ensureSchema), #181(Webhook+SW), #190(DO永続化) | 3並列 | インフラ最適化 — コールドスタート・状態永続化 |
| Wave 8 | #183(tRPCエラー), #184(ESLint), #191(テスト基盤) | 3並列 | エラーハンドリング + Lint + テスト |
| Wave 9 | #167(コマンドパレット), #185(devスクリプト), #186(ダークモード) | 3並列 | DX + UX 改善 |
| Wave 10 | #166(壊れた機能残り), #168(NPC), #189(i18n) | 3並列 | 機能修正 + NPC品質 + 多言語化 |

---

## Phase 85: Register原子性 + CSRF防御 + セッション失効 + Admin Guard + Cron修正（2026-03-03）

### 調査概要
3並列エージェント（opus）で以下を調査:
- Agent 1: Register フロー原子性 / error_logs テーブル / e2e 認証ファイル / R2 パストラバーサル / SW waitUntil / Cron 二重実行
- Agent 2: QueryClient 設定 / React 再レンダリング / 画像最適化 / バンドル分析 / API レスポンスサイズ
- Agent 3: JWT セッション管理 / パスワードセキュリティ / Cookie / Admin 保護 / CSRF / アカウント列挙

### 発見事項一覧

| ID | カテゴリ | 重要度 | 発見内容 |
|---|---|---|---|
| REG-1 | 整合性 | HIGH | register が 8+ 個の独立 .run() を順次実行、batch() ゼロ。ステップ6 (ensureNpcFriends) 失敗で users/twins/sessions は作成済みだが trust/email_verification 未作成 → 再登録不可の不整合状態 |
| REG-2 | 整合性 | HIGH | ensureNpcFriends (db-helpers.ts:2283) 自体も NPC あたり ~10 DB 呼び出しを個別 .run() で実行 |
| CSRF-1 | セキュリティ | HIGH | SameSite=None Cookie + CSRF トークンなし。CORS が唯一の防御だが OWASP は不十分と規定 |
| CSRF-2 | セキュリティ | HIGH | *.bunshin-ai.pages.dev ワイルドカードが CORS 許可 → Preview Deployment からの CSRF 攻撃が可能 |
| CSRF-3 | セキュリティ | MEDIUM | x-trpc-source ヘッダーが allowHeaders に含まれるがサーバー側で検証なし |
| SESS-1 | セキュリティ | CRITICAL | JWT 有効期限 1年、sessions テーブルなし、jti なし → トークン窃取で 1年間のアクセス |
| SESS-2 | セキュリティ | HIGH | auth.resetPassword がパスワードハッシュのみ更新、既存 JWT を無効化しない |
| SESS-3 | セキュリティ | HIGH | "全デバイスからログアウト" 機能が実装不可能（サーバーサイドセッション管理なし） |
| ADMIN-1 | 認可 | MEDIUM | admin.ts の各ルートが .use() で個別にチェック繰り返し、adminProcedure が未定義 → 新規ルートでチェック漏れリスク |
| ADMIN-2 | 認可 | MEDIUM | /admin/* フロントエンドルートに認証ガードなし → URL 直アクセスでページ表示（API は 403 だが UI 構造露出） |
| CRON-1 | 信頼性 | MEDIUM | event.cron パラメータ未使用 → daily/weekly の区別なし、月曜に handleScheduled が 2重実行 |
| CRON-2 | 信頼性 | MEDIUM | auto_matching_schedules に concurrency guard なし → 2重実行でマッチングが重複作成される可能性 |
| ERRLOG-1 | 監視 | LOW | error_logs テーブルの CREATE TABLE が db-helpers.ts に存在しない → admin.getErrorStats が常に空配列を返すデッド機能 |
| ERRLOG-2 | 監視 | LOW | INSERT INTO error_logs がコードベース全体でゼロ → エラー記録が完全に機能していない |
| GIT-1 | セキュリティ | MEDIUM | e2e/e2e/.auth/user.json が .gitignore でカバーされない（L21: e2e/.auth/ のみ）→ git add . で本番 JWT 誤コミットのリスク |
| AUTH-1 | セキュリティ | MEDIUM | PBKDF2 反復回数 100,000 は OWASP 2023 推奨 (600,000) を下回る |
| AUTH-2 | セキュリティ | LOW | login の応答時間差（ユーザー不在=即時 vs パスワード不正=PBKDF2計算）でメール登録有無が推測可能 |

### タスク対応表

| タスク# | 優先度 | 対応する発見 | 内容 |
|---|---|---|---|
| #197 | HIGH | REG-1, REG-2 | Register フロー原子性確保（D1 batch() トランザクション化） |
| #198 | HIGH | CSRF-1, CSRF-2, CSRF-3 | CSRF 防御（x-trpc-source 必須化 + CORS ワイルドカード削除） |
| #199 | HIGH | SESS-1, SESS-2, SESS-3 | セッション失効機構（tokenVersion + JWT 7日化 + logoutAll） |
| #200 | MEDIUM | ADMIN-1, ADMIN-2 | Admin ルートガード統一（adminProcedure + フロントエンド AdminGuard） |
| #201 | MEDIUM | CRON-1, CRON-2, ERRLOG-1, ERRLOG-2, GIT-1 | Cron 修正 + error_logs 作成 + gitignore 補完 |

### Wave 実装順序（Phase 78〜85 統合・最終版）

| Wave | タスク | 並列度 | 理由 |
|---|---|---|---|
| Wave 1 | #164(JWT秘密鍵), #169(IDOR), #199(セッション失効) | 3並列 | セキュリティ CRITICAL — 認証バイパス・トークン無効化の即時修正 |
| Wave 2 | #177(API暗号化), #198(CSRF), #197(Register原子性) | 3並列 | セキュリティ HIGH — データ暗号化・CSRF防御・データ整合性 |
| Wave 3 | #193(課金カウンター), #192(GDPR), #196(壊れた機能) | 3並列 | 課金非機能 + GDPR違反 + 完全に壊れた機能の即時修復 |
| Wave 4 | #165(QueryClient), #170(LLM), #187(Sentry) | 3並列 | 可観測性 + 安定性 — エラー監視とLLMリトライ |
| Wave 5 | #194(CI/CD), #171(バリデーション), #178(データ漏洩) | 3並列 | 品質ゲート復旧 + 入力検証 |
| Wave 6 | #188(WebPush), #179(プロンプトインジェクション), #200(Admin Guard) | 3並列 | 通知修復 + セキュリティ + 認可統一 |
| Wave 7 | #195(バンドル最適化), #172(Stripe), #182(デッドコード) | 3並列 | パフォーマンス + 課金安定化 + クリーンアップ |
| Wave 8 | #180(God-router), #173(ensureSchema), #201(Cron+error_logs) | 3並列 | 保守性 + インフラ最適化 + 監視基盤 |
| Wave 9 | #181(Webhook+SW), #190(DO永続化), #183(tRPCエラー) | 3並列 | インフラ最適化 + エラーハンドリング |
| Wave 10 | #184(ESLint), #191(テスト基盤), #167(コマンドパレット) | 3並列 | 品質ゲート + DX |
| Wave 11 | #185(devスクリプト), #186(ダークモード), #168(NPC), #189(i18n) | 3-4並列 | UX/DX 改善 + 多言語化 |
| Wave 12 | #166(壊れた機能残り) | 1並列 | 残件クリーンアップ |

---

## Phase 86: Stripe課金ライフサイクル + SQLカラム不一致 + D1スキーマ最適化 + ルート保護 + UX一貫性（2026-03-03）

### 調査概要
3並列エージェント（opus）で以下を調査:
- Agent 1: Stripe Webhook 完全性 / プランダウングレード / 価格不整合 / プラン制限未強制
- Agent 2: ensureSchema() 分析 / ALTER TABLE 安全性 / FK制約 / カラム名不一致 / インデックスカバレッジ
- Agent 3: ルート保護 / プランゲーティング / エラーハンドリング / ローディング状態 / モバイル対応

### 発見事項一覧

| ID | カテゴリ | 重要度 | 発見内容 |
|---|---|---|---|
| STRIPE-1 | 課金 | HIGH | Webhook が 3 イベントのみ処理。invoice.payment_failed / charge.dispute.created / subscription.paused が未処理 |
| STRIPE-2 | 課金 | HIGH | subscription.updated が past_due ステータスを無視 → 支払い失敗ユーザーがプレミアム継続 |
| STRIPE-3 | 課金 | HIGH | knowledge.add / files.upload にプラン制限チェックがゼロ → Free ユーザーが無制限追加可能 |
| STRIPE-4 | 法的 | HIGH | Terms.tsx にプロプラン ¥980/月と表示（実際 ¥1,480/月）→ 法的リスク |
| STRIPE-5 | 課金 | MEDIUM | プラン制限値が Plan.tsx (Free knowledge=10) とバックエンド (Free knowledge=50) で不一致 |
| STRIPE-6 | 保守性 | MEDIUM | Checkout 作成が 3 箇所に重複、プラン制限定義が 6 ファイルに分散 |
| STRIPE-7 | 課金 | MEDIUM | ダウングレード時に超過リソース (友達50→上限5) のアーカイブ/通知なし |
| SQL-1 | データ整合性 | CRITICAL | matching_sessions クエリが userId/targetUserId を参照するがスキーマは initiatorUserId（5箇所） |
| SQL-2 | データ整合性 | CRITICAL | matching_dialogues クエリが speaker を参照するがスキーマは speakerTwinId（7箇所） |
| SQL-3 | データ整合性 | HIGH | friendships クエリが userId1/userId2 を参照するが実際は userId/friendId |
| SQL-4 | データ整合性 | HIGH | matching_results クエリが userId/overallScore を参照するが実際は sessionId/compatibilityScore |
| DB-1 | パフォーマンス | HIGH | スキーマバージョニングなし: 269+ SQL が毎コールドスタートで実行（29 ALTER TABLE は全て失敗→無視） |
| DB-2 | パフォーマンス | MEDIUM | friendships(userId, status) 複合インデックスなし → 全フレンド検索がフルスキャン |
| DB-3 | パフォーマンス | MEDIUM | 60+ 新テーブルに PK 以外のインデックスがゼロ |
| DB-4 | データ整合性 | MEDIUM | FOREIGN KEY 制約ゼロ + PRAGMA foreign_keys 未有効化 → 参照整合性なし |
| ROUTE-1 | セキュリティ | MEDIUM | ProtectedRoute なし: DashboardLayout 依存のみ。使い忘れで全公開リスク |
| ROUTE-2 | UX | MEDIUM | プランゲーティングなし: 全ページが全プランユーザーにアクセス可能 |
| ROUTE-3 | 信頼性 | MEDIUM | ErrorBoundary がアプリ全体で1つ → 任意ページのエラーで全アプリクラッシュ |
| UX-1 | UX | MEDIUM | 133/137 ページがクエリエラー時に空白表示（isError フォールバック未実装） |
| UX-2 | UX | LOW | Twin 編集 save ボタンに disabled={isPending} なし → 二重送信リスク |
| UX-3 | UX | LOW | Loader2 とカスタム CSS スピナーが混在。Skeleton 未活用 |
| UX-4 | UX | LOW | LearnedPersonality.tsx が window.location.href で SPA ナビゲーション破壊 |

### タスク対応表

| タスク# | 優先度 | 対応する発見 | 内容 |
|---|---|---|---|
| #202 | HIGH | STRIPE-1〜7 | Stripe 課金ライフサイクル修復（past_due + Webhook + 制限強制 + 価格修正 + PLAN_LIMITS 一元化） |
| #203 | HIGH | SQL-1〜4 | SQL カラム名不一致一括修正（14箇所: matching_sessions/dialogues/friendships/results） |
| #204 | MEDIUM | DB-1〜4 | D1 スキーマ最適化（schema_migrations + 複合インデックス + 60+ テーブルインデックス） |
| #205 | MEDIUM | ROUTE-1〜3 | フロントルート保護（ProtectedRoute + PlanGate + per-route ErrorBoundary） |
| #206 | MEDIUM | UX-1〜4 | UX 一貫性修復（QueryErrorFallback + double-submit防止 + ローディング統一 + SPA修正） |

### Wave 実装順序（Phase 78〜86 統合・最終版）

| Wave | タスク | 並列度 | 理由 |
|---|---|---|---|
| Wave 1 | #164(JWT秘密鍵), #169(IDOR), #199(セッション失効) | 3並列 | セキュリティ CRITICAL — 認証基盤の即時修正 |
| Wave 2 | #177(API暗号化), #198(CSRF), #203(SQLカラム不一致) | 3並列 | セキュリティ + データ整合性 — 14箇所のカラム名不一致は全機能に影響 |
| Wave 3 | #197(Register原子性), #193(課金カウンター), #202(Stripe課金) | 3並列 | データ整合性 + 課金 — 登録フロー破損 + 課金制限非機能の修復 |
| Wave 4 | #192(GDPR), #196(壊れた機能), #187(Sentry) | 3並列 | GDPR + 機能修復 + 監視 — 法的リスク + ユーザー対面機能 |
| Wave 5 | #165(QueryClient), #170(LLM), #205(ルート保護) | 3並列 | 安定性 + フロント認可 — ProtectedRoute/PlanGate導入 |
| Wave 6 | #194(CI/CD), #171(バリデーション), #178(データ漏洩) | 3並列 | 品質ゲート + 入力検証 |
| Wave 7 | #188(WebPush), #179(プロンプトインジェクション), #200(Admin Guard) | 3並列 | 通知修復 + セキュリティ + 認可統一 |
| Wave 8 | #204(D1スキーマ最適化), #195(バンドル), #172(Stripe重複統合) | 3並列 | パフォーマンス + 保守性 |
| Wave 9 | #180(God-router), #173(ensureSchema), #201(Cron+error_logs) | 3並列 | 保守性 + インフラ |
| Wave 10 | #182(デッドコード), #181(Webhook+SW), #190(DO永続化) | 3並列 | クリーンアップ + インフラ |
| Wave 11 | #183(tRPCエラー), #206(UX一貫性), #184(ESLint) | 3並列 | エラーハンドリング + UX + Lint |
| Wave 12 | #191(テスト基盤), #167(コマンドパレット), #185(devスクリプト) | 3並列 | テスト + DX |
| Wave 13 | #186(ダークモード), #168(NPC), #189(i18n), #166(壊れた機能残り) | 3-4並列 | UX改善 + 多言語化 + 残件 |
