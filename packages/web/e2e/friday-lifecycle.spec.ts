import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:37556";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
}

/** Register a user, verify, and return the session cookie + userId. */
async function registerUser(
  request: APIRequestContext,
  name: string,
): Promise<UserHandle> {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const regRes = await request.post(`${API}/api/auth/register`, {
    data: { email, displayName: name },
  });
  expect(regRes.status()).toBe(201);
  const { userId, challengeToken } = await regRes.json();

  const verifyRes = await request.post(`${API}/api/auth/verify`, {
    data: { userId, challenge: challengeToken },
  });
  expect(verifyRes.status()).toBe(200);

  // Extract session cookie from Set-Cookie header
  const setCookieHeader = verifyRes.headers()["set-cookie"] ?? "";
  const sessionMatch = setCookieHeader.match(/session=([^;]+)/);
  expect(sessionMatch).toBeTruthy();
  const sessionCookie = sessionMatch![1];

  return { session: sessionCookie, userId };
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

// ---------------------------------------------------------------------------
// Full Friday lifecycle — end-to-end
// ---------------------------------------------------------------------------

test.describe("Friday lifecycle (full E2E)", () => {
  test.setTimeout(60_000);

  test("complete lifecycle: scheduled -> open -> vote_closed -> confirmed -> in_progress -> complete", async ({
    request,
  }) => {
    // -----------------------------------------------------------------------
    // 1. Register four users
    // -----------------------------------------------------------------------
    const alice = await registerUser(request, "Alice");
    const bob = await registerUser(request, "Bob");
    const carol = await registerUser(request, "Carol");
    const dave = await registerUser(request, "Dave");

    // -----------------------------------------------------------------------
    // 2. Get venue ID
    // -----------------------------------------------------------------------
    const venuesRes = await aGet(request, alice, `${API}/api/venues`);
    expect(venuesRes.status()).toBe(200);
    const { venues } = await venuesRes.json();
    expect(venues.length).toBeGreaterThan(0);
    const venueId = venues[0].id;

    // -----------------------------------------------------------------------
    // 3. Create a Friday (unique random date to avoid UNIQUE constraint)
    // -----------------------------------------------------------------------
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
    const year = 2030 + Math.floor(Math.random() * 20);
    const uniqueDate = `${year}-${month}-${day}`;

    const createFridayRes = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays`,
      { date: uniqueDate, venueId },
    );
    expect(createFridayRes.status()).toBe(201);
    const { friday: createdFriday } = await createFridayRes.json();
    const fridayId = createdFriday.id;
    expect(createdFriday.state.kind).toBe("scheduled");

    // -----------------------------------------------------------------------
    // 4. Advance: scheduled -> open
    // -----------------------------------------------------------------------
    const advanceToOpen = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToOpen.status()).toBe(200);
    expect((await advanceToOpen.json()).friday.state.kind).toBe("open");

    // -----------------------------------------------------------------------
    // 5. Alice: become host-capable, create cube, enroll it
    // -----------------------------------------------------------------------
    const patchMeRes = await aPatch(
      request, alice,
      `${API}/api/me`,
      { hostCapable: true },
    );
    expect(patchMeRes.status()).toBe(200);

    const createCubeRes = await aPost(
      request, alice,
      `${API}/api/cubes`,
      {
        name: "Alice's Vintage Cube",
        cubecobraUrl: "https://cubecobra.com/cube/alice-vintage",
        supportedFormats: ["swiss_draft"],
        preferredPodSize: 4,
        minPodSize: 4,
        maxPodSize: 8,
      },
    );
    expect(createCubeRes.status()).toBe(201);
    const { cube } = await createCubeRes.json();

    const enrollRes = await aPost(
      request, alice,
      `${API}/api/fridays/${fridayId}/enrollments`,
      { cubeId: cube.id },
    );
    expect(enrollRes.status()).toBe(201);

    // -----------------------------------------------------------------------
    // 6. All four RSVP in
    // -----------------------------------------------------------------------
    for (const user of [alice, bob, carol, dave]) {
      const rsvpRes = await aPost(
        request, user,
        `${API}/api/fridays/${fridayId}/rsvp`,
        { action: "in" },
      );
      expect(rsvpRes.status()).toBe(201);
    }

    // Verify RSVPs
    const fridayDetail = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(fridayDetail.status()).toBe(200);
    const detailBody = await fridayDetail.json();
    const activeRsvps = detailBody.rsvps.filter((r: any) => r.state === "in");
    expect(activeRsvps.length).toBe(4);

    // -----------------------------------------------------------------------
    // 7. Advance: open -> vote_closed (1 cube, vote skipped)
    // -----------------------------------------------------------------------
    const advanceToVoteClosed = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToVoteClosed.status()).toBe(200);
    expect((await advanceToVoteClosed.json()).friday.state.kind).toBe("vote_closed");

    // -----------------------------------------------------------------------
    // 8. Advance: vote_closed -> confirmed (auto-confirmed with 4 players)
    // -----------------------------------------------------------------------
    const advanceToConfirmed = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToConfirmed.status()).toBe(200);
    expect((await advanceToConfirmed.json()).friday.state.kind).toBe("confirmed");

    // -----------------------------------------------------------------------
    // 9. Advance: confirmed -> in_progress
    // -----------------------------------------------------------------------
    const advanceToInProgress = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToInProgress.status()).toBe(200);
    expect((await advanceToInProgress.json()).friday.state.kind).toBe("in_progress");

    // -----------------------------------------------------------------------
    // 10. Get pods — verify 1 pod with 4 seats
    // -----------------------------------------------------------------------
    const fridayWithPods = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(fridayWithPods.status()).toBe(200);
    const podsBody = await fridayWithPods.json();
    expect(podsBody.pods.length).toBe(1);
    const podId = podsBody.pods[0].id;

    const podDetailRes = await aGet(request, alice, `${API}/api/pods/${podId}`);
    expect(podDetailRes.status()).toBe(200);
    const podDetail = await podDetailRes.json();
    expect(podDetail.seats.length).toBe(4);

    // userId -> session for match reporting
    const sessionByUser: Record<string, string> = {
      [alice.userId]: alice.session,
      [bob.userId]: bob.session,
      [carol.userId]: carol.session,
      [dave.userId]: dave.session,
    };

    // -----------------------------------------------------------------------
    // Helper: play one round (start, report, complete)
    // -----------------------------------------------------------------------
    async function playRound(roundNumber: number) {
      // Start round — generates pairings
      const startRes = await aPost(
        request, alice,
        `${API}/api/lifecycle/pods/${podId}/rounds/${roundNumber}/start`,
      );
      expect(startRes.status()).toBe(200);
      const startBody = await startRes.json();
      expect(startBody.pairings).toBeTruthy();
      expect(startBody.pairings.length).toBe(2); // 4 players -> 2 matches

      // Fetch matches from pod detail
      const podRes = await aGet(request, alice, `${API}/api/pods/${podId}`);
      expect(podRes.status()).toBe(200);
      const pod = await podRes.json();

      const round = pod.rounds.find((r: any) => r.roundNumber === roundNumber);
      expect(round).toBeTruthy();
      expect(round.state).toBe("in_progress");

      const roundMatches = pod.matches.filter((m: any) => m.roundId === round.id);
      expect(roundMatches.length).toBe(2);

      // Report each match as player1 with 2-1 result
      for (const match of roundMatches) {
        const sess = sessionByUser[match.player1Id];
        expect(sess).toBeTruthy();

        const resultRes = await request.post(
          `${API}/api/pods/matches/${match.id}/result`,
          {
            headers: { Cookie: `session=${sess}` },
            data: { p1Wins: 2, p2Wins: 1, draws: 0 },
          },
        );
        expect(resultRes.status()).toBe(200);
      }

      // Complete round
      const completeRes = await aPost(
        request, alice,
        `${API}/api/lifecycle/pods/${podId}/rounds/${roundNumber}/complete`,
      );
      expect(completeRes.status()).toBe(200);
      expect((await completeRes.json()).round).toBeTruthy();
    }

    // -----------------------------------------------------------------------
    // 11-13. Round 1, 14. Round 2, 15. Round 3
    // -----------------------------------------------------------------------
    await playRound(1);
    await playRound(2);
    await playRound(3);

    // -----------------------------------------------------------------------
    // 16. Verify pod is complete
    // -----------------------------------------------------------------------
    const podAfterRes = await aGet(request, alice, `${API}/api/pods/${podId}`);
    expect(podAfterRes.status()).toBe(200);
    expect((await podAfterRes.json()).pod.state).toBe("complete");

    // -----------------------------------------------------------------------
    // 17. Advance: in_progress -> complete
    // -----------------------------------------------------------------------
    const advanceToComplete = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToComplete.status()).toBe(200);
    expect((await advanceToComplete.json()).friday.state.kind).toBe("complete");

    // -----------------------------------------------------------------------
    // 18. Get standings — verify 4 players ranked 1-4
    // -----------------------------------------------------------------------
    const standingsRes = await aGet(
      request, alice,
      `${API}/api/lifecycle/pods/${podId}/standings`,
    );
    expect(standingsRes.status()).toBe(200);
    const { standings } = await standingsRes.json();
    expect(standings.length).toBe(4);

    // Verify rankings 1-4
    const ranks = standings.map((s: any) => s.rank).sort();
    expect(ranks).toEqual([1, 2, 3, 4]);

    // Verify all 4 user IDs are present
    const standingUserIds = new Set(standings.map((s: any) => s.userId));
    expect(standingUserIds.size).toBe(4);
    for (const user of [alice, bob, carol, dave]) {
      expect(standingUserIds.has(user.userId)).toBe(true);
    }
  });
});
