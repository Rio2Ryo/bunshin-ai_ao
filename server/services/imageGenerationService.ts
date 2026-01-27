/**
 * Image Generation Service
 * 複数の画像生成AIプロバイダーをサポートする統合サービス
 * デフォルトはNano Banana Pro
 */

import { getDb } from "../db";
import { imageGenerationSettings, type ImageGenerationProvider } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "../storage";
import { randomUUID } from "crypto";

// 画像生成結果の型
export interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  provider: ImageGenerationProvider;
  generationTimeMs?: number;
}

// 画像生成オプション
export interface ImageGenerationOptions {
  prompt: string;
  size?: string;
  quality?: string;
  style?: string;
  userId: number;
}

/**
 * ユーザーの画像生成AI設定を取得
 */
export async function getUserImageGenerationSettings(userId: number): Promise<{
  provider: ImageGenerationProvider;
  settings: Record<string, any>;
}> {
  const db = await getDb();
  if (!db) {
    return { provider: "nano_banana_pro", settings: {} };
  }

  const [setting] = await db
    .select()
    .from(imageGenerationSettings)
    .where(eq(imageGenerationSettings.userId, userId))
    .limit(1);

  if (!setting) {
    return { provider: "nano_banana_pro", settings: {} };
  }

  return {
    provider: setting.provider as ImageGenerationProvider,
    settings: setting.settings || {},
  };
}

/**
 * ユーザーの画像生成AI設定を更新
 */
export async function updateUserImageGenerationSettings(
  userId: number,
  provider: ImageGenerationProvider,
  settings?: Record<string, any>
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    // 既存の設定を確認
    const [existing] = await db
      .select()
      .from(imageGenerationSettings)
      .where(eq(imageGenerationSettings.userId, userId))
      .limit(1);

    if (existing) {
      // 更新
      await db
        .update(imageGenerationSettings)
        .set({
          provider,
          settings: settings || existing.settings,
        })
        .where(eq(imageGenerationSettings.userId, userId));
    } else {
      // 新規作成
      await db.insert(imageGenerationSettings).values({
        userId,
        provider,
        settings: settings || {},
      });
    }

    return true;
  } catch (error) {
    console.error("[ImageGeneration] Failed to update settings:", error);
    return false;
  }
}

/**
 * 画像生成統計を更新
 */
async function updateGenerationStats(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const [existing] = await db
      .select()
      .from(imageGenerationSettings)
      .where(eq(imageGenerationSettings.userId, userId))
      .limit(1);

    if (existing) {
      await db
        .update(imageGenerationSettings)
        .set({
          totalGenerations: (existing.totalGenerations || 0) + 1,
          lastGeneratedAt: new Date(),
        })
        .where(eq(imageGenerationSettings.userId, userId));
    }
  } catch (error) {
    console.error("[ImageGeneration] Failed to update stats:", error);
  }
}

/**
 * Nano Banana Pro で画像を生成
 */
async function generateWithNanoBananaPro(
  prompt: string,
  options: { size?: string; quality?: string; style?: string }
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  try {
    // Nano Banana Proの画像生成API（generateImage）を使用
    const { generateImage } = await import("../_core/imageGeneration");
    
    const result = await generateImage({
      prompt,
      // Nano Banana Proの設定
    });

    if (result.url) {
      return {
        success: true,
        imageUrl: result.url,
      };
    } else {
      return {
        success: false,
        error: "Failed to generate image",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[NanoBananaPro] Generation error:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Flux で画像を生成
 */
async function generateWithFlux(
  prompt: string,
  options: { size?: string; quality?: string; style?: string }
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  try {
    const apiKey = process.env.BFL_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "Flux API key not configured",
      };
    }

    // Flux API呼び出し
    const response = await fetch("https://api.bfl.ai/v1/flux-pro-1.1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        width: 1024,
        height: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Flux API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    
    // Fluxは非同期なので、結果をポーリング
    if (data.id) {
      // 結果を取得
      const resultResponse = await fetch(`https://api.bfl.ai/v1/get_result?id=${data.id}`, {
        headers: {
          "x-key": apiKey,
        },
      });

      if (resultResponse.ok) {
        const resultData = await resultResponse.json();
        if (resultData.status === "Ready" && resultData.result?.sample) {
          return {
            success: true,
            imageUrl: resultData.result.sample,
          };
        }
      }
    }

    return {
      success: false,
      error: "Failed to get Flux result",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Flux] Generation error:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 画像を生成（ユーザー設定に基づいてプロバイダーを選択）
 */
export async function generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const startTime = Date.now();
  
  // ユーザーの設定を取得
  const { provider, settings } = await getUserImageGenerationSettings(options.userId);
  
  console.log(`[ImageGeneration] Using provider: ${provider} for user: ${options.userId}`);
  
  let result: { success: boolean; imageUrl?: string; error?: string };
  
  // プロバイダーに応じて画像生成
  switch (provider) {
    case "nano_banana_pro":
      result = await generateWithNanoBananaPro(options.prompt, {
        size: options.size || settings.defaultSize,
        quality: options.quality || settings.defaultQuality,
        style: options.style || settings.defaultStyle,
      });
      break;
    
    case "flux":
      result = await generateWithFlux(options.prompt, {
        size: options.size || settings.defaultSize,
        quality: options.quality || settings.defaultQuality,
        style: options.style || settings.defaultStyle,
      });
      break;
    
    case "dall_e":
    case "stable_diffusion":
    case "midjourney":
      // これらのプロバイダーは将来実装
      result = {
        success: false,
        error: `Provider ${provider} is not yet implemented. Please use Nano Banana Pro.`,
      };
      break;
    
    default:
      result = await generateWithNanoBananaPro(options.prompt, {
        size: options.size,
        quality: options.quality,
        style: options.style,
      });
  }
  
  const generationTimeMs = Date.now() - startTime;
  
  // 統計を更新
  if (result.success) {
    await updateGenerationStats(options.userId);
  }
  
  return {
    ...result,
    provider,
    generationTimeMs,
  };
}

/**
 * 画像URLをS3にアップロードして公開URLを取得
 */
export async function uploadImageToS3(
  imageUrl: string,
  userId: number
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // 画像をダウンロード
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download image: ${response.status}`,
      };
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    
    // ファイル名を生成
    const extension = contentType.includes("jpeg") ? "jpg" : "png";
    const fileName = `generated-images/${userId}/${randomUUID()}.${extension}`;
    
    // S3にアップロード
    const { url } = await storagePut(fileName, imageBuffer, contentType);
    
    return {
      success: true,
      url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: errorMessage,
    };
  }
}
