/**
 * TEST_MODE routes — only available when TEST_MODE=true.
 * Allows filling events with phony users, triggering early starts,
 * signing in as phony users, reporting results on their behalf.
 */

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import { getDb, query, run, persist } from "../../db/sqlite.js";
import { Clock } from "../../capabilities/clock.js";
import { RNG } from "../../capabilities/rng.js";
import {
  unsafeUserId, unsafeSessionId, unsafeISO8601,
  unsafeEmail, unsafeNonEmptyString, unsafeNonNegativeInt,
  unsafeRsvpId,
} from "@cubehall/core";
import type { User, Session } from "@cubehall/core";

const testmode = new Hono<AppEnv>();

// Gate: all routes require TEST_MODE
testmode.use("*", async (c, next) => {
  if (process.env.TEST_MODE !== "true") {
    return apiError(c, 403, "FORBIDDEN", "TEST_MODE is not enabled");
  }
  await next();
});

// POST /api/test/phony-users — create N phony users and RSVP them to a friday
testmode.post("/phony-users", authMiddleware(), async (c) => {
  const body = await c.req.json();
  const count = body.count ?? 4;
  const fridayId = body.fridayId;
  const firstNames = [
    "Alex", "Blake", "Casey", "Drew", "Ellis", "Finley", "Gray", "Harper",
    "Ira", "Jules", "Kit", "Lane", "Morgan", "Nat", "Oakley", "Pat",
  ];
  const surnames = [
    "Budde", "Finkel", "Nassif", "Wafo-Tapa", "Karsten", "Juza", "Duke",
    "Calcano", "Shenhar", "Manfield", "Stark", "Jensen", "Turtenwald",
    "Hayne", "Levy", "Sigrist", "Watanabe", "Yukuhiro", "Damo da Rosa",
    "Dominguez", "Floch", "Strasky", "Mengucci", "Cifka", "Dezani",
  ];

  const db = await getDb();
  const existingCount = query<{ cnt: number }>(db, "SELECT count(*) as cnt FROM users WHERE email LIKE 'phony-%'");
  const nameOffset = existingCount[0]?.cnt ?? 0;

  const users: Array<{ id: string; email: string; displayName: string }> = [];
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const fi = (nameOffset + i) % firstNames.length;
    const si = Math.floor((nameOffset + i) / firstNames.length) % surnames.length;
    const name = `${firstNames[fi]} ${surnames[si]}`;
    const email = `phony-${id.slice(0, 8)}@test.local`;

    run(db, `INSERT INTO users (id, email, display_name, created_at, auth_state, profile, role) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      id, email, name, now,
      JSON.stringify({ kind: "verified" }),
      JSON.stringify({
        preferredFormats: ["swiss_draft"],
        fallbackFormats: ["team_draft_3v3"],
        hostCapable: false,
        bio: "Phony test user",
        noShowCount: 0,
        banned: { kind: "not_banned" },
      }),
      "member",
    ]);

    // Create session for this user
    const sessionId = crypto.randomUUID();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    run(db, `INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?)`, [
      sessionId, id, now, expires, now,
    ]);

    // RSVP if fridayId provided
    if (fridayId) {
      const rsvpId = crypto.randomUUID();
      run(db, `INSERT OR IGNORE INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at) VALUES (?, ?, ?, 'locked', ?, ?)`, [
        rsvpId, fridayId, id, now, now,
      ]);
    }

    users.push({ id, email, displayName: name });
  }

  persist();
  return c.json({ users, count: users.length });
});

// POST /api/test/sign-in-as — sign in as any user (returns session cookie)
testmode.post("/sign-in-as", async (c) => {
  const body = await c.req.json();
  const userId = body.userId;

  const db = await getDb();
  const user = query<{ id: string; email: string }>(db, "SELECT id, email FROM users WHERE id = ?", [userId]);
  if (user.length === 0) {
    return apiError(c, 404, "NOT_FOUND", "User not found");
  }

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  run(db, `INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?)`, [
    sessionId, userId, now, expires, now,
  ]);
  persist();

  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 14 * 24 * 60 * 60,
    path: "/",
  });

  return c.json({ sessionId, userId });
});

// POST /api/test/report-as — report a match result as a specific user
testmode.post("/report-as", authMiddleware(), async (c) => {
  const body = await c.req.json();
  const { matchId, userId, p1Wins, p2Wins, draws } = body;

  const db = await getDb();
  const now = new Date().toISOString();
  run(db, `UPDATE matches SET result = ?, submitted_at = ?, submitted_by = ? WHERE id = ?`, [
    JSON.stringify({ kind: "reported", p1Wins, p2Wins, draws }),
    now, userId, matchId,
  ]);
  persist();

  return c.json({ ok: true });
});

// POST /api/test/advance-friday — advance a friday (no auth check, just TEST_MODE)
testmode.post("/advance-friday/:id", async (c) => {
  const run2 = c.get("effectRuntime");
  const fridayId = c.req.param("id")!;

  try {
    const { advanceFriday } = await import("../../programs/friday-lifecycle.js");
    const result = await run2(advanceFriday(fridayId));
    return c.json({ friday: result });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Advance failed: ${String(e)}`);
  }
});

// POST /api/test/start-round — start a round (no auth)
testmode.post("/start-round/:podId/:roundNumber", async (c) => {
  const run2 = c.get("effectRuntime");
  const podId = c.req.param("podId")!;
  const roundNumber = parseInt(c.req.param("roundNumber")!, 10);

  try {
    const { startRound } = await import("../../programs/friday-lifecycle.js");
    const result = await run2(startRound(podId, roundNumber));
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Start round failed: ${String(e)}`);
  }
});

// POST /api/test/complete-round
testmode.post("/complete-round/:podId/:roundNumber", async (c) => {
  const run2 = c.get("effectRuntime");
  const podId = c.req.param("podId")!;
  const roundNumber = parseInt(c.req.param("roundNumber")!, 10);

  try {
    const { completeRound } = await import("../../programs/friday-lifecycle.js");
    const result = await run2(completeRound(podId, roundNumber));
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Complete round failed: ${String(e)}`);
  }
});

// GET /api/test/users — list all users (for picking who to sign in as)
testmode.get("/users", async (c) => {
  const db = await getDb();
  const users = query<{ id: string; email: string; display_name: string; role: string }>(
    db, "SELECT id, email, display_name, role FROM users ORDER BY created_at",
  );
  return c.json({ users });
});

export { testmode };
