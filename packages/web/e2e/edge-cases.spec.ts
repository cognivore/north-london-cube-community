import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:37556";

// ---------------------------------------------------------------------------
// Helpers (same patterns as oversubscribed-friday.spec.ts)
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
    data: { email, displayName: name },
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

/** Generate a unique random date to avoid UNIQUE constraint collisions. */
function uniqueDate(): string {
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const year = 2030 + Math.floor(Math.random() * 20);
  return `${year}-${month}-${day}`;
}

/** Get the first venue ID. */
async function getVenueId(request: APIRequestContext, user: UserHandle): Promise<string> {
  const venuesRes = await aGet(request, user, `${API}/api/venues`);
  expect(venuesRes.status()).toBe(200);
  const { venues } = await venuesRes.json();
  expect(venues.length).toBeGreaterThan(0);
  return venues[0].id;
}

/** Create a Friday in scheduled state and return its ID. */
async function createFriday(
  request: APIRequestContext,
  user: UserHandle,
  venueId: string,
): Promise<string> {
  const createRes = await aPost(request, user, `${API}/api/lifecycle/fridays`, {
    date: uniqueDate(),
    venueId,
  });
  expect(createRes.status()).toBe(201);
  const { friday } = await createRes.json();
  expect(friday.state.kind).toBe("scheduled");
  return friday.id;
}

/** Advance a Friday and return the resulting state kind. */
async function advanceFriday(
  request: APIRequestContext,
  user: UserHandle,
  fridayId: string,
): Promise<{ stateKind: string; state: any; friday: any }> {
  const res = await aPost(
    request,
    user,
    `${API}/api/lifecycle/fridays/${fridayId}/advance`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  return {
    stateKind: body.friday.state.kind,
    state: body.friday.state,
    friday: body.friday,
  };
}

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

test.describe("Edge cases", () => {
  test.setTimeout(120_000);

  // =========================================================================
  // 1. Exactly 4 players, 1 cube -- minimum viable Friday
  // =========================================================================
  test("exactly 4 players, 1 cube -- minimum viable Friday", async ({
    request,
  }) => {
    // Register 4 users; first is host
    const host = await registerUser(request, "MinHost");
    const p2 = await registerUser(request, "MinP2");
    const p3 = await registerUser(request, "MinP3");
    const p4 = await registerUser(request, "MinP4");
    const allUsers = [host, p2, p3, p4];

    // Make host capable, set format prefs for all
    for (const u of allUsers) {
      await aPatch(request, u, `${API}/api/me`, {
        hostCapable: u === host,
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
      });
    }

    // Create 1 cube (swiss_draft, min 4, max 8)
    const cubeRes = await aPost(request, host, `${API}/api/cubes`, {
      name: "Tiny Cube",
      cubecobraUrl: "https://cubecobra.com/cube/tiny",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 4,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cubeRes.status()).toBe(201);
    const cubeId = (await cubeRes.json()).cube.id;

    // Create Friday, advance to open
    const venueId = await getVenueId(request, host);
    const fridayId = await createFriday(request, host, venueId);
    const { stateKind: openKind } = await advanceFriday(request, host, fridayId);
    expect(openKind).toBe("open");

    // All 4 RSVP
    for (const u of allUsers) {
      const rsvpRes = await aPost(request, u, `${API}/api/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // Host enrolls cube
    const enrollRes = await aPost(request, host, `${API}/api/fridays/${fridayId}/enrollments`, {
      cubeId,
    });
    expect(enrollRes.status()).toBe(201);

    // Advance: open -> vote_closed (1 enrollment < 3, vote skipped)
    const { stateKind: afterAdvance } = await advanceFriday(request, host, fridayId);
    expect(afterAdvance).toBe("vote_closed");

    // Advance: vote_closed -> confirmed (pod packing + auto-confirm)
    const { stateKind: confirmedKind } = await advanceFriday(request, host, fridayId);
    expect(confirmedKind).toBe("confirmed");

    // Verify 1 pod with 4 seats
    const detailRes = await aGet(request, host, `${API}/api/fridays/${fridayId}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.pods.length).toBe(1);

    const podDetailRes = await aGet(request, host, `${API}/api/pods/${detail.pods[0].id}`);
    expect(podDetailRes.status()).toBe(200);
    const podDetail = await podDetailRes.json();
    expect(podDetail.seats.length).toBe(4);

    // Advance: confirmed -> in_progress
    const { stateKind: inProgressKind } = await advanceFriday(request, host, fridayId);
    expect(inProgressKind).toBe("in_progress");

    // Play 3 rounds
    const podId = detail.pods[0].id;
    for (let roundNum = 1; roundNum <= 3; roundNum++) {
      const startRes = await aPost(
        request,
        host,
        `${API}/api/lifecycle/pods/${podId}/rounds/${roundNum}/start`,
      );
      expect(startRes.status()).toBe(200);

      // Get matches
      const podRes = await aGet(request, host, `${API}/api/pods/${podId}`);
      expect(podRes.status()).toBe(200);
      const pod = await podRes.json();
      const round = pod.rounds.find((r: any) => r.roundNumber === roundNum);
      expect(round).toBeTruthy();
      const matches = pod.matches.filter((m: any) => m.roundId === round.id);

      // Report results
      for (const match of matches) {
        const sess = allUsers.find(u => u.userId === match.player1Id)?.session;
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
        request,
        host,
        `${API}/api/lifecycle/pods/${podId}/rounds/${roundNum}/complete`,
      );
      expect(completeRes.status()).toBe(200);
    }

    // Pod should be complete
    const podAfterRes = await aGet(request, host, `${API}/api/pods/${podId}`);
    expect(podAfterRes.status()).toBe(200);
    expect((await podAfterRes.json()).pod.state).toBe("complete");

    // Advance: in_progress -> complete
    const { stateKind: completeKind } = await advanceFriday(request, host, fridayId);
    expect(completeKind).toBe("complete");

    // Verify standings
    const standingsRes = await aGet(
      request,
      host,
      `${API}/api/lifecycle/pods/${podId}/standings`,
    );
    expect(standingsRes.status()).toBe(200);
    const { standings } = await standingsRes.json();
    expect(standings.length).toBe(4);
    const ranks = standings.map((s: any) => s.rank).sort((a: number, b: number) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  // =========================================================================
  // 2. Friday cancelled: no cubes -- 5 RSVPs, 0 enrollments
  // =========================================================================
  test("friday cancelled when no cubes enrolled", async ({ request }) => {
    const alice = await registerUser(request, "NoCube-Alice");
    const bob = await registerUser(request, "NoCube-Bob");
    const carol = await registerUser(request, "NoCube-Carol");
    const dave = await registerUser(request, "NoCube-Dave");
    const eve = await registerUser(request, "NoCube-Eve");

    // Set preferences
    for (const u of [alice, bob, carol, dave, eve]) {
      await aPatch(request, u, `${API}/api/me`, {
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
      });
    }

    // Create Friday, advance to open
    const venueId = await getVenueId(request, alice);
    const fridayId = await createFriday(request, alice, venueId);
    await advanceFriday(request, alice, fridayId); // -> open

    // All 5 RSVP
    for (const u of [alice, bob, carol, dave, eve]) {
      const rsvpRes = await aPost(request, u, `${API}/api/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // No enrollments -- advance from open
    // This should: open -> enrollment_closed -> cancelled (no cubes)
    const { stateKind } = await advanceFriday(request, alice, fridayId);
    expect(stateKind).toBe("cancelled");

    // Verify via detail
    const detailRes = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.friday.state.kind).toBe("cancelled");
  });

  // =========================================================================
  // 3. Friday cancelled: insufficient RSVPs -- 1 RSVP, 1 cube
  //    Pod min size is 4, but only 1 RSVP. Pack should fail.
  // =========================================================================
  test("friday fails to pack pods when insufficient RSVPs", async ({
    request,
  }) => {
    const host = await registerUser(request, "InsufficientHost");

    await aPatch(request, host, `${API}/api/me`, {
      hostCapable: true,
      preferredFormats: ["swiss_draft"],
      fallbackFormats: [],
    });

    // Create cube with min 4
    const cubeRes = await aPost(request, host, `${API}/api/cubes`, {
      name: "Insufficient Cube",
      cubecobraUrl: "https://cubecobra.com/cube/insuf",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 8,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cubeRes.status()).toBe(201);
    const cubeId = (await cubeRes.json()).cube.id;

    // Create Friday, advance to open
    const venueId = await getVenueId(request, host);
    const fridayId = await createFriday(request, host, venueId);
    await advanceFriday(request, host, fridayId); // -> open

    // Only 1 RSVP
    const rsvpRes = await aPost(request, host, `${API}/api/fridays/${fridayId}/rsvp`, {
      action: "in",
    });
    expect(rsvpRes.status()).toBe(201);

    // Enroll cube
    const enrollRes = await aPost(
      request,
      host,
      `${API}/api/fridays/${fridayId}/enrollments`,
      { cubeId },
    );
    expect(enrollRes.status()).toBe(201);

    // Advance: open -> vote_closed (1 enrollment, vote skipped)
    const { stateKind: afterAdvance } = await advanceFriday(request, host, fridayId);
    expect(afterAdvance).toBe("vote_closed");

    // Advance: vote_closed -> should fail because pack cannot form a pod
    // with only 1 player and min pod size 4.
    // The server returns 500 on pack failure.
    const failRes = await aPost(
      request,
      host,
      `${API}/api/lifecycle/fridays/${fridayId}/advance`,
    );
    expect(failRes.status()).toBe(500);

    // Friday should still be in vote_closed state
    const detailRes = await aGet(request, host, `${API}/api/fridays/${fridayId}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.friday.state.kind).toBe("vote_closed");
  });

  // =========================================================================
  // 4. RSVP then cancel -- user RSVPs in then out, not counted as active
  // =========================================================================
  test("RSVP then cancel removes user from active RSVPs", async ({
    request,
  }) => {
    const alice = await registerUser(request, "CancelRsvp-Alice");
    const bob = await registerUser(request, "CancelRsvp-Bob");

    for (const u of [alice, bob]) {
      await aPatch(request, u, `${API}/api/me`, {
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
      });
    }

    const venueId = await getVenueId(request, alice);
    const fridayId = await createFriday(request, alice, venueId);
    await advanceFriday(request, alice, fridayId); // -> open

    // Both RSVP in
    for (const u of [alice, bob]) {
      const rsvpRes = await aPost(request, u, `${API}/api/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // Verify 2 active
    let detailRes = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    let detail = await detailRes.json();
    let activeRsvps = detail.rsvps.filter((r: any) => r.state === "in");
    expect(activeRsvps.length).toBe(2);

    // Bob cancels
    const cancelRes = await aPost(request, bob, `${API}/api/fridays/${fridayId}/rsvp`, {
      action: "out",
    });
    expect(cancelRes.status()).toBe(200);

    // Verify only 1 active RSVP
    detailRes = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    detail = await detailRes.json();
    activeRsvps = detail.rsvps.filter((r: any) => r.state === "in");
    expect(activeRsvps.length).toBe(1);
    expect(activeRsvps[0].userId).toBe(alice.userId);

    // Verify Bob's RSVP shows cancelled_by_user
    const bobRsvp = detail.rsvps.find((r: any) => r.userId === bob.userId);
    expect(bobRsvp).toBeTruthy();
    expect(bobRsvp.state).toBe("cancelled_by_user");
  });

  // =========================================================================
  // 5. Admin cancel -- POST /api/admin/fridays/:id/force-state
  //    Non-admin user gets 403. Verifies the admin middleware guards the endpoint.
  // =========================================================================
  test("admin cancel endpoint rejects non-admin users with 403", async ({
    request,
  }) => {
    const alice = await registerUser(request, "AdminTest-Alice");

    const venueId = await getVenueId(request, alice);
    const fridayId = await createFriday(request, alice, venueId);
    await advanceFriday(request, alice, fridayId); // -> open

    // Non-admin tries to force-cancel
    const cancelRes = await aPost(
      request,
      alice,
      `${API}/api/admin/fridays/${fridayId}/force-state`,
      { reason: "Testing admin cancel" },
    );
    expect(cancelRes.status()).toBe(403);

    // Friday should still be open
    const detailRes = await aGet(request, alice, `${API}/api/fridays/${fridayId}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.friday.state.kind).toBe("open");
  });

  // =========================================================================
  // 6. 2 cubes, no vote needed -- advance should skip vote, go to vote_closed
  // =========================================================================
  test("2 cubes skip vote and go directly to vote_closed", async ({
    request,
  }) => {
    // Register 8 users; 2 are hosts
    const host1 = await registerUser(request, "TwoCube-Host1");
    const host2 = await registerUser(request, "TwoCube-Host2");
    const p3 = await registerUser(request, "TwoCube-P3");
    const p4 = await registerUser(request, "TwoCube-P4");
    const p5 = await registerUser(request, "TwoCube-P5");
    const p6 = await registerUser(request, "TwoCube-P6");
    const p7 = await registerUser(request, "TwoCube-P7");
    const p8 = await registerUser(request, "TwoCube-P8");
    const allUsers = [host1, host2, p3, p4, p5, p6, p7, p8];

    // Set format prefs
    for (const u of allUsers) {
      await aPatch(request, u, `${API}/api/me`, {
        hostCapable: u === host1 || u === host2,
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
      });
    }

    // Create 2 cubes
    const cube1Res = await aPost(request, host1, `${API}/api/cubes`, {
      name: "Cube Alpha",
      cubecobraUrl: "https://cubecobra.com/cube/alpha",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 4,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cube1Res.status()).toBe(201);
    const cube1Id = (await cube1Res.json()).cube.id;

    const cube2Res = await aPost(request, host2, `${API}/api/cubes`, {
      name: "Cube Beta",
      cubecobraUrl: "https://cubecobra.com/cube/beta",
      supportedFormats: ["swiss_draft"],
      preferredPodSize: 4,
      minPodSize: 4,
      maxPodSize: 8,
    });
    expect(cube2Res.status()).toBe(201);
    const cube2Id = (await cube2Res.json()).cube.id;

    // Create Friday, advance to open
    const venueId = await getVenueId(request, host1);
    const fridayId = await createFriday(request, host1, venueId);
    await advanceFriday(request, host1, fridayId); // -> open

    // All 8 RSVP
    for (const u of allUsers) {
      const rsvpRes = await aPost(request, u, `${API}/api/fridays/${fridayId}/rsvp`, {
        action: "in",
      });
      expect(rsvpRes.status()).toBe(201);
    }

    // Enroll 2 cubes
    const enroll1 = await aPost(request, host1, `${API}/api/fridays/${fridayId}/enrollments`, {
      cubeId: cube1Id,
    });
    expect(enroll1.status()).toBe(201);
    const enrollment1Id = (await enroll1.json()).enrollment.id;

    const enroll2 = await aPost(request, host2, `${API}/api/fridays/${fridayId}/enrollments`, {
      cubeId: cube2Id,
    });
    expect(enroll2.status()).toBe(201);
    const enrollment2Id = (await enroll2.json()).enrollment.id;

    // Advance: open -> vote_closed (2 enrollments < 3, skip vote)
    const { stateKind, state } = await advanceFriday(request, host1, fridayId);
    expect(stateKind).toBe("vote_closed");

    // Both enrollment IDs should be winners (all enrolled cubes win when vote skipped)
    expect(state.winners).toBeDefined();
    expect(state.winners.length).toBe(2);
    expect(state.winners).toContain(enrollment1Id);
    expect(state.winners).toContain(enrollment2Id);

    // Continue to confirm pods are packable
    const { stateKind: confirmedKind } = await advanceFriday(request, host1, fridayId);
    expect(confirmedKind).toBe("confirmed");

    // Verify 2 pods created
    const detailRes = await aGet(request, host1, `${API}/api/fridays/${fridayId}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.pods.length).toBe(2);
  });

  // =========================================================================
  // 7. Double RSVP rejected -- second RSVP returns 409
  // =========================================================================
  test("double RSVP is rejected with 409", async ({ request }) => {
    const alice = await registerUser(request, "DoubleRsvp-Alice");

    await aPatch(request, alice, `${API}/api/me`, {
      preferredFormats: ["swiss_draft"],
      fallbackFormats: [],
    });

    const venueId = await getVenueId(request, alice);
    const fridayId = await createFriday(request, alice, venueId);
    await advanceFriday(request, alice, fridayId); // -> open

    // First RSVP succeeds
    const rsvp1 = await aPost(request, alice, `${API}/api/fridays/${fridayId}/rsvp`, {
      action: "in",
    });
    expect(rsvp1.status()).toBe(201);

    // Second RSVP returns 409
    const rsvp2 = await aPost(request, alice, `${API}/api/fridays/${fridayId}/rsvp`, {
      action: "in",
    });
    expect(rsvp2.status()).toBe(409);

    // Verify the error code (error responses are { error: { code, message } })
    const body = await rsvp2.json();
    expect(body.error.code).toBe("ALREADY_IN");
  });
});
