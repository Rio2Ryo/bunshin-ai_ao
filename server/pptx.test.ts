import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pptxgenjs
vi.mock("pptxgenjs", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      author: "",
      title: "",
      subject: "",
      company: "",
      defineSlideMaster: vi.fn(),
      addSlide: vi.fn().mockReturnValue({
        background: {},
        addText: vi.fn(),
        addShape: vi.fn(),
      }),
      write: vi.fn().mockResolvedValue("dGVzdCBwcHR4IGNvbnRlbnQ="), // base64 encoded "test pptx content"
    })),
  };
});

import { generatePptx } from "./services/pptxGenerator";

describe("PPTX Generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate PPTX buffer from slide data", async () => {
    const input = {
      theme: "テストテーマ",
      twin1Name: "テスト太郎",
      twin2Name: "テスト花子",
      compatibilityScore: 85,
      slides: [
        {
          slideNumber: 1,
          title: "タイトルスライド",
          content: "テストコンテンツ",
          keyPoints: [],
        },
        {
          slideNumber: 2,
          title: "内容スライド",
          content: "",
          keyPoints: ["ポイント1", "ポイント2", "ポイント3"],
        },
      ],
    };

    const result = await generatePptx(input);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle empty slides array", async () => {
    const input = {
      theme: "空のテーマ",
      twin1Name: "テスト太郎",
      twin2Name: "テスト花子",
      compatibilityScore: 0,
      slides: [],
    };

    const result = await generatePptx(input);

    expect(result).toBeInstanceOf(Buffer);
  });

  it("should handle slides without key points", async () => {
    const input = {
      theme: "シンプルテーマ",
      twin1Name: "テスト太郎",
      twin2Name: "テスト花子",
      compatibilityScore: 50,
      slides: [
        {
          slideNumber: 1,
          title: "タイトルのみ",
          content: "コンテンツのみ",
          keyPoints: [],
        },
      ],
    };

    const result = await generatePptx(input);

    expect(result).toBeInstanceOf(Buffer);
  });

  it("should handle many slides with different themes", async () => {
    const slides = Array.from({ length: 15 }, (_, i) => ({
      slideNumber: i + 1,
      title: `スライド ${i + 1}`,
      content: `コンテンツ ${i + 1}`,
      keyPoints: [`ポイント ${i + 1}-1`, `ポイント ${i + 1}-2`],
    }));

    const input = {
      theme: "多数スライドテーマ",
      twin1Name: "テスト太郎",
      twin2Name: "テスト花子",
      compatibilityScore: 100,
      slides,
    };

    const result = await generatePptx(input);

    expect(result).toBeInstanceOf(Buffer);
  });
});
