import { test, expect, type Page } from "@playwright/test";

/**
 * Group 3 E2E Tests: Settings & Miscellaneous Pages
 *
 * Pages under test:
 *   /clawdbot, /line-link, /discover, /orchestration, /ai-config,
 *   /admin/ai-provider, /quests, /learned-personality, /404
 *
 * The production deployment runs with VITE_PHASE1_NOAUTH=1, so all pages
 * are accessible without authentication via a demo user context.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect JS errors emitted during a page session. */
function collectJsErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/**
 * Navigate and wait for the page to reach a stable network-idle state.
 * Returns the list of JS errors captured during navigation.
 */
async function navigateAndSettle(page: Page, path: string) {
  const errors = collectJsErrors(page);
  await page.goto(path, { waitUntil: "networkidle" });
  // Give SPA router + tRPC queries a moment to settle
  await page.waitForTimeout(2000);
  return errors;
}

/** Assert no critical JS errors occurred (filter out benign network errors). */
function assertNoCriticalErrors(errors: string[]) {
  const critical = errors.filter(
    (e) =>
      !e.includes("UNAUTHORIZED") &&
      !e.includes("fetch") &&
      !e.includes("Failed to fetch") &&
      !e.includes("NetworkError") &&
      !e.includes("net::ERR")
  );
  expect(critical).toHaveLength(0);
}

/** Assert the sidebar navigation rendered (common to all dashboard pages). */
async function assertSidebarPresent(page: Page) {
  await expect(page.getByText("ダッシュボード").first()).toBeVisible();
  await expect(page.getByText("プロフィール").first()).toBeVisible();
  await expect(page.getByText("チャット").first()).toBeVisible();
}

// ===========================================================================
// 1. Clawdbot  (/clawdbot)
// ===========================================================================
test.describe("Clawdbot Page (/clawdbot)", () => {
  test("1.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/clawdbot");
    assertNoCriticalErrors(errors);
  });

  test("1.2 sidebar navigation is present", async ({ page }) => {
    await navigateAndSettle(page, "/clawdbot");
    await assertSidebarPresent(page);
  });

  test("1.3 page heading and description are visible", async ({ page }) => {
    await navigateAndSettle(page, "/clawdbot");
    // The heading is split across icon + text in an h1
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Clawdbot");

    // Description text
    await expect(
      page.getByText("LINE・WhatsApp・Telegramなどから操作できるようにします")
    ).toBeVisible();
  });

  test("1.4 tabs are rendered (setup, status, chat, learning)", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/clawdbot");
    await expect(page.getByText("セットアップ")).toBeVisible();
    await expect(page.getByText("ステータス")).toBeVisible();
    await expect(page.getByText("学習状況")).toBeVisible();
  });

  test("1.5 tRPC data loaded - connection data renders", async ({ page }) => {
    await navigateAndSettle(page, "/clawdbot");
    // The connection data shows a gateway URL from tRPC response
    await expect(page.getByText("接続済み")).toBeVisible();
    await expect(page.getByText("https://test-gateway.example.com")).toBeVisible();
  });

  test("1.6 action buttons are present and interactive", async ({ page }) => {
    await navigateAndSettle(page, "/clawdbot");
    const testBtn = page.getByRole("button", { name: "接続テスト" });
    await expect(testBtn).toBeVisible();
    await expect(testBtn).toBeEnabled();

    const deleteBtn = page.getByRole("button", { name: "削除" });
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();
  });

  test("1.7 settings switches are visible and interactive", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/clawdbot");
    // Verify setting labels are present
    await expect(page.getByText("メモリ同期")).toBeVisible();
    await expect(page.getByText("スキルアクセス")).toBeVisible();
    await expect(page.getByText("チャンネルブリッジ")).toBeVisible();
    await expect(page.getByText("セッション永続化")).toBeVisible();

    // Verify switch elements exist
    const switches = page.locator('button[role="switch"]');
    const count = await switches.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("1.8 Clawdbot explanation card is present", async ({ page }) => {
    await navigateAndSettle(page, "/clawdbot");
    await expect(page.getByText("Clawdbotとは？")).toBeVisible();
    await expect(page.getByText("Peter Steinberger")).toBeVisible();
  });
});

// ===========================================================================
// 2. LINE Link  (/line-link)
// ===========================================================================
test.describe("LineLink Page (/line-link)", () => {
  test("2.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/line-link");
    assertNoCriticalErrors(errors);
  });

  test("2.2 page heading is visible", async ({ page }) => {
    await navigateAndSettle(page, "/line-link");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("LINE連携");
  });

  test("2.3 description text is visible", async ({ page }) => {
    await navigateAndSettle(page, "/line-link");
    await expect(
      page.getByText("LINE公式アカウントと分身AIを連携して、LINEから会話できます")
    ).toBeVisible();
  });

  test("2.4 link instructions alert is shown (unlinked state)", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/line-link");
    await expect(page.getByText("LINE連携の手順")).toBeVisible();
    await expect(
      page.getByText("分身AI公式LINEアカウントを友だち追加")
    ).toBeVisible();
  });

  test("2.5 link code input and button are present and interactive", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/line-link");
    // The input should have a placeholder
    const input = page.getByPlaceholder("例: ABC123");
    await expect(input).toBeVisible();

    // Type a value
    await input.fill("ABC12");
    await expect(input).toHaveValue("ABC12");

    // Link button should be present
    const linkBtn = page.getByRole("button", { name: "連携する" });
    await expect(linkBtn).toBeVisible();

    // Button should be disabled with < 6 chars
    await expect(linkBtn).toBeDisabled();

    // Type full 6 chars
    await input.fill("ABC123");
    // Button should now be enabled
    await expect(linkBtn).toBeEnabled();
  });

  test("2.6 friend add section is present", async ({ page }) => {
    await navigateAndSettle(page, "/line-link");
    await expect(
      page.getByText("公式LINEを友だち追加", { exact: true })
    ).toBeVisible();
    // The friend add button/link - use first() since text appears in heading too
    await expect(page.getByText("友だち追加").first()).toBeVisible();
  });

  test("2.7 tRPC data loads - loading spinner disappears", async ({
    page,
  }) => {
    const errors = collectJsErrors(page);
    await page.goto("/line-link", { waitUntil: "networkidle" });

    // After networkidle, loading spinner should have disappeared
    const spinner = page.locator(".animate-spin");
    // Either no spinner, or it's the one inside a button (not the loading state spinner)
    await page.waitForTimeout(2000);
    const loadingText = page.getByText("読み込み中...");
    const isLoadingVisible = await loadingText.isVisible().catch(() => false);
    expect(isLoadingVisible).toBe(false);
  });
});

// ===========================================================================
// 3. Discover  (/discover)
// ===========================================================================
test.describe("Discover Page (/discover)", () => {
  test("3.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/discover");
    assertNoCriticalErrors(errors);
  });

  test("3.2 page heading is visible", async ({ page }) => {
    await navigateAndSettle(page, "/discover");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("分身AI発見");
  });

  test("3.3 search form is present and interactive", async ({ page }) => {
    await navigateAndSettle(page, "/discover");

    // Search input
    const input = page.getByPlaceholder("名前、スキル、タグで検索...");
    await expect(input).toBeVisible();
    await input.fill("test search");
    await expect(input).toHaveValue("test search");

    // Search button
    const searchBtn = page.getByRole("button", { name: "検索" });
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toBeEnabled();
  });

  test("3.4 empty state shows correctly when no public twins exist", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/discover");
    await expect(page.getByText("公開分身AIが見つかりません")).toBeVisible();
    await expect(
      page.getByText("まだ公開されている分身AIがありません")
    ).toBeVisible();
  });

  test("3.5 tRPC data loads - loading spinner disappears", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/discover");
    // The loading state uses animate-spin with border element
    const loadingSpinner = page.locator(
      ".animate-spin.rounded-full.h-8.w-8.border-b-2"
    );
    const spinnerVisible = await loadingSpinner.isVisible().catch(() => false);
    expect(spinnerVisible).toBe(false);
  });

  test("3.6 search button triggers refetch", async ({ page }) => {
    await navigateAndSettle(page, "/discover");
    const input = page.getByPlaceholder("名前、スキル、タグで検索...");
    await input.fill("nonexistent");
    const searchBtn = page.getByRole("button", { name: "検索" });
    await searchBtn.click();
    await page.waitForTimeout(1000);
    // Should still show empty state for nonexistent query
    await expect(page.getByText("公開分身AIが見つかりません")).toBeVisible();
  });
});

// ===========================================================================
// 4. Orchestration  (/orchestration)
// ===========================================================================
test.describe("Orchestration Page (/orchestration)", () => {
  test("4.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/orchestration");
    assertNoCriticalErrors(errors);
  });

  test("4.2 page heading and description are visible", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("AIオーケストレーション");

    await expect(
      page.getByText("複数のAIモデルを使い分け、タスクに最適なAIを選択します")
    ).toBeVisible();
  });

  test("4.3 save button is present and enabled", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    const saveBtn = page.getByRole("button", { name: "保存" });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
  });

  test("4.4 orchestration explanation card is visible", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    await expect(page.getByText("Manusのオーケストレーション")).toBeVisible();
  });

  test("4.5 default provider selector is rendered", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    await expect(page.getByText("デフォルトAIプロバイダー")).toBeVisible();
    await expect(page.getByText("プロバイダー", { exact: true })).toBeVisible();
    // Select trigger shows builtin as default
    await expect(page.getByText("ビルトイン").first()).toBeVisible();
  });

  test("4.6 task types are listed", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    await expect(page.getByText("タスクタイプ", { exact: true })).toBeVisible();
    await expect(page.getByText("会話・対話")).toBeVisible();
    await expect(page.getByText("分析・評価")).toBeVisible();
    await expect(page.getByText("知識処理")).toBeVisible();
    await expect(page.getByText("推論・判断")).toBeVisible();
  });

  test("4.7 tRPC data loads - roles section renders when data exists", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/orchestration");
    // The test data includes a "test-role" role
    await expect(page.getByText("登録済みの役割設定")).toBeVisible();
    await expect(page.getByText("test-role")).toBeVisible();
  });

  test("4.8 loading spinner disappears after data loads", async ({ page }) => {
    await navigateAndSettle(page, "/orchestration");
    const spinner = page.locator(".animate-spin");
    const spinnerCount = await spinner.count();
    // No spinners should be visible on the settled page
    for (let i = 0; i < spinnerCount; i++) {
      const isVisible = await spinner.nth(i).isVisible().catch(() => false);
      if (isVisible) {
        // The only visible spinner might be inside a button that's loading
        const parent = spinner.nth(i).locator("..");
        const parentTag = await parent.evaluate((el) => el.tagName);
        expect(parentTag).not.toBe("DIV"); // Not the full-page loading spinner
      }
    }
  });
});

// ===========================================================================
// 5. AI Config  (/ai-config)
// ===========================================================================
test.describe("AIConfig Page (/ai-config)", () => {
  test("5.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/ai-config");
    assertNoCriticalErrors(errors);
  });

  test("5.2 page heading and description are visible", async ({ page }) => {
    await navigateAndSettle(page, "/ai-config");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("AI API設定");

    await expect(
      page.getByText("外部AIサービスのAPIキーを設定して、分身AIの機能を拡張します")
    ).toBeVisible();
  });

  test("5.3 builtin AI info card is shown", async ({ page }) => {
    await navigateAndSettle(page, "/ai-config");
    await expect(page.getByText("ビルトインAI")).toBeVisible();
  });

  test("5.4 all four AI providers are listed", async ({ page }) => {
    await navigateAndSettle(page, "/ai-config");
    await expect(page.getByText("OpenAI (ChatGPT)").first()).toBeVisible();
    await expect(page.getByText("Google Gemini").first()).toBeVisible();
    await expect(page.getByText("Anthropic (Claude)").first()).toBeVisible();
    await expect(page.getByText("xAI (Grok)").first()).toBeVisible();
  });

  test("5.5 API key inputs are present for unconfigured providers", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/ai-config");
    // OpenAI is unconfigured - should have an API key input with placeholder
    const openaiInput = page.getByPlaceholder("sk-...");
    await expect(openaiInput).toBeVisible();
  });

  test("5.6 tRPC data loaded - Gemini shows existing key", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/ai-config");
    // Gemini has an existing key per the debug output
    await expect(page.getByText("登録済み").first()).toBeVisible();
    await expect(page.getByText("test-api-key")).toBeVisible();
  });

  test("5.7 save/update buttons are present for each provider", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/ai-config");
    // There should be multiple save/update buttons
    const saveButtons = page.getByRole("button", { name: "保存" });
    const saveBtnCount = await saveButtons.count();
    expect(saveBtnCount).toBeGreaterThanOrEqual(2);

    // At least one update button for existing keys
    const updateButtons = page.getByRole("button", { name: "更新" });
    const updateCount = await updateButtons.count();
    expect(updateCount).toBeGreaterThanOrEqual(1);
  });

  test("5.8 show/hide toggle buttons exist for API key inputs", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/ai-config");
    const showBtns = page.getByRole("button", { name: "表示" });
    const count = await showBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("5.9 API key input is interactive", async ({ page }) => {
    await navigateAndSettle(page, "/ai-config");
    const openaiInput = page.getByPlaceholder("sk-...");
    await openaiInput.fill("sk-test-key-12345");
    await expect(openaiInput).toHaveValue("sk-test-key-12345");
  });
});

// ===========================================================================
// 6. Admin AI Provider  (/admin/ai-provider)
// ===========================================================================
test.describe("AdminAIProvider Page (/admin/ai-provider)", () => {
  test("6.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/admin/ai-provider");
    assertNoCriticalErrors(errors);
  });

  test("6.2 page heading and description are visible", async ({ page }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("AIプロバイダー設定");

    await expect(
      page.getByText("機能ごとに使用するAIプロバイダーを設定できます（管理者専用）")
    ).toBeVisible();
  });

  test("6.3 tabs are present (providers list and settings)", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    await expect(page.getByText("プロバイダー一覧")).toBeVisible();
    await expect(page.getByText("機能別設定")).toBeVisible();
  });

  test("6.4 all providers are listed with availability badges", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    await expect(page.getByText("Manus内蔵LLM", { exact: true })).toBeVisible();
    await expect(page.getByText("Google Gemini").first()).toBeVisible();
    await expect(page.getByText("OpenAI (ChatGPT)").first()).toBeVisible();
    await expect(page.getByText("Anthropic (Claude)").first()).toBeVisible();
    await expect(page.getByText("xAI (Grok)").first()).toBeVisible();

    // Availability badges
    const availableBadges = page.getByText("利用可能");
    const availableCount = await availableBadges.count();
    expect(availableCount).toBeGreaterThanOrEqual(1);
  });

  test("6.5 connection test buttons are present", async ({ page }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    const testBtns = page.getByRole("button", { name: "接続テスト" });
    const count = await testBtns.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("6.6 API key setup instructions are shown", async ({ page }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    await expect(page.getByText("APIキーの設定方法")).toBeVisible();
    await expect(page.getByText("GEMINI_API_KEY")).toBeVisible();
    await expect(page.getByText("OPENAI_API_KEY")).toBeVisible();
  });

  test("6.7 tRPC data loaded - loading spinner disappears", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    // The page loading state uses Loader2 with animate-spin in center
    // After data loads, it should not be visible
    const pageSpinner = page.locator(
      ".flex.items-center.justify-center.h-64 .animate-spin"
    );
    const isVisible = await pageSpinner.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test("6.8 switching to settings tab shows feature list", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/admin/ai-provider");
    const settingsTab = page.getByText("機能別設定");
    await settingsTab.click();
    await page.waitForTimeout(500);

    await expect(page.getByText("機能別AIプロバイダー設定")).toBeVisible();
    await expect(page.getByText("分身AIとの会話")).toBeVisible();
    await expect(page.getByText("性格診断", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("マッチング分析", { exact: true }).first()).toBeVisible();
  });
});

// ===========================================================================
// 7. Quests  (/quests)
// ===========================================================================
test.describe("Quests Page (/quests)", () => {
  test("7.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/quests");
    assertNoCriticalErrors(errors);
  });

  test("7.2 page heading is visible", async ({ page }) => {
    await navigateAndSettle(page, "/quests");
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("クエスト");
  });

  test("7.3 point balance is displayed", async ({ page }) => {
    await navigateAndSettle(page, "/quests");
    await expect(page.getByText("pt").first()).toBeVisible();
    await expect(page.getByText("現在のポイント")).toBeVisible();
  });

  test("7.4 stats cards are rendered", async ({ page }) => {
    await navigateAndSettle(page, "/quests");
    await expect(page.getByText("完了したクエスト")).toBeVisible();
    await expect(page.getByText("獲得ポイント合計")).toBeVisible();
    await expect(page.getByText("カテゴリ")).toBeVisible();
  });

  test("7.5 tips card is visible", async ({ page }) => {
    await navigateAndSettle(page, "/quests");
    await expect(
      page.getByText("ポイントを効率よく貯めるコツ")
    ).toBeVisible();
    await expect(page.getByText("毎日ログイン")).toBeVisible();
    await expect(page.getByText("分身AIと会話")).toBeVisible();
  });

  test("7.6 tRPC data loads - loading spinner disappears", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/quests");
    const pageSpinner = page.locator(
      ".flex.items-center.justify-center.h-64 .animate-spin"
    );
    const isVisible = await pageSpinner.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test("7.7 empty state - zero values displayed correctly", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/quests");
    // Stats show 0 values
    const zeroValues = page.getByText("0", { exact: true });
    const count = await zeroValues.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 8. Learned Personality  (/learned-personality)
// ===========================================================================
test.describe("LearnedPersonality Page (/learned-personality)", () => {
  test("8.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/learned-personality");
    assertNoCriticalErrors(errors);
  });

  test("8.2 empty state message is displayed when no data", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/learned-personality");
    await expect(page.getByText("学習データがありません")).toBeVisible();
    await expect(
      page.getByText("Clawdbotで会話をすると、自動的にあなたの人格を学習します")
    ).toBeVisible();
  });

  test("8.3 CTA button to configure Clawdbot is present", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/learned-personality");
    const ctaBtn = page.getByRole("button", {
      name: "Clawdbot連携を設定",
    });
    await expect(ctaBtn).toBeVisible();
    await expect(ctaBtn).toBeEnabled();
  });

  test("8.4 CTA button navigates to /clawdbot", async ({ page }) => {
    await navigateAndSettle(page, "/learned-personality");
    const ctaBtn = page.getByRole("button", {
      name: "Clawdbot連携を設定",
    });
    await ctaBtn.click();
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/clawdbot");
  });

  test("8.5 sidebar navigation is present", async ({ page }) => {
    await navigateAndSettle(page, "/learned-personality");
    await assertSidebarPresent(page);
  });
});

// ===========================================================================
// 9. Not Found  (/404)
// ===========================================================================
test.describe("NotFound Page (/404)", () => {
  test("9.1 loads without JS errors", async ({ page }) => {
    const errors = await navigateAndSettle(page, "/404");
    assertNoCriticalErrors(errors);
  });

  test("9.2 displays 404 heading", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    const heading = page.getByRole("heading", { name: "404" });
    await expect(heading).toBeVisible();
  });

  test("9.3 displays Page Not Found message", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    const subheading = page.getByText("Page Not Found");
    await expect(subheading).toBeVisible();
  });

  test("9.4 displays descriptive sorry message", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    await expect(
      page.getByText("Sorry, the page you are looking for doesn't exist.")
    ).toBeVisible();
    await expect(
      page.getByText("It may have been moved or deleted.")
    ).toBeVisible();
  });

  test("9.5 Go Home button is present and clickable", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    const goHomeBtn = page.getByRole("button", { name: "Go Home" });
    await expect(goHomeBtn).toBeVisible();
    await expect(goHomeBtn).toBeEnabled();
    await goHomeBtn.click();
    await page.waitForTimeout(2000);
    // Should navigate to home
    expect(page.url()).toMatch(/\/(#.*)?$/);
  });

  test("9.6 AlertCircle icon is rendered", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    const icon = page.locator("svg.lucide-circle-alert");
    await expect(icon).toBeVisible();
  });

  test("9.7 button group container is present", async ({ page }) => {
    await navigateAndSettle(page, "/404");
    const buttonGroup = page.locator("#not-found-button-group");
    await expect(buttonGroup).toBeVisible();
  });

  test("9.8 does NOT show sidebar navigation (standalone page)", async ({
    page,
  }) => {
    await navigateAndSettle(page, "/404");
    // 404 page is NOT inside DashboardLayout
    const sidebarText = page.getByText("ダッシュボード");
    const isVisible = await sidebarText.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });
});

// ===========================================================================
// 10. Unknown route triggers NotFound
// ===========================================================================
test.describe("Unknown route displays NotFound", () => {
  test("10.1 random path shows 404 page", async ({ page }) => {
    await navigateAndSettle(page, "/this-path-does-not-exist-xyz");
    const heading = page.getByRole("heading", { name: "404" });
    await expect(heading).toBeVisible();
    await expect(page.getByText("Page Not Found")).toBeVisible();
  });
});

// ===========================================================================
// 11. SPA routing - all routes return HTTP 200
// ===========================================================================
test.describe("SPA routing integrity", () => {
  test("11.1 all group3 routes return HTTP 200", async ({ page }) => {
    const routes = [
      "/clawdbot",
      "/line-link",
      "/discover",
      "/orchestration",
      "/ai-config",
      "/admin/ai-provider",
      "/quests",
      "/learned-personality",
      "/404",
    ];

    for (const route of routes) {
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
      });
      expect(
        response?.status(),
        `Expected HTTP 200 for ${route}`
      ).toBe(200);
    }
  });
});

// ===========================================================================
// 12. Loading states settle for all dashboard pages
// ===========================================================================
test.describe("Loading state settles", () => {
  test("12.1 all dashboard pages settle past loading state", async ({
    page,
  }) => {
    const routes = [
      "/clawdbot",
      "/line-link",
      "/discover",
      "/orchestration",
      "/ai-config",
      "/admin/ai-provider",
      "/quests",
      "/learned-personality",
    ];

    for (const route of routes) {
      await page.goto(route, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);

      // Full-page loading spinners should be gone
      const fullPageLoader = page.locator(
        ".flex.items-center.justify-center.h-64 .animate-spin"
      );
      const isLoading = await fullPageLoader.isVisible().catch(() => false);
      expect(isLoading, `Loading spinner still visible on ${route}`).toBe(
        false
      );
    }
  });
});
