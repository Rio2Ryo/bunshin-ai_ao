/**
 * Clawdbot Gateway Connection Test
 */

import { describe, it, expect } from "vitest";

describe("Clawdbot Gateway", () => {
  const GATEWAY_URL = process.env.CLAWDBOT_GATEWAY_URL;
  const AUTH_TOKEN = process.env.CLAWDBOT_AUTH_TOKEN;
  const AGENT_ID = process.env.CLAWDBOT_AGENT_ID || "main";

  it("should have environment variables configured", () => {
    expect(GATEWAY_URL).toBeDefined();
    expect(GATEWAY_URL).not.toBe("");
    expect(AUTH_TOKEN).toBeDefined();
    expect(AUTH_TOKEN).not.toBe("");
  });

  it.skip("should connect to Clawdbot Gateway and get response (external service)", async () => {
    // このテストは外部サービス（ngrok）に依存するため、手動実行用にスキップ
    if (!GATEWAY_URL || !AUTH_TOKEN) {
      console.log("Skipping test: Clawdbot credentials not configured");
      return;
    }

    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "x-clawdbot-agent-id": AGENT_ID,
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        model: "clawdbot",
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data).toHaveProperty("choices");
    expect(data.choices).toBeInstanceOf(Array);
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0]).toHaveProperty("message");
    expect(data.choices[0].message).toHaveProperty("content");
    
    console.log("Clawdbot response:", data.choices[0].message.content);
  });
});
