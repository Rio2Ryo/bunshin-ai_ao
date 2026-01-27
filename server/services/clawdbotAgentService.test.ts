/**
 * Clawdbot Agent Service Tests
 * ユーザーごとに独立したClawdbotエージェントを管理するサービスのテスト
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateAgentId,
  generateSystemPromptFromWaveform,
  getOrCreateAgentId,
} from "./clawdbotAgentService";

// モック設定
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./clawdbotGatewayService", () => ({
  sendToClawdbot: vi.fn().mockResolvedValue({ success: true, response: "OK" }),
}));

vi.mock("../_core/env", () => ({
  ENV: {
    clawdbotGatewayUrl: "https://test-gateway.example.com",
    clawdbotAuthToken: "test-token",
    clawdbotAgentId: "default-agent",
  },
}));

describe("Clawdbot Agent Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateAgentId", () => {
    it("should generate agent ID with correct format", () => {
      const agentId = generateAgentId(123);
      expect(agentId).toBe("bunshin_user_123");
    });

    it("should generate unique IDs for different users", () => {
      const agentId1 = generateAgentId(1);
      const agentId2 = generateAgentId(2);
      expect(agentId1).not.toBe(agentId2);
      expect(agentId1).toBe("bunshin_user_1");
      expect(agentId2).toBe("bunshin_user_2");
    });

    it("should handle large user IDs", () => {
      const agentId = generateAgentId(999999999);
      expect(agentId).toBe("bunshin_user_999999999");
    });
  });

  describe("generateSystemPromptFromWaveform", () => {
    it("should return default prompt when database is not available", async () => {
      const { getDb } = await import("../db");
      vi.mocked(getDb).mockResolvedValue(null);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("分身AI");
      expect(prompt).toContain("LINE");
    });

    it("should return default prompt when user has no twin", async () => {
      const { getDb } = await import("../db");
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("分身AI");
    });

    it("should include twin name in system prompt", async () => {
      const { getDb } = await import("../db");
      const mockTwin = {
        id: 1,
        userId: 1,
        name: "テスト分身",
        personality: "テストの性格",
      };
      
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockResolvedValueOnce([mockTwin]) // digitalTwins
          .mockResolvedValueOnce([]) // conversationLearning
          .mockResolvedValueOnce([]), // cumulativeWaveforms
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("テスト分身");
      expect(prompt).toContain("テストの性格");
    });

    it("should include Big Five traits when available", async () => {
      const { getDb } = await import("../db");
      const mockTwin = {
        id: 1,
        userId: 1,
        name: "テスト分身",
        personality: null,
        bigFiveTraits: {
          openness: 80,
          conscientiousness: 70,
          extraversion: 60,
          agreeableness: 75,
          neuroticism: 30,
        },
      };
      
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockResolvedValueOnce([mockTwin])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("ビッグファイブ");
      expect(prompt).toContain("開放性");
      expect(prompt).toContain("80%");
    });

    it("should include MBTI type when available", async () => {
      const { getDb } = await import("../db");
      const mockTwin = {
        id: 1,
        userId: 1,
        name: "テスト分身",
        personality: null,
        mbtiType: {
          type: "INTJ",
          description: "建築家タイプ",
        },
      };
      
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockResolvedValueOnce([mockTwin])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("MBTI");
      expect(prompt).toContain("INTJ");
    });

    it("should include learned traits from conversation learning", async () => {
      const { getDb } = await import("../db");
      const mockTwin = {
        id: 1,
        userId: 1,
        name: "テスト分身",
        personality: null,
      };
      const mockLearning = {
        learnedTraits: {
          likes: ["プログラミング", "読書"],
          dislikes: ["早起き"],
          values: ["効率性"],
          catchphrases: ["なるほど"],
        },
      };
      
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockResolvedValueOnce([mockTwin])
          .mockResolvedValueOnce([mockLearning])
          .mockResolvedValueOnce([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const prompt = await generateSystemPromptFromWaveform(1);
      expect(prompt).toContain("好きなこと");
      expect(prompt).toContain("プログラミング");
      expect(prompt).toContain("読書");
    });
  });

  describe("getOrCreateAgentId", () => {
    it("should return existing agent ID if found", async () => {
      const { getDb } = await import("../db");
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ clawdbotAgentId: "existing_agent_123" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);

      const agentId = await getOrCreateAgentId(123);
      expect(agentId).toBe("existing_agent_123");
    });

    it("should return default agent ID when database is not available", async () => {
      const { getDb } = await import("../db");
      vi.mocked(getDb).mockResolvedValue(null);

      const agentId = await getOrCreateAgentId(123);
      expect(agentId).toBe("default-agent");
    });
  });
});
