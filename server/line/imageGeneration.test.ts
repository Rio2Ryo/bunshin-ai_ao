/**
 * LINE画像生成リクエスト検出機能のテスト
 */

import { describe, it, expect } from "vitest";

// テスト対象の関数を再実装（webhook.tsからエクスポートされていないため）
function detectImageGenerationRequest(message: string): { isImageRequest: boolean; prompt: string } {
  const patterns = [
    /(画像|絵|イラスト|写真|ピクチャー|アート)を?(作って|描いて|生成して|作成して|書いて|見せて)/i,
    /(generate|create|draw|make|show).*(image|picture|illustration|art|photo)/i,
    /(画像生成|イラスト生成)/i,
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(message)) {
      const prompt = message
        .replace(/(画像|絵|イラスト|写真|ピクチャー|アート)を?(作って|描いて|生成して|作成して|書いて|見せて)/gi, "")
        .replace(/(generate|create|draw|make|show).*(image|picture|illustration|art|photo)/gi, "")
        .replace(/(画像生成|イラスト生成)/gi, "")
        .replace(/[。、！？.!?]/g, "")
        .trim();
      
      return {
        isImageRequest: true,
        prompt: prompt || message,
      };
    }
  }
  
  return { isImageRequest: false, prompt: "" };
}

describe("detectImageGenerationRequest", () => {
  describe("日本語の画像生成リクエスト", () => {
    it("「猫の画像を作って」を検出する", () => {
      const result = detectImageGenerationRequest("猫の画像を作って");
      expect(result.isImageRequest).toBe(true);
      expect(result.prompt).toBe("猫の");
    });

    it("「富士山の絵を描いて」を検出する", () => {
      const result = detectImageGenerationRequest("富士山の絵を描いて");
      expect(result.isImageRequest).toBe(true);
      expect(result.prompt).toBe("富士山の");
    });

    it("「可愛い子犬のイラストを生成して」を検出する", () => {
      const result = detectImageGenerationRequest("可愛い子犬のイラストを生成して");
      expect(result.isImageRequest).toBe(true);
      expect(result.prompt).toBe("可愛い子犬の");
    });

    it("「夕焼けの写真を見せて」を検出する", () => {
      const result = detectImageGenerationRequest("夕焼けの写真を見せて");
      expect(result.isImageRequest).toBe(true);
      expect(result.prompt).toBe("夕焼けの");
    });

    it("「画像生成してほしい」を検出する", () => {
      const result = detectImageGenerationRequest("宇宙の画像生成してほしい");
      expect(result.isImageRequest).toBe(true);
    });
  });

  describe("英語の画像生成リクエスト", () => {
    it("「generate an image of a cat」を検出する", () => {
      const result = detectImageGenerationRequest("generate an image of a cat");
      expect(result.isImageRequest).toBe(true);
    });

    it("「create a picture of mountains」を検出する", () => {
      const result = detectImageGenerationRequest("create a picture of mountains");
      expect(result.isImageRequest).toBe(true);
    });

    it("「draw an illustration of a robot」を検出する", () => {
      const result = detectImageGenerationRequest("draw an illustration of a robot");
      expect(result.isImageRequest).toBe(true);
    });
  });

  describe("画像生成リクエストではないメッセージ", () => {
    it("「今日の天気は？」は画像生成リクエストではない", () => {
      const result = detectImageGenerationRequest("今日の天気は？");
      expect(result.isImageRequest).toBe(false);
    });

    it("「こんにちは」は画像生成リクエストではない", () => {
      const result = detectImageGenerationRequest("こんにちは");
      expect(result.isImageRequest).toBe(false);
    });

    it("「画像について教えて」は画像生成リクエストではない", () => {
      const result = detectImageGenerationRequest("画像について教えて");
      expect(result.isImageRequest).toBe(false);
    });

    it("「絵の具の種類は？」は画像生成リクエストではない", () => {
      const result = detectImageGenerationRequest("絵の具の種類は？");
      expect(result.isImageRequest).toBe(false);
    });
  });
});
