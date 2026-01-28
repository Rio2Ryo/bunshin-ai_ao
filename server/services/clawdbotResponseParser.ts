/**
 * Clawdbot Response Parser
 * Clawdbotからの応答を解析し、テキスト・画像・その他のコンテンツを抽出
 */

export interface ParsedContent {
  type: "text" | "image" | "video" | "audio" | "file";
  content: string; // テキストの場合は本文、メディアの場合はURL
  metadata?: {
    alt?: string;
    width?: number;
    height?: number;
    duration?: number;
    mimeType?: string;
    title?: string;
  };
}

export interface ParsedClawdbotResponse {
  textContent: string;
  mediaContents: ParsedContent[];
  hasMedia: boolean;
  rawResponse: string;
  model?: string; // 使用したAIモデル名
  apiSource?: string; // APIソース（clawdbot, fallbackなど）
}

/**
 * 画像URLのパターン（Markdown形式）
 * ![alt](url) または単独のURL
 */
const IMAGE_PATTERNS = [
  // Markdown画像: ![alt](url)
  /!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg)(?:\?[^)]*)?)\)/gi,
  // HTML img タグ: <img src="url">
  /<img[^>]+src=["']([^"']+\.(png|jpg|jpeg|gif|webp|svg)(?:\?[^"']*)?)["'][^>]*>/gi,
  // 単独の画像URL（行頭または空白の後）
  /(?:^|\s)(https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?)/gim,
];

/**
 * 動画URLのパターン
 */
const VIDEO_PATTERNS = [
  /(?:^|\s)(https?:\/\/[^\s]+\.(mp4|webm|mov)(?:\?[^\s]*)?)/gim,
];

/**
 * 音声URLのパターン
 */
const AUDIO_PATTERNS = [
  /(?:^|\s)(https?:\/\/[^\s]+\.(mp3|wav|ogg|m4a)(?:\?[^\s]*)?)/gim,
];

/**
 * Clawdbotの内部コマンドパターン
 */
const INTERNAL_COMMAND_PATTERNS = [
  /^📖 Read:.*$/gm,
  /^📝 Write:.*$/gm,
  /^🔧 Tool:.*$/gm,
  /^🖼️ Generated:.*$/gm,
  /^⚙️ Processing:.*$/gm,
];

/**
 * Clawdbotの応答からメディアコンテンツを抽出
 */
export function parseClawdbotResponse(response: string): ParsedClawdbotResponse {
  const mediaContents: ParsedContent[] = [];
  let cleanedText = response;

  // 内部コマンドを除去
  for (const pattern of INTERNAL_COMMAND_PATTERNS) {
    cleanedText = cleanedText.replace(pattern, "");
  }

  // 画像を抽出
  for (const pattern of IMAGE_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    let match;
    while ((match = pattern.exec(response)) !== null) {
      // Markdown形式の場合
      if (match[0].startsWith("!")) {
        mediaContents.push({
          type: "image",
          content: match[2],
          metadata: { alt: match[1] || undefined },
        });
        // テキストからMarkdown画像を除去
        cleanedText = cleanedText.replace(match[0], "");
      } 
      // HTML img タグの場合
      else if (match[0].startsWith("<img")) {
        mediaContents.push({
          type: "image",
          content: match[1],
        });
        cleanedText = cleanedText.replace(match[0], "");
      }
      // 単独URLの場合
      else {
        const url = match[1];
        mediaContents.push({
          type: "image",
          content: url,
        });
        cleanedText = cleanedText.replace(url, "");
      }
    }
  }

  // 動画を抽出
  for (const pattern of VIDEO_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const url = match[1];
      mediaContents.push({
        type: "video",
        content: url,
      });
      cleanedText = cleanedText.replace(url, "");
    }
  }

  // 音声を抽出
  for (const pattern of AUDIO_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const url = match[1];
      mediaContents.push({
        type: "audio",
        content: url,
      });
      cleanedText = cleanedText.replace(url, "");
    }
  }

  // 重複を除去
  const uniqueMedia = mediaContents.filter((item, index, self) =>
    index === self.findIndex((t) => t.content === item.content)
  );

  // テキストをクリーンアップ（余分な空行を除去）
  cleanedText = cleanedText
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n")
    .trim();

  return {
    textContent: cleanedText,
    mediaContents: uniqueMedia,
    hasMedia: uniqueMedia.length > 0,
    rawResponse: response,
  };
}

/**
 * URLがLINEで送信可能な形式かチェック
 * LINEは HTTPS のみ対応
 */
export function isValidLineMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 画像URLをLINE送信用に変換
 * HTTPの場合はHTTPSに変換を試みる
 */
export function normalizeMediaUrl(url: string): string {
  if (url.startsWith("http://")) {
    return url.replace("http://", "https://");
  }
  return url;
}

/**
 * 画像URLからプレビュー用URLを生成
 * 同じURLを使用（LINEが自動でリサイズ）
 */
export function generatePreviewUrl(originalUrl: string): string {
  // 多くの画像ホスティングサービスはサイズパラメータをサポート
  // ここでは同じURLを返す（LINEが自動でサムネイルを生成）
  return originalUrl;
}
