import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-remote",
  fullyParallel: false, // sequential — one test modifies state for the next
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://staging.north.cube.london",
    headless: false, // NOT headless
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
