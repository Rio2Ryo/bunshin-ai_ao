import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM module
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { generatePresentationContent } from "./services/presentationGenerator";
import { invokeLLM } from "./_core/llm";

describe("Presentation Generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate presentation content from matching data", async () => {
    const mockLLMResponse = {
      choices: [
        {
          message: {
            content: `# ビジネスマッチング結果
## テストテーマ

---

# エグゼクティブサマリー
- 相性スコア: **85%**
- 高い協業可能性

---

# 参加者1: テスト太郎
- スキル: プログラミング
- 経験: 10年

---

# 参加者2: テスト花子
- スキル: デザイン
- 経験: 8年

---

# シナジー・強み
- 技術とデザインの融合
- 相互補完的なスキルセット

---

# 協業プロジェクト提案
- Webアプリケーション開発
- UI/UXデザインの改善

---

# 役割分担とタイムライン
- テスト太郎: バックエンド開発
- テスト花子: フロントエンドデザイン

---

# 次のステップ
- 初回ミーティングの設定
- プロジェクト計画書の作成`,
          },
        },
      ],
    };

    vi.mocked(invokeLLM).mockResolvedValue(mockLLMResponse as any);

    const input = {
      theme: "テストテーマ",
      twin1: {
        name: "テスト太郎",
        description: "プログラマー",
        personality: "論理的",
      },
      twin2: {
        name: "テスト花子",
        description: "デザイナー",
        personality: "クリエイティブ",
      },
      dialogues: [
        { speaker: "テスト太郎", content: "こんにちは" },
        { speaker: "テスト花子", content: "よろしくお願いします" },
      ],
      result: {
        compatibilityScore: 85,
        summary: "高い相性",
        collaborationPotential: "非常に高い",
        strengths: ["技術力", "デザイン力"],
        challenges: ["スケジュール調整"],
        recommendations: ["定期ミーティング"],
        roleDistribution: "テスト太郎: 開発、テスト花子: デザイン",
        timeline: "3ヶ月",
        resources: "開発環境",
        kpis: "月次レビュー",
        nextSteps: "キックオフミーティング",
        detailedAnalysis: "詳細な分析内容",
      },
    };

    const result = await generatePresentationContent(input);

    expect(result).toBeDefined();
    expect(result.markdown).toBeDefined();
    expect(result.slideCount).toBeGreaterThan(0);
    expect(result.slideCount).toBeLessThanOrEqual(12);
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("should handle missing result data gracefully", async () => {
    const mockLLMResponse = {
      choices: [
        {
          message: {
            content: `# ビジネスマッチング結果

---

# 参加者紹介

---

# 次のステップ`,
          },
        },
      ],
    };

    vi.mocked(invokeLLM).mockResolvedValue(mockLLMResponse as any);

    const input = {
      theme: "テストテーマ",
      twin1: {
        name: "テスト太郎",
        description: null,
        personality: null,
      },
      twin2: {
        name: "テスト花子",
        description: null,
        personality: null,
      },
      dialogues: [],
      result: null,
    };

    const result = await generatePresentationContent(input);

    expect(result).toBeDefined();
    expect(result.markdown).toBeDefined();
    expect(result.slideCount).toBeGreaterThan(0);
  });

  it("should throw error when LLM returns invalid response", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as any);

    const input = {
      theme: "テストテーマ",
      twin1: { name: "テスト太郎", description: null, personality: null },
      twin2: { name: "テスト花子", description: null, personality: null },
      dialogues: [],
      result: null,
    };

    await expect(generatePresentationContent(input)).rejects.toThrow(
      "Failed to generate presentation content"
    );
  });

  it("should limit slide count to maximum of 12", async () => {
    // Create a response with many slides (more than 12)
    const manySlides = Array(15)
      .fill("# Slide\nContent")
      .join("\n\n---\n\n");

    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: manySlides } }],
    } as any);

    const input = {
      theme: "テストテーマ",
      twin1: { name: "テスト太郎", description: null, personality: null },
      twin2: { name: "テスト花子", description: null, personality: null },
      dialogues: [],
      result: null,
    };

    const result = await generatePresentationContent(input);

    expect(result.slideCount).toBeLessThanOrEqual(12);
  });
});
