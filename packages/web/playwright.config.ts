import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:17556",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        // Mobile-first: 375x667 viewport matching the target audience
      },
    },
  ],

  // Start both API server and web dev server before running tests
  webServer: [
    {
      command: "pnpm --filter @cubehall/server run dev",
      port: 37556,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @cubehall/web run dev",
      port: 17556,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: "../..",
    },
  ],

  // Reasonable timeouts for a small local app
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
});
