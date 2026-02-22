import { test as setup } from "@playwright/test";

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";
const E2E_EMAIL = "e2e-test@bunshin-ai.dev";
const E2E_PASSWORD = "e2eTestPass123";
const E2E_NAME = "E2Eテストユーザー";

/**
 * Global setup: register (if needed) and login to get session cookie.
 * Saves browser storage state to e2e/.auth/user.json for reuse by all tests.
 */
setup("authenticate", async ({ page }) => {
  // Try to register (ignore if already exists)
  const regRes = await fetch(`${API_BASE}/api/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: { email: E2E_EMAIL, password: E2E_PASSWORD, name: E2E_NAME },
    }),
  });
  // 200 = new user, error = already exists — both OK

  // Login to get JWT token
  const loginRes = await fetch(`${API_BASE}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: { email: E2E_EMAIL, password: E2E_PASSWORD },
    }),
  });
  const loginData = await loginRes.json() as any;
  const token = loginData?.result?.data?.json?.token;
  if (!token) {
    throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  }

  // Set session cookie via the set-session endpoint (using browser context)
  await page.goto("https://bunshin-ai.pages.dev/login");
  const setSessionRes = await page.evaluate(
    async ({ apiBase, tok }) => {
      const res = await fetch(`${apiBase}/api/auth/set-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: tok }),
      });
      return { ok: res.ok, status: res.status };
    },
    { apiBase: API_BASE, tok: token }
  );

  if (!setSessionRes.ok) {
    throw new Error(`set-session failed: ${setSessionRes.status}`);
  }

  // Complete onboarding if needed (so we don't get stuck on /onboarding)
  await page.evaluate(
    async ({ apiBase }) => {
      // Best-effort: try to complete onboarding
      try {
        await fetch(`${apiBase}/api/trpc/onboarding.complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ json: {} }),
        });
      } catch {
        // ignore
      }
    },
    { apiBase: API_BASE }
  );

  // Save storage state (cookies) for reuse
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
