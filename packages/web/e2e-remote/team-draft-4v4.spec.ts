import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "https://staging.north.cube.london/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserHandle {
  session: string;
  userId: string;
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

  const signInRes = await request.post(`${API}/test/sign-in-as`, {
    data: { userId: coordinator.id },
  });
  expect(signInRes.status()).toBe(200);
  const signInBody = await signInRes.json();

  return { session: signInBody.sessionId, userId: coordinator.id };
}

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
// Team Draft 4v4 — full lifecycle
// ---------------------------------------------------------------------------

test.describe("Team Draft 4v4 (8 players, 3 rounds, Swiss cross-team)", () => {
  test.setTimeout(60_000);

  test("complete 4v4 lifecycle: create friday -> pods -> rounds -> standings", async ({
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
    // 3. Create Friday
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
    // 5. Create 8 phony users, update profiles, RSVP properly
    // -----------------------------------------------------------------
    const phonyRes = await aPost(request, coord, `${API}/test/phony-users`, {
      count: 8,
    });
    expect(phonyRes.status()).toBe(200);
    const { users: phonyUsers } = await phonyRes.json();
    expect(phonyUsers.length).toBe(8);

    const phonyHandles: UserHandle[] = [];
    for (const pu of phonyUsers) {
      const handle = await signInAs(request, pu.id);
      phonyHandles.push(handle);

      const patchRes = await aPatch(request, handle, `${API}/me`, {
        preferredFormats: ["team_draft_4v4"],
        fallbackFormats: ["swiss_draft"],
      });
      expect(patchRes.status()).toBe(200);

      const rsvpRes = await aPost(request, handle, `${API}/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // -----------------------------------------------------------------
    // 6. Create 4v4 cube, enroll it
    // -----------------------------------------------------------------
    const patchRes = await aPatch(request, coord, `${API}/me`, {
      hostCapable: true,
      preferredFormats: ["team_draft_4v4"],
      fallbackFormats: ["swiss_draft"],
    });
    expect(patchRes.status()).toBe(200);

    const cubeSlug = `test-4v4-${Date.now()}`;
    const createCubeRes = await aPost(request, coord, `${API}/cubes`, {
      name: "4v4 Team Cube",
      cubecobraUrl: `https://cubecobra.com/cube/overview/${cubeSlug}`,
      supportedFormats: ["team_draft_4v4"],
      preferredPodSize: 8,
      minPodSize: 8,
      maxPodSize: 8,
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
    // 7. Advance: open -> vote_closed
    // -----------------------------------------------------------------
    const advVoteClosed = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    const advVoteClosedBody = await advVoteClosed.json();
    expect(advVoteClosed.status(), `advance to vote_closed failed: ${JSON.stringify(advVoteClosedBody)}`).toBe(200);
    expect(advVoteClosedBody.friday.state.kind).toBe("vote_closed");

    // -----------------------------------------------------------------
    // 8. Advance: vote_closed -> confirmed
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
    // 10. Get pod — verify format and teams
    // -----------------------------------------------------------------
    const fridayDetail = await aGet(request, coord, `${API}/fridays/${fridayId}`);
    expect(fridayDetail.status()).toBe(200);
    const fridayBody = await fridayDetail.json();
    expect(fridayBody.pods.length).toBe(1);
    const podId = fridayBody.pods[0].id;

    const podRes = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podRes.status()).toBe(200);
    const podDetail = await podRes.json();
    expect(podDetail.pod.format).toBe("team_draft_4v4");
    expect(podDetail.seats.length).toBe(8);

    // Verify team assignments: even seats = A, odd seats = B
    const sortedSeats = [...podDetail.seats].sort(
      (a: any, b: any) => a.seatIndex - b.seatIndex,
    );
    for (let i = 0; i < 8; i++) {
      expect(sortedSeats[i].team).toBe(i % 2 === 0 ? "A" : "B");
    }

    const teamA = sortedSeats.filter((s: any) => s.team === "A");
    const teamB = sortedSeats.filter((s: any) => s.team === "B");
    expect(teamA.length).toBe(4);
    expect(teamB.length).toBe(4);

    // Verify 3 rounds created
    expect(podDetail.rounds.length).toBe(3);

    const teamAIds = new Set(teamA.map((s: any) => s.userId));
    const teamBIds = new Set(teamB.map((s: any) => s.userId));

    // Track all pairings across rounds
    const allPairKeys = new Set<string>();

    // -----------------------------------------------------------------
    // 11-13. Play 3 rounds
    // -----------------------------------------------------------------
    for (let roundNum = 1; roundNum <= 3; roundNum++) {
      const startRes = await request.post(
        `${API}/test/start-round/${podId}/${roundNum}`,
      );
      const startBody = await startRes.json();
      expect(startRes.status(), `start round ${roundNum} failed: ${JSON.stringify(startBody)}`).toBe(200);
      expect(startBody.pairings, `round ${roundNum} pairings missing: ${JSON.stringify(startBody)}`).toBeTruthy();
      expect(startBody.pairings.length).toBe(4); // 4v4 = 4 matches per round

      // Fetch pod
      const podRoundRes = await aGet(request, coord, `${API}/pods/${podId}`);
      expect(podRoundRes.status()).toBe(200);
      const podRound = await podRoundRes.json();

      const round = podRound.rounds.find((r: any) => r.roundNumber === roundNum);
      expect(round).toBeTruthy();
      expect(round.state).toBe("in_progress");

      const roundMatches = podRound.matches.filter(
        (m: any) => m.roundId === round.id,
      );
      expect(roundMatches.length).toBe(4);

      // Verify all pairings are cross-team
      for (const match of roundMatches) {
        const p1InA = teamAIds.has(match.player1Id);
        const p1InB = teamBIds.has(match.player1Id);
        const p2InA = teamAIds.has(match.player2Id);
        const p2InB = teamBIds.has(match.player2Id);
        expect((p1InA && p2InB) || (p1InB && p2InA)).toBe(true);

        const key = [match.player1Id, match.player2Id].sort().join("-");
        allPairKeys.add(key);
      }

      // Report results (varied patterns per round)
      const resultPatterns = [
        { p1Wins: 2, p2Wins: 1, draws: 0 },
        { p1Wins: 1, p2Wins: 2, draws: 0 },
        { p1Wins: 2, p2Wins: 0, draws: 0 },
        { p1Wins: 0, p2Wins: 2, draws: 0 },
      ];

      for (let mi = 0; mi < roundMatches.length; mi++) {
        const match = roundMatches[mi];
        const result = resultPatterns[mi % resultPatterns.length];
        const reportRes = await aPost(request, coord, `${API}/test/report-as`, {
          matchId: match.id,
          userId: match.player1Id,
          ...result,
        });
        expect(reportRes.status()).toBe(200);
      }

      // Complete round
      const completeRes = await request.post(
        `${API}/test/complete-round/${podId}/${roundNum}`,
      );
      expect(completeRes.status()).toBe(200);
    }

    // 4v4, 3 rounds, 4 matches each = 12 total matches
    // Swiss cross-team avoids rematches, so expect 12 unique pairings
    expect(allPairKeys.size).toBe(12);

    // -----------------------------------------------------------------
    // 14. Verify pod is complete
    // -----------------------------------------------------------------
    const podFinalRes = await aGet(request, coord, `${API}/pods/${podId}`);
    expect(podFinalRes.status()).toBe(200);
    expect((await podFinalRes.json()).pod.state).toBe("complete");

    // -----------------------------------------------------------------
    // 15. Advance friday: in_progress -> complete
    // -----------------------------------------------------------------
    const advComplete = await aPost(
      request, coord,
      `${API}/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(advComplete.status()).toBe(200);
    expect((await advComplete.json()).friday.state.kind).toBe("complete");

    // -----------------------------------------------------------------
    // 16. Verify standings
    // -----------------------------------------------------------------
    const standingsRes = await aGet(
      request, coord,
      `${API}/lifecycle/pods/${podId}/standings`,
    );
    expect(standingsRes.status()).toBe(200);
    const { standings } = await standingsRes.json();
    expect(standings.length).toBe(8);

    const ranks = standings
      .map((s: any) => s.rank)
      .sort((a: number, b: number) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const standingUserIds = new Set(standings.map((s: any) => s.userId));
    expect(standingUserIds.size).toBe(8);
  });
});
