import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays hero heading and community name", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Friday night");
    await expect(heading).toContainText("cube drafts");
    // Community name now lives in the site identity bar, not the h1.
    await expect(
      page.getByText("North London Cube Community").first(),
    ).toBeVisible();
  });

  test("displays the rotation subline with the new P1P1 and doors times", async ({
    page,
  }) => {
    // Hero subline: P1P1 time + cadence + locale.
    await expect(
      page.getByText("P1P1 18:30 every Friday in North London"),
    ).toBeVisible();
    // Framework table doors row now reads 18:00 (the new, earlier doors time).
    await expect(page.getByText("18:00")).toBeVisible();
  });

  test("shows both rotation venues with odd/even Friday labels", async ({
    page,
  }) => {
    // Find-us section renders one card per venue (name rendered as a heading).
    await expect(
      page.getByRole("heading", { name: "Arcadia Games" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Bad Moon Cafe (Holloway Rd)" }),
    ).toBeVisible();
    // Each venue is tagged with which Fridays it hosts.
    await expect(page.getByText("Odd Fridays").first()).toBeVisible();
    await expect(page.getByText("Even Fridays").first()).toBeVisible();
  });

  test("shows Sign in link that navigates to /login", async ({ page }) => {
    const signInLink = page.getByRole("link", { name: "Sign in" });
    await expect(signInLink).toBeVisible();
    await signInLink.click();
    await expect(page).toHaveURL("/login");
  });

  test("shows Register link that navigates to /register", async ({ page }) => {
    const registerLink = page.getByRole("link", { name: "Register" });
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL("/register");
  });

  test("displays the framework and how-it-works sections", async ({ page }) => {
    const sections = [
      "No gods, no masters",
      "The framework",
      "How it works",
      "Find us",
    ];
    for (const title of sections) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });

  test("displays footer attribution", async ({ page }) => {
    await expect(
      page.getByText("Cubehall — Built for the North London cube community"),
    ).toBeVisible();
  });
});
