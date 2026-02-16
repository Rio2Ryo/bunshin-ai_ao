/**
 * Gemini Image Generation Service (Nano Banana Pro)
 * Google Gemini APIを使用した本物のNano Banana Pro画像生成
 * 
 * 現在利用可能なモデル:
 * - gemini-2.0-flash-exp-image-generation (Experimental - 画像生成対応)
 */

import { storagePut } from "../storage";

// 環境変数からGemini API Keyを取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini API エンドポイント
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// 利用可能なモデル（画像生成対応）
export type GeminiImageModel = 
  | "gemini-2.0-flash-exp-image-generation"; // 画像生成対応モデル

// 画像生成オプション
export interface GeminiImageOptions {
  prompt: string;
  model?: GeminiImageModel;
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
  resolution?: "1K" | "2K" | "4K";
  originalImages?: Array<{
    url?: string;
    base64?: string;
    mimeType?: string;
  }>;
}

// 画像生成結果
export interface GeminiImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  model?: string;
}

/**
 * Gemini APIが有効かどうかを確認
 */
export function isGeminiImageEnabled(): boolean {
  return !!GEMINI_API_KEY;
}

/**
 * URLから画像をBase64に変換
 */
async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");
  
  const contentType = response.headers.get("content-type") || "image/jpeg";
  
  return { base64, mimeType: contentType };
}

/**
 * Gemini APIで画像を生成（Nano Banana Pro）
 */
export async function generateImageWithGemini(
  options: GeminiImageOptions
): Promise<GeminiImageResult> {
  if (!GEMINI_API_KEY) {
    return {
      success: false,
      error: "GEMINI_API_KEY is not configured",
    };
  }

  // 画像生成対応モデルを使用
  const model = options.model || "gemini-2.0-flash-exp-image-generation";
  const endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  console.log(`[GeminiImage] Generating image with model: ${model}`);
  console.log(`[GeminiImage] Prompt: ${options.prompt}`);

  try {
    // リクエストボディを構築
    const contents: Array<{
      role: string;
      parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
    }> = [];

    // ユーザーメッセージを構築
    const userParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

    // プロンプトを追加
    userParts.push({ text: options.prompt });

    // 参照画像がある場合は追加（画像編集用）
    if (options.originalImages && options.originalImages.length > 0) {
      for (const img of options.originalImages) {
        let base64Data: string;
        let mimeType: string;

        if (img.base64) {
          base64Data = img.base64;
          mimeType = img.mimeType || "image/jpeg";
        } else if (img.url) {
          const converted = await urlToBase64(img.url);
          base64Data = converted.base64;
          mimeType = converted.mimeType;
        } else {
          continue;
        }

        userParts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64Data,
          },
        });
      }
    }

    contents.push({
      role: "user",
      parts: userParts,
    });

    // 生成設定
    const generationConfig: Record<string, unknown> = {
      responseModalities: ["TEXT", "IMAGE"],
    };

    const requestBody = {
      contents,
      generationConfig,
    };

    console.log(`[GeminiImage] Sending request to: ${endpoint}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GeminiImage] API error: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Gemini API error: ${response.status} - ${errorText}`,
        model,
      };
    }

    const result: any = await response.json();
    console.log(`[GeminiImage] Response received`);

    // 応答から画像を抽出
    const candidates = result.candidates;
    if (!candidates || candidates.length === 0) {
      return {
        success: false,
        error: "No candidates in response",
        model,
      };
    }

    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
      return {
        success: false,
        error: "No parts in response",
        model,
      };
    }

    // 画像データを探す
    for (const part of parts) {
      if (part.inlineData) {
        const imageData = part.inlineData;
        const base64Data = imageData.data;
        const mimeType = imageData.mimeType || "image/png";

        // Base64をBufferに変換
        const buffer = Buffer.from(base64Data, "base64");

        // S3にアップロード
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const extension = mimeType.includes("png") ? "png" : "jpg";
        const fileKey = `gemini-generated/${timestamp}-${randomSuffix}.${extension}`;

        const { url } = await storagePut(fileKey, buffer, mimeType);

        console.log(`[GeminiImage] Image saved to S3: ${url}`);

        return {
          success: true,
          imageUrl: url,
          model,
        };
      }
    }

    // テキストのみの応答の場合
    const textPart = parts.find((p: { text?: string }) => p.text);
    if (textPart) {
      console.log(`[GeminiImage] Text response: ${textPart.text}`);
      return {
        success: false,
        error: `Model returned text instead of image: ${textPart.text}`,
        model,
      };
    }

    return {
      success: false,
      error: "No image data in response",
      model,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[GeminiImage] Error: ${errorMessage}`);
    return {
      success: false,
      error: `Gemini image generation error: ${errorMessage}`,
      model,
    };
  }
}

/**
 * Nano Banana（高速モデル）で画像を生成
 * 現在はgemini-2.0-flash-exp-image-generationを使用
 */
export async function generateWithNanoBanana(
  prompt: string,
  originalImages?: GeminiImageOptions["originalImages"]
): Promise<GeminiImageResult> {
  return generateImageWithGemini({
    prompt,
    model: "gemini-2.0-flash-exp-image-generation",
    originalImages,
  });
}

/**
 * Nano Banana Pro（高品質モデル）で画像を生成
 * 現在はgemini-2.0-flash-exp-image-generationを使用
 */
export async function generateWithNanoBananaPro(
  prompt: string,
  options?: {
    aspectRatio?: GeminiImageOptions["aspectRatio"];
    resolution?: GeminiImageOptions["resolution"];
    originalImages?: GeminiImageOptions["originalImages"];
  }
): Promise<GeminiImageResult> {
  return generateImageWithGemini({
    prompt,
    model: "gemini-2.0-flash-exp-image-generation",
    aspectRatio: options?.aspectRatio,
    resolution: options?.resolution,
    originalImages: options?.originalImages,
  });
}

/**
 * スキルレベルに応じたモデルを選択して画像を生成
 * 現在は全レベルでgemini-2.0-flash-exp-image-generationを使用
 */
export async function generateImageBySkillLevel(
  prompt: string,
  skillLevel: number,
  options?: {
    aspectRatio?: GeminiImageOptions["aspectRatio"];
    resolution?: GeminiImageOptions["resolution"];
    originalImages?: GeminiImageOptions["originalImages"];
  }
): Promise<GeminiImageResult> {
  // 現在は全レベルで同じモデルを使用
  // 将来的にモデルが増えたらスキルレベルで切り替え
  const model: GeminiImageModel = "gemini-2.0-flash-exp-image-generation";

  console.log(`[GeminiImage] Skill level ${skillLevel} -> Model: ${model}`);

  return generateImageWithGemini({
    prompt,
    model,
    aspectRatio: options?.aspectRatio,
    resolution: options?.resolution,
    originalImages: options?.originalImages,
  });
}
