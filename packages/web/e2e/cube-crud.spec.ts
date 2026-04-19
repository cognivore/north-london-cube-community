import { test, expect, type APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = "http://localhost:37556";

/** Register a user, verify, and return the session cookie value. */
async function registerAndGetSession(
  request: APIRequestContext,
  suffix: string,
): Promise<{ sessionValue: string; userId: string; email: string }> {
  const email = `cube-${suffix}-${Date.now()}@example.com`;

  const regRes = await request.post(`${API}/api/auth/register`, {
    data: { email, displayName: `Cube ${suffix}`, inviteCode: "NLCC2026" },
  });
  expect(regRes.status()).toBe(201);
  const { userId, challengeToken } = await regRes.json();

  const verifyRes = await request.post(`${API}/api/auth/verify`, {
    data: { userId, challenge: challengeToken },
  });
  expect(verifyRes.status()).toBe(200);

  const setCookieHeader = verifyRes.headers()["set-cookie"] ?? "";
  const match = setCookieHeader.match(/session=([^;]+)/);
  expect(match).toBeTruthy();

  return { sessionValue: match![1], userId, email };
}

function authedHeaders(sessionValue: string) {
  return { Cookie: `session=${sessionValue}` };
}

/** Create a cube and return its id. */
async function createTestCube(
  request: APIRequestContext,
  sessionValue: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request.post(`${API}/api/cubes`, {
    headers: authedHeaders(sessionValue),
    data: {
      name: "Test Cube",
      cubecobraUrl: "https://cubecobra.com/cube/overview/test",
      supportedFormats: ["swiss_draft", "team_draft_3v3"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const { cube } = await res.json();
  return cube;
}

async function becomeHost(request: APIRequestContext, sessionValue: string) {
  const res = await request.patch(`${API}/api/me`, {
    headers: authedHeaders(sessionValue),
    data: { hostCapable: true },
  });
  expect(res.status()).toBe(200);
}

// ---------------------------------------------------------------------------
// Tests — serial because later tests depend on earlier state
// ---------------------------------------------------------------------------

test.describe("Cube CRUD", () => {
  test.describe.configure({ mode: "serial" });

  let ownerSession: string;
  let cubeId: string;

  test.beforeAll(async ({ request }) => {
    const owner = await registerAndGetSession(request, "owner");
    ownerSession = owner.sessionValue;
    await becomeHost(request, ownerSession);
  });

  // 1. Create cube
  test("create cube returns 201 with correct fields", async ({ request }) => {
    const res = await request.post(`${API}/api/cubes`, {
      headers: authedHeaders(ownerSession),
      data: {
        name: "Test Cube",
        cubecobraUrl: "https://cubecobra.com/cube/overview/test",
        supportedFormats: ["swiss_draft", "team_draft_3v3"],
        preferredPodSize: 8,
        minPodSize: 4,
        maxPodSize: 8,
      },
    });

    expect(res.status()).toBe(201);
    const { cube } = await res.json();
    expect(cube.id).toBeTruthy();
    expect(cube.name).toBe("Test Cube");
    expect(cube.cubecobraUrl).toBe(
      "https://cubecobra.com/cube/overview/test",
    );
    expect(cube.cubecobraId).toBe("test");
    expect(cube.supportedFormats).toEqual(["swiss_draft", "team_draft_3v3"]);
    expect(cube.preferredPodSize).toBe(8);
    expect(cube.minPodSize).toBe(4);
    expect(cube.maxPodSize).toBe(8);
    expect(cube.retired).toBe(false);
    expect(cube.ownerId).toBeTruthy();

    cubeId = cube.id;
  });

  // 2. List cubes includes the created one
  test("list cubes includes created cube", async ({ request }) => {
    const res = await request.get(`${API}/api/cubes`);
    expect(res.status()).toBe(200);

    const { cubes } = await res.json();
    const found = cubes.find((c: any) => c.id === cubeId);
    expect(found).toBeTruthy();
    expect(found.name).toBe("Test Cube");
  });

  // 3. Update cube name
  test("update cube name succeeds", async ({ request }) => {
    const res = await request.patch(`${API}/api/cubes/${cubeId}`, {
      headers: authedHeaders(ownerSession),
      data: { name: "Renamed Cube" },
    });
    expect(res.status()).toBe(200);

    const { cube } = await res.json();
    expect(cube.name).toBe("Renamed Cube");
    expect(cube.supportedFormats).toEqual(["swiss_draft", "team_draft_3v3"]);
  });

  // 4. Retire cube
  test("retire cube sets retired to true", async ({ request }) => {
    const res = await request.patch(`${API}/api/cubes/${cubeId}`, {
      headers: authedHeaders(ownerSession),
      data: { retired: true },
    });
    expect(res.status()).toBe(200);

    const { cube } = await res.json();
    expect(cube.retired).toBe(true);
    expect(cube.name).toBe("Renamed Cube");
  });

  // 5. Non-owner cannot update
  test("non-owner gets 403 when updating cube", async ({ request }) => {
    const other = await registerAndGetSession(request, "intruder");
    await becomeHost(request, other.sessionValue);

    const res = await request.patch(`${API}/api/cubes/${cubeId}`, {
      headers: authedHeaders(other.sessionValue),
      data: { name: "Hacked" },
    });
    expect(res.status()).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // 6. Create cube with all supported formats
  test("create cube with all formats preserves supportedFormats", async ({
    request,
  }) => {
    const allFormats = [
      "swiss_draft",
      "team_draft_3v3",
      "team_draft_4v4",
      "rochester",
      "winston",
      "winchester",
      "grid",
      "glimpse",
      "sealed",
    ];
    const res = await request.post(`${API}/api/cubes`, {
      headers: authedHeaders(ownerSession),
      data: {
        name: "All Formats Cube",
        cubecobraUrl: "https://cubecobra.com/cube/overview/allformats",
        supportedFormats: allFormats,
        preferredPodSize: 8,
        minPodSize: 4,
        maxPodSize: 8,
      },
    });

    expect(res.status()).toBe(201);
    const { cube } = await res.json();
    expect(cube.supportedFormats).toEqual(allFormats);
  });

  // 7. Browser test: verify the cubes page renders cube data.
  // We inject the session cookie into the browser context, then navigate
  // to /app/cubes.  The SSR layout loader forwards the cookie to the API
  // server, authenticates the user, and renders the cubes list page.
  test("cubes page shows created cube in browser", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "session",
        value: ownerSession,
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/app/cubes");

    // Verify the renamed cube appears in the list.
    // Multiple test runs may leave cubes in the DB, so check the first match.
    await expect(page.getByText("Renamed Cube").first()).toBeVisible({ timeout: 10_000 });
  });
});
