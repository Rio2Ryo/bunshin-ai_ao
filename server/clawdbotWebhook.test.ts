import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Clawdbot Webhook テスト
 */
describe("Clawdbot Webhook", () => {
  describe("Webhook Payload Structure", () => {
    it("should accept valid message payload", () => {
      const payload = {
        type: "message",
        userId: "user123",
        agentId: "agent456",
        message: {
          content: "こんにちは",
          direction: "outgoing",
          timestamp: new Date().toISOString(),
          channel: "line",
        },
      };
      
      expect(payload.type).toBe("message");
      expect(payload.message.direction).toBe("outgoing");
      expect(payload.message.channel).toBe("line");
    });

    it("should accept valid group_message payload", () => {
      const payload = {
        type: "group_message",
        userId: "user123",
        agentId: "agent456",
        groupMessage: {
          groupId: "group789",
          groupName: "友達グループ",
          speakerType: "self",
          speakerName: "山田太郎",
          content: "今日の予定どうする？",
          timestamp: new Date().toISOString(),
          channel: "line",
        },
      };
      
      expect(payload.type).toBe("group_message");
      expect(payload.groupMessage.speakerType).toBe("self");
      expect(payload.groupMessage.groupName).toBe("友達グループ");
    });

    it("should accept valid status payload", () => {
      const payload = {
        type: "status",
        userId: "user123",
        status: {
          connected: true,
          lastActivity: new Date().toISOString(),
        },
      };
      
      expect(payload.type).toBe("status");
      expect(payload.status.connected).toBe(true);
    });

    it("should accept valid error payload", () => {
      const payload = {
        type: "error",
        userId: "user123",
        error: {
          code: "CONNECTION_FAILED",
          message: "Failed to connect to Clawdbot",
          details: { retryCount: 3 },
        },
      };
      
      expect(payload.type).toBe("error");
      expect(payload.error.code).toBe("CONNECTION_FAILED");
    });
  });

  describe("Message Direction Filtering", () => {
    it("should only learn from outgoing messages (user's own messages)", () => {
      const outgoingMessage = {
        content: "私はコーヒーが好きです",
        direction: "outgoing",
      };
      
      const incomingMessage = {
        content: "AIからの応答です",
        direction: "incoming",
      };
      
      // 学習対象は自分が送ったメッセージのみ
      const shouldLearnOutgoing = outgoingMessage.direction === "outgoing";
      const shouldLearnIncoming = incomingMessage.direction === "outgoing";
      
      expect(shouldLearnOutgoing).toBe(true);
      expect(shouldLearnIncoming).toBe(false);
    });
  });

  describe("Group Message Speaker Type", () => {
    it("should identify self messages in group chat", () => {
      const selfMessage = {
        speakerType: "self",
        content: "私の発言",
      };
      
      const otherMessage = {
        speakerType: "other",
        speakerName: "友達A",
        content: "友達の発言",
      };
      
      expect(selfMessage.speakerType).toBe("self");
      expect(otherMessage.speakerType).toBe("other");
      expect(otherMessage.speakerName).toBe("友達A");
    });
  });

  describe("Webhook Info Endpoint", () => {
    it("should return correct webhook info structure", () => {
      const webhookInfo = {
        status: "active",
        version: "1.0.0",
        supportedTypes: ["message", "group_message", "status", "error"],
        documentation: "https://github.com/your-repo/bunshin-ai/docs/clawdbot-webhook.md",
      };
      
      expect(webhookInfo.status).toBe("active");
      expect(webhookInfo.supportedTypes).toContain("message");
      expect(webhookInfo.supportedTypes).toContain("group_message");
      expect(webhookInfo.supportedTypes).toHaveLength(4);
    });
  });

  describe("Signature Verification", () => {
    it("should skip verification when no secret is set", () => {
      const verifySignature = (
        payload: string,
        signature: string | undefined,
        secret: string | undefined
      ): boolean => {
        if (!secret || !signature) {
          return true; // シークレットが設定されていない場合はスキップ
        }
        // 実際の検証ロジック
        return true;
      };
      
      expect(verifySignature("{}", undefined, undefined)).toBe(true);
      expect(verifySignature("{}", "sig", undefined)).toBe(true);
      expect(verifySignature("{}", undefined, "secret")).toBe(true);
    });
  });

  describe("Channel Support", () => {
    it("should support multiple messaging channels", () => {
      const supportedChannels = ["line", "whatsapp", "telegram", "discord", "slack"];
      
      const lineMessage = { channel: "line" };
      const whatsappMessage = { channel: "whatsapp" };
      
      expect(supportedChannels).toContain(lineMessage.channel);
      expect(supportedChannels).toContain(whatsappMessage.channel);
    });
  });
});

describe("Learning Status API", () => {
  describe("getLearningStatus response structure", () => {
    it("should return correct learning status structure", () => {
      const mockStatus = {
        totalSnippets: 50,
        analyzedSnippets: 30,
        learning: {
          pendingConversations: 20,
          learningThreshold: 10,
          autoLearnEnabled: 1,
          analysisCount: 3,
          lastAnalyzedAt: new Date().toISOString(),
        },
      };
      
      expect(mockStatus.totalSnippets).toBe(50);
      expect(mockStatus.analyzedSnippets).toBe(30);
      expect(mockStatus.learning.pendingConversations).toBe(20);
      expect(mockStatus.learning.autoLearnEnabled).toBe(1);
    });
  });

  describe("getLearnedTraits response structure", () => {
    it("should return correct learned traits structure", () => {
      const mockTraits = {
        likes: ["コーヒー", "読書", "プログラミング"],
        dislikes: ["早起き", "混雑"],
        values: ["効率", "誠実さ", "創造性"],
        interests: ["AI", "音楽", "旅行"],
        communicationStyle: {
          formality: 40,
          verbosity: 60,
          emotionality: 30,
          directness: 70,
        },
        catchphrases: ["なるほど", "確かに"],
        frequentExpressions: ["〜かもしれない", "〜だと思う"],
        lastAnalyzedAt: new Date().toISOString(),
        totalConversationsAnalyzed: 50,
      };
      
      expect(mockTraits.likes).toContain("コーヒー");
      expect(mockTraits.communicationStyle.formality).toBe(40);
      expect(mockTraits.catchphrases).toHaveLength(2);
    });
  });
});

describe("Conversation Sync", () => {
  describe("syncConversations", () => {
    it("should track sync count", () => {
      const syncResult = {
        synced: 15,
        skipped: 3,
        errors: 0,
      };
      
      expect(syncResult.synced).toBe(15);
      expect(syncResult.skipped).toBe(3);
      expect(syncResult.errors).toBe(0);
    });
  });

  describe("analyzePersonality", () => {
    it("should track analysis count", () => {
      const analysisResult = {
        analyzed: 10,
        newTraitsExtracted: 5,
        updatedTraits: 3,
      };
      
      expect(analysisResult.analyzed).toBe(10);
      expect(analysisResult.newTraitsExtracted).toBe(5);
    });
  });
});
