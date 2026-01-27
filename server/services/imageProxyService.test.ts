import { describe, it, expect } from "vitest";
import { needsProxy } from "./imageProxyService";

describe("Image Proxy Service", () => {
  describe("needsProxy", () => {
    it("should return true for Google Cloud Storage gen-ai-storage URLs", () => {
      const url = "https://storage.googleapis.com/gen-ai-storage/d946d29d-400d-4017-91f9-8d1976a445c7.png";
      expect(needsProxy(url)).toBe(true);
    });

    it("should return true for storage.cloud.google.com URLs", () => {
      const url = "https://storage.cloud.google.com/some-bucket/image.png";
      expect(needsProxy(url)).toBe(true);
    });

    it("should return false for bunshin storage URLs", () => {
      const url = "https://bunshin-storage.example.com/images/test.png";
      expect(needsProxy(url)).toBe(false);
    });

    it("should return false for manus storage URLs", () => {
      const url = "https://manus-storage.example.com/images/test.png";
      expect(needsProxy(url)).toBe(false);
    });

    it("should return false for generic public URLs", () => {
      const url = "https://example.com/images/public-image.png";
      expect(needsProxy(url)).toBe(false);
    });

    it("should return false for imgur URLs", () => {
      const url = "https://i.imgur.com/abc123.png";
      expect(needsProxy(url)).toBe(false);
    });
  });
});
