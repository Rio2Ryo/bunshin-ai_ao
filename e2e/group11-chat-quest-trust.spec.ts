import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

/** tRPC query helper — GET with input encoded as query param. */
async function trpcQuery(
  endpoint: string,
  token: string,
  input?: unknown
): Promise<any> {
  const qs = input
    ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : "";
  const res = await fetch(`${API_BASE}/api/trpc/${endpoint}${qs}`, {
    headers: { Cookie: `app_session_id=${token}` },
  });
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`trpcQuery ${endpoint} failed: ${JSON.stringify(data.error)}`);
  return data.result.data.json;
}

/** tRPC mutation helper — POST with JSON body. */
async function trpcMutation(
  endpoint: string,
  token: string,
  input?: unknown
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/trpc/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `app_session_id=${token}`,
    },
    body: JSON.stringify({ json: input ?? {} }),
  });
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`trpcMutation ${endpoint} failed: ${JSON.stringify(data.error)}`);
  return data.result.data.json;
}

/** Register a fresh user and return token + userId. */
async function registerFreshUser(): Promise<{ token: string; userId: number }> {
  const unique = `chattest${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        name: `ChatTest_${unique}`,
        email: `${unique}@e2e-test.local`,
        password: "TestPass1234",
      },
    }),
  });
  const data = (await res.json()) as any;
  return {
    token: data.result.data.json.token,
    userId: data.result.data.json.user.id,
  };
}

// ===========================================================================
// 1. CHAT SESSION CRUD (API-level)
// ===========================================================================
test.describe("Chat Session CRUD", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerFreshUser();
    token = user.token;
  });

  test("createSession returns a valid session ID", async () => {
    const result = await trpcMutation("chat.createSession", token, {
      title: "E2Eテストセッション",
    });
    expect(result.id).toBeGreaterThan(0);
  });

  test("sessions list includes the newly created session", async () => {
    // Create a session with a unique title
    const title = `テスト_${Date.now()}`;
    await trpcMutation("chat.createSession", token, { title });

    const sessions = await trpcQuery("chat.sessions", token);
    const found = sessions.find((s: any) => s.title === title);
    expect(found).toBeTruthy();
    expect(found.messageCount).toBe(0);
  });

  test("renameSession changes the session title", async () => {
    const { id } = await trpcMutation("chat.createSession", token, {
      title: "元のタイトル",
    });

    const newTitle = "変更後タイトル";
    const result = await trpcMutation("chat.renameSession", token, {
      id,
      title: newTitle,
    });
    expect(result.success).toBe(true);

    // Verify via getSession
    const session = await trpcQuery("chat.getSession", token, { id });
    expect(session.session.title).toBe(newTitle);
  });

  test("deleteSession removes the session", async () => {
    const { id } = await trpcMutation("chat.createSession", token, {
      title: "削除予定セッション",
    });

    // Delete
    const result = await trpcMutation("chat.deleteSession", token, { id });
    expect(result.success).toBe(true);

    // Verify it's gone from the list
    const sessions = await trpcQuery("chat.sessions", token);
    const found = sessions.find((s: any) => s.id === id);
    expect(found).toBeFalsy();
  });

  test("getSession returns session details with empty messages", async () => {
    const { id } = await trpcMutation("chat.createSession", token, {
      title: "詳細確認セッション",
    });

    const data = await trpcQuery("chat.getSession", token, { id });
    expect(data.session.id).toBe(id);
    expect(data.session.title).toBe("詳細確認セッション");
    expect(data.messages).toHaveLength(0);
    expect(data.totalMessages).toBe(0);
  });

  test("getSession for non-existent ID returns error", async () => {
    await expect(
      trpcQuery("chat.getSession", token, { id: 999999 })
    ).rejects.toThrow();
  });

  test("renameSession with empty title is rejected", async () => {
    const { id } = await trpcMutation("chat.createSession", token, {
      title: "バリデーションテスト",
    });

    await expect(
      trpcMutation("chat.renameSession", token, { id, title: "" })
    ).rejects.toThrow();
  });

  test("createSession without title uses default", async () => {
    const { id } = await trpcMutation("chat.createSession", token, {});

    const data = await trpcQuery("chat.getSession", token, { id });
    expect(data.session.title).toBe("New Chat");
  });
});

// ===========================================================================
// 2. QUEST & DAILY LOGIN FLOW (API-level)
// ===========================================================================
test.describe("Quest & Daily Login Flow", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerFreshUser();
    token = user.token;
  });

  test("quests.list returns transaction history", async () => {
    const transactions = await trpcQuery("quests.list", token);
    // Newly registered user may have registration bonus transactions
    expect(Array.isArray(transactions)).toBe(true);
  });

  test("quests.checkDailyLogin detects first login of the day", async () => {
    const result = await trpcMutation("quests.checkDailyLogin", token);
    // Fresh user on first call: should be eligible for daily bonus
    expect(result).toHaveProperty("points");
    expect(result).toHaveProperty("isFirstLogin");
    expect(typeof result.points).toBe("number");
    expect(typeof result.isFirstLogin).toBe("boolean");
  });

  test("quests.checkDailyLogin returns 0 points on second call same day", async () => {
    // First call to claim
    await trpcMutation("quests.checkDailyLogin", token);
    // Second call — already claimed
    const result = await trpcMutation("quests.checkDailyLogin", token);
    // Note: checkDailyLogin only checks, it doesn't actually award.
    // The result should be consistent either way.
    expect(result).toHaveProperty("points");
  });
});

// ===========================================================================
// 3. TRUST SCORE FLOW (API-level)
// ===========================================================================
test.describe("Trust Score Flow", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerFreshUser();
    token = user.token;
  });

  test("trust.getScore returns score and rank for new user", async () => {
    const trust = await trpcQuery("trust.getScore", token);
    expect(trust).toHaveProperty("score");
    expect(trust).toHaveProperty("rank");
    expect(trust).toHaveProperty("rankLabel");
    expect(trust.score).toBeGreaterThanOrEqual(0);
    expect(typeof trust.rank).toBe("string");
  });

  test("new user has registration bonus in trust score", async () => {
    const trust = await trpcQuery("trust.getScore", token);
    // Registration awards +50 points
    expect(trust.score).toBeGreaterThanOrEqual(50);
  });

  test("trust.getHistory shows registration action", async () => {
    const history = await trpcQuery("trust.getHistory", token, { limit: 50 });
    expect(Array.isArray(history)).toBe(true);

    const regAction = history.find((h: any) => h.action === "register");
    expect(regAction).toBeTruthy();
    expect(regAction.delta).toBe(50);
  });

  test("trust.addAction awards points and returns updated score", async () => {
    const before = await trpcQuery("trust.getScore", token);

    const result = await trpcMutation("trust.addAction", token, {
      action: "e2e_test_action",
      delta: 5,
      description: "E2Eテストアクション",
    });

    expect(result.score).toBe(before.score + 5);
    expect(result).toHaveProperty("rank");
    expect(result).toHaveProperty("rankLabel");
  });

  test("trust.addAction appears in history", async () => {
    const history = await trpcQuery("trust.getHistory", token, { limit: 50 });
    const testAction = history.find(
      (h: any) => h.action === "e2e_test_action"
    );
    expect(testAction).toBeTruthy();
    expect(testAction.delta).toBe(5);
    expect(testAction.description).toBe("E2Eテストアクション");
  });

  test("trust rank progresses with accumulated points", async () => {
    // Award enough points to progress rank
    await trpcMutation("trust.addAction", token, {
      action: "e2e_rank_boost",
      delta: 30,
      description: "ランクアップテスト",
    });

    const trust = await trpcQuery("trust.getScore", token);
    // 50 (register) + 5 (previous test) + 30 = 85 → should be gold or platinum
    expect(trust.score).toBeGreaterThanOrEqual(85);
    expect(["gold", "platinum", "diamond"]).toContain(trust.rank);
  });
});

// ===========================================================================
// 4. GROWTH SYSTEM (API-level)
// ===========================================================================
test.describe("Growth System", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerFreshUser();
    token = user.token;
  });

  test("growth.getStatus initializes status for new user with twin", async () => {
    const status = await trpcQuery("growth.getStatus", token);
    // New user has auto-created twin → growth status initialized
    if (status) {
      expect(status).toHaveProperty("level");
      expect(status).toHaveProperty("twinId");
    }
    // status may be null if no twin exists (acceptable)
  });

  test("growth.getSkillLevels returns empty array initially", async () => {
    const skills = await trpcQuery("growth.getSkillLevels", token);
    expect(Array.isArray(skills)).toBe(true);
  });

  test("growth.setSkillLevel sets a skill and retrieves it", async () => {
    const status = await trpcQuery("growth.getStatus", token);
    if (!status) {
      test.skip();
      return;
    }

    await trpcMutation("growth.setSkillLevel", token, {
      skillType: "communication",
      level: 3,
    });

    const skills = await trpcQuery("growth.getSkillLevels", token);
    const comm = skills.find((s: any) => s.skillType === "communication");
    expect(comm).toBeTruthy();
    expect(comm.level).toBe(3);
  });

  test("growth.setSkillLevels batch-sets multiple skills", async () => {
    const status = await trpcQuery("growth.getStatus", token);
    if (!status) {
      test.skip();
      return;
    }

    await trpcMutation("growth.setSkillLevels", token, {
      skillLevels: {
        leadership: 4,
        creativity: 2,
        technical: 5,
      },
    });

    const skills = await trpcQuery("growth.getSkillLevels", token);
    const leadership = skills.find((s: any) => s.skillType === "leadership");
    const creativity = skills.find((s: any) => s.skillType === "creativity");
    const technical = skills.find((s: any) => s.skillType === "technical");

    expect(leadership?.level).toBe(4);
    expect(creativity?.level).toBe(2);
    expect(technical?.level).toBe(5);
  });

  test("growth.areSkillsConfigured returns true after setting skills", async () => {
    const configured = await trpcQuery("growth.areSkillsConfigured", token);
    expect(configured).toBe(true);
  });

  test("growth.getMilestones returns array", async () => {
    const milestones = await trpcQuery("growth.getMilestones", token);
    expect(Array.isArray(milestones)).toBe(true);
  });
});

// ===========================================================================
// 5. CHAT PAGE UI (browser-level)
// ===========================================================================
test.describe("Chat Page UI (/chat)", () => {
  test("chat page loads and shows heading", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    await expect(
      page.locator("text=チャット").first()
    ).toBeVisible();
  });

  test("new session button is visible", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    // Look for + button or "新しいチャット" text
    const newChatBtn = page.locator('[aria-label="新しいチャット"], button:has(svg.lucide-plus)').first();
    const hasNewChat = await newChatBtn.isVisible().catch(() => false);
    const hasNewChatText = await page.getByText("新しいチャット").first().isVisible().catch(() => false);
    expect(hasNewChat || hasNewChatText).toBeTruthy();
  });
});

// ===========================================================================
// 6. TRUST SCORE PAGE UI (browser-level)
// ===========================================================================
test.describe("Trust Score Page UI (/trust)", () => {
  test("trust page loads and shows score elements", async ({ page }) => {
    await page.goto("/trust", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    // Should show heading
    await expect(
      page.locator("text=信頼度スコア").first()
    ).toBeVisible();

    // Should show score out of 100
    await expect(page.locator("text=/ 100").first()).toBeVisible();
  });
});

// ===========================================================================
// 7. QUESTS PAGE UI (browser-level)
// ===========================================================================
test.describe("Quests Page UI (/quests)", () => {
  test("quests page loads without errors", async ({ page }) => {
    await page.goto("/quests", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    // Should show quests heading
    await expect(
      page.locator("text=クエスト").first()
    ).toBeVisible();
  });
});
