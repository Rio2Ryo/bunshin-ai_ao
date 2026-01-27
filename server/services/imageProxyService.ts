/**
 * Image Proxy Service
 * 外部の画像URLをダウンロードし、分身AIのS3ストレージに再アップロードして
 * 公開アクセス可能なURLを生成する
 */

import { storagePut } from "../storage";
import { randomUUID } from "crypto";

/**
 * 画像URLからMIMEタイプを推測
 */
function guessMimeType(url: string): string {
  const urlLower = url.toLowerCase();
  if (urlLower.includes(".png")) return "image/png";
  if (urlLower.includes(".jpg") || urlLower.includes(".jpeg")) return "image/jpeg";
  if (urlLower.includes(".gif")) return "image/gif";
  if (urlLower.includes(".webp")) return "image/webp";
  if (urlLower.includes(".svg")) return "image/svg+xml";
  // デフォルトはPNG
  return "image/png";
}

/**
 * MIMEタイプから拡張子を取得
 */
function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}

/**
 * 外部画像URLをダウンロードしてS3に再アップロード
 * @param externalUrl 外部の画像URL
 * @param userId ユーザーID（ストレージパスに使用）
 * @returns 公開アクセス可能なURL
 */
export async function proxyImageToS3(
  externalUrl: string,
  userId: number
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    console.log(`[ImageProxy] Downloading image from: ${externalUrl}`);
    
    // 画像をダウンロード
    const response = await fetch(externalUrl, {
      headers: {
        "User-Agent": "BunshinAI/1.0",
      },
    });
    
    if (!response.ok) {
      console.error(`[ImageProxy] Download failed: ${response.status} ${response.statusText}`);
      return {
        success: false,
        error: `Failed to download image: ${response.status} ${response.statusText}`,
      };
    }
    
    // Content-Typeを取得（なければURLから推測）
    const contentType = response.headers.get("content-type") || guessMimeType(externalUrl);
    const extension = getExtensionFromMimeType(contentType);
    
    // 画像データを取得
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    // ユニークなファイル名を生成
    const uniqueId = randomUUID();
    const fileName = `line-images/${userId}/${uniqueId}.${extension}`;
    
    console.log(`[ImageProxy] Uploading to S3: ${fileName} (${contentType}, ${imageBuffer.length} bytes)`);
    
    // S3にアップロード
    const { url } = await storagePut(fileName, imageBuffer, contentType);
    
    console.log(`[ImageProxy] Upload successful: ${url}`);
    
    return {
      success: true,
      url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ImageProxy] Error: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 複数の画像URLを一括でプロキシ
 */
export async function proxyMultipleImages(
  urls: string[],
  userId: number
): Promise<{ originalUrl: string; proxyUrl: string | null }[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      const result = await proxyImageToS3(url, userId);
      return {
        originalUrl: url,
        proxyUrl: result.success ? result.url! : null,
      };
    })
  );
  return results;
}

/**
 * URLが公開アクセス可能かチェック
 * Google Cloud Storageの非公開URLなどを検出
 */
export function needsProxy(url: string): boolean {
  // Google Cloud Storageの非公開バケット
  if (url.includes("storage.googleapis.com/gen-ai-storage")) {
    return true;
  }
  // 他の非公開ストレージパターンを追加可能
  if (url.includes("storage.cloud.google.com")) {
    return true;
  }
  // 署名付きURLでない場合は基本的にプロキシが必要
  // ただし、既に分身AIのストレージにある場合は不要
  if (url.includes("bunshin") || url.includes("manus")) {
    return false;
  }
  return false;
}
