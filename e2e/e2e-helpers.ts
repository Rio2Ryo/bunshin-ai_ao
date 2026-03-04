import { Page, expect } from "@playwright/test";

export const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";
export const APP_BASE = "https://bunshin-ai.pages.dev";

export async function navigateAndWait(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2000);
}

export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

export async function isOnLoginPage(page: Page): Promise<boolean> {
  return page.url().includes("/login") || page.url().includes("/register");
}

export async function waitForPageReady(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
}

export async function trpcQuery(path: string, input?: any, cookie?: string): Promise<any> {
  const url = input
    ? `${API_BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${API_BASE}/api/trpc/${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(url, { headers });
  return res.json();
}

export async function trpcMutate(path: string, input: any, cookie?: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${API_BASE}/api/trpc/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  return res.json();
}
