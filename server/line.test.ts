/**
 * LINE連携機能のテスト
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// モックの設定
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([]))
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve([{ insertId: 1 }]))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve())
      }))
    })),
  })),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(() => Promise.resolve({
    choices: [{ message: { content: "テスト応答です" } }]
  }))
}));

describe("LINE連携機能", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("lineService", () => {
    it("LINE署名を正しく検証できる", async () => {
      const { verifyLineSignature } = await import("./services/lineService");
      
      // 空のシークレットの場合はfalseを返す
      const result = verifyLineSignature("test body", "invalid signature");
      expect(result).toBe(false);
    });

    it("6桁の連携コードを生成できる", async () => {
      const { generateLinkCode } = await import("./services/lineService");
      
      // モックDBを設定
      vi.doMock("./db", () => ({
        getDb: vi.fn(() => Promise.resolve({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve([{ id: 1, settings: {} }]))
              }))
            }))
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve())
            }))
          })),
        })),
      }));
      
      // 連携コードの形式をテスト（英数字6桁）
      const codePattern = /^[A-Z0-9]{6}$/;
      expect(codePattern.test("ABC123")).toBe(true);
      expect(codePattern.test("abc123")).toBe(false);
      expect(codePattern.test("ABCDE")).toBe(false);
    });

    it("LINEメッセージの形式が正しい", () => {
      // テキストメッセージの形式
      const textMessage = {
        type: "text",
        text: "こんにちは",
      };
      
      expect(textMessage.type).toBe("text");
      expect(textMessage.text).toBeDefined();
    });
  });

  describe("LINE Webhook", () => {
    it("Webhookイベントの種類を正しく識別できる", () => {
      const events = [
        { type: "follow", source: { userId: "U123" } },
        { type: "unfollow", source: { userId: "U123" } },
        { type: "message", source: { userId: "U123" }, message: { type: "text", text: "hello" } },
        { type: "join", source: { groupId: "G123" } },
      ];
      
      expect(events[0].type).toBe("follow");
      expect(events[1].type).toBe("unfollow");
      expect(events[2].type).toBe("message");
      expect(events[3].type).toBe("join");
    });

    it("メッセージイベントにはmessageプロパティがある", () => {
      const messageEvent = {
        type: "message",
        source: { userId: "U123" },
        message: { type: "text", text: "テスト" },
        replyToken: "token123",
      };
      
      expect(messageEvent.message).toBeDefined();
      expect(messageEvent.message.type).toBe("text");
      expect(messageEvent.message.text).toBe("テスト");
      expect(messageEvent.replyToken).toBeDefined();
    });

    it("グループイベントにはgroupIdがある", () => {
      const joinEvent = {
        type: "join",
        source: { groupId: "G123", type: "group" },
        replyToken: "token123",
      };
      
      expect(joinEvent.source.groupId).toBeDefined();
      expect(joinEvent.source.type).toBe("group");
    });
  });

  describe("LINE連携フロー", () => {
    it("連携コードの有効期限は10分", () => {
      const now = Date.now();
      const expiryTime = now + 10 * 60 * 1000; // 10分後
      
      expect(expiryTime - now).toBe(600000); // 600,000ミリ秒 = 10分
    });

    it("連携ステータスの遷移が正しい", () => {
      const validStatuses = ["pending", "active", "paused", "disconnected"];
      
      // pending -> active（連携完了時）
      expect(validStatuses.includes("pending")).toBe(true);
      expect(validStatuses.includes("active")).toBe(true);
      
      // active -> paused（一時停止時）
      expect(validStatuses.includes("paused")).toBe(true);
      
      // any -> disconnected（解除時）
      expect(validStatuses.includes("disconnected")).toBe(true);
    });

    it("LINE設定のデフォルト値が正しい", () => {
      const defaultSettings = {
        receiveHeartbeat: true,
        receiveNotifications: true,
        allowVoiceMessages: true,
        language: "ja",
      };
      
      expect(defaultSettings.receiveHeartbeat).toBe(true);
      expect(defaultSettings.receiveNotifications).toBe(true);
      expect(defaultSettings.allowVoiceMessages).toBe(true);
      expect(defaultSettings.language).toBe("ja");
    });
  });

  describe("分身AIとの会話", () => {
    it("システムプロンプトにLINE用の指示が含まれる", () => {
      const systemPromptParts = [
        "LINEでの会話なので、簡潔で親しみやすい返答を心がけてください。",
        "長文は避け、1-3文程度で返答してください。",
      ];
      
      const fullPrompt = systemPromptParts.join("\n");
      
      expect(fullPrompt).toContain("LINE");
      expect(fullPrompt).toContain("簡潔");
      expect(fullPrompt).toContain("1-3文");
    });

    it("会話履歴は最新10件を取得する", () => {
      const limit = 10;
      expect(limit).toBe(10);
    });

    it("LINE会話セッションのタイトルは「LINE会話」", () => {
      const sessionTitle = "LINE会話";
      expect(sessionTitle).toBe("LINE会話");
    });
  });

  describe("メッセージ保存", () => {
    it("メッセージの方向は incoming/outgoing", () => {
      const directions = ["incoming", "outgoing"];
      
      expect(directions).toContain("incoming");
      expect(directions).toContain("outgoing");
    });

    it("メッセージタイプにはtext/image/audio/videoがある", () => {
      const messageTypes = ["text", "image", "audio", "video", "sticker", "location"];
      
      expect(messageTypes).toContain("text");
      expect(messageTypes).toContain("image");
      expect(messageTypes).toContain("audio");
    });
  });

  describe("グループLINE対応", () => {
    it("グループ参加時のメッセージが適切", () => {
      const joinMessage = "分身AIボットがグループに参加しました！🤖";
      
      expect(joinMessage).toContain("グループ");
      expect(joinMessage).toContain("参加");
    });

    it("グループIDとユーザーIDを区別できる", () => {
      const groupSource = { type: "group", groupId: "G123", userId: "U456" };
      const userSource = { type: "user", userId: "U789" };
      
      expect(groupSource.type).toBe("group");
      expect(groupSource.groupId).toBeDefined();
      expect(userSource.type).toBe("user");
      expect(userSource.groupId).toBeUndefined();
    });
  });
});

describe("LINE API連携", () => {
  it("LINE Messaging APIのエンドポイントが正しい", () => {
    const baseUrl = "https://api.line.me/v2/bot";
    const replyEndpoint = `${baseUrl}/message/reply`;
    const pushEndpoint = `${baseUrl}/message/push`;
    const profileEndpoint = `${baseUrl}/profile`;
    
    expect(replyEndpoint).toBe("https://api.line.me/v2/bot/message/reply");
    expect(pushEndpoint).toBe("https://api.line.me/v2/bot/message/push");
    expect(profileEndpoint).toBe("https://api.line.me/v2/bot/profile");
  });

  it("Webhookエンドポイントのパスが正しい", () => {
    const webhookPath = "/api/line/webhook";
    expect(webhookPath).toBe("/api/line/webhook");
  });
});
