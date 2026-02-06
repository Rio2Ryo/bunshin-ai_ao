/**
 * LINE紐付けコード連携機能のテスト
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db";
import { lineConnections, users, digitalTwins } from "../../drizzle/schema";
import { linkByCode, generateLinkCode } from "../services/lineService";
import { eq } from "drizzle-orm";

describe("LINE紐付けコード連携", () => {
  let testUserId: number;
  let testTwinId: number;
  let testLineUserId: string;

  beforeEach(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    // テスト用ユーザーを作成
    const [userResult] = await db.insert(users).values({
      openId: `test-${Date.now()}`,
      name: "Test User",
      email: "test@example.com",
    });
    testUserId = userResult.insertId;

    // テスト用分身AIを作成
    const [twinResult] = await db.insert(digitalTwins).values({
      userId: testUserId,
      name: "Test Twin",
      description: "Test Description",
      personality: JSON.stringify({}),
      skills: [],
      experience: "",
      businessInfo: "",
    });
    testTwinId = twinResult.insertId;

    // テスト用LINE連携を作成（pending状態）
    testLineUserId = `line-${Date.now()}`;
    await db.insert(lineConnections).values({
      userId: 0, // 未紐付け
      twinId: 0,
      lineUserId: testLineUserId,
      lineDisplayName: "Test LINE User",
      status: "pending",
      settings: {
        receiveHeartbeat: true,
        receiveNotifications: true,
        allowVoiceMessages: true,
        language: "ja",
      },
    });
  });

  it("正常系: 有効なコードで紐付け成功", async () => {
    // コードを生成
    const code = await generateLinkCode(testLineUserId);
    expect(code).toHaveLength(6);

    // 紐付けを実行
    const result = await linkByCode(code, testUserId, testTwinId);
    expect(result.success).toBe(true);

    // 紐付け後の状態を確認
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [connection] = await db
      .select()
      .from(lineConnections)
      .where(eq(lineConnections.lineUserId, testLineUserId));

    expect(connection.userId).toBe(testUserId);
    expect(connection.twinId).toBe(testTwinId);
    expect(connection.status).toBe("active");
    expect(connection.connectedAt).toBeTruthy();

    // linkCodeとlinkCodeExpiryが削除されていることを確認
    const settings = connection.settings as any;
    expect(settings.linkCode).toBeUndefined();
    expect(settings.linkCodeExpiry).toBeUndefined();
  });

  it("エラー: 存在しないコード", async () => {
    const result = await linkByCode("INVALID", testUserId, testTwinId);
    expect(result.success).toBe(false);
    expect(result.error).toBe("連携コードが見つかりません");
  });

  it("エラー: 期限切れのコード", async () => {
    // 期限切れのコードを設定
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const expiredCode = "EXPIRE";
    const expiredTime = new Date(Date.now() - 60 * 1000).toISOString(); // 1分前

    await db
      .update(lineConnections)
      .set({
        settings: {
          receiveHeartbeat: true,
          receiveNotifications: true,
          allowVoiceMessages: true,
          language: "ja",
          linkCode: expiredCode,
          linkCodeExpiry: expiredTime,
        } as any,
      })
      .where(eq(lineConnections.lineUserId, testLineUserId));

    // 紐付けを試行
    const result = await linkByCode(expiredCode, testUserId, testTwinId);
    expect(result.success).toBe(false);
    expect(result.error).toBe("連携コードの有効期限が切れています");
  });

  it("エラー: 既に使用されたコード（再利用不可）", async () => {
    // コードを生成して1回目の紐付け
    const code = await generateLinkCode(testLineUserId);
    const firstResult = await linkByCode(code, testUserId, testTwinId);
    expect(firstResult.success).toBe(true);

    // 同じコードで2回目の紐付けを試行（別のユーザー）
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [user2Result] = await db.insert(users).values({
      openId: `test2-${Date.now()}`,
      name: "Test User 2",
      email: "test2@example.com",
    });
    const user2Id = user2Result.insertId;

    const [twin2Result] = await db.insert(digitalTwins).values({
      userId: user2Id,
      name: "Test Twin 2",
      description: "Test Description 2",
      personality: JSON.stringify({}),
      skills: [],
      experience: "",
      businessInfo: "",
    });
    const twin2Id = twin2Result.insertId;

    // 2回目の紐付けは失敗するはず（statusがactiveになっているため）
    const secondResult = await linkByCode(code, user2Id, twin2Id);
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toBe("連携コードが見つかりません"); // pending状態のものが見つからない
  });

  it("競合対策: 同じコードを同時に使用しても1回のみ成功", async () => {
    // コードを生成
    const code = await generateLinkCode(testLineUserId);

    // 2人のユーザーを作成
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [user2Result] = await db.insert(users).values({
      openId: `test2-${Date.now()}`,
      name: "Test User 2",
      email: "test2@example.com",
    });
    const user2Id = user2Result.insertId;

    const [twin2Result] = await db.insert(digitalTwins).values({
      userId: user2Id,
      name: "Test Twin 2",
      description: "Test Description 2",
      personality: JSON.stringify({}),
      skills: [],
      experience: "",
      businessInfo: "",
    });
    const twin2Id = twin2Result.insertId;

    // 同時に紐付けを実行
    const [result1, result2] = await Promise.all([
      linkByCode(code, testUserId, testTwinId),
      linkByCode(code, user2Id, twin2Id),
    ]);

    // どちらか1つだけ成功するはず
    const successCount = [result1, result2].filter((r) => r.success).length;
    expect(successCount).toBe(1);

    // 失敗した方は適切なエラーメッセージ
    const failedResult = result1.success ? result2 : result1;
    expect(failedResult.success).toBe(false);
    expect(failedResult.error).toBeTruthy();
  });

  it("コード生成: 6桁英数字", async () => {
    const code = await generateLinkCode(testLineUserId);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("コード生成: 有効期限が10分後", async () => {
    const beforeGenerate = Date.now();
    await generateLinkCode(testLineUserId);
    const afterGenerate = Date.now();

    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [connection] = await db
      .select()
      .from(lineConnections)
      .where(eq(lineConnections.lineUserId, testLineUserId));

    const settings = connection.settings as any;
    const expiry = new Date(settings.linkCodeExpiry).getTime();

    // 有効期限が現在時刻から9分50秒～10分10秒の範囲内
    const expectedExpiry = beforeGenerate + 10 * 60 * 1000;
    expect(expiry).toBeGreaterThanOrEqual(expectedExpiry - 10000);
    expect(expiry).toBeLessThanOrEqual(afterGenerate + 10 * 60 * 1000 + 10000);
  });
});
