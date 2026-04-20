import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "https://staging.north.cube.london/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
}

/** Sign in as coordinator via test endpoint. */
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

  const signInRes = await request.post(`${API}/test/sign-in-as`, {
    data: { userId: coordinator.id },
  });
  expect(signInRes.status()).toBe(200);
  const signInBody = await signInRes.json();

  return { session: signInBody.sessionId, userId: coordinator.id };
}

/** Sign in as a user via test endpoint. */
async function signInAs(
  request: APIRequestContext,
  userId: string,
): Promise<UserHandle> {
  const signInRes = await request.post(`${API}/test/sign-in-as`, {
    data: { userId },
  });
  expect(signInRes.status()).toBe(200);
  const { sessionId } = await signInRes.json();
  return { session: sessionId, userId };
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

function uniqueDate(): string {
  const year = 2030 + Math.floor(Math.random() * 20);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Team Draft 2v2 — full lifecycle
// ---------------------------------------------------------------------------

test.describe("Team Draft 2v2 (4 players, 2 rounds, Latin square)", () => {
  test.setTimeout(60_000);

  test("complete 2v2 lifecycle: create friday -> pods -> rounds -> standings", async ({
    request,
  }) => {
    // -----------------------------------------------------------------
    // 1. Sign in as coordinator
    // -----------------------------------------------------------------
    const coord = await signInAsCoordinator(request);

    // -----------------------------------------------------------------
    // 2. Get venue
    // -----------------------------------------------------------------
    const venuesRes = await aGet(request, coord, `${API}/venues`);
    expect(venuesRes.status()).toBe(200);
    const { venues } = await venuesRes.json();
    expect(venues.length).toBeGreaterThan(0);
    const venueId = venues[0].id;

    // -----------------------------------------------------------------
    // 3. Create Friday with unique date
    // -----------------------------------------------------------------
    const date = uniqueDate();
    const createFridayRes = await aPost(request, coord, `${API}/lifecycle/fridays`, {
      date,
      venueId,
    });
    expect(createFridayRes.status()).toBe(201);
    const { friday: createdFriday } = await createFridayRes.json();
    const fridayId = createdFriday.id;
    expect(createdFriday.state.kind).toBe("scheduled");

    // -----------------------------------------------------------------
    // 4. Advance: scheduled -> open
    // -----------------------------------------------------------------
    const advOpen = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advOpen.status()).toBe(200);
    expect((await advOpen.json()).friday.state.kind).toBe("open");

    // -----------------------------------------------------------------
    // 5. Create 4 phony users (no auto-RSVP — we'll RSVP properly)
    // -----------------------------------------------------------------
    const phonyRes = await aPost(request, coord, `${API}/test/phony-users`, {
      count: 4,
    });
    expect(phonyRes.status()).toBe(200);
    const { users: phonyUsers } = await phonyRes.json();
    expect(phonyUsers.length).toBe(4);

    // Sign in as each phony user, update profile, and RSVP properly
    const phonyHandles: UserHandle[] = [];
    for (const pu of phonyUsers) {
      const handle = await signInAs(request, pu.id);
      phonyHandles.push(handle);

      // Update profile to accept team_draft_2v2
      const patchRes = await aPatch(request, handle, `${API}/me`, {
        preferredFormats: ["team_draft_2v2"],
        fallbackFormats: ["swiss_draft"],
      });
      expect(patchRes.status()).toBe(200);

      // RSVP via the proper API endpoint (creates valid RSVP state)
      const rsvpRes = await aPost(request, handle, `${API}/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // -----------------------------------------------------------------
    // 6. Make coordinator host-capable, create 2v2 cube, enroll it
    // -----------------------------------------------------------------
    const patchRes = await aPatch(request, coord, `${API}/me`, {
      hostCapable: true,
      preferredFormats: ["team_draft_2v2"],
      fallbackFormats: ["swiss_draft"],
    });
    expect(patchRes.status()).toBe(200);

    const cubeSlug = `test-2v2-${Date.now()}`;
    const createCubeRes = await aPost(request, coord, `${API}/cubes`, {
      name: "2v2 Team Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/${cubeSlug}`,
      supportedFormats: ["team_draft_2v2"],
      preferredPodSize: 4,
      minPodSize: 4,
      maxPodSize: 4,
    });
    expect(createCubeRes.status()).toBe(201);
    const { cube } = await createCubeRes.json();

    const enrollRes = await aPost(
      request, coord,
      `${API}/fridays/${fridayId}/enrollments`,
      { cubeId: cube.id },
    );
    expect(enrollRes.status()).toBe(201);

    // -----------------------------------------------------------------
    // 7. Advance: open -> vote_closed (1 cube, vote skipped)
    // -----------------------------------------------------------------
    const advVoteClosed = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    const advVoteClosedBody = await advVoteClosed.json();
    expect(advVoteClosed.status(), `advance to vote_closed failed: ${JSON.stringify(advVoteClosedBody)}`).toBe(200);
    expect(advVoteClosedBody.friday.state.kind).toBe("vote_closed");

    // -----------------------------------------------------------------
    // 8. Advance: vote_closed -> confirmed (packs pods, auto-confirms)
    // -----------------------------------------------------------------
    const advConfirmed = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    const advConfirmedBody = await advConfirmed.json();
    expect(advConfirmed.status(), `advance to confirmed failed: ${JSON.stringify(advConfirmedBody)}`).toBe(200);
    expect(advConfirmedBody.friday.state.kind).toBe("confirmed");

    // -----------------------------------------------------------------
    // 9. Advance: confirmed -> in_progress
    // -----------------------------------------------------------------
    const advInProgress = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advInProgress.status()).toBe(200);
    expect((await advInProgress.json()).friday.state.kind).toBe("in_progress");

    // -----------------------------------------------------------------
    // 10. Get pod detail — verify format and team assignments
    // -----------------------------------------------------------------
    const fridayDetail = await aGet(request, coord, `${API}/fridays/${fridayId}`);
    expect(fridayDetail.status()).toBe(200);
    const fridayBody = await fridayDetail.json();
    expect(fridayBody.pods.length).toBe(1);
    const podId = fridayBody.pods[0].id;

    const podRes = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podRes.status()).toBe(200);
    const podDetail = await podRes.json();
    expect(podDetail.pod.format).toBe("team_draft_2v2");
    expect(podDetail.seats.length).toBe(4);

    // Verify team assignments: alternating A/B by seat index
    const sortedSeats = [...podDetail.seats].sort(
      (a: any, b: any) => a.seatIndex - b.seatIndex,
    );
    expect(sortedSeats[0].team).toBe("A");
    expect(sortedSeats[1].team).toBe("B");
    expect(sortedSeats[2].team).toBe("A");
    expect(sortedSeats[3].team).toBe("B");

    const teamA = sortedSeats.filter((s: any) => s.team === "A");
    const teamB = sortedSeats.filter((s: any) => s.team === "B");
    expect(teamA.length).toBe(2);
    expect(teamB.length).toBe(2);

    // Verify 2 rounds were created (2v2 has 2 rounds)
    expect(podDetail.rounds.length).toBe(2);

    // -----------------------------------------------------------------
    // 11. Round 1: start, verify pairings (A0-B0, A1-B1)
    // -----------------------------------------------------------------
    const startR1 = await request.post(
      `${API}/test/start-round/${podId}/1`,
    );
    expect(startR1.status()).toBe(200);
    const r1Body = await startR1.json();
    expect(r1Body.pairings).toBeTruthy();
    expect(r1Body.pairings.length).toBe(2);

    // Re-fetch pod to get match details
    const podAfterR1 = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podAfterR1.status()).toBe(200);
    const podR1 = await podAfterR1.json();
    const round1 = podR1.rounds.find((r: any) => r.roundNumber === 1);
    expect(round1).toBeTruthy();
    expect(round1.state).toBe("in_progress");

    const r1Matches = podR1.matches.filter((m: any) => m.roundId === round1.id);
    expect(r1Matches.length).toBe(2);

    // Verify pairings are cross-team
    const teamAIds = new Set(teamA.map((s: any) => s.userId));
    const teamBIds = new Set(teamB.map((s: any) => s.userId));
    for (const match of r1Matches) {
      const p1InA = teamAIds.has(match.player1Id);
      const p1InB = teamBIds.has(match.player1Id);
      const p2InA = teamAIds.has(match.player2Id);
      const p2InB = teamBIds.has(match.player2Id);
      expect((p1InA && p2InB) || (p1InB && p2InA)).toBe(true);
    }

    // Report round 1 results
    for (const match of r1Matches) {
      const reportRes = await aPost(request, coord, `${API}/test/report-as`, {
        matchId: match.id,
        userId: match.player1Id,
        p1Wins: 2,
        p2Wins: 1,
        draws: 0,
      });
      expect(reportRes.status()).toBe(200);
    }

    // Complete round 1
    const completeR1 = await request.post(
      `${API}/test/complete-round/${podId}/1`,
    );
    expect(completeR1.status()).toBe(200);

    // -----------------------------------------------------------------
    // 12. Round 2: start, verify pairings (A0-B1, A1-B0 — swapped)
    // -----------------------------------------------------------------
    const startR2 = await request.post(
      `${API}/test/start-round/${podId}/2`,
    );
    expect(startR2.status()).toBe(200);
    const r2Body = await startR2.json();
    expect(r2Body.pairings).toBeTruthy();
    expect(r2Body.pairings.length).toBe(2);

    // Re-fetch pod
    const podAfterR2 = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podAfterR2.status()).toBe(200);
    const podR2 = await podAfterR2.json();
    const round2 = podR2.rounds.find((r: any) => r.roundNumber === 2);
    expect(round2).toBeTruthy();

    const r2Matches = podR2.matches.filter((m: any) => m.roundId === round2.id);
    expect(r2Matches.length).toBe(2);

    // Verify cross-team and no rematches (Latin-square)
    for (const match of r2Matches) {
      const p1InA = teamAIds.has(match.player1Id);
      const p1InB = teamBIds.has(match.player1Id);
      const p2InA = teamAIds.has(match.player2Id);
      const p2InB = teamBIds.has(match.player2Id);
      expect((p1InA && p2InB) || (p1InB && p2InA)).toBe(true);
    }

    // Verify no rematches between round 1 and round 2
    const r1PairSet = new Set(
      r1Matches.map((m: any) =>
        [m.player1Id, m.player2Id].sort().join("-"),
      ),
    );
    for (const match of r2Matches) {
      const key = [match.player1Id, match.player2Id].sort().join("-");
      expect(r1PairSet.has(key)).toBe(false);
    }

    // Report round 2 results
    for (const match of r2Matches) {
      const reportRes = await aPost(request, coord, `${API}/test/report-as`, {
        matchId: match.id,
        userId: match.player1Id,
        p1Wins: 2,
        p2Wins: 0,
        draws: 0,
      });
      expect(reportRes.status()).toBe(200);
    }

    // Complete round 2
    const completeR2 = await request.post(
      `${API}/test/complete-round/${podId}/2`,
    );
    expect(completeR2.status()).toBe(200);

    // -----------------------------------------------------------------
    // 13. Verify pod is complete (2v2 = 2 rounds total)
    // -----------------------------------------------------------------
    const podFinalRes = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podFinalRes.status()).toBe(200);
    const podFinal = await podFinalRes.json();
    expect(podFinal.pod.state).toBe("complete");

    // -----------------------------------------------------------------
    // 14. Advance friday: in_progress -> complete
    // -----------------------------------------------------------------
    const advComplete = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advComplete.status()).toBe(200);
    expect((await advComplete.json()).friday.state.kind).toBe("complete");

    // -----------------------------------------------------------------
    // 15. Verify standings
    // -----------------------------------------------------------------
    const standingsRes = await aGet(
      request, coord,
      `${API}/lifecycle/pods/${podId}/standings`,
    );
    expect(standingsRes.status()).toBe(200);
    const { standings } = await standingsRes.json();
    expect(standings.length).toBe(4);

    // Ranks 1-4
    const ranks = standings
      .map((s: any) => s.rank)
      .sort((a: number, b: number) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);

    // All 4 player IDs present
    const standingUserIds = new Set(standings.map((s: any) => s.userId));
    expect(standingUserIds.size).toBe(4);
  });
});
