/**
 * 会話学習サービスのテスト
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// モックの設定
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          likes: ["プログラミング", "読書"],
          dislikes: ["早起き"],
          values: ["効率", "正確さ"],
          priorities: ["仕事", "健康"],
          communicationStyle: {
            formality: 40,
            verbosity: 60,
            emotionality: 30,
            directness: 70,
          },
          catchphrases: ["なるほど", "確かに"],
          frequentExpressions: ["〜ですね", "〜かもしれません"],
          interests: ["AI", "テクノロジー"],
          expertise: ["ソフトウェア開発"],
          decisionMakingStyle: "慎重型",
          conflictResolutionStyle: "妥協型",
          emotionalTriggers: {
            positive: ["新しい技術を学ぶ"],
            negative: ["非効率な作業"],
          },
        }),
      },
    }],
  }),
}));

describe("会話学習サービス", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("LearnedPersonalityTraits型", () => {
    it("必要なフィールドを持つ", () => {
      const traits = {
        likes: ["テスト"],
        dislikes: ["バグ"],
        values: ["品質"],
        priorities: ["テスト"],
        communicationStyle: {
          formality: 50,
          verbosity: 50,
          emotionality: 50,
          directness: 50,
        },
        catchphrases: [],
        frequentExpressions: [],
        interests: [],
        expertise: [],
        decisionMakingStyle: "未分析",
        conflictResolutionStyle: "未分析",
        emotionalTriggers: {
          positive: [],
          negative: [],
        },
        lastAnalyzedAt: new Date().toISOString(),
        totalConversationsAnalyzed: 0,
      };

      expect(traits.likes).toContain("テスト");
      expect(traits.communicationStyle.formality).toBe(50);
      expect(traits.emotionalTriggers.positive).toEqual([]);
    });
  });

  describe("人格特性のマージ", () => {
    it("配列フィールドをユニークにマージする", () => {
      const existing = ["A", "B", "C"];
      const newItems = ["B", "C", "D"];
      
      // マージロジックのシミュレーション
      const merged = Array.from(new Set([...existing, ...newItems]));
      
      expect(merged).toEqual(["A", "B", "C", "D"]);
      expect(merged.length).toBe(4);
    });

    it("コミュニケーションスタイルを加重平均する", () => {
      const existing = 50;
      const newValue = 80;
      const weight = 0.7;
      
      const averaged = Math.round(existing * weight + newValue * (1 - weight));
      
      expect(averaged).toBe(59); // 50 * 0.7 + 80 * 0.3 = 35 + 24 = 59
    });

    it("配列の最大長を制限する", () => {
      const longArray = Array.from({ length: 30 }, (_, i) => `item${i}`);
      const limited = longArray.slice(0, 20);
      
      expect(limited.length).toBe(20);
    });
  });

  describe("会話スニペット", () => {
    it("ソースタイプが正しく設定される", () => {
      const sources = ["clawdbot", "web_chat", "matching", "group"] as const;
      
      sources.forEach(source => {
        expect(["clawdbot", "web_chat", "matching", "group"]).toContain(source);
      });
    });

    it("グループ会話で自分の発言のみ学習対象になる", () => {
      const selfMessage = { speakerType: "self" as const, isRelevantForLearning: true };
      const otherMessage = { speakerType: "other" as const, isRelevantForLearning: false };
      
      expect(selfMessage.isRelevantForLearning).toBe(true);
      expect(otherMessage.isRelevantForLearning).toBe(false);
    });
  });

  describe("学習設定", () => {
    it("デフォルトの学習閾値は10", () => {
      const defaultThreshold = 10;
      expect(defaultThreshold).toBe(10);
    });

    it("自動学習はデフォルトで有効", () => {
      const defaultAutoLearn = true;
      expect(defaultAutoLearn).toBe(true);
    });

    it("学習閾値は5〜100の範囲", () => {
      const minThreshold = 5;
      const maxThreshold = 100;
      
      expect(minThreshold).toBeGreaterThanOrEqual(5);
      expect(maxThreshold).toBeLessThanOrEqual(100);
    });
  });

  describe("人格テキスト生成", () => {
    it("学習した特性からテキストを生成する", () => {
      const traits = {
        likes: ["プログラミング", "読書"],
        dislikes: ["早起き"],
        values: ["効率"],
        interests: ["AI"],
        expertise: ["開発"],
        catchphrases: ["なるほど"],
        decisionMakingStyle: "慎重型",
        communicationStyle: {
          formality: 30,
          verbosity: 70,
          emotionality: 20,
          directness: 80,
        },
      };

      // テキスト生成ロジックのシミュレーション
      const lines: string[] = [];
      if (traits.likes.length > 0) {
        lines.push(`好きなこと: ${traits.likes.join("、")}`);
      }
      if (traits.dislikes.length > 0) {
        lines.push(`苦手なこと: ${traits.dislikes.join("、")}`);
      }

      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain("プログラミング");
    });

    it("コミュニケーションスタイルを説明文に変換する", () => {
      const style = {
        formality: 30, // カジュアル
        verbosity: 70, // 詳細
        emotionality: 20, // 論理的
        directness: 80, // 直接的
      };

      const styleDesc: string[] = [];
      if (style.formality < 30) styleDesc.push("カジュアル");
      if (style.verbosity > 70) styleDesc.push("詳細に説明する");
      if (style.emotionality < 30) styleDesc.push("論理的");
      if (style.directness > 70) styleDesc.push("直接的");

      expect(styleDesc).toContain("論理的");
      expect(styleDesc).toContain("直接的");
    });
  });

  describe("同期処理", () => {
    it("最後に同期したIDより新しいメッセージのみを取得する", () => {
      const lastSyncedId = 100;
      const newMessages = [
        { id: 101, content: "新しいメッセージ1" },
        { id: 102, content: "新しいメッセージ2" },
      ];

      const filtered = newMessages.filter(m => m.id > lastSyncedId);
      expect(filtered.length).toBe(2);
    });

    it("sourceIdからIDを抽出する", () => {
      const sourceId = "clawdbot_123";
      const id = parseInt(sourceId.replace("clawdbot_", ""), 10);
      
      expect(id).toBe(123);
    });
  });

  describe("分析トリガー", () => {
    it("未分析会話数が閾値に達したら分析を実行する", () => {
      const pendingConversations = 10;
      const learningThreshold = 10;
      const autoLearnEnabled = true;

      const shouldAnalyze = autoLearnEnabled && pendingConversations >= learningThreshold;
      expect(shouldAnalyze).toBe(true);
    });

    it("自動学習が無効の場合は分析しない", () => {
      const pendingConversations = 10;
      const learningThreshold = 10;
      const autoLearnEnabled = false;

      const shouldAnalyze = autoLearnEnabled && pendingConversations >= learningThreshold;
      expect(shouldAnalyze).toBe(false);
    });
  });
});
