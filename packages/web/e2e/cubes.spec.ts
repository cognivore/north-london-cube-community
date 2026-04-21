import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Cubes — tests that work against the real running stack.
//
// The /app/* routes require authentication (the layout loader calls api.me()
// and redirects to /login if unauthenticated). Because SSR cookie forwarding
// is not yet wired up, we cannot programmatically log in via the browser.
//
// Instead we test:
// 1. Unauthenticated access to /app/cubes redirects to /login (auth guard)
// 2. The cubes API endpoint directly (no auth needed for GET /api/cubes)
// 3. Full create-cube flow via the API
// ---------------------------------------------------------------------------

test.describe("Cubes auth guard", () => {
  test("unauthenticated visit to /app/cubes redirects to /login", async ({
    page,
  }) => {
    await page.goto("/app/cubes");
    await expect(page).toHaveURL("/login");
  });

  test("unauthenticated visit to /app/cubes/new redirects to /login", async ({
    page,
  }) => {
    await page.goto("/app/cubes/new");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Cubes API", () => {
  test("GET /api/cubes returns empty list initially", async ({ request }) => {
    const res = await request.get("http://localhost:37556/api/cubes");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.cubes).toBeDefined();
    expect(Array.isArray(body.cubes)).toBe(true);
  });

  test("create cube via API requires authentication", async ({ request }) => {
    const res = await request.post("http://localhost:37556/api/cubes", {
      data: {
        name: "Test Cube",
        cubecobraUrl: "https://cubecobra.com/cube/overview/test",
        supportedFormats: ["swiss_draft"],
        preferredPodSize: 8,
        minPodSize: 4,
        maxPodSize: 8,
      },
    });
    // Should be 401 because no session cookie
    expect(res.status()).toBe(401);
  });

  test("authenticated user can create and list cubes via API", async ({
    request,
  }) => {
    const unique = `cube-user-${Date.now()}@example.com`;

    // Register + verify to get a session cookie
    const registerRes = await request.post("http://localhost:37556/api/auth/register", {
      data: {
        email: unique,
        displayName: "Cube Creator",
      },
    });
    const { userId, challengeToken } = await registerRes.json();

    const verifyRes = await request.post("http://localhost:37556/api/auth/verify", {
      data: { userId, challenge: challengeToken },
    });
    expect(verifyRes.status()).toBe(200);

    // The verify response sets a session cookie — Playwright APIRequestContext
    // automatically stores and sends cookies for subsequent requests.
    const createRes = await request.post("http://localhost:37556/api/cubes", {
      data: {
        name: "Powered Vintage Cube",
        cubecobraUrl: "https://cubecobra.com/cube/overview/poweredvintage",
        supportedFormats: ["swiss_draft", "team_draft_3v3"],
        preferredPodSize: 8,
        minPodSize: 6,
        maxPodSize: 8,
      },
    });
    expect(createRes.status()).toBe(201);

    const createBody = await createRes.json();
    expect(createBody.cube.name).toBe("Powered Vintage Cube");
    expect(createBody.cube.supportedFormats).toContain("swiss_draft");

    // Verify it shows up in the list
    const listRes = await request.get("http://localhost:37556/api/cubes");
    const listBody = await listRes.json();
    const found = listBody.cubes.find(
      (c: any) => c.name === "Powered Vintage Cube",
    );
    expect(found).toBeTruthy();
  });
});
