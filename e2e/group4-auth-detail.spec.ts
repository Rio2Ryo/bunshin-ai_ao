import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// 1. Login Page  (/login)
// ===========================================================================
test.describe("Login Page (/login)", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/login");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("displays login heading and description", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    await expect(page.getByText("分身AIにログイン")).toBeVisible();
    await expect(
      page.getByText("メールアドレスとパスワードでログインしてください")
    ).toBeVisible();
  });

  test("displays bot icon", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const icon = page.locator("svg.lucide-bot");
    await expect(icon).toBeVisible();
  });

  test("has email and password input fields", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    await expect(page.locator("label", { hasText: "メールアドレス" })).toBeVisible();
    await expect(page.locator("label", { hasText: "パスワード" })).toBeVisible();

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    expect(await emailInput.getAttribute("type")).toBe("email");
    expect(await passwordInput.getAttribute("type")).toBe("password");
  });

  test("email and password inputs are interactive", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const emailInput = page.locator("#email");
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");

    const passwordInput = page.locator("#password");
    await passwordInput.fill("testpass123");
    await expect(passwordInput).toHaveValue("testpass123");
  });

  test("login button is present and enabled", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const loginBtn = page.getByRole("button", { name: "ログイン" });
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toBeEnabled();
  });

  test("has link to registration page", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    await expect(page.getByText("アカウントをお持ちでない方は")).toBeVisible();
    const registerLink = page.locator("a[href='/register']");
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toContainText("新規登録");
  });

  test("has link to home page", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const homeLink = page.locator("a[href='/']");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toContainText("トップページに戻る");
  });

  test("register link navigates to /register", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const registerLink = page.locator("a[href='/register']");
    await registerLink.click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/register");
  });

  test("does not show sidebar navigation (standalone page)", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const sidebar = page.locator("aside, [data-sidebar]");
    const sidebarVisible = await sidebar.first().isVisible().catch(() => false);
    expect(sidebarVisible).toBe(false);
  });

  test("has proper autocomplete attributes", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    expect(await emailInput.getAttribute("autocomplete")).toBe("email");
    expect(await passwordInput.getAttribute("autocomplete")).toBe("current-password");
  });
});

// ===========================================================================
// 2. Register Page  (/register)
// ===========================================================================
test.describe("Register Page (/register)", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/register");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("displays registration heading and description", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    await expect(page.getByText("新規アカウント作成")).toBeVisible();
    await expect(
      page.getByText("分身AIを始めるためにアカウントを作成してください")
    ).toBeVisible();
  });

  test("has all four input fields", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    await expect(page.locator("label", { hasText: "お名前" })).toBeVisible();
    await expect(page.locator("label", { hasText: "メールアドレス" })).toBeVisible();
    // Two password labels: "パスワード" and "パスワード（確認）"
    const passwordLabels = page.locator("label").filter({ hasText: "パスワード" });
    expect(await passwordLabels.count()).toBeGreaterThanOrEqual(2);

    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirmPassword")).toBeVisible();
  });

  test("all inputs are interactive", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    await page.locator("#name").fill("テストユーザー");
    await expect(page.locator("#name")).toHaveValue("テストユーザー");

    await page.locator("#email").fill("test@example.com");
    await expect(page.locator("#email")).toHaveValue("test@example.com");

    await page.locator("#password").fill("testpass123");
    await expect(page.locator("#password")).toHaveValue("testpass123");

    await page.locator("#confirmPassword").fill("testpass123");
    await expect(page.locator("#confirmPassword")).toHaveValue("testpass123");
  });

  test("submit button is present and enabled", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const submitBtn = page.getByRole("button", { name: "アカウント作成" });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test("has link to login page", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    await expect(page.getByText("既にアカウントをお持ちの方は")).toBeVisible();
    const loginLink = page.locator("a[href='/login']");
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toContainText("ログイン");
  });

  test("has link to home page", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const homeLink = page.locator("a[href='/']");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toContainText("トップページに戻る");
  });

  test("login link navigates to /login", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const loginLink = page.locator("a[href='/login']");
    await loginLink.click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/login");
  });

  test("does not show sidebar navigation (standalone page)", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const sidebar = page.locator("aside, [data-sidebar]");
    const sidebarVisible = await sidebar.first().isVisible().catch(() => false);
    expect(sidebarVisible).toBe(false);
  });

  test("has proper autocomplete attributes", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    expect(await page.locator("#name").getAttribute("autocomplete")).toBe("name");
    expect(await page.locator("#email").getAttribute("autocomplete")).toBe("email");
    expect(await page.locator("#password").getAttribute("autocomplete")).toBe("new-password");
    expect(await page.locator("#confirmPassword").getAttribute("autocomplete")).toBe("new-password");
  });

  test("password fields require minimum 6 characters", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const passwordInput = page.locator("#password");
    const minLength = await passwordInput.getAttribute("minlength");
    expect(minLength).toBe("6");
  });

  test("displays bot icon", async ({ page }) => {
    await page.goto("/register");
    await waitForPageReady(page);

    const icon = page.locator("svg.lucide-bot");
    await expect(icon).toBeVisible();
  });
});

// ===========================================================================
// 3. Onboarding Page  (/onboarding)
// ===========================================================================
test.describe("Onboarding Page (/onboarding)", () => {
  test("loads without page crashes", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/onboarding");
    await waitForPageReady(page);
    // Onboarding may redirect to dashboard if already completed
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows onboarding chat UI or redirects to dashboard", async ({ page }) => {
    await page.goto("/onboarding");
    await waitForPageReady(page);

    // User has already completed onboarding, so they get redirected to dashboard
    const onDashboard = page.url().includes("/dashboard");
    const onOnboarding = page.url().includes("/onboarding");
    const onLogin = page.url().includes("/login");

    // The chat UI or redirect should be visible
    const hasOnboardingUI = await page
      .getByText("オンボーディング")
      .isVisible()
      .catch(() => false);
    const hasDashboard = await page
      .locator("h1")
      .filter({ hasText: "おかえりなさい" })
      .isVisible()
      .catch(() => false);

    expect(onDashboard || onOnboarding || onLogin || hasOnboardingUI || hasDashboard).toBeTruthy();
  });

  test("page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/onboarding");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 4. Matching Session Detail  (/matching/:id)
// ===========================================================================
test.describe("Matching Session Detail (/matching/:id)", () => {
  test("loads without page crashes for nonexistent session", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/matching/99999");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("shows error state or content for invalid session", async ({ page }) => {
    await page.goto("/matching/99999");
    await waitForPageReady(page);
    // Wait extra for tRPC error to settle
    await page.waitForTimeout(3000);

    if (await isOnSignInPage(page)) {
      await expect(page.getByText("分身AIにログイン")).toBeVisible();
      return;
    }

    // Should show "session not found", back button, loading spinner, or matching page
    const hasNotFound = await page
      .getByText("セッションが見つかりません")
      .isVisible()
      .catch(() => false);
    const hasBackButton = await page
      .locator("a[href='/matching']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasSpinner = await page
      .locator(".animate-spin")
      .first()
      .isVisible()
      .catch(() => false);
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);

    // Page should render something (error state, loading, or content)
    expect(hasNotFound || hasBackButton || hasSpinner || bodyText > 20).toBeTruthy();
  });

  test("back button navigates to matching list", async ({ page }) => {
    await page.goto("/matching/99999");
    await waitForPageReady(page);

    if (await isOnSignInPage(page)) {
      test.skip();
      return;
    }

    const backBtn = page.getByRole("button", { name: "一覧に戻る" });
    const visible = await backBtn.isVisible().catch(() => false);
    if (visible) {
      await backBtn.click();
      await page.waitForTimeout(1000);
      expect(page.url()).toContain("/matching");
    }
  });

  test("page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/matching/1");
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 5. Twin Detail  (/twins/:id)
// ===========================================================================
test.describe("Twin Detail (/twins/:id)", () => {
  test("loads without page crashes", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/twins/1");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/twins/1");
    expect(response?.status()).toBe(200);
  });

  test("shows content or login redirect", async ({ page }) => {
    await page.goto("/twins/1");
    await waitForPageReady(page);

    const onLogin = await isOnSignInPage(page);
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);

    // Page should show either login or content
    expect(onLogin || bodyText > 10).toBeTruthy();
  });
});

// ===========================================================================
// 6. Chat Session Detail  (/chat/:sessionId)
// ===========================================================================
test.describe("Chat Session Detail (/chat/:sessionId)", () => {
  test("loads without page crashes", async ({ page }) => {
    const errors = collectJsErrors(page);
    await page.goto("/chat/1");
    await waitForPageReady(page);
    expect(filterCriticalErrors(errors)).toEqual([]);
  });

  test("page responds with HTTP 200", async ({ page }) => {
    const response = await page.goto("/chat/1");
    expect(response?.status()).toBe(200);
  });

  test("shows chat content or login redirect", async ({ page }) => {
    await page.goto("/chat/1");
    await waitForPageReady(page);

    const onLogin = await isOnSignInPage(page);
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);

    expect(onLogin || bodyText > 10).toBeTruthy();
  });
});

// ===========================================================================
// 7. Cross-page: Auth pages navigation
// ===========================================================================
test.describe("Auth page cross-navigation", () => {
  test("login → register → login round-trip works", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    // Go to register
    await page.locator("a[href='/register']").click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/register");
    await expect(page.getByText("新規アカウント作成")).toBeVisible();

    // Go back to login
    await page.locator("a[href='/login']").click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/login");
    await expect(page.getByText("分身AIにログイン")).toBeVisible();
  });

  test("login home link goes to /", async ({ page }) => {
    await page.goto("/login");
    await waitForPageReady(page);

    await page.locator("a[href='/']").click();
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/\/$/);
  });

  test("all auth-related routes return HTTP 200", async ({ page }) => {
    const routes = ["/login", "/register", "/onboarding"];
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `Expected 200 for ${route}`).toBe(200);
    }
  });
});

// ===========================================================================
// 8. Detail pages with IDs return HTTP 200
// ===========================================================================
test.describe("Detail page routing", () => {
  test("all detail routes return HTTP 200", async ({ page }) => {
    const routes = ["/matching/1", "/twins/1", "/chat/1"];
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `Expected 200 for ${route}`).toBe(200);
    }
  });
});
