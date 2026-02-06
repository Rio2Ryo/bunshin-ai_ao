# LINE連携の実装箇所

## 概要

LINE連携コード（6桁英数字）を使用したアカウント紐付け機能の実装箇所を整理。

## コード形式

- **形式**: 6桁英数字（A-Z, 0-9）
- **生成方法**: `Math.random().toString(36).substring(2, 8).toUpperCase()`
- **有効期限**: 10分間
- **ワンタイム**: はい（紐付け完了後、再利用不可）

## 実装箇所

### 1. データベース（DB）

**ファイル**: `drizzle/schema.ts:1039-1069`

**テーブル**: `line_connections`

```typescript
export const lineConnections = mysqlTable("line_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),  // 1ユーザー1LINE制約
  twinId: int("twinId").notNull(),
  lineUserId: varchar("lineUserId", { length: 255 }).notNull().unique(),
  status: mysqlEnum("status", ["pending", "active", "paused", "disconnected"]),
  settings: json("settings").$type<{
    receiveHeartbeat: boolean;
    receiveNotifications: boolean;
    allowVoiceMessages: boolean;
    language: string;
    linkCode?: string;        // 6桁コード（一時的）
    linkCodeExpiry?: string;  // ISO8601形式の有効期限（一時的）
  }>(),
  // ...
});
```

### 2. サービス層（Business Logic）

**ファイル**: `server/services/lineService.ts`

#### コード生成

**関数**: `generateLinkCode()` (行402-441)

```typescript
export async function generateLinkCode(lineUserId: string): Promise<string> {
  // 1. 既存のpending連携を取得
  // 2. 6桁コードを生成
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  // 3. 有効期限を10分後に設定
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  // 4. settings.linkCode, settings.linkCodeExpiryを更新
  // 5. コードを返す
}
```

#### コード検証・紐付け

**関数**: `linkByCode(code, userId, twinId)` (行446-476)

```typescript
export async function linkByCode(
  code: string,
  userId: number,
  twinId: number
): Promise<void> {
  // 1. トランザクション開始
  // 2. pending状態の全LINE連携を取得（FOR UPDATE ロック）
  // 3. settings.linkCodeが一致するものを検索
  // 4. 有効期限チェック（settings.linkCodeExpiry）
  // 5. linkLineToUser()で紐付け実行
  // 6. settings.linkCode, settings.linkCodeExpiryを削除
  // 7. トランザクションコミット
}
```

**エラー**:
- `LINK_CODE_NOT_FOUND`: コードが見つからない
- `LINK_CODE_EXPIRED`: 有効期限切れ
- `LINK_CODE_ALREADY_USED`: 既に使用済み（statusがpending以外）

#### ユーザーと紐付け

**関数**: `linkLineToUser(lineConnectionId, userId, twinId)` (行478-512)

```typescript
export async function linkLineToUser(
  lineConnectionId: number,
  userId: number,
  twinId: number
): Promise<void> {
  // 1. userId, twinIdを更新
  // 2. statusをactiveに変更
  // 3. connectedAtを現在時刻に設定
  // 4. Clawdbotエージェントを自動作成
}
```

### 3. API層（tRPC）

**ファイル**: `server/routers.ts:2542-2567`

**プロシージャ**: `line.linkByCode`

```typescript
linkByCode: protectedProcedure
  .input(z.object({ code: z.string().length(6) }))
  .mutation(async ({ ctx, input }) => {
    // 1. 入力検証（6桁）
    // 2. linkByCode(code, ctx.user.id, twinId)を呼び出し
    // 3. 成功/失敗を返す
  }),
```

### 4. フロントエンド（React）

**ファイル**: `client/src/pages/LineLink.tsx`

**ルート**: `/line-link`

**主要機能**:
- コード入力UI（6桁、大文字変換）
- 連携状態表示（ステータス/設定/履歴タブ）
- 連携解除、一時停止機能

**API呼び出し**:
```typescript
const linkMutation = trpc.line.linkByCode.useMutation({
  onSuccess: () => {
    toast.success("LINE連携が完了しました！");
    refetch();
  },
  onError: (error) => {
    toast.error(error.message);
  },
});
```

### 5. ルーティング

**ファイル**: `client/src/App.tsx`

```typescript
<Route path="/line-link" element={<LineLink />} />
```

### 6. LINE Webhook

**ファイル**: `server/line/webhook.ts`

**イベント処理**:
- `follow`: 友だち追加時にコード生成・送信
- `message`: 未連携ユーザーにコード再送信

```typescript
case "follow":
  // 1. pending連携を作成
  // 2. generateLinkCode()でコード生成
  // 3. LINEでコードを送信
  break;
```

## 競合対策

**トランザクション + FOR UPDATE ロック**:

```typescript
await db.transaction(async (tx) => {
  // FOR UPDATE ロックで同時実行を防止
  const pendingConnections = await tx
    .select()
    .from(lineConnections)
    .where(eq(lineConnections.status, "pending"))
    .for("update");
  
  // コード検証・紐付け処理
});
```

## エラーメッセージ

| エラーコード | メッセージ | 原因 |
|---|---|---|
| `LINK_CODE_NOT_FOUND` | 連携コードが見つかりません | コードが存在しない |
| `LINK_CODE_EXPIRED` | 連携コードの有効期限が切れています | 10分経過 |
| `LINK_CODE_ALREADY_USED` | この連携コードは既に使用されています | statusがpending以外 |
| `ALREADY_LINKED` | 既に別のLINEアカウントと連携しています | userIdに既存連携あり |

## フロー図

```
[LINEユーザー]
    ↓ 友だち追加
[LINE Webhook (follow)]
    ↓ pending連携作成
[generateLinkCode()]
    ↓ 6桁コード生成
[LINE API] → コード送信
    ↓
[ユーザー] コードを確認
    ↓ Webアプリで入力
[/line-link]
    ↓ trpc.line.linkByCode.mutate()
[linkByCode()]
    ↓ トランザクション開始
    ↓ コード検証
    ↓ 有効期限チェック
[linkLineToUser()]
    ↓ userId, twinId更新
    ↓ status → active
    ↓ linkCode削除
    ↓ Clawdbotエージェント作成
[連携完了]
```

## テスト

**ファイル**: `server/line/linkByCode.test.ts`

**テストケース**:
1. 正常系: コード入力→連携成功
2. 異常系: 存在しないコード
3. 異常系: 有効期限切れ
4. 異常系: 既に使用済み
5. 競合: 同時実行で1回のみ成功

## 改善点

### 現在の実装

✅ コード生成・検証機能
✅ 有効期限チェック
✅ トランザクション + FOR UPDATE ロック
✅ コード削除（redeem）

### 今後の改善案

- [ ] コード再発行機能（UI）
- [ ] 期限切れコードの自動掃除（cron）
- [ ] QRコード生成機能
- [ ] 連携履歴の記録
