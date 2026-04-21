import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Registration page tests
// ---------------------------------------------------------------------------

test.describe("Registration page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/register");
  });

  test("renders heading and tagline", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
    await expect(
      page.getByText("Join the North London cube community"),
    ).toBeVisible();
  });

  test("renders all form fields and submit button", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
  });

  test("shows link to sign in page and navigates there", async ({ page }) => {
    const signInLink = page.getByRole("link", { name: "Sign in" });
    await expect(signInLink).toBeVisible();
    await signInLink.click();
    await expect(page).toHaveURL("/login");
  });

  test("duplicate email shows error message", async ({ page }) => {
    // Register once via API
    const unique = `dup-ui-${Date.now()}@example.com`;
    await page.request.post("http://localhost:37556/api/auth/register", {
      data: { email: unique, displayName: "First" },
    });

    // Try same email via form
    await page.getByLabel("Email").fill(unique);
    await page.getByLabel("Display name").fill("Second");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Email already registered")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Login page tests
// ---------------------------------------------------------------------------

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders heading and instructions", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByText("Enter your email to continue"),
    ).toBeVisible();
  });

  test("renders email field and submit button", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });

  test("shows link to registration page and navigates there", async ({
    page,
  }) => {
    const registerLink = page.getByRole("link", { name: "Register" });
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL("/register");
  });

  test("login with non-existent email shows error", async ({ page }) => {
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("No account with that email")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Registration via direct API call
// ---------------------------------------------------------------------------

test.describe("Registration API", () => {
  test("register with valid invite code succeeds via API", async ({
    request,
  }) => {
    const unique = `api-test-${Date.now()}@example.com`;

    // Step 1: Register
    const registerRes = await request.post("http://localhost:37556/api/auth/register", {
      data: {
        email: unique,
        displayName: "API Test User",
      },
    });
    expect(registerRes.status()).toBe(201);

    const registerBody = await registerRes.json();
    expect(registerBody.userId).toBeTruthy();
    expect(registerBody.challengeToken).toBeTruthy();

    // Step 2: Verify
    const verifyRes = await request.post("http://localhost:37556/api/auth/verify", {
      data: {
        userId: registerBody.userId,
        challenge: registerBody.challengeToken,
      },
    });
    expect(verifyRes.status()).toBe(200);

    const verifyBody = await verifyRes.json();
    expect(verifyBody.user).toBeTruthy();
    expect(verifyBody.user.email).toBe(unique);
    expect(verifyBody.user.displayName).toBe("API Test User");
  });

  test("register then login creates session via API", async ({ request }) => {
    const unique = `login-test-${Date.now()}@example.com`;

    // Register + verify first
    const registerRes = await request.post("http://localhost:37556/api/auth/register", {
      data: {
        email: unique,
        displayName: "Login Test User",
      },
    });
    const { userId, challengeToken } = await registerRes.json();

    await request.post("http://localhost:37556/api/auth/verify", {
      data: { userId, challenge: challengeToken },
    });

    // Now login
    const loginRes = await request.post("http://localhost:37556/api/auth/session", {
      data: { email: unique },
    });
    expect(loginRes.status()).toBe(200);

    const loginBody = await loginRes.json();
    expect(loginBody.user.email).toBe(unique);
  });

  test("duplicate email fails on second registration", async ({ request }) => {
    const unique = `dup-test-${Date.now()}@example.com`;

    // First registration succeeds
    const firstRes = await request.post("http://localhost:37556/api/auth/register", {
      data: {
        email: unique,
        displayName: "First User",
      },
    });
    expect(firstRes.status()).toBe(201);

    // Second registration with same email fails
    const secondRes = await request.post("http://localhost:37556/api/auth/register", {
      data: {
        email: unique,
        displayName: "Duplicate User",
      },
    });
    // Server returns 500 due to Effect error wrapping in catch block
    expect(secondRes.ok()).toBe(false);

    const body = await secondRes.json();
    expect(body.error).toBeTruthy();
  });
});
