/**
 * Clawdbot Response Parser Tests
 * Clawdbotからの応答を解析するパーサーのテスト
 */

import { describe, it, expect } from "vitest";
import {
  parseClawdbotResponse,
  isValidLineMediaUrl,
  normalizeMediaUrl,
  generatePreviewUrl,
} from "./clawdbotResponseParser";

describe("Clawdbot Response Parser", () => {
  describe("parseClawdbotResponse", () => {
    it("should parse text-only response", () => {
      const response = "こんにちは！今日はいい天気ですね。";
      const result = parseClawdbotResponse(response);
      
      expect(result.textContent).toBe("こんにちは！今日はいい天気ですね。");
      expect(result.hasMedia).toBe(false);
      expect(result.mediaContents).toHaveLength(0);
    });

    it("should extract Markdown image", () => {
      const response = "画像を生成しました！\n\n![猫の画像](https://example.com/cat.png)";
      const result = parseClawdbotResponse(response);
      
      expect(result.textContent).toBe("画像を生成しました！");
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents).toHaveLength(1);
      expect(result.mediaContents[0].type).toBe("image");
      expect(result.mediaContents[0].content).toBe("https://example.com/cat.png");
      expect(result.mediaContents[0].metadata?.alt).toBe("猫の画像");
    });

    it("should extract multiple images", () => {
      const response = "複数の画像です：\n![画像1](https://example.com/img1.jpg)\n![画像2](https://example.com/img2.png)";
      const result = parseClawdbotResponse(response);
      
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents).toHaveLength(2);
      expect(result.mediaContents[0].content).toBe("https://example.com/img1.jpg");
      expect(result.mediaContents[1].content).toBe("https://example.com/img2.png");
    });

    it("should extract standalone image URL", () => {
      const response = "画像はこちら：\nhttps://storage.example.com/generated/image.png";
      const result = parseClawdbotResponse(response);
      
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents).toHaveLength(1);
      expect(result.mediaContents[0].type).toBe("image");
      expect(result.mediaContents[0].content).toBe("https://storage.example.com/generated/image.png");
    });

    it("should extract image with query parameters", () => {
      const response = "![alt](https://example.com/image.png?token=abc123&size=large)";
      const result = parseClawdbotResponse(response);
      
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents[0].content).toBe("https://example.com/image.png?token=abc123&size=large");
    });

    it("should remove internal commands", () => {
      const response = "📖 Read: file.txt\n📝 Write: output.txt\n🔧 Tool: generate_image\n実際の応答テキスト";
      const result = parseClawdbotResponse(response);
      
      expect(result.textContent).toBe("実際の応答テキスト");
      expect(result.textContent).not.toContain("📖 Read:");
      expect(result.textContent).not.toContain("📝 Write:");
      expect(result.textContent).not.toContain("🔧 Tool:");
    });

    it("should handle mixed content (text + images)", () => {
      const response = "こちらが生成した画像です：\n\n![生成画像](https://api.example.com/images/abc.png)\n\n気に入っていただけましたか？";
      const result = parseClawdbotResponse(response);
      
      expect(result.textContent).toContain("こちらが生成した画像です");
      expect(result.textContent).toContain("気に入っていただけましたか？");
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents[0].content).toBe("https://api.example.com/images/abc.png");
    });

    it("should remove duplicate media", () => {
      const response = "![img](https://example.com/same.png)\n![img](https://example.com/same.png)";
      const result = parseClawdbotResponse(response);
      
      expect(result.mediaContents).toHaveLength(1);
    });

    it("should extract video URLs", () => {
      const response = "動画を生成しました：\nhttps://example.com/video.mp4";
      const result = parseClawdbotResponse(response);
      
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents[0].type).toBe("video");
      expect(result.mediaContents[0].content).toBe("https://example.com/video.mp4");
    });

    it("should extract audio URLs", () => {
      const response = "音声ファイル：\nhttps://example.com/audio.mp3";
      const result = parseClawdbotResponse(response);
      
      expect(result.hasMedia).toBe(true);
      expect(result.mediaContents[0].type).toBe("audio");
      expect(result.mediaContents[0].content).toBe("https://example.com/audio.mp3");
    });

    it("should handle empty response", () => {
      const response = "";
      const result = parseClawdbotResponse(response);
      
      expect(result.textContent).toBe("");
      expect(result.hasMedia).toBe(false);
    });

    it("should support various image extensions", () => {
      const extensions = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
      
      for (const ext of extensions) {
        const response = `![img](https://example.com/image.${ext})`;
        const result = parseClawdbotResponse(response);
        
        expect(result.hasMedia).toBe(true);
        expect(result.mediaContents[0].type).toBe("image");
      }
    });
  });

  describe("isValidLineMediaUrl", () => {
    it("should accept HTTPS URLs", () => {
      expect(isValidLineMediaUrl("https://example.com/image.png")).toBe(true);
    });

    it("should reject HTTP URLs", () => {
      expect(isValidLineMediaUrl("http://example.com/image.png")).toBe(false);
    });

    it("should reject invalid URLs", () => {
      expect(isValidLineMediaUrl("not-a-url")).toBe(false);
      expect(isValidLineMediaUrl("")).toBe(false);
    });
  });

  describe("normalizeMediaUrl", () => {
    it("should convert HTTP to HTTPS", () => {
      expect(normalizeMediaUrl("http://example.com/image.png")).toBe("https://example.com/image.png");
    });

    it("should keep HTTPS unchanged", () => {
      expect(normalizeMediaUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
    });
  });

  describe("generatePreviewUrl", () => {
    it("should return same URL for preview", () => {
      const url = "https://example.com/image.png";
      expect(generatePreviewUrl(url)).toBe(url);
    });
  });
});
