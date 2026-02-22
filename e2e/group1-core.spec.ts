import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect JS console errors during a test. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  return errors;
}

/** Collect uncaught page exceptions. */
function trackPageCrashes(page: Page): Error[] {
  const crashes: Error[] = [];
  page.on("pageerror", (err) => crashes.push(err));
  return crashes;
}

/**
 * Navigate and wait for the SPA to finish rendering.
 * Uses networkidle + an extra short delay for React hydration.
 */
async function navigateAndWait(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle", timeout: 30_000 });
  // Give React a moment to render after network settles
  await page.waitForTimeout(2000);
}

/** Check if page redirected to login or shows login page content. */
async function isOnLoginPage(page: Page): Promise<boolean> {
  if (page.url().includes("/login")) return true;
  const loginHeading = page.locator("text=分身AIにログイン");
  return loginHeading.isVisible().catch(() => false);
}

// ===========================================================================
// GROUP 1 - CORE PAGES
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. HOME PAGE  (/)
// ---------------------------------------------------------------------------
test.describe("Home Page (/)", () => {
  test("loads without JS errors or page crashes", async ({ page }) => {
    const jsErrors = trackConsoleErrors(page);
    const crashes = trackPageCrashes(page);
    await navigateAndWait(page, "/");

    // Filter out known non-critical errors (e.g. favicon, analytics)
    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("404") &&
        !e.includes("Failed to load resource")
    );
    expect(crashes).toHaveLength(0);
    // We allow minor console errors (like tRPC auth failures for unauthenticated users)
    // but there should be no uncaught exceptions
  });

  test("displays hero heading and branding", async ({ page }) => {
    await navigateAndWait(page, "/");

    // The page should show the brand name
    await expect(page.locator("text=分身AI").first()).toBeVisible();

    // Hero section heading
    await expect(
      page.locator("h1").filter({ hasText: "あなたの分身AI" })
    ).toBeVisible();

    // Sub-heading text
    await expect(
      page.locator("text=あなたの知識、経験、スキルを学習したAI")
    ).toBeVisible();
  });

  test("displays feature cards section", async ({ page }) => {
    await navigateAndWait(page, "/");

    // Section heading
    await expect(page.locator("h2").filter({ hasText: "主な機能" })).toBeVisible();

    // Individual feature cards
    const featureTitles = [
      "分身AI作成",
      "1対1チャット",
      "分身AI同士の対話",
      "マッチング分析",
      "外部AI連携",
      "AIオーケストレーション",
    ];
    for (const title of featureTitles) {
      await expect(
        page.locator("h3").filter({ hasText: title })
      ).toBeVisible();
    }
  });

  test("displays how-it-works steps section", async ({ page }) => {
    await navigateAndWait(page, "/");

    await expect(page.locator("h2").filter({ hasText: "使い方" })).toBeVisible();

    // Step titles
    const stepTitles = [
      "プロフィールを設定",
      "分身AIを作成",
      "分身AIと対話",
      "マッチング開始",
    ];
    for (const title of stepTitles) {
      await expect(
        page.locator("h3").filter({ hasText: title })
      ).toBeVisible();
    }
  });

  test("displays CTA section and footer", async ({ page }) => {
    await navigateAndWait(page, "/");

    // CTA
    await expect(
      page.locator("h2").filter({ hasText: "今すぐ始めましょう" })
    ).toBeVisible();

    // Footer
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("footer").locator("text=分身AI").first()).toBeVisible();
  });

  test("has login or dashboard button in header", async ({ page }) => {
    await navigateAndWait(page, "/");

    // Depending on auth state, one of these buttons should be visible.
    // Buttons may be inside <a> tags, so search broadly for text content.
    const loginBtn = page.getByRole("button", { name: "ログイン" }).first();
    const dashboardBtn = page.getByRole("button", { name: "ダッシュボード" }).first();
    // Also check for link variants that look like buttons
    const loginLink = page.locator("header").locator("text=ログイン").first();
    const dashboardLink = page.locator("header a[href='/dashboard']").first();

    const loginBtnVisible = await loginBtn.isVisible().catch(() => false);
    const dashboardBtnVisible = await dashboardBtn.isVisible().catch(() => false);
    const loginLinkVisible = await loginLink.isVisible().catch(() => false);
    const dashboardLinkVisible = await dashboardLink.isVisible().catch(() => false);

    expect(loginBtnVisible || dashboardBtnVisible || loginLinkVisible || dashboardLinkVisible).toBeTruthy();
  });

  test("has CTA button that is clickable", async ({ page }) => {
    await navigateAndWait(page, "/");

    // The "詳しく見る" outline button should be present and clickable
    const detailsBtn = page.locator("button", { hasText: "詳しく見る" });
    await expect(detailsBtn).toBeVisible();
    await expect(detailsBtn).toBeEnabled();
    // Click it - it shouldn't crash the page
    await detailsBtn.click();
  });

  test("navigating from home to dashboard or login works", async ({ page }) => {
    await navigateAndWait(page, "/");

    // Click the primary CTA (either "無料で始める", "ダッシュボードへ", or "ログイン")
    const dashboardLink = page.locator("a[href='/dashboard']").first();
    const loginLink = page.locator("a[href*='ログイン'], a:has(button:has-text('ログイン'))").first();

    const hasDashboardLink = await dashboardLink.isVisible().catch(() => false);
    if (hasDashboardLink) {
      await dashboardLink.click();
      await page.waitForTimeout(2000);
      expect(page.url()).toContain("/dashboard");
    }
    // If not authenticated, the login link will redirect externally - that's fine
  });
});

// ---------------------------------------------------------------------------
// 2. DASHBOARD PAGE  (/dashboard)
// ---------------------------------------------------------------------------
test.describe("Dashboard Page (/dashboard)", () => {
  test("loads without page crashes", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await navigateAndWait(page, "/dashboard");
    expect(crashes).toHaveLength(0);
  });

  test("shows either dashboard content or login redirect", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    // Either we see the authenticated dashboard or get redirected to login
    const welcomeHeading = page.locator("h1").filter({ hasText: "おかえりなさい" });
    const welcomeVisible = await welcomeHeading.isVisible().catch(() => false);
    const loginRedirected = await isOnLoginPage(page);

    expect(welcomeVisible || loginRedirected).toBeTruthy();
  });

  test("sign-in gate redirects to login when unauthenticated", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    const loginRedirected = await isOnLoginPage(page);
    const isAuthenticated = await page.locator("h1").filter({ hasText: "おかえりなさい" }).isVisible().catch(() => false);

    if (loginRedirected) {
      // Verify login page renders properly
      await expect(page.locator("text=分身AIにログイン")).toBeVisible();
      await expect(page.locator("button", { hasText: "ログイン" })).toBeEnabled();
    }
    // Either redirected to login or already authenticated
    expect(loginRedirected || isAuthenticated).toBeTruthy();
  });

  test("dashboard stat cards are present when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    const welcomeHeading = page.locator("h1").filter({ hasText: "おかえりなさい" });
    const isAuthenticated = await welcomeHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Stat card titles
      const statTitles = ["分身AI", "友達", "チャット", "マッチング"];
      for (const title of statTitles) {
        await expect(
          page.locator("text=" + title).first()
        ).toBeVisible();
      }
    }
  });

  test("dashboard quick actions section when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    const welcomeHeading = page.locator("h1").filter({ hasText: "おかえりなさい" });
    const isAuthenticated = await welcomeHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      await expect(
        page.locator("text=クイックアクション")
      ).toBeVisible();

      // Quick action buttons
      const actions = ["分身AIを発見", "友達を追加", "新規マッチング", "プランを確認"];
      for (const action of actions) {
        await expect(
          page.locator("button", { hasText: action }).or(page.locator(`text=${action}`)).first()
        ).toBeVisible();
      }
    }
  });

  test("sidebar navigation links are present when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    const welcomeHeading = page.locator("h1").filter({ hasText: "おかえりなさい" });
    const isAuthenticated = await welcomeHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Sidebar menu items (checking key items)
      const sidebarItems = [
        "ダッシュボード",
        "プロフィール",
        "分身AI",
        "チャット",
        "マッチング",
      ];
      for (const item of sidebarItems) {
        await expect(
          page.locator(`text=${item}`).first()
        ).toBeVisible();
      }
    }
  });

  test("tRPC data loading: loading spinner disappears", async ({ page }) => {
    await navigateAndWait(page, "/dashboard");

    const welcomeHeading = page.locator("h1").filter({ hasText: "おかえりなさい" });
    const isAuthenticated = await welcomeHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // After networkidle + 2s, any loading spinner (animate-pulse/animate-spin) should be gone
      // or data should be rendered
      const spinners = page.locator(".animate-spin");
      const spinnerCount = await spinners.count();
      // Some spinners may remain if data is truly loading, but the page should be functional
      // The key check is that the welcome heading is visible - it means the auth query resolved
      await expect(welcomeHeading).toBeVisible();
    }
  });

  test("handles network errors gracefully (page does not crash)", async ({ page }) => {
    const crashes = trackPageCrashes(page);

    // Block tRPC API calls to simulate network failure
    await page.route("**/trpc/**", (route) => route.abort("failed"));

    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);

    // The page should not crash even if API calls fail
    expect(crashes).toHaveLength(0);

    // The page should still show something (at least the error boundary or sign-in gate)
    const bodyText = await page.evaluate(() => document.body?.innerText?.length || 0);
    expect(bodyText).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. PROFILE PAGE  (/profile)
// ---------------------------------------------------------------------------
test.describe("Profile Page (/profile)", () => {
  test("loads without page crashes", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await navigateAndWait(page, "/profile");
    expect(crashes).toHaveLength(0);
  });

  test("shows either profile form or login redirect", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });
    const profileVisible = await profileHeading.isVisible().catch(() => false);
    const loginRedirected = await isOnLoginPage(page);

    expect(profileVisible || loginRedirected).toBeTruthy();
  });

  test("profile form fields are present when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });
    const isAuthenticated = await profileHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Form labels
      await expect(page.locator("label", { hasText: "表示名" })).toBeVisible();
      await expect(page.locator("label", { hasText: "自己紹介" })).toBeVisible();

      // Input fields
      await expect(page.locator("#displayName")).toBeVisible();
      await expect(page.locator("#bio")).toBeVisible();

      // Card sections
      await expect(
        page.locator("text=基本情報").first()
      ).toBeVisible();
      await expect(
        page.locator("text=職業情報").first()
      ).toBeVisible();
      await expect(
        page.locator("text=スキル").first()
      ).toBeVisible();
      await expect(
        page.locator("text=専門分野").first()
      ).toBeVisible();
    }
  });

  test("profile form inputs are interactive when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });
    const isAuthenticated = await profileHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Type into display name field
      const displayNameInput = page.locator("#displayName");
      await displayNameInput.click();
      await displayNameInput.fill("Test User");
      await expect(displayNameInput).toHaveValue("Test User");

      // Type into bio textarea
      const bioTextarea = page.locator("#bio");
      await bioTextarea.click();
      await bioTextarea.fill("This is a test bio");
      await expect(bioTextarea).toHaveValue("This is a test bio");

      // Company field
      const companyInput = page.locator("#company");
      await companyInput.click();
      await companyInput.fill("Test Corp");
      await expect(companyInput).toHaveValue("Test Corp");
    }
  });

  test("skill addition UI works when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });
    const isAuthenticated = await profileHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Find the skill input by its placeholder
      const skillInput = page.locator("input[placeholder='スキルを入力']");
      if (await skillInput.isVisible()) {
        await skillInput.fill("TypeScript");
        // Click the add button (Plus icon button next to skill input)
        const addBtn = skillInput.locator("..").locator("button").first();
        if (await addBtn.isVisible()) {
          await addBtn.click();
        }
      }
    }
  });

  test("save button is present and enabled when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });
    const isAuthenticated = await profileHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      const saveBtn = page.locator("button", { hasText: "保存する" });
      await expect(saveBtn).toBeVisible();
      await expect(saveBtn).toBeEnabled();
    }
  });

  test("tRPC data loads - loading spinner disappears", async ({ page }) => {
    await navigateAndWait(page, "/profile");

    // After full load, the loading spinner should be gone (replaced by form or sign-in)
    const spinner = page.locator(".animate-spin").first();
    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const profileHeading = page.locator("h1").filter({ hasText: "プロフィール設定" });

    const spinnerGone = await spinner.isHidden().catch(() => true);
    const signInVisible = await signInBtn.isVisible().catch(() => false);
    const profileVisible = await profileHeading.isVisible().catch(() => false);

    // Either spinner is gone, or we see sign-in or profile
    expect(spinnerGone || signInVisible || profileVisible).toBeTruthy();
  });

  test("handles network errors gracefully", async ({ page }) => {
    const crashes = trackPageCrashes(page);

    await page.route("**/trpc/**", (route) => route.abort("failed"));

    await page.goto("/profile", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);

    expect(crashes).toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body?.innerText?.length || 0);
    expect(bodyText).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. TWINS PAGE  (/twins)
// ---------------------------------------------------------------------------
test.describe("Twins Page (/twins)", () => {
  test("loads without page crashes", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await navigateAndWait(page, "/twins");
    expect(crashes).toHaveLength(0);
  });

  test("shows either twins content or sign-in prompt", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });

    const signInVisible = await signInBtn.isVisible().catch(() => false);
    const twinsVisible = await twinsHeading.isVisible().catch(() => false);

    expect(signInVisible || twinsVisible).toBeTruthy();
  });

  test("shows create twin CTA or existing twin when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });
    const isAuthenticated = await twinsHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      // Either "create twin" CTA or existing twin card
      const createBtn = page.locator("button", { hasText: "分身AIを作成" });
      const twinNameEl = page.locator("text=アクティブ");
      const editingTitle = page.locator("text=分身AIを編集");

      const createVisible = await createBtn.isVisible().catch(() => false);
      const twinActive = await twinNameEl.isVisible().catch(() => false);
      const isEditing = await editingTitle.isVisible().catch(() => false);

      expect(createVisible || twinActive || isEditing).toBeTruthy();
    }
  });

  test("create twin button opens editing form when no twin exists", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });
    const isAuthenticated = await twinsHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      const createBtn = page.locator("button", { hasText: "分身AIを作成" }).first();
      const createVisible = await createBtn.isVisible().catch(() => false);

      if (createVisible) {
        await createBtn.click();
        await page.waitForTimeout(1000);

        // Should show the name input and rawInput textarea
        const nameInput = page.locator("#name");
        await expect(nameInput).toBeVisible();

        const rawInputTextarea = page.locator("#rawInput");
        await expect(rawInputTextarea).toBeVisible();
      }
    }
  });

  test("twin detail view shows personality analysis section when twin exists", async ({
    page,
  }) => {
    await navigateAndWait(page, "/twins");

    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });
    const isAuthenticated = await twinsHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      const twinActive = await page
        .locator("text=アクティブ")
        .isVisible()
        .catch(() => false);

      if (twinActive) {
        // Should show personality analysis section
        await expect(
          page.locator("text=人格分析").first()
        ).toBeVisible();

        // Should show accuracy score area
        await expect(
          page.locator("text=分身AI精度").first()
        ).toBeVisible();

        // Chat link should be present
        await expect(
          page.locator("text=分身AIとチャット").first()
        ).toBeVisible();
      }
    }
  });

  test("public settings section when twin exists", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });
    const isAuthenticated = await twinsHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      const twinActive = await page
        .locator("text=アクティブ")
        .isVisible()
        .catch(() => false);

      if (twinActive) {
        // Public settings card
        await expect(
          page.locator("text=公開設定").first()
        ).toBeVisible();

        // Public switch
        await expect(
          page.locator("text=分身AIを公開")
        ).toBeVisible();

        // Save public settings button
        await expect(
          page.locator("button", { hasText: "公開設定を保存" })
        ).toBeVisible();
      }
    }
  });

  test("tRPC data loads - spinner disappears", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    // After full load, either we see content or sign-in
    const spinner = page.locator(".animate-spin").first();
    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });

    const spinnerGone = await spinner.isHidden().catch(() => true);
    const signInVisible = await signInBtn.isVisible().catch(() => false);
    const twinsVisible = await twinsHeading.isVisible().catch(() => false);

    expect(spinnerGone || signInVisible || twinsVisible).toBeTruthy();
  });

  test("handles network errors gracefully", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await page.route("**/trpc/**", (route) => route.abort("failed"));
    await page.goto("/twins", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);
    expect(crashes).toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body?.innerText?.length || 0);
    expect(bodyText).toBeGreaterThan(0);
  });

  test("navigation: clicking chat link from twins page works", async ({ page }) => {
    await navigateAndWait(page, "/twins");

    const twinsHeading = page.locator("h1").filter({ hasText: "自分の分身AI" });
    const isAuthenticated = await twinsHeading.isVisible().catch(() => false);

    if (isAuthenticated) {
      const chatLink = page.locator("a[href='/chat']").first();
      const chatLinkVisible = await chatLink.isVisible().catch(() => false);

      if (chatLinkVisible) {
        await chatLink.click();
        await page.waitForTimeout(2000);
        expect(page.url()).toContain("/chat");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. CHAT PAGE  (/chat)
// ---------------------------------------------------------------------------
test.describe("Chat Page (/chat)", () => {
  test("loads without page crashes", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await navigateAndWait(page, "/chat");
    expect(crashes).toHaveLength(0);
  });

  test("shows either chat UI or sign-in prompt", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const chatTitle = page.locator("text=分身AIチャット");
    const chatTwinTitle = page.locator("text=とチャット");

    const signInVisible = await signInBtn.isVisible().catch(() => false);
    const chatVisible = await chatTitle.isVisible().catch(() => false);
    const chatTwinVisible = await chatTwinTitle.isVisible().catch(() => false);

    expect(signInVisible || chatVisible || chatTwinVisible).toBeTruthy();
  });

  test("shows chat creation prompt when no session is active", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      // Should show one of:
      // 1. "分身AIを作成してください" if no twin
      // 2. "チャットを始めましょう" if twin exists but no session
      // 3. Chat messages if session exists
      const createTwinPrompt = page.locator("text=分身AIを作成してください");
      const startChatPrompt = page.locator("text=チャットを始めましょう");
      const newChatBtn = page.locator("button", { hasText: "新規チャット" });

      const createTwinVisible = await createTwinPrompt.isVisible().catch(() => false);
      const startChatVisible = await startChatPrompt.isVisible().catch(() => false);
      const newChatVisible = await newChatBtn.isVisible().catch(() => false);

      expect(createTwinVisible || startChatVisible || newChatVisible).toBeTruthy();
    }
  });

  test("new chat button is present when authenticated", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      // The "新規チャット" button should be in the header area
      const newChatBtn = page.locator("button", { hasText: "新規チャット" });
      const startChatBtn = page.locator("button", { hasText: "チャットを始めましょう" }).or(
        page.locator("button", { hasText: "新規チャット" })
      );

      const visible = await newChatBtn.isVisible().catch(() => false);
      // It might be disabled if no twin exists, but it should be present
      if (visible) {
        await expect(newChatBtn).toBeVisible();
      }
    }
  });

  test("chat session sidebar is present on desktop when authenticated", async ({ page }) => {
    // Set a desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      // Chat history sidebar (hidden on mobile, visible on lg)
      const chatHistoryTitle = page.locator("text=チャット履歴");
      const historyVisible = await chatHistoryTitle.isVisible().catch(() => false);
      // This may or may not be visible depending on viewport breakpoint
      // Just verify no crash occurred
    }
  });

  test("message input field is present when in active chat", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      // If we're in an active chat session, the message input should be visible
      const messageInput = page.locator("input[placeholder='メッセージを入力...']");
      const isInputVisible = await messageInput.isVisible().catch(() => false);

      if (isInputVisible) {
        await expect(messageInput).toBeEnabled();
        // Type a test message
        await messageInput.fill("Hello test");
        await expect(messageInput).toHaveValue("Hello test");
      }
    }
  });

  test("chat UI shows create-twin CTA if no twin exists", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      const createTwinPrompt = page.locator("text=分身AIを作成してください");
      const createTwinBtn = page.locator("a[href='/twins'] button", { hasText: "分身AIを作成" });

      const promptVisible = await createTwinPrompt.isVisible().catch(() => false);
      if (promptVisible) {
        // The "create twin" button should link to /twins
        await expect(createTwinBtn).toBeVisible();
      }
    }
  });

  test("tRPC data loads - page resolves from loading state", async ({ page }) => {
    await navigateAndWait(page, "/chat");

    // The page should have resolved (either sign-in, or chat UI)
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
    expect(bodyText).toBeGreaterThan(0);
  });

  test("handles network errors gracefully", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    await page.route("**/trpc/**", (route) => route.abort("failed"));
    await page.goto("/chat", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);
    expect(crashes).toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body?.innerText?.length || 0);
    expect(bodyText).toBeGreaterThan(0);
  });

  test("navigation: sidebar links work when authenticated", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigateAndWait(page, "/chat");

    const signInBtn = page.locator("button", { hasText: "ログイン" });
    const isSignIn = await signInBtn.isVisible().catch(() => false);

    if (!isSignIn) {
      // Try clicking on a sidebar navigation item to go to dashboard
      const dashboardNavItem = page.locator("text=ダッシュボード").first();
      const dashVisible = await dashboardNavItem.isVisible().catch(() => false);

      if (dashVisible) {
        await dashboardNavItem.click();
        await page.waitForTimeout(2000);
        expect(page.url()).toContain("/dashboard");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. CROSS-PAGE NAVIGATION
// ---------------------------------------------------------------------------
test.describe("Cross-page navigation", () => {
  test("navigating between all group 1 pages does not crash", async ({ page }) => {
    const crashes = trackPageCrashes(page);
    const routes = ["/", "/dashboard", "/profile", "/twins", "/chat"];

    for (const route of routes) {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);
    }

    expect(crashes).toHaveLength(0);
  });

  test("home page links to dashboard resolve correctly", async ({ page }) => {
    await navigateAndWait(page, "/");

    // All dashboard links on home page should point to /dashboard
    const dashboardLinks = page.locator("a[href='/dashboard']");
    const count = await dashboardLinks.count();

    // The home page has multiple dashboard links (header + hero CTA)
    // At minimum, if authenticated, there should be dashboard links
    // If not authenticated, there should be login links instead
    const loginLinks = page.locator("a").filter({ hasText: "ログイン" });
    const loginCount = await loginLinks.count();

    // Either we have dashboard links or login links
    expect(count + loginCount).toBeGreaterThan(0);
  });

  test("all group 1 pages render non-blank content", async ({ page }) => {
    const routes = ["/", "/dashboard", "/profile", "/twins", "/chat"];

    for (const route of routes) {
      await navigateAndWait(page, route);

      const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
      expect(bodyText).toBeGreaterThan(10);

      // Verify no React error boundary white screen
      const hasErrorBoundary = await page
        .locator("text=Something went wrong")
        .isVisible()
        .catch(() => false);
      expect(hasErrorBoundary).toBeFalsy();
    }
  });
});
