import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

async function registerUser(prefix: string) {
  const unique = `${prefix}${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        name: `E2E_${unique}`,
        email: `${unique}@e2e-test.local`,
        password: "TestPass1234",
      },
    }),
  });
  const data = (await res.json()) as any;
  return {
    token: data.result.data.json.token as string,
    userId: data.result.data.json.user.id as number,
  };
}

async function trpcQuery(token: string, path: string, input?: any) {
  const url = input
    ? `${API_BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : `${API_BASE}/api/trpc/${path}`;
  const res = await fetch(url, {
    headers: { Cookie: `app_session_id=${token}` },
  });
  return (await res.json()) as any;
}

async function trpcMutate(token: string, path: string, input: any) {
  const res = await fetch(`${API_BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `app_session_id=${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  return (await res.json()) as any;
}

function collectJsErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

function filterCriticalErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes("UNAUTHORIZED") &&
      !e.includes("fetch") &&
      !e.includes("Failed to fetch") &&
      !e.includes("NetworkError") &&
      !e.includes("net::ERR")
  );
}

async function waitForPageReady(page: Page, timeout = 20_000) {
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await page.waitForTimeout(500);
}

// ===========================================================================
// 1. Profile Completion & Trust Scoring
// ===========================================================================
test.describe("Profile Completion & Trust", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("p4prof");
    token = user.token;
  });

  test("new user profile is empty", async () => {
    const res = await trpcQuery(token, "profile.get");
    const profile = res.result.data.json;
    // New user should have mostly empty profile
    expect(profile.displayName).toBeFalsy();
    expect(profile.bio).toBeFalsy();
  });

  test("filling profile fields awards trust points incrementally", async () => {
    // Get baseline score
    const beforeRes = await trpcQuery(token, "trust.getScore");
    const scoreBefore = beforeRes.result.data.json.score;

    // Update just displayName + bio
    await trpcMutate(token, "profile.update", {
      displayName: "テスト太郎",
      bio: "Phase4テストユーザー",
    });

    const afterRes = await trpcQuery(token, "trust.getScore");
    const scoreAfter = afterRes.result.data.json.score;
    expect(scoreAfter).toBeGreaterThan(scoreBefore);

    // Now add more fields
    const scoreMid = scoreAfter;
    await trpcMutate(token, "profile.update", {
      displayName: "テスト太郎",
      bio: "Phase4テストユーザー",
      skills: ["TypeScript"],
      experience: "3年",
    });

    const afterRes2 = await trpcQuery(token, "trust.getScore");
    expect(afterRes2.result.data.json.score).toBeGreaterThan(scoreMid);
  });

  test("trust history shows profile field actions", async () => {
    const res = await trpcQuery(token, "trust.getHistory", { limit: 50 });
    const history = res.result.data.json;

    const profileActions = history.filter((h: any) =>
      h.action.startsWith("profile_field_")
    );
    expect(profileActions.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. Chat Session Pagination
// ===========================================================================
test.describe("Chat Session Pagination", () => {
  let token: string;
  let sessionId: number;

  test.beforeAll(async () => {
    const user = await registerUser("p4chat");
    token = user.token;

    // Create a session and send several messages
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "Pagination test",
    });
    sessionId = createRes.result.data.json.id;

    // Send 3 messages to have some data
    for (let i = 0; i < 3; i++) {
      await trpcMutate(token, "chat.sendMessage", {
        sessionId,
        content: `テストメッセージ ${i + 1}`,
      });
    }
  });

  test("getSession returns totalMessages count", async () => {
    const res = await trpcQuery(token, "chat.getSession", { id: sessionId });
    const data = res.result.data.json;

    expect(data.totalMessages).toBeGreaterThanOrEqual(6); // 3 user + 3 assistant
    expect(data.messages).toBeInstanceOf(Array);
    expect(data.messages.length).toBeGreaterThan(0);
  });

  test("getSession respects limit parameter", async () => {
    const res = await trpcQuery(token, "chat.getSession", {
      id: sessionId,
      limit: 2,
    });
    const data = res.result.data.json;

    expect(data.messages.length).toBe(2);
    expect(data.totalMessages).toBeGreaterThan(2);
  });

  test("getSession respects offset parameter", async () => {
    const res = await trpcQuery(token, "chat.getSession", {
      id: sessionId,
      limit: 2,
      offset: 2,
    });
    const data = res.result.data.json;

    expect(data.messages.length).toBe(2);
  });

  test("sessions list is limited to 50", async () => {
    const res = await trpcQuery(token, "chat.sessions");
    const sessions = res.result.data.json;
    expect(sessions.length).toBeLessThanOrEqual(50);
  });
});

// ===========================================================================
// 3. Dashboard Page
// ===========================================================================
test.describe("Dashboard Page", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/dashboard");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows welcome heading or sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForPageReady(page);

    const isSignIn = page.url().includes("/login");
    if (isSignIn) {
      await expect(page.getByText("分身AIにログイン")).toBeVisible();
    } else {
      await expect(page.getByText("おかえりなさい").first()).toBeVisible();
    }
  });

  test("shows quick stats section", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    // Check that stats are visible
    await expect(page.getByText("信頼度").first()).toBeVisible();
    await expect(page.getByText("分身AI").first()).toBeVisible();
    await expect(page.getByText("友達").first()).toBeVisible();
  });
});

// ===========================================================================
// 4. Friends Page
// ===========================================================================
test.describe("Friends Page", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/friends");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows friends heading", async ({ page }) => {
    await page.goto("/friends");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    await expect(page.getByRole("heading", { name: "友達" })).toBeVisible();
  });

  test("shows friend code section", async ({ page }) => {
    await page.goto("/friends");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    await expect(page.getByText("あなたの友達コード")).toBeVisible();
  });

  test("NPC friends have NPC badge via API", async () => {
    const user = await registerUser("p4friends");
    const res = await trpcQuery(user.token, "friends.list");
    const friends = res.result.data.json;

    const npcFriends = friends.filter((f: any) => f.friend.isNpc);
    expect(npcFriends.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 5. Matching Session Detail
// ===========================================================================
test.describe("Matching Session Detail Page", () => {
  test("non-existent session shows error state", async ({ page }) => {
    await page.goto("/matching/999999");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    // Should show error or "not found" state
    const hasNotFound = await page.getByText("セッションが見つかりません").isVisible().catch(() => false);
    const hasError = await page.getByText("一覧に戻る").isVisible().catch(() => false);
    expect(hasNotFound || hasError).toBeTruthy();
  });

  test("matching page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/matching/1");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 6. Growth Page
// ===========================================================================
test.describe("Growth Page", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/growth");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows growth heading or sign-in", async ({ page }) => {
    await page.goto("/growth");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    const hasGrowth = await page.getByText("分身AI育成").isVisible().catch(() => false);
    const hasLevel = await page.getByText("レベル").first().isVisible().catch(() => false);
    expect(hasGrowth || hasLevel).toBeTruthy();
  });

  test("responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/growth");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 7. Quests Page
// ===========================================================================
test.describe("Quests Page", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/quests");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows quests heading", async ({ page }) => {
    await page.goto("/quests");
    await waitForPageReady(page);

    if (page.url().includes("/login")) {
      test.skip();
      return;
    }

    await expect(page.getByText("クエスト").first()).toBeVisible();
  });
});

// ===========================================================================
// 8. Zero TypeScript errors (API validation)
// ===========================================================================
test.describe("API Health", () => {
  test("/api/status returns ok", async () => {
    const res = await fetch(`${API_BASE}/api/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
  });

  test("auth.me returns user info for valid token", async () => {
    const user = await registerUser("p4health");
    const res = await trpcQuery(user.token, "auth.me");
    const me = res.result.data.json;
    expect(me.id).toBe(user.userId);
    expect(me.trustScore).toBeGreaterThanOrEqual(0);
  });

  test("protected endpoint returns UNAUTHORIZED without token", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/profile.get`);
    const data = (await res.json()) as any;
    expect(data.error).toBeTruthy();
    expect(data.error.json.message).toContain("UNAUTHORIZED");
  });
});
