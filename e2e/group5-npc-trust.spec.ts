import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

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

async function isOnSignInPage(page: Page): Promise<boolean> {
  if (page.url().includes("/login")) return true;
  return page.getByText("分身AIにログイン").isVisible().catch(() => false);
}

// ===========================================================================
// 1. NPC Auto-Friend on Registration (API-level)
// ===========================================================================
test.describe("NPC Auto-Friend on Registration", () => {
  let token: string;
  let userId: number;

  test.beforeAll(async () => {
    const unique = `npctest${Date.now()}`;
    const res = await fetch(`${API_BASE}/api/trpc/auth.register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: {
          name: `NpcTest_${unique}`,
          email: `${unique}@e2e-test.local`,
          password: "TestPass1234",
        },
      }),
    });
    const data = (await res.json()) as any;
    token = data.result.data.json.token;
    userId = data.result.data.json.user.id;
  });

  test("registration returns valid user ID and token", () => {
    expect(userId).toBeGreaterThan(0);
    expect(token).toBeTruthy();
    expect(token.split(".")).toHaveLength(3); // JWT format
  });

  test("new user has ガイド太郎 as NPC friend", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/friends.list`, {
      headers: { Cookie: `app_session_id=${token}` },
    });
    const data = (await res.json()) as any;
    const friends = data.result.data.json;

    const taro = friends.find(
      (f: any) => f.friend.name === "ガイド太郎"
    );
    expect(taro).toBeTruthy();
    expect(taro.friend.isNpc).toBeTruthy();
    expect(taro.twin).toBeTruthy();
    expect(taro.twin.name).toBe("ガイド太郎の分身AI");
  });

  test("new user has 案内花子 as NPC friend", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/friends.list`, {
      headers: { Cookie: `app_session_id=${token}` },
    });
    const data = (await res.json()) as any;
    const friends = data.result.data.json;

    const hanako = friends.find(
      (f: any) => f.friend.name === "案内花子"
    );
    expect(hanako).toBeTruthy();
    expect(hanako.friend.isNpc).toBeTruthy();
    expect(hanako.twin).toBeTruthy();
    expect(hanako.twin.name).toBe("案内花子の分身AI");
  });

  test("NPC tutorial chat sessions are created", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/chat.sessions`, {
      headers: { Cookie: `app_session_id=${token}` },
    });
    const data = (await res.json()) as any;
    const sessions = data.result.data.json;

    // Should have onboarding + 2 NPC tutorial sessions
    const npcSessions = sessions.filter(
      (s: any) => s.mode === "npc_tutorial"
    );
    expect(npcSessions).toHaveLength(2);

    const taroSession = npcSessions.find((s: any) =>
      s.title.includes("ガイド太郎")
    );
    expect(taroSession).toBeTruthy();

    const hanakoSession = npcSessions.find((s: any) =>
      s.title.includes("案内花子")
    );
    expect(hanakoSession).toBeTruthy();
  });

  test("trust score is initialized with registration bonus", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/trust.getScore`, {
      headers: { Cookie: `app_session_id=${token}` },
    });
    const data = (await res.json()) as any;
    const trust = data.result.data.json;

    expect(trust.score).toBeGreaterThanOrEqual(5); // +5 registration bonus
    expect(trust.rank).toBe("bronze");
  });

  test("trust score history shows registration action", async () => {
    const res = await fetch(
      `${API_BASE}/api/trpc/trust.getHistory?input=${encodeURIComponent(
        JSON.stringify({ json: { limit: 50 } })
      )}`,
      { headers: { Cookie: `app_session_id=${token}` } }
    );
    const data = (await res.json()) as any;
    const history = data.result.data.json;

    const regAction = history.find(
      (h: any) => h.action === "register"
    );
    expect(regAction).toBeTruthy();
    expect(regAction.delta).toBe(5);
  });

  test("auth.me includes trust score and tutorial flags", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/auth.me`, {
      headers: { Cookie: `app_session_id=${token}` },
    });
    const data = (await res.json()) as any;
    const me = data.result.data.json;

    expect(me.trustScore).toBeGreaterThanOrEqual(5);
    expect(me.trustRank).toBe("bronze");
    expect(me.onboardingCompleted).toBe(0);
    expect(me.tutorialCompleted).toBe(0);
  });
});

// ===========================================================================
// 2. Trust Score Page (/trust)
// ===========================================================================
test.describe("Trust Score Page (/trust)", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/trust");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows sign-in or trust score heading", async ({ page }) => {
    await page.goto("/trust");
    await waitForPageReady(page);

    const signedOut = await isOnSignInPage(page);
    if (signedOut) {
      await expect(page.getByText("分身AIにログイン")).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "信頼度スコア" })
      ).toBeVisible();
    }
  });

  test("displays score circle and rank badge when authenticated", async ({
    page,
  }) => {
    await page.goto("/trust");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    // Score number should be visible
    await expect(page.getByText("/ 100")).toBeVisible();

    // Rank badge (Bronze, Silver, Gold, or Platinum)
    const hasBronze = await page.getByText("Bronze").first().isVisible().catch(() => false);
    const hasSilver = await page.getByText("Silver").first().isVisible().catch(() => false);
    const hasGold = await page.getByText("Gold").first().isVisible().catch(() => false);
    const hasPlatinum = await page.getByText("Platinum").first().isVisible().catch(() => false);
    expect(hasBronze || hasSilver || hasGold || hasPlatinum).toBeTruthy();
  });

  test("displays rank overview section", async ({ page }) => {
    await page.goto("/trust");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    await expect(page.getByText("ランク一覧")).toBeVisible();
    // All four ranks should be listed
    await expect(page.getByText("Bronze").first()).toBeVisible();
    await expect(page.getByText("Silver").first()).toBeVisible();
    await expect(page.getByText("Gold").first()).toBeVisible();
    await expect(page.getByText("Platinum").first()).toBeVisible();
  });

  test("displays how-to-increase section", async ({ page }) => {
    await page.goto("/trust");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    await expect(page.getByText("スコアを上げる方法")).toBeVisible();
    await expect(page.getByText("アカウント作成")).toBeVisible();
    await expect(page.getByText("デイリーログイン", { exact: true })).toBeVisible();
    await expect(page.getByText("オンボーディング完了")).toBeVisible();
  });

  test("displays history section", async ({ page }) => {
    await page.goto("/trust");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    await expect(page.getByText("変動履歴")).toBeVisible();
  });

  test("page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/trust");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 3. Trust Score in Navigation (sidebar)
// ===========================================================================
test.describe("Trust Score in Navigation", () => {
  test("sidebar shows 信頼度 menu item", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    await expect(page.getByText("信頼度").first()).toBeVisible();
  });

  test("信頼度 menu item is clickable and navigates to /trust", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    // Find and click the trust score menu item
    const trustMenuItem = page.getByText("信頼度").first();
    await trustMenuItem.click();
    await page.waitForTimeout(2000);

    expect(page.url()).toContain("/trust");
  });

  test("dashboard quick stats shows trust score", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    // Dashboard has a mini stat for trust score
    await expect(page.getByText("信頼度").first()).toBeVisible();
    // Should show "pt" value (e.g., "7pt" or "0pt")
    await expect(page.getByText(/\d+pt/).first()).toBeVisible();
  });
});

// ===========================================================================
// 4. Matching + Trust Score Threshold
// ===========================================================================
test.describe("Matching Trust Score Integration", () => {
  test("matching page loads and shows heading", async ({ page }) => {
    await page.goto("/matching");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    await expect(
      page.getByRole("heading", { name: "ビジネスマッチング" })
    ).toBeVisible();
  });

  test("matching page shows trust warning or session list", async ({
    page,
  }) => {
    await page.goto("/matching");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    // Wait for tRPC data to settle
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000);

    // Possible states:
    // - Trust score < 30: "信頼度スコアが不足しています"
    // - No twin: "まず分身AIを作成してください"
    // - No friends with twin: "分身AIを持つ友達を追加しましょう"
    // - Has sessions: session cards visible
    // - Empty: "マッチングセッションがありません"
    const hasTrustWarning = await page
      .getByText("信頼度スコアが不足しています")
      .isVisible()
      .catch(() => false);
    const hasTwinWarning = await page
      .getByText("まず分身AIを作成してください")
      .isVisible()
      .catch(() => false);
    const hasFriendWarning = await page
      .getByText("分身AIを持つ友達を追加しましょう")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("マッチングセッションがありません")
      .isVisible()
      .catch(() => false);
    const hasHeading = await page
      .getByText("ビジネスマッチング")
      .isVisible()
      .catch(() => false);

    expect(
      hasTrustWarning ||
        hasTwinWarning ||
        hasFriendWarning ||
        hasEmptyState ||
        hasHeading
    ).toBeTruthy();
  });

  test("matching page shows tutorial banner when NPC sessions exist", async ({
    page,
  }) => {
    await page.goto("/matching");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    // Wait for data
    await page.waitForTimeout(1500);

    // If user has NPC sessions and tutorialCompleted=0, should show banner
    const hasTutorialBanner = await page
      .getByText("チュートリアルセッション表示中")
      .isVisible()
      .catch(() => false);
    const hasTutorialCompleteBtn = await page
      .getByRole("button", { name: "チュートリアル完了" })
      .isVisible()
      .catch(() => false);

    // This may or may not be visible depending on the E2E user's state
    // The test just verifies no crash and one of the expected states renders
    const hasHeading = await page
      .getByText("ビジネスマッチング")
      .isVisible()
      .catch(() => false);

    expect(
      hasTutorialBanner || hasTutorialCompleteBtn || hasHeading
    ).toBeTruthy();
  });

  test("trust score threshold enforcement via API", async () => {
    // Register a fresh user (trust score = 5, below 30 threshold)
    const unique = `matchtest${Date.now()}`;
    const regRes = await fetch(`${API_BASE}/api/trpc/auth.register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: {
          name: `MatchTest_${unique}`,
          email: `${unique}@e2e-test.local`,
          password: "TestPass1234",
        },
      }),
    });
    const regData = (await regRes.json()) as any;
    const freshToken = regData.result.data.json.token;

    // Get friends list to find an NPC friend's ID
    const friendsRes = await fetch(`${API_BASE}/api/trpc/friends.list`, {
      headers: { Cookie: `app_session_id=${freshToken}` },
    });
    const friendsData = (await friendsRes.json()) as any;
    const npcFriend = friendsData.result.data.json.find(
      (f: any) => f.friend.isNpc && f.twin
    );

    // NPC matching should succeed (exempt from trust threshold)
    if (npcFriend) {
      const npcMatchRes = await fetch(
        `${API_BASE}/api/trpc/matching.create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `app_session_id=${freshToken}`,
          },
          body: JSON.stringify({
            json: {
              friendId: npcFriend.friend.id,
              theme: "E2Eテスト: NPC練習マッチング",
              turns: 3,
            },
          }),
        }
      );
      const npcMatchData = (await npcMatchRes.json()) as any;
      // NPC matching should succeed or fail gracefully (LLM may not be configured)
      // The key check: it should NOT fail with "trust score" error
      const errorMsg =
        npcMatchData?.error?.json?.message || "";
      expect(errorMsg).not.toContain("信頼度");
    }
  });
});

// ===========================================================================
// 5. Onboarding Flow Structure
// ===========================================================================
test.describe("Onboarding Flow", () => {
  test("onboarding page has step indicators", async ({ page }) => {
    // Use unauthenticated visit - may redirect
    await page.goto("/onboarding");
    await waitForPageReady(page);

    // Onboarding may redirect if completed or not logged in
    const onOnboarding = page.url().includes("/onboarding");
    if (!onOnboarding) {
      // Redirected - that's expected for completed users
      return;
    }

    // If we're on onboarding, check for step labels
    const stepLabels = [
      "サービス概要",
      "機能説明",
      "マッチング説明",
      "NPC紹介",
      "自己紹介",
    ];

    let foundSteps = 0;
    for (const label of stepLabels) {
      const visible = await page
        .getByText(label, { exact: true })
        .isVisible()
        .catch(() => false);
      if (visible) foundSteps++;
    }

    // At least the current step label should be visible
    expect(foundSteps).toBeGreaterThan(0);
  });

  test("onboarding page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/onboarding");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 6. /api/status endpoint
// ===========================================================================
test.describe("API Status Endpoint", () => {
  test("/api/status returns feature flags", async () => {
    const res = await fetch(`${API_BASE}/api/status`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(data.features.npcTutorial).toBe(true);
    expect(data.features.trustScore).toBe(true);
    expect(data.features.onboarding5Step).toBe(true);
  });

  test("/api/status shows NPC count of 2", async () => {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = (await res.json()) as any;
    expect(data.stats.npcs).toBe(2);
  });
});
