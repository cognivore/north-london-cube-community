import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays hero heading with community name", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("North London");
    await expect(heading).toContainText("Cube Community");
  });

  test("displays tagline describing the purpose", async ({ page }) => {
    await expect(
      page.getByText("Friday night MTG cube drafts at Owl & Hitchhiker."),
    ).toBeVisible();
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

  test("displays all four feature descriptions", async ({ page }) => {
    const features = [
      { title: "RSVP in one tap", snippet: "Tap /in to reserve your seat" },
      { title: "Cube voting", snippet: "ranked-choice voting" },
      { title: "Live pairings & timer", snippet: "Swiss and team draft pairings" },
      { title: "Standings & history", snippet: "Match results and standings" },
    ];

    for (const feature of features) {
      const heading = page.getByRole("heading", { name: feature.title });
      await expect(heading).toBeVisible();
      await expect(page.getByText(feature.snippet)).toBeVisible();
    }
  });

  test("displays footer attribution", async ({ page }) => {
    await expect(
      page.getByText("Cubehall — Built for the North London cube community"),
    ).toBeVisible();
  });
});
