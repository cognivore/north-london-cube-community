import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "https://staging.north.cube.london/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
}

/** Sign in as a user via test endpoint. Returns session handle. */
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

/** Sign in as the coordinator (jm@memorici.de). */
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

/** Authenticated GET. */
function aGet(req: APIRequestContext, u: UserHandle, url: string) {
  return req.get(url, { headers: { Cookie: `session=${u.session}` } });
}

/** Authenticated POST. */
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

/** Authenticated PATCH. */
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
  // Pick a random year/month, then find the first Friday in that month
  const year = 2030 + Math.floor(Math.random() * 20);
  const month = Math.floor(Math.random() * 12); // 0-11
  // Find first Friday of this month, then offset by a random week
  const d = new Date(year, month, 1);
  // Advance to first Friday (day 5)
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  // Add 0-3 weeks
  d.setDate(d.getDate() + 7 * Math.floor(Math.random() * 4));
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Test: 2 pods, 2 cubes, 10 players
// ---------------------------------------------------------------------------

test.describe("Two pods, two cubes, 10 players — full Friday lifecycle", () => {
  test.setTimeout(120_000);

  test("create friday, enroll 2 cubes, RSVP 10, pack 2 pods, play all rounds, complete", async ({
    request,
  }) => {
    // ---------------------------------------------------------------
    // 1. Sign in as coordinator
    // ---------------------------------------------------------------
    const coord = await signInAsCoordinator(request);

    // ---------------------------------------------------------------
    // 2. Get venue
    // ---------------------------------------------------------------
    const venuesRes = await aGet(request, coord, `${API}/venues`);
    expect(venuesRes.status()).toBe(200);
    const { venues } = await venuesRes.json();
    expect(venues.length).toBeGreaterThan(0);
    const venueId = venues[0].id;

    // ---------------------------------------------------------------
    // 3. Create Friday (random date that is actually a Friday)
    // ---------------------------------------------------------------
    const date = randomFriday();
    const createFridayRes = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays`,
      { date, venueId },
    );
    expect(createFridayRes.status()).toBe(201);
    const { friday: createdFriday } = await createFridayRes.json();
    const fridayId = createdFriday.id;
    expect(createdFriday.state.kind).toBe("scheduled");

    // ---------------------------------------------------------------
    // 4. Advance: scheduled -> open
    // ---------------------------------------------------------------
    const advOpen = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advOpen.status()).toBe(200);
    expect((await advOpen.json()).friday.state.kind).toBe("open");

    // ---------------------------------------------------------------
    // 5. Create 10 phony users (no auto-RSVP; we RSVP them properly)
    // ---------------------------------------------------------------
    const phonyRes = await aPost(request, coord, `${API}/test/phony-users`, {
      count: 10,
    });
    expect(phonyRes.status()).toBe(200);
    const { users: phonyUsers } = await phonyRes.json();
    expect(phonyUsers.length).toBe(10);

    // ---------------------------------------------------------------
    // 6. Make coordinator host-capable, create Cube A (Vintage Cube)
    // ---------------------------------------------------------------
    const patchCoord = await aPatch(request, coord, `${API}/me`, {
      hostCapable: true,
    });
    expect(patchCoord.status()).toBe(200);

    const cubeARes = await aPost(request, coord, `${API}/cubes`, {
      name: "Vintage Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/vintage-test-${Date.now()}`,
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cubeARes.status()).toBe(201);
    const cubeA = (await cubeARes.json()).cube;

    // ---------------------------------------------------------------
    // 7. Sign in as first phony user, make host-capable, create Cube B
    // ---------------------------------------------------------------
    const host2 = await signInAs(request, phonyUsers[0].id);

    const patchHost2 = await aPatch(request, host2, `${API}/me`, {
      hostCapable: true,
    });
    expect(patchHost2.status()).toBe(200);

    const cubeBRes = await aPost(request, host2, `${API}/cubes`, {
      name: "Legacy Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/legacy-test-${Date.now()}`,
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 6,
      minPodSize: 4,
      maxPodSize: 6,
    });
    expect(cubeBRes.status()).toBe(201);
    const cubeB = (await cubeBRes.json()).cube;

    // ---------------------------------------------------------------
    // 8. RSVP all 10 phony users + coordinator via the proper API
    // ---------------------------------------------------------------
    // Coordinator RSVPs first
    const coordRsvp = await aPost(
      request,
      coord,
      `${API}/fridays/${fridayId}/rsvp`,
      { action: "in" },
    );
    expect([201, 409]).toContain(coordRsvp.status());

    // RSVP each phony user
    for (const pu of phonyUsers) {
      const handle = await signInAs(request, pu.id);
      const rsvpRes = await aPost(
        request,
        handle,
        `${API}/fridays/${fridayId}/rsvp`,
        { action: "in" },
      );
      expect([201, 409]).toContain(rsvpRes.status());
    }

    // ---------------------------------------------------------------
    // 9. Enroll both cubes
    // ---------------------------------------------------------------
    const enrollARes = await aPost(
      request,
      coord,
      `${API}/fridays/${fridayId}/enrollments`,
      { cubeId: cubeA.id },
    );
    expect(enrollARes.status()).toBe(201);

    const enrollBRes = await aPost(
      request,
      host2,
      `${API}/fridays/${fridayId}/enrollments`,
      { cubeId: cubeB.id },
    );
    expect(enrollBRes.status()).toBe(201);

    // ---------------------------------------------------------------
    // 10. Advance: open -> vote_closed (<=2 cubes => vote skipped)
    // ---------------------------------------------------------------
    const advVoteClosed = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advVoteClosed.status()).toBe(200);
    const vcState = (await advVoteClosed.json()).friday.state.kind;
    expect(vcState).toBe("vote_closed");

    // ---------------------------------------------------------------
    // 11. Advance: vote_closed -> confirmed (pod packer runs)
    // ---------------------------------------------------------------
    const advConfirmed = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advConfirmed.status()).toBe(200);
    const confirmedBody = await advConfirmed.json();
    expect(confirmedBody.friday.state.kind).toBe("confirmed");

    // ---------------------------------------------------------------
    // 12. Verify 2 pods, sizes add up
    // ---------------------------------------------------------------
    const fridayDetail = await aGet(
      request,
      coord,
      `${API}/fridays/${fridayId}`,
    );
    expect(fridayDetail.status()).toBe(200);
    const fridayBody = await fridayDetail.json();
    expect(fridayBody.pods.length).toBe(2);

    const podIds: string[] = fridayBody.pods.map((p: any) => p.id);

    // Fetch each pod and verify seats
    const podDetails: any[] = [];
    let totalSeated = 0;
    for (const podId of podIds) {
      const podRes = await aGet(request, coord, `${API}/pods/${podId}`);
      expect(podRes.status()).toBe(200);
      const detail = await podRes.json();
      podDetails.push(detail);
      totalSeated += detail.seats.length;
    }

    // With 10 phony users + 1 coordinator = 11 RSVPs, pod packer should
    // seat 10 (the max across both cubes: 4+6 or 6+4 or 8+... etc)
    // At minimum we expect >= 8 seated across 2 pods
    expect(totalSeated).toBeGreaterThanOrEqual(8);
    expect(totalSeated).toBeLessThanOrEqual(14); // upper bound sanity

    // ---------------------------------------------------------------
    // 13. Advance: confirmed -> in_progress
    // ---------------------------------------------------------------
    const advInProgress = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advInProgress.status()).toBe(200);
    expect((await advInProgress.json()).friday.state.kind).toBe("in_progress");

    // ---------------------------------------------------------------
    // 14. Play all rounds in each pod
    // ---------------------------------------------------------------
    for (let pi = 0; pi < podDetails.length; pi++) {
      const pod = podDetails[pi];
      const podId = pod.pod.id;
      const roundCount = pod.rounds.length;

      expect(roundCount).toBeGreaterThanOrEqual(2);
      expect(roundCount).toBeLessThanOrEqual(3);

      for (let rn = 1; rn <= roundCount; rn++) {
        // Start round
        const startRes = await request.post(
          `${API}/test/start-round/${podId}/${rn}`,
        );
        expect(startRes.status()).toBe(200);
        const startBody = await startRes.json();
        expect(startBody.pairings).toBeTruthy();
        expect(startBody.pairings.length).toBeGreaterThan(0);

        // Re-fetch pod to get match objects with IDs
        const podRefresh = await aGet(
          request,
          coord,
          `${API}/pods/${podId}`,
        );
        expect(podRefresh.status()).toBe(200);
        const refreshed = await podRefresh.json();

        const thisRound = refreshed.rounds.find(
          (r: any) => r.roundNumber === rn,
        );
        expect(thisRound).toBeTruthy();
        expect(thisRound.state).toBe("in_progress");

        const roundMatches = refreshed.matches.filter(
          (m: any) => m.roundId === thisRound.id,
        );
        expect(roundMatches.length).toBeGreaterThan(0);

        // Report each match
        for (const match of roundMatches) {
          const reportRes = await aPost(
            request,
            coord,
            `${API}/test/report-as`,
            {
              matchId: match.id,
              userId: match.player1Id,
              p1Wins: 2,
              p2Wins: 1,
              draws: 0,
            },
          );
          expect(reportRes.status()).toBe(200);
        }

        // Complete round
        const completeRes = await request.post(
          `${API}/test/complete-round/${podId}/${rn}`,
        );
        expect(completeRes.status()).toBe(200);
      }

      // Verify pod is complete after all rounds
      const podFinalRes = await aGet(
        request,
        coord,
        `${API}/pods/${podId}`,
      );
      expect(podFinalRes.status()).toBe(200);
      const podFinal = await podFinalRes.json();
      expect(podFinal.pod.state).toBe("complete");
    }

    // ---------------------------------------------------------------
    // 15. Advance: in_progress -> complete
    // ---------------------------------------------------------------
    const advComplete = await aPost(
      request,
      coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advComplete.status()).toBe(200);
    expect((await advComplete.json()).friday.state.kind).toBe("complete");

    // ---------------------------------------------------------------
    // 16. Verify standings for each pod
    // ---------------------------------------------------------------
    for (let pi = 0; pi < podDetails.length; pi++) {
      const podId = podDetails[pi].pod.id;
      const seatCount = podDetails[pi].seats.length;

      const standingsRes = await aGet(
        request,
        coord,
        `${API}/lifecycle/pods/${podId}/standings`,
      );
      expect(standingsRes.status()).toBe(200);
      const { standings } = await standingsRes.json();
      expect(standings.length).toBe(seatCount);

      // All players have a rank
      for (const s of standings) {
        expect(s.rank).toBeGreaterThanOrEqual(1);
        expect(s.rank).toBeLessThanOrEqual(seatCount);
        expect(s.userId).toBeTruthy();
      }

      // All seat user IDs appear in standings
      const standingUserIds = new Set(standings.map((s: any) => s.userId));
      expect(standingUserIds.size).toBe(seatCount);
    }

    // ---------------------------------------------------------------
    // 17. Final check: Friday is complete
    // ---------------------------------------------------------------
    const finalFridayRes = await aGet(
      request,
      coord,
      `${API}/fridays/${fridayId}`,
    );
    expect(finalFridayRes.status()).toBe(200);
    const finalFriday = await finalFridayRes.json();
    expect(finalFriday.friday.state.kind).toBe("complete");
  });
});
