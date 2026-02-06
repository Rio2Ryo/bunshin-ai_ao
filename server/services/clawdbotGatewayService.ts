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

/**
 * Clawdbot Gatewayが有効かどうかを確認
 */
export function isClawdbotEnabled(): boolean {
  return !!(ENV.clawdbotGatewayUrl && ENV.clawdbotAuthToken);
}

/**
 * Clawdbot Gateway経由でチャット応答を生成
 * Priority: options (user's DB settings) > ENV (system-wide default)
 */
export async function sendToClawdbot(
  messages: ClawdbotMessage[],
  options?: {
    agentId?: string;
    sessionKey?: string;
    stream?: boolean;
    gatewayUrl?: string;
    authToken?: string;
  }
): Promise<{
  success: boolean;
  response?: string;
  error?: string;
  rawResponse?: ClawdbotResponse;
  model?: string;
}> {
  // Priority: options (user's DB settings) > ENV (system-wide default)
  const gatewayUrl = options?.gatewayUrl || ENV.clawdbotGatewayUrl;
  const authToken = options?.authToken || ENV.clawdbotAuthToken;
  const agentId = options?.agentId || ENV.clawdbotAgentId;

  if (!gatewayUrl || !authToken) {
    return {
      success: false,
      error: "Clawdbot Gateway is not configured (missing gatewayUrl or authToken)",
    };
  }
  
  try {
    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        "x-clawdbot-agent-id": agentId,
        "ngrok-skip-browser-warning": "true",
        ...(options?.sessionKey && { "x-clawdbot-session-key": options.sessionKey }),
      },
      body: JSON.stringify({
        model: "clawdbot",
        messages,
        stream: options?.stream || false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Clawdbot] API error:", response.status, errorText);
      return {
        success: false,
        error: `Clawdbot API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json() as ClawdbotResponse;
    const assistantMessage = data.choices?.[0]?.message?.content || "";

    return {
      success: true,
      response: assistantMessage,
      rawResponse: data,
      model: data.model || "clawdbot",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Clawdbot] Request error:", errorMessage);
    return {
      success: false,
      error: `Clawdbot request error: ${errorMessage}`,
    };
  }
}

/**
 * Clawdbot Gatewayの接続テスト
 */
export async function testClawdbotConnection(
  gatewayUrl?: string,
  authToken?: string
): Promise<{
  success: boolean;
  message: string;
  responseTimeMs?: number;
}> {
  // If custom URL/token provided, use them; otherwise use ENV
  const url = gatewayUrl || ENV.clawdbotGatewayUrl;
  const token = authToken || ENV.clawdbotAuthToken;

  if (!url || !token) {
    return {
      success: false,
      message: "Clawdbot Gateway is not configured",
    };
  }

  const startTime = Date.now();

  try {
    const result = await sendToClawdbot(
      [{ role: "user", content: "ping" }],
      { gatewayUrl: url, authToken: token }
    );

    const responseTimeMs = Date.now() - startTime;

    if (result.success) {
      return {
        success: true,
        message: "Clawdbot Gateway connection successful",
        responseTimeMs,
      };
    } else {
      return {
        success: false,
        message: result.error || "Unknown error",
        responseTimeMs,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: `Connection test failed: ${errorMessage}`,
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
