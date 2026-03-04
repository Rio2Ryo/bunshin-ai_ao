/**
 * LINE Rich Messaging Helper Functions
 *
 * Provides helpers for:
 * - Fetching binary message content from LINE Content API
 * - OCR via Vision APIs (OpenAI gpt-4o + Gemini fallback)
 * - Syncing LINE profile images to R2
 * - Building LINE Flex Messages (welcome, OCR result, matching, friend request)
 * - Quick Reply items for common actions
 */

import type { Env } from "../trpc";

// ============ Color Constants ============

const COLOR_PRIMARY = "#0084FF";
const COLOR_SUCCESS = "#06C755";
const COLOR_WARNING = "#FFB900";
const COLOR_DANGER = "#FF4444";

// ============ 1. fetchLineMessageContent ============

/**
 * Fetch binary content from LINE Content API for a given message ID.
 * Returns the raw data and content type, or null on failure.
 */
export async function fetchLineMessageContent(
  messageId: string,
  accessToken: string
): Promise<{ data: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await res.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    return { data, contentType };
  } catch {
    return null;
  }
}

// ============ 2. ocrImageViaVision ============

/**
 * Perform OCR on an image using Vision APIs.
 * Tries OpenAI gpt-4o first, then falls back to Gemini gemini-2.0-flash.
 * Returns extracted text or null on failure.
 */
export async function ocrImageViaVision(
  imageData: Uint8Array,
  contentType: string,
  db: D1Database,
  userId: number,
  env: Env
): Promise<string | null> {
  // Convert Uint8Array to base64
  const base64 = btoa(
    String.fromCharCode.apply(null, Array.from(imageData))
  );

  const ocrPrompt =
    "この画像の内容をすべて読み取ってテキストとして出力してください。名刺、書類、メモ、スクリーンショットなど、あらゆる画像を処理します。";

  // Get user's API keys for OpenAI and Gemini
  const configs = await db
    .prepare(
      `SELECT apiKey, provider FROM ai_api_configs WHERE userId=? AND (provider='openai' OR provider='gemini')`
    )
    .bind(userId)
    .all<{ apiKey: string; provider: string }>();

  const keys = new Map<string, string>();
  for (const c of configs.results ?? []) {
    keys.set(c.provider, c.apiKey);
  }

  // Try OpenAI gpt-4o first
  if (keys.has("openai")) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keys.get("openai")}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: ocrPrompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${contentType};base64,${base64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 2048,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const text = data.choices?.[0]?.message?.content ?? "";
        if (text.trim()) return text.trim();
      }
    } catch {
      /* fall through to Gemini */
    }
  }

  // Fallback: Gemini gemini-2.0-flash
  if (keys.has("gemini")) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys.get("gemini")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: ocrPrompt },
                  {
                    inlineData: {
                      mimeType: contentType,
                      data: base64,
                    },
                  },
                ],
              },
            ],
          }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const text =
          data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text.trim()) return text.trim();
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

// ============ 3. syncLineProfileToR2 ============

/**
 * Download a LINE profile image and upload it to R2.
 * Only updates the user's avatar if they don't already have one set.
 * Returns the R2 asset URL or null on failure/skip.
 */
export async function syncLineProfileToR2(
  pictureUrl: string,
  userId: number,
  db: D1Database,
  r2: R2Bucket
): Promise<string | null> {
  try {
    // Check if user already has an avatar
    const profile = await db
      .prepare(`SELECT avatarUrl FROM user_profiles WHERE userId=?`)
      .bind(userId)
      .first<{ avatarUrl: string | null }>();

    if (profile?.avatarUrl) {
      // User already has an avatar, skip
      return null;
    }

    // Download LINE profile image
    const res = await fetch(pictureUrl);
    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    const binaryData = new Uint8Array(arrayBuffer);

    // Upload to R2
    const key = `avatars/line_${userId}_${Date.now()}.jpg`;
    await r2.put(key, binaryData, {
      httpMetadata: { contentType: "image/jpeg" },
    });

    // Update user_profiles with the new avatar URL
    const avatarUrl = `/assets/${key}`;
    await db
      .prepare(`UPDATE user_profiles SET avatarUrl=? WHERE userId=?`)
      .bind(avatarUrl, userId)
      .run();

    return avatarUrl;
  } catch {
    return null;
  }
}

// ============ 4. buildWelcomeGuidanceFlex ============

/**
 * Build a LINE Flex Message showing what the bot can do after connection.
 */
export function buildWelcomeGuidanceFlex(twinName: string): object {
  return {
    type: "flex",
    altText: `${twinName}とのLINE連携が完了しました`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\uD83C\uDF89 LINE連携完了！",
            weight: "bold",
            size: "xl",
            color: COLOR_SUCCESS,
          },
        ],
        backgroundColor: "#F0FFF4",
        paddingAll: "20px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `${twinName}があなたのLINEに接続されました。以下の機能が利用できます。`,
            wrap: true,
            size: "sm",
            color: "#666666",
            margin: "none",
          },
          {
            type: "separator",
            margin: "lg",
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            spacing: "md",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "\uD83D\uDCAC",
                    size: "lg",
                    flex: 0,
                  },
                  {
                    type: "text",
                    text: "分身AIとチャット",
                    size: "sm",
                    color: "#333333",
                    margin: "md",
                    gravity: "center",
                  },
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "\uD83D\uDCF7",
                    size: "lg",
                    flex: 0,
                  },
                  {
                    type: "text",
                    text: "画像送信\u2192テキスト読み取り",
                    size: "sm",
                    color: "#333333",
                    margin: "md",
                    gravity: "center",
                  },
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "\uD83D\uDCCA",
                    size: "lg",
                    flex: 0,
                  },
                  {
                    type: "text",
                    text: "マッチング結果通知",
                    size: "sm",
                    color: "#333333",
                    margin: "md",
                    gravity: "center",
                  },
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "\uD83D\uDC65",
                    size: "lg",
                    flex: 0,
                  },
                  {
                    type: "text",
                    text: "友達リクエスト通知",
                    size: "sm",
                    color: "#333333",
                    margin: "md",
                    gravity: "center",
                  },
                ],
              },
            ],
          },
        ],
        paddingAll: "20px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "メッセージを送って会話を始めましょう！",
            size: "xs",
            color: "#AAAAAA",
            align: "center",
            wrap: true,
          },
        ],
        paddingAll: "15px",
      },
    },
    quickReply: buildQuickReplyItems(),
  };
}

// ============ 5. buildImageOCRResultFlex ============

/**
 * Build a LINE Flex Message showing OCR extraction results.
 */
export function buildImageOCRResultFlex(
  extractedText: string,
  savedToKB: boolean
): object {
  const truncatedText =
    extractedText.length > 300
      ? extractedText.substring(0, 300) + "..."
      : extractedText;

  const footerText = savedToKB
    ? "ナレッジベースに保存しました \u2705"
    : "ナレッジベースへの保存に失敗しました";
  const footerColor = savedToKB ? COLOR_SUCCESS : COLOR_DANGER;

  return {
    type: "flex",
    altText: "画像読み取り結果",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\uD83D\uDCF7 画像読み取り結果",
            weight: "bold",
            size: "lg",
            color: COLOR_PRIMARY,
          },
        ],
        backgroundColor: "#F0F7FF",
        paddingAll: "20px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: truncatedText,
            wrap: true,
            size: "sm",
            color: "#333333",
          },
        ],
        paddingAll: "20px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "separator",
            margin: "none",
          },
          {
            type: "text",
            text: footerText,
            size: "xs",
            color: footerColor,
            align: "center",
            margin: "md",
          },
        ],
        paddingAll: "15px",
      },
    },
  };
}

// ============ 6. buildMatchingResultFlex ============

/**
 * Build a LINE Flex Message for matching result notifications.
 * Score color: green >= 70, yellow >= 40, red < 40.
 */
export function buildMatchingResultFlex(
  matchName: string,
  overallScore: number,
  recommendation: string
): object {
  const scorePercent = Math.round(overallScore);
  let scoreColor: string;
  if (overallScore >= 70) {
    scoreColor = COLOR_SUCCESS;
  } else if (overallScore >= 40) {
    scoreColor = COLOR_WARNING;
  } else {
    scoreColor = COLOR_DANGER;
  }

  return {
    type: "flex",
    altText: `マッチング結果: ${matchName}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\uD83E\uDD1D マッチング結果",
            weight: "bold",
            size: "lg",
            color: COLOR_PRIMARY,
          },
        ],
        backgroundColor: "#F0F7FF",
        paddingAll: "20px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: matchName,
            weight: "bold",
            size: "md",
            color: "#333333",
          },
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "lg",
            contents: [
              {
                type: "text",
                text: "相性スコア",
                size: "sm",
                color: "#666666",
                flex: 1,
                gravity: "center",
              },
              {
                type: "text",
                text: `${scorePercent}%`,
                weight: "bold",
                size: "xxl",
                color: scoreColor,
                flex: 0,
                align: "end",
              },
            ],
          },
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "text",
            text: recommendation,
            wrap: true,
            size: "sm",
            color: "#666666",
            margin: "lg",
          },
        ],
        paddingAll: "20px",
      },
    },
  };
}

// ============ 7. buildFriendRequestFlex ============

/**
 * Build a LINE Flex Message for friend request notifications.
 * Includes action buttons to accept or view details.
 */
export function buildFriendRequestFlex(
  fromUserName: string,
  requestId: number,
  frontendUrl: string
): object {
  return {
    type: "flex",
    altText: `友達リクエスト: ${fromUserName}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\uD83D\uDC65 友達リクエスト",
            weight: "bold",
            size: "lg",
            color: COLOR_PRIMARY,
          },
        ],
        backgroundColor: "#F0F7FF",
        paddingAll: "20px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `${fromUserName}さんから友達リクエストが届いています`,
            wrap: true,
            size: "md",
            color: "#333333",
          },
        ],
        paddingAll: "20px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "承認する",
              uri: `${frontendUrl}/friends`,
            },
            style: "primary",
            color: COLOR_SUCCESS,
          },
          {
            type: "button",
            action: {
              type: "uri",
              label: "詳細を見る",
              uri: `${frontendUrl}/friends`,
            },
            style: "secondary",
          },
        ],
        paddingAll: "15px",
      },
    },
  };
}

// ============ 8. buildQuickReplyItems ============

/**
 * Build a quickReply object for common LINE bot actions.
 */
export function buildQuickReplyItems(): {
  items: Array<{
    type: "action";
    action: { type: "message"; label: string; text: string };
  }>;
} {
  return {
    items: [
      {
        type: "action",
        action: {
          type: "message",
          label: "マッチング",
          text: "マッチング結果を見せて",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "友達一覧",
          text: "友達一覧を見せて",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "ヘルプ",
          text: "ヘルプ",
        },
      },
    ],
  };
}
