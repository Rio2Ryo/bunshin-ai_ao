/**
 * LINE API認証情報の検証テスト
 */

import { describe, it, expect } from "vitest";

describe("LINE API認証情報の検証", () => {
  it("LINE_CHANNEL_IDが設定されている", () => {
    const channelId = process.env.LINE_CHANNEL_ID;
    expect(channelId).toBeDefined();
    expect(channelId).not.toBe("");
    // Channel IDは数字のみ
    expect(/^\d+$/.test(channelId || "")).toBe(true);
  });

  it("LINE_CHANNEL_SECRETが設定されている", () => {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    expect(channelSecret).toBeDefined();
    expect(channelSecret).not.toBe("");
    // Channel Secretは32文字の16進数
    expect(channelSecret?.length).toBe(32);
  });

  it("LINE_CHANNEL_ACCESS_TOKENが設定されている", () => {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    expect(accessToken).toBeDefined();
    expect(accessToken).not.toBe("");
    // Access Tokenは長い文字列
    expect((accessToken?.length || 0) > 100).toBe(true);
  });

  it("LINE Messaging APIにアクセスできる", async () => {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (!accessToken) {
      console.log("LINE_CHANNEL_ACCESS_TOKENが設定されていないためスキップ");
      return;
    }

    // Bot情報を取得するAPIを呼び出し
    const response = await fetch("https://api.line.me/v2/bot/info", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    // 認証が成功すれば200が返る
    expect(response.status).toBe(200);
    
    const data = await response.json();
    console.log("LINE Bot情報:", data);
    
    // Bot情報が取得できることを確認
    expect(data.userId).toBeDefined();
    expect(data.basicId).toBeDefined();
  });
});
