import { test, expect, APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = "http://localhost:37556";

/** Register + verify a fresh user, returning userId. Session cookie is stored
 *  automatically by the Playwright APIRequestContext. */
async function registerAndVerify(
  request: APIRequestContext,
  suffix: string,
): Promise<string> {
  const email = `rsvp-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const regRes = await request.post(`${API}/api/auth/register`, {
    data: {
      email,
      displayName: `Test ${suffix}`,
    },
  });
  expect(regRes.status()).toBe(201);
  const { userId, challengeToken } = await regRes.json();

  const verRes = await request.post(`${API}/api/auth/verify`, {
    data: { userId, challenge: challengeToken },
  });
  expect(verRes.status()).toBe(200);

  return userId;
}

/** Fetch the first venue id from the seeded data. */
async function getVenueId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/api/venues`);
  expect(res.status()).toBe(200);
  const { venues } = await res.json();
  expect(venues.length).toBeGreaterThan(0);
  return venues[0].id;
}

/** Generate a unique date string to avoid the UNIQUE constraint on fridays.date.
 *  Uses dates far in the future so they don't collide with other tests. */
function uniqueDate(): string {
  // Base: 2027-01-01, offset by timestamp + random to guarantee uniqueness
  const base = new Date("2027-01-01");
  const offset = (Date.now() % 100000) + Math.floor(Math.random() * 10000);
  base.setDate(base.getDate() + offset);
  return base.toISOString().slice(0, 10);
}

/** Create a friday and return its id (starts in "scheduled" state). */
async function createFriday(
  request: APIRequestContext,
  venueId: string,
): Promise<string> {
  const date = uniqueDate();
  const res = await request.post(`${API}/api/lifecycle/fridays`, {
    data: { date, venueId },
  });
  expect(res.status()).toBe(201);
  const { friday } = await res.json();
  expect(friday.id).toBeTruthy();
  return friday.id;
}

/** Advance a friday one step and return the new state kind. */
async function advanceFriday(
  request: APIRequestContext,
  fridayId: string,
): Promise<string> {
  const res = await request.post(
    `${API}/api/lifecycle/fridays/${fridayId}/advance`,
  );
  expect(res.status()).toBe(200);
  const { friday } = await res.json();
  return friday.state.kind;
}

/** Make the current session user host-capable via PATCH /api/me. */
async function makeHostCapable(request: APIRequestContext): Promise<void> {
  const res = await request.patch(`${API}/api/me`, {
    data: { hostCapable: true },
  });
  expect(res.status()).toBe(200);
}

/** Create a cube owned by the current session user and return its id. */
async function createCube(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/api/cubes`, {
    data: {
      name: `Test Cube ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cubecobraUrl: "https://cubecobra.com/cube/overview/test",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    },
  });
  expect(res.status()).toBe(201);
  const { cube } = await res.json();
  return cube.id;
}

/** Full setup: register user, get venue, create friday, advance to open. */
async function setupOpenFriday(
  request: APIRequestContext,
  suffix: string,
): Promise<{ userId: string; fridayId: string; venueId: string }> {
  const userId = await registerAndVerify(request, suffix);
  const venueId = await getVenueId(request);
  const fridayId = await createFriday(request, venueId);
  const stateKind = await advanceFriday(request, fridayId);
  expect(stateKind).toBe("open");
  return { userId, fridayId, venueId };
}

// ---------------------------------------------------------------------------
// RSVP tests
// ---------------------------------------------------------------------------

test.describe("RSVP", () => {
  test("full RSVP lifecycle: in, duplicate, out, re-in", async ({ request }) => {
    const { fridayId } = await setupOpenFriday(request, "rsvp-lifecycle");

    // 1. RSVP in succeeds (201)
    const inRes = await request.post(`${API}/api/fridays/${fridayId}/rsvp`, {
      data: { action: "in" },
    });
    expect(inRes.status()).toBe(201);
    const inBody = await inRes.json();
    expect(inBody.rsvp.state).toBe("in");

    // 2. Duplicate RSVP in returns 409
    const dupRes = await request.post(`${API}/api/fridays/${fridayId}/rsvp`, {
      data: { action: "in" },
    });
    expect(dupRes.status()).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error.code).toBe("ALREADY_IN");

    // 3. RSVP out cancels (200)
    const outRes = await request.post(`${API}/api/fridays/${fridayId}/rsvp`, {
      data: { action: "out" },
    });
    expect(outRes.status()).toBe(200);
    const outBody = await outRes.json();
    expect(outBody.rsvp.state).toBe("cancelled_by_user");

    // 4. RSVP in after out re-RSVPs (201)
    const reInRes = await request.post(`${API}/api/fridays/${fridayId}/rsvp`, {
      data: { action: "in" },
    });
    expect(reInRes.status()).toBe(201);
    const reInBody = await reInRes.json();
    expect(reInBody.rsvp.state).toBe("in");
  });

  test("RSVP not accepted when friday is scheduled", async ({ request }) => {
    const userId = await registerAndVerify(request, "rsvp-sched");
    const venueId = await getVenueId(request);
    const fridayId = await createFriday(request, venueId);
    // Do NOT advance — friday stays "scheduled"

    const res = await request.post(`${API}/api/fridays/${fridayId}/rsvp`, {
      data: { action: "in" },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_ACCEPTED");
  });
});

// ---------------------------------------------------------------------------
// Enrollment tests
// ---------------------------------------------------------------------------

test.describe("Enrollment", () => {
  test("enroll and withdraw cube", async ({ request }) => {
    const userId = await registerAndVerify(request, "enroll-ok");
    await makeHostCapable(request);
    const cubeId = await createCube(request);
    const venueId = await getVenueId(request);
    const fridayId = await createFriday(request, venueId);
    const stateKind = await advanceFriday(request, fridayId);
    expect(stateKind).toBe("open");

    // Enroll cube (201)
    const enrollRes = await request.post(
      `${API}/api/fridays/${fridayId}/enrollments`,
      { data: { cubeId } },
    );
    expect(enrollRes.status()).toBe(201);
    const { enrollment } = await enrollRes.json();
    expect(enrollment.cubeId).toBe(cubeId);
    expect(enrollment.withdrawn).toBe(false);

    // Withdraw enrollment (200)
    const withdrawRes = await request.delete(
      `${API}/api/fridays/${fridayId}/enrollments/${enrollment.id}`,
    );
    expect(withdrawRes.status()).toBe(200);
    const withdrawBody = await withdrawRes.json();
    expect(withdrawBody.ok).toBe(true);
  });

  test("enrollment rejected when not host-capable", async ({ request }) => {
    // Register a fresh user who is NOT host-capable (default)
    await registerAndVerify(request, "no-host");
    const cubeId = await createCube(request);
    const venueId = await getVenueId(request);
    const fridayId = await createFriday(request, venueId);
    await advanceFriday(request, fridayId);

    const res = await request.post(
      `${API}/api/fridays/${fridayId}/enrollments`,
      { data: { cubeId } },
    );
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_HOST");
  });

  test("enrollment rejected when friday not open", async ({ request }) => {
    await registerAndVerify(request, "enroll-sched");
    await makeHostCapable(request);
    const cubeId = await createCube(request);
    const venueId = await getVenueId(request);
    const fridayId = await createFriday(request, venueId);
    // Do NOT advance — stays "scheduled"

    const res = await request.post(
      `${API}/api/fridays/${fridayId}/enrollments`,
      { data: { cubeId } },
    );
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_ACCEPTED");
  });
});
