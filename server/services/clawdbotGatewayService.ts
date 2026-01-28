/**
 * Clawdbot Gateway Service
 * システム全体で共通のClawdbot Gatewayを使用してメッセージを処理
 */

import { ENV } from "../_core/env";

interface ClawdbotMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ClawdbotResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// デフォルトタイムアウト（ミリ秒）
// 画像生成（nano-banana-pro + Gyazoアップロード）に60-90秒かかるため120秒に設定
const DEFAULT_TIMEOUT_MS = 120000; // 120秒

/**
 * Clawdbot Gatewayが有効かどうかを確認
 */
export function isClawdbotEnabled(): boolean {
  return !!(ENV.clawdbotGatewayUrl && ENV.clawdbotAuthToken);
}

/**
 * タイムアウト付きfetch
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clawdbot Gateway経由でチャット応答を生成
 */
export async function sendToClawdbot(
  messages: ClawdbotMessage[],
  options?: {
    agentId?: string;
    sessionKey?: string;
    stream?: boolean;
    timeoutMs?: number;
  }
): Promise<{
  success: boolean;
  response?: string;
  error?: string;
  rawResponse?: ClawdbotResponse;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();
  
  if (!isClawdbotEnabled()) {
    return {
      success: false,
      error: "Clawdbot Gateway is not configured",
      responseTimeMs: Date.now() - startTime,
    };
  }

  const agentId = options?.agentId || ENV.clawdbotAgentId;
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  
  try {
    console.log(`[Clawdbot] Sending request to ${ENV.clawdbotGatewayUrl} with timeout ${timeoutMs}ms`);
    
    const response = await fetchWithTimeout(
      `${ENV.clawdbotGatewayUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ENV.clawdbotAuthToken}`,
          "x-clawdbot-agent-id": agentId,
          "ngrok-skip-browser-warning": "true",
          ...(options?.sessionKey && { "x-clawdbot-session-key": options.sessionKey }),
        },
        body: JSON.stringify({
          model: "clawdbot",
          messages,
          stream: options?.stream || false,
        }),
      },
      timeoutMs
    );

    const responseTimeMs = Date.now() - startTime;
    console.log(`[Clawdbot] Response received in ${responseTimeMs}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Clawdbot] API error:", response.status, errorText);
      return {
        success: false,
        error: `Clawdbot API error: ${response.status} - ${errorText}`,
        responseTimeMs,
      };
    }

    const data = await response.json() as ClawdbotResponse;
    const assistantMessage = data.choices?.[0]?.message?.content || "";

    return {
      success: true,
      response: assistantMessage,
      rawResponse: data,
      responseTimeMs,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[Clawdbot] Request timed out after ${timeoutMs}ms`);
      return {
        success: false,
        error: `Clawdbot request timed out after ${timeoutMs}ms`,
        responseTimeMs,
      };
    }
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Clawdbot] Request error:", errorMessage);
    return {
      success: false,
      error: `Clawdbot request error: ${errorMessage}`,
      responseTimeMs,
    };
  }
}

/**
 * Clawdbot Gatewayの接続テスト
 */
export async function testClawdbotConnection(): Promise<{
  success: boolean;
  message: string;
  responseTimeMs?: number;
}> {
  if (!isClawdbotEnabled()) {
    return {
      success: false,
      message: "Clawdbot Gateway is not configured",
    };
  }

  const result = await sendToClawdbot(
    [{ role: "user", content: "ping" }],
    { timeoutMs: 10000 } // テスト用は10秒タイムアウト
  );

  if (result.success) {
    return {
      success: true,
      message: "Clawdbot Gateway connection successful",
      responseTimeMs: result.responseTimeMs,
    };
  } else {
    return {
      success: false,
      message: result.error || "Unknown error",
      responseTimeMs: result.responseTimeMs,
    };
  }
}

/**
 * 応答テキストからClawdbotの内部コマンド（📖 Read:など）を除去
 */
export function cleanClawdbotResponse(response: string): string {
  // 📖 Read: で始まる行を除去
  const lines = response.split("\n");
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith("📖 Read:") && 
           !trimmed.startsWith("📝 Write:") &&
           !trimmed.startsWith("🔧 Tool:");
  });
  
  return cleanedLines.join("\n").trim();
}
