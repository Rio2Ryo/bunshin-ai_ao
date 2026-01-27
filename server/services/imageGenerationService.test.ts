/**
 * Image Generation Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
vi.mock("../db", () => ({
  getDb: vi.fn(() => Promise.resolve(null)),
}));

// Mock storage
vi.mock("../storage", () => ({
  storagePut: vi.fn(() => Promise.resolve({ url: "https://s3.example.com/test.png", key: "test.png" })),
}));

// Mock the image generation core
vi.mock("../_core/imageGeneration", () => ({
  generateImage: vi.fn(() => Promise.resolve({ url: "https://generated.example.com/image.png" })),
}));

describe("Image Generation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserImageGenerationSettings", () => {
    it("should return default settings when database is not available", async () => {
      const { getUserImageGenerationSettings } = await import("./imageGenerationService");
      
      const settings = await getUserImageGenerationSettings(1);
      
      expect(settings.provider).toBe("nano_banana_pro");
      expect(settings.settings).toEqual({});
    });
  });

  describe("generateImage", () => {
    it("should use Nano Banana Pro by default", async () => {
      const { generateImage } = await import("./imageGenerationService");
      
      const result = await generateImage({
        prompt: "A cute cat",
        userId: 1,
      });
      
      // Even if the generation fails due to mocks, it should attempt to use nano_banana_pro
      expect(result.provider).toBe("nano_banana_pro");
    });
  });

  describe("uploadImageToS3", () => {
    it("should upload image to S3 and return public URL", async () => {
      // Mock fetch for downloading image
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/png"]]),
      }) as any;

      const { uploadImageToS3 } = await import("./imageGenerationService");
      
      const result = await uploadImageToS3("https://example.com/image.png", 1);
      
      expect(result.success).toBe(true);
      expect(result.url).toBe("https://s3.example.com/test.png");
    });

    it("should return error when download fails", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any;

      const { uploadImageToS3 } = await import("./imageGenerationService");
      
      const result = await uploadImageToS3("https://example.com/notfound.png", 1);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to download image");
    });
  });
});

describe("Image Generation Providers", () => {
  it("should have nano_banana_pro as default provider", async () => {
    const { imageGenerationProviders } = await import("../../drizzle/schema");
    
    expect(imageGenerationProviders.nano_banana_pro.isDefault).toBe(true);
    expect(imageGenerationProviders.nano_banana_pro.requiresApiKey).toBe(false);
  });

  it("should have all required providers defined", async () => {
    const { imageGenerationProviders } = await import("../../drizzle/schema");
    
    const providers = Object.keys(imageGenerationProviders);
    expect(providers).toContain("nano_banana_pro");
    expect(providers).toContain("dall_e");
    expect(providers).toContain("stable_diffusion");
    expect(providers).toContain("midjourney");
    expect(providers).toContain("flux");
  });

  it("should mark external providers as requiring API key", async () => {
    const { imageGenerationProviders } = await import("../../drizzle/schema");
    
    expect(imageGenerationProviders.dall_e.requiresApiKey).toBe(true);
    expect(imageGenerationProviders.stable_diffusion.requiresApiKey).toBe(true);
    expect(imageGenerationProviders.midjourney.requiresApiKey).toBe(true);
  });
});
