import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 300_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://bunshin-ai.pages.dev",
    headless: true,
    screenshot: "off",
    trace: "off",
    navigationTimeout: 30_000,
    actionTimeout: 10_000,
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [
          "/home/ginocbot/local_libs/extracted/usr/lib/x86_64-linux-gnu",
          process.env.LD_LIBRARY_PATH || "",
        ]
          .filter(Boolean)
          .join(":"),
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
