import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, "../test_screenshots");
const BASE_URL = "https://bunshin-ai.pages.dev";

const ROUTES = [
  "/",
  "/dashboard",
  "/profile",
  "/twins",
  "/twins/1",
  "/chat",
  "/chat/1",
  "/matching",
  "/matching/1",
  "/ai-config",
  "/orchestration",
  "/friends",
  "/plan",
  "/discover",
  "/points",
  "/quests",
  "/clawdbot",
  "/learned-personality",
  "/line-link",
  "/growth",
  "/cards",
  "/admin/ai-provider",
  "/404",
];

interface PageResult {
  route: string;
  status: "success" | "error";
  consoleErrors: string[];
  failedRequests: { url: string; status: number; statusText: string }[];
  screenshotPath: string;
  isBlank: boolean;
  pageTitle: string;
  bodyTextLength: number;
  loadTimeMs: number;
  errorMessage?: string;
}

// Ensure screenshot directory exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test("Crawl all 21+ pages of the application", async ({ page }) => {
  const results: PageResult[] = [];

  for (const route of ROUTES) {
    const consoleErrors: string[] = [];
    const failedRequests: { url: string; status: number; statusText: string }[] = [];

    // Listen for console errors
    const onConsoleMsg = (msg: any) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    };
    page.on("console", onConsoleMsg);

    // Listen for failed network requests (4xx/5xx)
    const onResponse = (response: any) => {
      const status = response.status();
      if (status >= 400) {
        failedRequests.push({
          url: response.url(),
          status,
          statusText: response.statusText(),
        });
      }
    };
    page.on("response", onResponse);

    // Listen for request failures (network errors)
    const onRequestFailed = (request: any) => {
      failedRequests.push({
        url: request.url(),
        status: 0,
        statusText: request.failure()?.errorText || "Network error",
      });
    };
    page.on("requestfailed", onRequestFailed);

    const fullUrl = `${BASE_URL}${route}`;
    const safeName = route === "/" ? "home" : route.replace(/\//g, "_").replace(/^_/, "");
    const screenshotPath = path.join(SCREENSHOT_DIR, `${safeName}.png`);
    const startTime = Date.now();

    let isBlank = false;
    let pageTitle = "";
    let bodyTextLength = 0;
    let errorMessage: string | undefined;
    let status: "success" | "error" = "success";

    try {
      // Navigate to the page
      const response = await page.goto(fullUrl, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });

      // Additional wait for SPA rendering
      await page.waitForTimeout(2000);

      // Get page info
      pageTitle = await page.title();
      bodyTextLength = await page.evaluate(() => {
        const body = document.body;
        return body ? body.innerText.trim().length : 0;
      });

      // Check if page is blank
      isBlank = await page.evaluate(() => {
        const body = document.body;
        if (!body) return true;
        const text = body.innerText.trim();
        const hasVisibleElements = body.querySelectorAll(
          "img, svg, canvas, video, [role], button, a, h1, h2, h3, h4, h5, h6, p, span, div:not(:empty)"
        ).length;
        return text.length === 0 && hasVisibleElements < 3;
      });

      // Take screenshot
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (err: any) {
      status = "error";
      errorMessage = err.message?.substring(0, 200);
      // Try to take screenshot even on error
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        // ignore screenshot failure
      }
    }

    const loadTimeMs = Date.now() - startTime;

    // Remove listeners to avoid stacking
    page.removeListener("console", onConsoleMsg);
    page.removeListener("response", onResponse);
    page.removeListener("requestfailed", onRequestFailed);

    results.push({
      route,
      status,
      consoleErrors,
      failedRequests,
      screenshotPath,
      isBlank,
      pageTitle,
      bodyTextLength,
      loadTimeMs,
      errorMessage,
    });

    console.log(
      `[${status.toUpperCase()}] ${route} - title: "${pageTitle}", text: ${bodyTextLength} chars, ` +
        `errors: ${consoleErrors.length}, failed reqs: ${failedRequests.length}, blank: ${isBlank}, ${loadTimeMs}ms`
    );
  }

  // Print summary report
  console.log("\n" + "=".repeat(100));
  console.log("CRAWL REPORT SUMMARY");
  console.log("=".repeat(100));

  console.log("\n--- SUCCESSFULLY LOADED PAGES ---");
  const successPages = results.filter((r) => r.status === "success" && !r.isBlank);
  for (const r of successPages) {
    console.log(`  OK  ${r.route} (${r.loadTimeMs}ms, ${r.bodyTextLength} chars)`);
  }

  console.log("\n--- BLANK / BROKEN PAGES ---");
  const blankPages = results.filter((r) => r.isBlank);
  if (blankPages.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of blankPages) {
      console.log(`  BLANK  ${r.route} (${r.bodyTextLength} chars of text)`);
    }
  }

  console.log("\n--- PAGES WITH ERRORS ---");
  const errorPages = results.filter((r) => r.status === "error");
  if (errorPages.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of errorPages) {
      console.log(`  ERROR  ${r.route}: ${r.errorMessage}`);
    }
  }

  console.log("\n--- PAGES WITH CONSOLE ERRORS ---");
  const consoleErrorPages = results.filter((r) => r.consoleErrors.length > 0);
  if (consoleErrorPages.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of consoleErrorPages) {
      console.log(`  ${r.route}: ${r.consoleErrors.length} console error(s)`);
      for (const err of r.consoleErrors) {
        console.log(`    -> ${err.substring(0, 200)}`);
      }
    }
  }

  console.log("\n--- PAGES WITH FAILED API REQUESTS ---");
  const failedReqPages = results.filter((r) => r.failedRequests.length > 0);
  if (failedReqPages.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of failedReqPages) {
      console.log(`  ${r.route}: ${r.failedRequests.length} failed request(s)`);
      for (const freq of r.failedRequests) {
        console.log(`    -> [${freq.status}] ${freq.statusText} - ${freq.url.substring(0, 150)}`);
      }
    }
  }

  console.log("\n--- FULL RESULTS TABLE ---");
  console.log(
    "Route".padEnd(30) +
      "Status".padEnd(10) +
      "Blank".padEnd(8) +
      "Errors".padEnd(8) +
      "FailReqs".padEnd(10) +
      "TextLen".padEnd(10) +
      "Time(ms)"
  );
  console.log("-".repeat(84));
  for (const r of results) {
    console.log(
      r.route.padEnd(30) +
        r.status.padEnd(10) +
        String(r.isBlank).padEnd(8) +
        String(r.consoleErrors.length).padEnd(8) +
        String(r.failedRequests.length).padEnd(10) +
        String(r.bodyTextLength).padEnd(10) +
        String(r.loadTimeMs)
    );
  }

  // Write JSON results file
  const jsonResultsPath = path.join(SCREENSHOT_DIR, "crawl-results.json");
  fs.writeFileSync(jsonResultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${jsonResultsPath}`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log("=".repeat(100));
});
