import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:37556";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
  name: string;
}

/** Register a user, verify, and return the session cookie + userId. */
async function registerUser(
  request: APIRequestContext,
  name: string,
): Promise<UserHandle> {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const regRes = await request.post(`${API}/api/auth/register`, {
    data: { email, displayName: name, inviteCode: "NLCC2026" },
  });
  expect(regRes.status()).toBe(201);
  const { userId, challengeToken } = await regRes.json();

  const verifyRes = await request.post(`${API}/api/auth/verify`, {
    data: { userId, challenge: challengeToken },
  });
  expect(verifyRes.status()).toBe(200);

  const setCookieHeader = verifyRes.headers()["set-cookie"] ?? "";
  const sessionMatch = setCookieHeader.match(/session=([^;]+)/);
  expect(sessionMatch).toBeTruthy();
  const sessionCookie = sessionMatch![1];

  return { session: sessionCookie, userId, name };
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
// Oversubscribed Friday — full E2E with voting, 2 pods, full tournaments
// ---------------------------------------------------------------------------

test.describe("Oversubscribed Friday (10 players, 3 cubes, IRV, 2 pods)", () => {
  test.setTimeout(120_000);

  test("complete oversubscribed lifecycle with voting, pod packing, and full tournaments", async ({
    request,
  }) => {
    // -------------------------------------------------------------------
    // 1. Register 10 users
    // -------------------------------------------------------------------
    const alice = await registerUser(request, "Host-Alice");
    const bob = await registerUser(request, "Host-Bob");
    const carol = await registerUser(request, "Host-Carol");
    const dave = await registerUser(request, "Player-Dave");
    const eve = await registerUser(request, "Player-Eve");
    const frank = await registerUser(request, "Player-Frank");
    const grace = await registerUser(request, "Player-Grace");
    const hank = await registerUser(request, "Player-Hank");
    const iris = await registerUser(request, "Player-Iris");
    const jack = await registerUser(request, "Player-Jack");

    const allUsers = [alice, bob, carol, dave, eve, frank, grace, hank, iris, jack];

    // -------------------------------------------------------------------
    // 2. Make Alice, Bob, Carol host-capable. Set format preferences.
    // -------------------------------------------------------------------

    // Alice, Dave, Eve, Frank, Grace: prefer swiss_draft, fallback team_draft_3v3
    for (const u of [alice, dave, eve, frank, grace]) {
      const res = await aPatch(request, u, `${API}/api/me`, {
        hostCapable: u === alice,
        preferredFormats: ["swiss_draft"],
        fallbackFormats: ["team_draft_3v3"],
      });
      expect(res.status()).toBe(200);
    }

    // Bob, Hank, Iris, Jack: prefer team_draft_3v3, fallback swiss_draft
    for (const u of [bob, hank, iris, jack]) {
      const res = await aPatch(request, u, `${API}/api/me`, {
        hostCapable: u === bob,
        preferredFormats: ["team_draft_3v3"],
        fallbackFormats: ["swiss_draft"],
      });
      expect(res.status()).toBe(200);
    }

    // Carol: prefers swiss_draft only (no fallback)
    {
      const res = await aPatch(request, carol, `${API}/api/me`, {
        hostCapable: true,
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
      });
      expect(res.status()).toBe(200);
    }

    // -------------------------------------------------------------------
    // 3. Create 3 cubes
    // -------------------------------------------------------------------

    // Alice's Vintage Cube (swiss_draft, preferred 8, min 4, max 8)
    const aliceCubeRes = await aPost(request, alice, `${API}/api/cubes`, {
      name: "Vintage Cube",
      cubecobraUrl: "https://cubecobra.com/cube/vintage",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(aliceCubeRes.status()).toBe(201);
    const aliceCubeId = (await aliceCubeRes.json()).cube.id;

    // Bob's Team Cube (team_draft_3v3, fixed 6)
    const bobCubeRes = await aPost(request, bob, `${API}/api/cubes`, {
      name: "Team Cube",
      cubecobraUrl: "https://cubecobra.com/cube/team",
      supportedFormats: ["team_draft_3v3"],
      preferredPodSize: 6,
      minPodSize: 6,
      maxPodSize: 6,
    });
    expect(bobCubeRes.status()).toBe(201);
    const bobCubeId = (await bobCubeRes.json()).cube.id;

    // Carol's Power Cube (swiss_draft, preferred 8, min 4, max 8)
    const carolCubeRes = await aPost(request, carol, `${API}/api/cubes`, {
      name: "Power Cube",
      cubecobraUrl: "https://cubecobra.com/cube/power",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(carolCubeRes.status()).toBe(201);
    const carolCubeId = (await carolCubeRes.json()).cube.id;

    // -------------------------------------------------------------------
    // 4. Get venue, create Friday, advance to open
    // -------------------------------------------------------------------
    const venuesRes = await aGet(request, alice, `${API}/api/venues`);
    expect(venuesRes.status()).toBe(200);
    const { venues } = await venuesRes.json();
    expect(venues.length).toBeGreaterThan(0);
    const venueId = venues[0].id;

    // Random date to avoid UNIQUE constraint collisions
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
    const year = 2030 + Math.floor(Math.random() * 20);
    const uniqueDate = `${year}-${month}-${day}`;

    const createFridayRes = await aPost(request, alice, `${API}/api/lifecycle/fridays`, {
      date: uniqueDate,
      venueId,
    });
    expect(createFridayRes.status()).toBe(201);
    const { friday: createdFriday } = await createFridayRes.json();
    const fridayId = createdFriday.id;
    expect(createdFriday.state.kind).toBe("scheduled");

    // Advance: scheduled -> open
    const advanceToOpen = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToOpen.status()).toBe(200);
    expect((await advanceToOpen.json()).friday.state.kind).toBe("open");

    // -------------------------------------------------------------------
    // 5. All 10 RSVP in
    // -------------------------------------------------------------------
    for (const user of allUsers) {
      const rsvpRes = await aPost(request, user, `${API}/api/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // Verify RSVPs
    const fridayDetail = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(fridayDetail.status()).toBe(200);
    const detailBody = await fridayDetail.json();
    const activeRsvps = detailBody.rsvps.filter((r: any) => r.state === "in");
    expect(activeRsvps.length).toBe(10);

    // -------------------------------------------------------------------
    // 6. All 3 hosts enroll their cubes
    // -------------------------------------------------------------------
    const aliceEnrollRes = await aPost(
      request, alice,
      `${API}/api/fridays/${fridayId}/enrollments`,
      { cubeId: aliceCubeId },
    );
    expect(aliceEnrollRes.status()).toBe(201);
    const aliceEnrollmentId = (await aliceEnrollRes.json()).enrollment.id;

    const bobEnrollRes = await aPost(
      request, bob,
      `${API}/api/fridays/${fridayId}/enrollments`,
      { cubeId: bobCubeId },
    );
    expect(bobEnrollRes.status()).toBe(201);
    const bobEnrollmentId = (await bobEnrollRes.json()).enrollment.id;

    const carolEnrollRes = await aPost(
      request, carol,
      `${API}/api/fridays/${fridayId}/enrollments`,
      { cubeId: carolCubeId },
    );
    expect(carolEnrollRes.status()).toBe(201);
    const carolEnrollmentId = (await carolEnrollRes.json()).enrollment.id;

    // -------------------------------------------------------------------
    // 7. Advance: open -> enrollment_closed -> vote_open
    //    (>=3 cubes triggers vote)
    // -------------------------------------------------------------------
    const advanceToVoteOpen = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToVoteOpen.status()).toBe(200);
    const voteOpenState = (await advanceToVoteOpen.json()).friday.state;
    expect(voteOpenState.kind).toBe("vote_open");

    // -------------------------------------------------------------------
    // 8. Submit votes (ranked choice)
    //    Alice, Dave, Eve, Frank, Grace: [Alice's cube, Carol's cube, Bob's cube]
    //    Bob, Hank, Iris, Jack: [Bob's cube, Alice's cube, Carol's cube]
    //    Carol: [Carol's cube, Alice's cube, Bob's cube]
    // -------------------------------------------------------------------

    // Group 1: Alice, Dave, Eve, Frank, Grace vote for Alice > Carol > Bob
    for (const u of [alice, dave, eve, frank, grace]) {
      const voteRes = await aPost(
        request, u,
        `${API}/api/fridays/${fridayId}/vote`,
        { ranking: [aliceEnrollmentId, carolEnrollmentId, bobEnrollmentId] },
      );
      expect(voteRes.status()).toBe(200);
    }

    // Group 2: Bob, Hank, Iris, Jack vote for Bob > Alice > Carol
    for (const u of [bob, hank, iris, jack]) {
      const voteRes = await aPost(
        request, u,
        `${API}/api/fridays/${fridayId}/vote`,
        { ranking: [bobEnrollmentId, aliceEnrollmentId, carolEnrollmentId] },
      );
      expect(voteRes.status()).toBe(200);
    }

    // Carol votes for Carol > Alice > Bob
    {
      const voteRes = await aPost(
        request, carol,
        `${API}/api/fridays/${fridayId}/vote`,
        { ranking: [carolEnrollmentId, aliceEnrollmentId, bobEnrollmentId] },
      );
      expect(voteRes.status()).toBe(200);
    }

    // -------------------------------------------------------------------
    // 9. Advance: vote_open -> vote_closed (runs IRV)
    //    Expected: Alice's cube wins (5 first-place), Bob's cube second (4 first-place)
    // -------------------------------------------------------------------
    const advanceToVoteClosed = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToVoteClosed.status()).toBe(200);
    const voteClosedState = (await advanceToVoteClosed.json()).friday.state;
    expect(voteClosedState.kind).toBe("vote_closed");

    // Verify 2 winners
    expect(voteClosedState.winners).toBeDefined();
    expect(voteClosedState.winners.length).toBe(2);

    // Verify Alice's cube won pass 1 (5 first-place votes = majority of 10)
    expect(voteClosedState.winners).toContain(aliceEnrollmentId);
    // Pass 2: After removing Alice, ballots become:
    //   Group 1 (5 voters) first active = Carol, Group 2 (4 voters) first active = Bob,
    //   Carol's ballot first active = Carol.  Carol gets 6 votes, Bob gets 4 => Carol wins.
    expect(voteClosedState.winners).toContain(carolEnrollmentId);

    // -------------------------------------------------------------------
    // 10. Advance: vote_closed -> locked -> confirmed (packs pods)
    // -------------------------------------------------------------------
    const advanceToConfirmed = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToConfirmed.status()).toBe(200);
    const confirmedState = (await advanceToConfirmed.json()).friday.state;
    expect(confirmedState.kind).toBe("confirmed");

    // Verify pods created
    const fridayWithPods = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(fridayWithPods.status()).toBe(200);
    const podsBody = await fridayWithPods.json();
    expect(podsBody.pods.length).toBe(2);

    // Verify pod sizes add up to <= 10
    let totalSeats = 0;
    const podInfos: Array<{ podId: string; seatCount: number; playerIds: string[] }> = [];

    for (const pod of podsBody.pods) {
      const podDetailRes = await aGet(request, alice, `${API}/api/pods/${pod.id}`);
      expect(podDetailRes.status()).toBe(200);
      const podDetail = await podDetailRes.json();
      const seatCount = podDetail.seats.length;
      expect(seatCount).toBeGreaterThanOrEqual(4);
      totalSeats += seatCount;

      const playerIds = podDetail.seats.map((s: any) => s.userId);
      podInfos.push({ podId: pod.id, seatCount, playerIds });
    }
    expect(totalSeats).toBeLessThanOrEqual(10);

    // -------------------------------------------------------------------
    // 11. Advance: confirmed -> in_progress
    // -------------------------------------------------------------------
    const advanceToInProgress = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToInProgress.status()).toBe(200);
    expect((await advanceToInProgress.json()).friday.state.kind).toBe("in_progress");

    // -------------------------------------------------------------------
    // Build a userId -> session map for match reporting
    // -------------------------------------------------------------------
    const sessionByUser: Record<string, string> = {};
    for (const u of allUsers) {
      sessionByUser[u.userId] = u.session;
    }

    // -------------------------------------------------------------------
    // Match result patterns per round (varied, not all 2-1)
    // -------------------------------------------------------------------
    const roundResults = [
      // Round 1: first match 2-0, second match 2-1
      [
        { p1Wins: 2, p2Wins: 0, draws: 0 },
        { p1Wins: 2, p2Wins: 1, draws: 0 },
      ],
      // Round 2: first match 1-2, second match 2-0
      [
        { p1Wins: 1, p2Wins: 2, draws: 0 },
        { p1Wins: 2, p2Wins: 0, draws: 0 },
      ],
      // Round 3: first match 2-1, second match 1-2
      [
        { p1Wins: 2, p2Wins: 1, draws: 0 },
        { p1Wins: 1, p2Wins: 2, draws: 0 },
      ],
    ];

    // -------------------------------------------------------------------
    // 12. For EACH pod: play 3 rounds
    // -------------------------------------------------------------------
    for (const podInfo of podInfos) {
      const { podId } = podInfo;

      for (let roundNum = 1; roundNum <= 3; roundNum++) {
        // Start round -- generates pairings
        const startRes = await aPost(
          request, alice,
          `${API}/api/lifecycle/pods/${podId}/rounds/${roundNum}/start`,
        );
        expect(startRes.status()).toBe(200);
        const startBody = await startRes.json();
        expect(startBody.pairings).toBeTruthy();
        expect(startBody.pairings.length).toBeGreaterThanOrEqual(1);

        // Fetch matches from pod detail
        const podRes = await aGet(request, alice, `${API}/api/pods/${podId}`);
        expect(podRes.status()).toBe(200);
        const pod = await podRes.json();

        const round = pod.rounds.find((r: any) => r.roundNumber === roundNum);
        expect(round).toBeTruthy();
        expect(round.state).toBe("in_progress");

        const roundMatches = pod.matches.filter((m: any) => m.roundId === round.id);
        expect(roundMatches.length).toBeGreaterThanOrEqual(1);

        // Report each match with varied results
        const resultPattern = roundResults[roundNum - 1];
        for (let mi = 0; mi < roundMatches.length; mi++) {
          const match = roundMatches[mi];
          const sess = sessionByUser[match.player1Id];
          expect(sess).toBeTruthy();

          // Use the pattern, cycling if more matches than patterns
          const result = resultPattern[mi % resultPattern.length];

          const resultRes = await request.post(
            `${API}/api/pods/matches/${match.id}/result`,
            {
              headers: { Cookie: `session=${sess}` },
              data: result,
            },
          );
          expect(resultRes.status()).toBe(200);
        }

        // Complete round
        const completeRes = await aPost(
          request, alice,
          `${API}/api/lifecycle/pods/${podId}/rounds/${roundNum}/complete`,
        );
        expect(completeRes.status()).toBe(200);
        expect((await completeRes.json()).round).toBeTruthy();
      }

      // Verify pod state is "complete"
      const podAfterRes = await aGet(request, alice, `${API}/api/pods/${podId}`);
      expect(podAfterRes.status()).toBe(200);
      expect((await podAfterRes.json()).pod.state).toBe("complete");
    }

    // -------------------------------------------------------------------
    // 13. Advance: in_progress -> complete
    // -------------------------------------------------------------------
    const advanceToComplete = await aPost(
      request, alice,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advanceToComplete.status()).toBe(200);
    expect((await advanceToComplete.json()).friday.state.kind).toBe("complete");

    // -------------------------------------------------------------------
    // 14. For each pod, get standings and verify
    // -------------------------------------------------------------------
    for (const podInfo of podInfos) {
      const standingsRes = await aGet(
        request, alice,
        `${API}/api/lifecycle/pods/${podInfo.podId}/standings`,
      );
      expect(standingsRes.status()).toBe(200);
      const { standings } = await standingsRes.json();

      // Verify correct number of players
      expect(standings.length).toBe(podInfo.seatCount);

      // Verify ranks are 1..N with no gaps
      const ranks = standings.map((s: any) => s.rank).sort((a: number, b: number) => a - b);
      const expectedRanks = Array.from({ length: podInfo.seatCount }, (_, i) => i + 1);
      expect(ranks).toEqual(expectedRanks);

      // Verify match points are non-negative
      for (const s of standings) {
        expect(s.matchPoints).toBeGreaterThanOrEqual(0);
      }

      // Verify all seated player IDs are present in standings
      const standingUserIds = new Set(standings.map((s: any) => s.userId));
      expect(standingUserIds.size).toBe(podInfo.seatCount);
      for (const pid of podInfo.playerIds) {
        expect(standingUserIds.has(pid)).toBe(true);
      }
    }

    // -------------------------------------------------------------------
    // 15. Verify friday state is "complete"
    // -------------------------------------------------------------------
    const finalFridayRes = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(finalFridayRes.status()).toBe(200);
    const finalFriday = await finalFridayRes.json();
    expect(finalFriday.friday.state.kind).toBe("complete");
  });
});
