/**
 * Clawdbot Gateway接続テスト
 */
import { describe, it, expect } from "vitest";
import { isClawdbotEnabled, sendToClawdbot, testClawdbotConnection } from "./services/clawdbotGatewayService";

describe("Clawdbot Gateway Connection", () => {
  it("should have Clawdbot enabled", () => {
    expect(isClawdbotEnabled()).toBe(true);
  });

  it("should connect to Clawdbot Gateway successfully", async () => {
    const result = await testClawdbotConnection();
    console.log("Connection test result:", result);
    expect(result.success).toBe(true);
    expect(result.responseTimeMs).toBeDefined();
  }, 30000);

  it("should receive response from Clawdbot", async () => {
    const result = await sendToClawdbot([
      { role: "user", content: "ping" }
    ]);
    console.log("Send test result:", result);
    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.model).toBe("clawdbot");
  }, 30000);
});
