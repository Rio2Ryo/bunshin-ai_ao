# LINE紐付けコード連携仕様書

## 概要
LINE公式アカウントと分身AIシステムのアカウントを紐付けるための機能。

## フロー
1. ユーザーがLINE公式アカウントを友だち追加
2. LINE側で6桁の紐付けコードを生成・表示
3. ユーザーが分身AIのWebアプリにログイン
4. Webアプリでコードを入力
5. システムが検証・紐付けを実行
6. 紐付け完了

## コード仕様
- **形式**: 6桁英数字（A-Z, 0-9）
- **生成方法**: `Math.random().toString(36).substring(2, 8).toUpperCase()`
- **有効期限**: 10分間
- **ワンタイム**: はい（紐付け成功後は再利用不可）
- **保存場所**: `line_connections.settings.linkCode` (JSON)

## データベース設計

### line_connections テーブル
```sql
CREATE TABLE line_connections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL UNIQUE,           -- 1ユーザー1LINE制約
  twinId INT NOT NULL,
  lineUserId VARCHAR(255) NOT NULL UNIQUE,
  lineDisplayName VARCHAR(255),
  linePictureUrl VARCHAR(1000),
  status ENUM('pending', 'active', 'paused', 'disconnected') DEFAULT 'pending' NOT NULL,
  settings JSON,                        -- { linkCode, linkCodeExpiry, ... }
  clawdbotAgentId VARCHAR(255),
  clawdbotAgentCreatedAt TIMESTAMP,
  totalMessages INT DEFAULT 0 NOT NULL,
  lastMessageAt TIMESTAMP,
  connectedAt TIMESTAMP,
  disconnectedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW() NOT NULL,
  updatedAt TIMESTAMP DEFAULT NOW() ON UPDATE NOW() NOT NULL
);
```

### settings JSON スキーマ
```typescript
{
  receiveHeartbeat: boolean;
  receiveNotifications: boolean;
  allowVoiceMessages: boolean;
  language: string;
  // 一時フィールド（紐付け時のみ使用）
  linkCode?: string;        // 6桁コード
  linkCodeExpiry?: string;  // ISO8601形式の有効期限
}
```

## API仕様

### POST /api/trpc/line.linkByCode
紐付けコードでLINE連携を実行

**リクエスト**:
```json
{
  "code": "ABC123"
}
```

**レスポンス（成功）**:
```json
{
  "success": true
}
```

**レスポンス（失敗）**:
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "連携コードが見つかりません"
  }
}
```

**エラーメッセージ**:
- `連携コードが見つかりません` - コードが存在しない
- `連携コードの有効期限が切れています` - 期限切れ
- `分身AIを先に作成してください` - 分身AI未作成
- `このコードは既に使用されています` - 再利用不可

## 競合対策

### 問題
同じコードが同時に複数のユーザーから使われる可能性

### 対策
1. **トランザクション**: コード検証から紐付けまでを1トランザクションで実行
2. **status制約**: `pending`状態のみ検索（`active`になったら再利用不可）
3. **userId unique制約**: 1ユーザー1LINE制約により重複紐付け防止
4. **コード削除**: 紐付け成功後、`settings.linkCode`と`settings.linkCodeExpiry`を削除

### 実装方針
```typescript
// トランザクション内で実行
await db.transaction(async (tx) => {
  // 1. コード検証（FOR UPDATE でロック）
  const conn = await tx.select()
    .from(lineConnections)
    .where(and(
      eq(lineConnections.status, "pending"),
      sql`JSON_EXTRACT(settings, '$.linkCode') = ${code}`
    ))
    .for('update')
    .limit(1);
  
  // 2. 有効期限チェック
  // 3. 紐付け実行
  // 4. コード削除
});
```

## Web UI

### URL
`/line-link`

### 画面構成
- コード入力フィールド（6桁）
- 送信ボタン
- 成功/失敗メッセージ表示
- LINE連携状態表示（既に連携済みの場合）

### 認証
- ログイン中ユーザーのみアクセス可能
- `ctx.user.id` と `ctx.user.twinId` を使用

## テストケース

1. **正常系**: 有効なコードで紐付け成功
2. **期限切れ**: 10分経過後のコードでエラー
3. **再利用**: 既に使用されたコードでエラー
4. **不正コード**: 存在しないコードでエラー
5. **競合**: 同じコードを同時に2人が使用→1人のみ成功
6. **分身AI未作成**: 分身AIがない状態でエラー

## 変更ファイル一覧

- `server/services/lineService.ts` - linkByCode関数の改善
- `server/routers.ts` - エラーメッセージの改善
- `client/src/pages/LineLink.tsx` - UI改善（既存）
- `server/line/linkByCode.test.ts` - テスト追加
- `drizzle/schema.ts` - ドキュメント追加（コメント）
