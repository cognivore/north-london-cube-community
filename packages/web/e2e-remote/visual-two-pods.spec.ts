import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

const API = "https://staging.north.cube.london/api";
const BASE = "https://staging.north.cube.london";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
}

async function signInAs(
  request: APIRequestContext,
  userId: string,
): Promise<UserHandle> {
  const res = await request.post(`${API}/test/sign-in-as`, {
    data: { userId },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return { session: body.sessionId, userId };
}

async function signInAsCoordinator(
  request: APIRequestContext,
): Promise<UserHandle> {
  const usersRes = await request.get(`${API}/test/users`);
  expect(usersRes.status()).toBe(200);
  const { users } = await usersRes.json();
  const coordinator = users.find(
    (u: any) => u.role === "coordinator" || u.email === "jm@memorici.de",
  );
  expect(coordinator).toBeTruthy();
  return signInAs(request, coordinator.id);
}

function aGet(req: APIRequestContext, u: UserHandle, url: string) {
  return req.get(url, { headers: { Cookie: `session=${u.session}` } });
}

function aPost(
  req: APIRequestContext,
  u: UserHandle,
  url: string,
  data?: Record<string, unknown>,
) {
  return req.post(url, {
    headers: { Cookie: `session=${u.session}` },
    ...(data !== undefined ? { data } : {}),
  });
}

function aPatch(
  req: APIRequestContext,
  u: UserHandle,
  url: string,
  data: Record<string, unknown>,
) {
  return req.patch(url, {
    headers: { Cookie: `session=${u.session}` },
    data,
  });
}

/** Generate a random date in 2030-2049 that is a Friday. */
function randomFriday(): string {
  const year = 2030 + Math.floor(Math.random() * 20);
  const month = Math.floor(Math.random() * 12);
  const d = new Date(year, month, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * Math.floor(Math.random() * 4));
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Inject session cookie into the browser context. */
async function injectSession(context: BrowserContext, sessionId: string) {
  await context.addCookies([
    {
      name: "session",
      value: sessionId,
      domain: "staging.north.cube.london",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

// ---------------------------------------------------------------------------
// Visual E2E: Two pods, two cubes, 10 players — full Friday lifecycle
// ---------------------------------------------------------------------------

test.describe("VISUAL: Two pods, two cubes, full Friday lifecycle", () => {
  test.slow(); // extend timeout for slow visual test

  test("watch the entire Friday unfold in the browser", async ({
    page,
    context,
    request,
  }) => {
    // =================================================================
    // STEP 1 — API setup (invisible to browser)
    // =================================================================

    // 1a. Sign in as coordinator
    const coord = await signInAsCoordinator(request);

    // 1b. Get venue
    const venuesRes = await aGet(request, coord, `${API}/venues`);
    expect(venuesRes.status()).toBe(200);
    const { venues } = await venuesRes.json();
    expect(venues.length).toBeGreaterThan(0);
    const venueId = venues[0].id;

    // 1c. Create a Friday
    const date = randomFriday();
    const createFridayRes = await aPost(request, coord, `${API}/lifecycle/fridays`, {
      date,
      venueId,
    });
    expect(createFridayRes.status()).toBe(201);
    const { friday: createdFriday } = await createFridayRes.json();
    const fridayId = createdFriday.id;

    // 1d. Advance: scheduled -> open
    const advOpen = await aPost(request, coord, `${API}/lifecycle/fridays/${fridayId}/advance`);
    expect(advOpen.status()).toBe(200);

    // 1e. Create 10 phony users (no auto-RSVP — we RSVP them properly)
    const phonyRes = await aPost(request, coord, `${API}/test/phony-users`, {
      count: 10,
    });
    expect(phonyRes.status()).toBe(200);
    const { users: phonyUsers } = await phonyRes.json();
    expect(phonyUsers.length).toBe(10);

    // 1f. Coordinator becomes host-capable, creates Cube A
    await aPatch(request, coord, `${API}/me`, { hostCapable: true });
    const cubeARes = await aPost(request, coord, `${API}/cubes`, {
      name: "Vintage Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/vintage-visual-${Date.now()}`,
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cubeARes.status()).toBe(201);
    const cubeA = (await cubeARes.json()).cube;

    // 1g. First phony user becomes host, creates Cube B
    const host2 = await signInAs(request, phonyUsers[0].id);
    await aPatch(request, host2, `${API}/me`, { hostCapable: true });
    const cubeBRes = await aPost(request, host2, `${API}/cubes`, {
      name: "Legacy Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/legacy-visual-${Date.now()}`,
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 6,
      minPodSize: 4,
      maxPodSize: 6,
    });
    expect(cubeBRes.status()).toBe(201);
    const cubeB = (await cubeBRes.json()).cube;

    // 1h. RSVP everyone: coordinator + 10 phony users
    const coordRsvp = await aPost(request, coord, `${API}/fridays/${fridayId}/rsvp`, {
      action: "in",
    });
    expect([201, 409]).toContain(coordRsvp.status());

    for (const pu of phonyUsers) {
      const handle = await signInAs(request, pu.id);
      const rsvpRes = await aPost(request, handle, `${API}/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect([201, 409]).toContain(rsvpRes.status());
    }

    // 1i. Enroll both cubes
    const enrollARes = await aPost(request, coord, `${API}/fridays/${fridayId}/enrollments`, {
      cubeId: cubeA.id,
    });
    expect(enrollARes.status()).toBe(201);

    const enrollBRes = await aPost(request, host2, `${API}/fridays/${fridayId}/enrollments`, {
      cubeId: cubeB.id,
    });
    expect(enrollBRes.status()).toBe(201);

    // =================================================================
    // STEP 2 — Browser: Log in as coordinator and see the home page
    // =================================================================

    await injectSession(context, coord.session);
    await page.goto(`${BASE}/app`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("This Friday");
    await page.waitForTimeout(1500);

    // =================================================================
    // STEP 3 — Browser: Navigate to the Friday detail page
    // =================================================================

    await page.goto(`${BASE}/app/fridays/${fridayId}`);
    await page.waitForLoadState("networkidle");

    // Verify the heading shows the date
    await expect(page.locator("h1")).toBeVisible();

    // See "Attending" count and "Cubes" count
    await expect(page.getByRole("heading", { name: /Attending/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Cubes/ })).toBeVisible();
    await page.waitForTimeout(2000);

    // =================================================================
    // STEP 4 — Advance through states via API, refresh browser each time
    // =================================================================

    // 4a. Advance: open -> vote_closed (<=2 cubes => vote skipped)
    const advVoteClosed = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advVoteClosed.status()).toBe(200);
    const vcState = (await advVoteClosed.json()).friday.state.kind;
    expect(vcState).toBe("vote_closed");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("text=vote closed")).toBeVisible();
    await page.waitForTimeout(1500);

    // 4b. Advance: vote_closed -> confirmed (pods created!)
    const advConfirmed = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advConfirmed.status()).toBe(200);
    expect((await advConfirmed.json()).friday.state.kind).toBe("confirmed");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("text=confirmed")).toBeVisible();
    // Pods section should now be visible
    await expect(page.locator("text=Pods")).toBeVisible();
    await page.waitForTimeout(2000);

    // 4c. Fetch pod details from API for later use
    const fridayDetail = await aGet(request, coord, `${API}/fridays/${fridayId}`);
    expect(fridayDetail.status()).toBe(200);
    const fridayBody = await fridayDetail.json();
    expect(fridayBody.pods.length).toBe(2);
    const podIds: string[] = fridayBody.pods.map((p: any) => p.id);

    // Fetch each pod to know seat counts and round counts
    const podDetails: any[] = [];
    for (const podId of podIds) {
      const podRes = await aGet(request, coord, `${API}/pods/${podId}`);
      expect(podRes.status()).toBe(200);
      podDetails.push(await podRes.json());
    }

    // 4d. Advance: confirmed -> in_progress
    const advInProgress = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advInProgress.status()).toBe(200);
    expect((await advInProgress.json()).friday.state.kind).toBe("in_progress");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("text=in progress")).toBeVisible();
    await page.waitForTimeout(1500);

    // =================================================================
    // STEP 5 — Browser: Navigate to Pod 1, see seats
    // =================================================================

    const pod1Id = podDetails[0].pod.id;
    await page.goto(`${BASE}/app/pods/${pod1Id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText("Pod");
    await expect(page.locator("text=Seats")).toBeVisible();
    await expect(page.locator("text=Rounds")).toBeVisible();
    await page.waitForTimeout(2000);

    // =================================================================
    // STEP 6-9 — Play all rounds for Pod 1
    // =================================================================

    const pod1RoundCount = podDetails[0].rounds.length;
    const resultVariants = [
      { p1Wins: 2, p2Wins: 0, draws: 0 },
      { p1Wins: 2, p2Wins: 1, draws: 0 },
      { p1Wins: 1, p2Wins: 2, draws: 0 },
    ];

    for (let rn = 1; rn <= pod1RoundCount; rn++) {
      // Start round via API
      const startRes = await request.post(`${API}/test/start-round/${pod1Id}/${rn}`);
      expect(startRes.status()).toBe(200);

      // Navigate to round page in browser
      await page.goto(`${BASE}/app/pods/${pod1Id}/round/${rn}`);
      await page.waitForLoadState("networkidle");

      await expect(page.locator("h1")).toContainText(`Round ${rn}`);
      await expect(page.locator("text=Matches")).toBeVisible();
      await page.waitForTimeout(2000);

      // Re-fetch pod to get match IDs
      const podRefresh = await aGet(request, coord, `${API}/pods/${pod1Id}`);
      expect(podRefresh.status()).toBe(200);
      const refreshed = await podRefresh.json();

      const thisRound = refreshed.rounds.find((r: any) => r.roundNumber === rn);
      expect(thisRound).toBeTruthy();

      const roundMatches = refreshed.matches.filter(
        (m: any) => m.roundId === thisRound.id,
      );
      expect(roundMatches.length).toBeGreaterThan(0);

      // Report each match with varied results
      for (let mi = 0; mi < roundMatches.length; mi++) {
        const match = roundMatches[mi];
        const result = resultVariants[(rn + mi) % resultVariants.length];
        const reportRes = await aPost(request, coord, `${API}/test/report-as`, {
          matchId: match.id,
          userId: match.player1Id,
          ...result,
        });
        expect(reportRes.status()).toBe(200);
      }

      // Refresh round page to see reported scores
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(2000);

      // Complete round via API
      await request.post(`${API}/test/complete-round/${pod1Id}/${rn}`);

      // After completing, navigate to pod page to see round status
      await page.goto(`${BASE}/app/pods/${pod1Id}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
    }

    // After all rounds, Pod 1 should show standings
    await page.goto(`${BASE}/app/pods/${pod1Id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Standings")).toBeVisible();
    await page.waitForTimeout(3000);

    // =================================================================
    // STEP 10 — Pod 2: same cycle
    // =================================================================

    const pod2Id = podDetails[1].pod.id;
    const pod2RoundCount = podDetails[1].rounds.length;

    await page.goto(`${BASE}/app/pods/${pod2Id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("Pod");
    await expect(page.locator("text=Seats")).toBeVisible();
    await page.waitForTimeout(1500);

    for (let rn = 1; rn <= pod2RoundCount; rn++) {
      // Start round via API
      const startRes = await request.post(`${API}/test/start-round/${pod2Id}/${rn}`);
      expect(startRes.status()).toBe(200);

      // Navigate to round page
      await page.goto(`${BASE}/app/pods/${pod2Id}/round/${rn}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1")).toContainText(`Round ${rn}`);
      await page.waitForTimeout(2000);

      // Fetch matches
      const podRefresh = await aGet(request, coord, `${API}/pods/${pod2Id}`);
      expect(podRefresh.status()).toBe(200);
      const refreshed = await podRefresh.json();

      const thisRound = refreshed.rounds.find((r: any) => r.roundNumber === rn);
      expect(thisRound).toBeTruthy();

      const roundMatches = refreshed.matches.filter(
        (m: any) => m.roundId === thisRound.id,
      );

      // Report results
      for (let mi = 0; mi < roundMatches.length; mi++) {
        const match = roundMatches[mi];
        const result = resultVariants[(rn + mi + 1) % resultVariants.length];
        await aPost(request, coord, `${API}/test/report-as`, {
          matchId: match.id,
          userId: match.player1Id,
          ...result,
        });
      }

      // Refresh to see scores
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1500);

      // Complete round
      await request.post(`${API}/test/complete-round/${pod2Id}/${rn}`);

      // Check pod page
      await page.goto(`${BASE}/app/pods/${pod2Id}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
    }

    // Pod 2 standings
    await page.goto(`${BASE}/app/pods/${pod2Id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Standings")).toBeVisible();
    await page.waitForTimeout(3000);

    // =================================================================
    // STEP 11 — Complete the Friday
    // =================================================================

    const advComplete = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advComplete.status()).toBe(200);
    expect((await advComplete.json()).friday.state.kind).toBe("complete");

    // Navigate to Friday detail and see "complete" state
    await page.goto(`${BASE}/app/fridays/${fridayId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=complete")).toBeVisible();
    await page.waitForTimeout(3000);
  });
});
