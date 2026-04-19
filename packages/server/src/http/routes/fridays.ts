/**
 * Friday routes — list, detail, RSVP, enrollment, vote.
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import { rsvpIn, rsvpOut } from "../../programs/rsvp.js";
import { enrollCube, withdrawEnrollment } from "../../programs/enrollment.js";
import {
  FridayRepo, EnrollmentRepo, RsvpRepo, VoteRepo, PodRepo,
} from "../../repos/types.js";
import { Effect } from "effect";
import { Clock } from "../../capabilities/clock.js";
import { RNG } from "../../capabilities/rng.js";

// Extract error kind from Effect's FiberFailure-wrapped errors
function extractErrorKind(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.kind === "string") return obj.kind;
  try {
    const str = String(e);
    const match = str.match(/"kind"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {}
  if ("error" in obj) return extractErrorKind(obj.error);
  if ("cause" in obj) return extractErrorKind(obj.cause);
  return undefined;
}

// Extract fridayState from Effect's FiberFailure-wrapped errors
function extractFridayState(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.fridayState === "string") return obj.fridayState;
  try {
    const str = String(e);
    const match = str.match(/"fridayState"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {}
  if ("error" in obj) return extractFridayState(obj.error);
  if ("cause" in obj) return extractFridayState(obj.cause);
  return undefined;
}

const fridays = new Hono<AppEnv>();

// GET /api/fridays — list upcoming
fridays.get("/", async (c) => {
  const run = c.get("effectRuntime");
  try {
    const list = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        return yield* fridayRepo.findUpcoming();
      }),
    );
    return c.json({ fridays: list });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to list fridays");
  }
});

// GET /api/fridays/:id — detail
fridays.get("/:id", async (c) => {
  const run = c.get("effectRuntime");
  const id = c.req.param("id");

  try {
    const detail = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const enrollmentRepo = yield* EnrollmentRepo;
        const rsvpRepo = yield* RsvpRepo;
        const podRepo = yield* PodRepo;

        const friday = yield* fridayRepo.findById(id as any);
        if (!friday) return null;

        const enrollments = yield* enrollmentRepo.findByFriday(friday.id);
        const rsvps = yield* rsvpRepo.findByFriday(friday.id);
        const pods = yield* podRepo.findByFriday(friday.id);

        // Build a player directory: userId → { displayName, dciNumber }
        const { getDb: gdb, query: dbq } = await import("../../db/sqlite.js");
        const db = await gdb();
        const allUserIds = new Set([
          ...rsvps.map((r: any) => r.userId),
          ...enrollments.map((e: any) => e.hostId),
        ]);
        const players: Record<string, { displayName: string; dciNumber: number | null }> = {};
        for (const uid of allUserIds) {
          const rows = dbq<{ display_name: string; dci_number: number | null }>(
            db, "SELECT display_name, dci_number FROM users WHERE id = ?", [uid],
          );
          if (rows[0]) {
            players[uid as string] = {
              displayName: rows[0].display_name,
              dciNumber: rows[0].dci_number,
            };
          }
        }

        return { friday, enrollments, rsvps, pods, players };
      }),
    );

    if (!detail) {
      return apiError(c, 404, "NOT_FOUND", "Friday not found");
    }
    return c.json(detail);
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to load friday");
  }
});

// POST /api/fridays/:id/rsvp — RSVP in or out
fridays.post("/:id/rsvp", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();
  const fridayId = c.req.param("id");

  try {
    if (body.action === "in") {
      const rsvp = await run(rsvpIn({ fridayId: fridayId!, userId: user.id, covered: !!body.covered }));
      return c.json({ rsvp }, 201);
    } else if (body.action === "out") {
      const rsvp = await run(rsvpOut({ fridayId: fridayId!, userId: user.id }));
      return c.json({ rsvp });
    } else {
      return apiError(c, 400, "INVALID_ACTION", "action must be 'in' or 'out'");
    }
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "friday_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Friday not found");
    }
    if (kind === "rsvp_not_accepted") {
      const fridayState = extractFridayState(e) ?? "unknown";
      return apiError(c, 409, "NOT_ACCEPTED", `RSVPs not accepted in state: ${fridayState}`);
    }
    if (kind === "already_in") {
      return apiError(c, 409, "ALREADY_IN", "Already RSVP'd");
    }
    return apiError(c, 500, "INTERNAL", "RSVP failed");
  }
});

// POST /api/fridays/:id/enrollments — enroll a cube
fridays.post("/:id/enrollments", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();
  const fridayId = c.req.param("id");

  try {
    const enrollment = await run(
      enrollCube({ fridayId: fridayId!, cubeId: body.cubeId, userId: user.id }),
    );
    return c.json({ enrollment }, 201);
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "not_host_capable") {
      return apiError(c, 403, "NOT_HOST", "Must be host-capable to enroll cubes");
    }
    if (kind === "already_enrolled") {
      return apiError(c, 409, "ALREADY_ENROLLED", "Already enrolled a cube for this Friday");
    }
    if (kind === "enrollment_not_accepted") {
      const fridayState = extractFridayState(e) ?? "unknown";
      return apiError(c, 409, "NOT_ACCEPTED", `Enrollments not accepted in state: ${fridayState}`);
    }
    return apiError(c, 500, "INTERNAL", "Enrollment failed");
  }
});

// GET /api/fridays/:id/covered-count — coordinator only
fridays.get("/:id/covered-count", authMiddleware(), async (c) => {
  const user = c.get("user");
  if (user.role !== "coordinator") {
    return apiError(c, 403, "FORBIDDEN", "Coordinator only");
  }
  const fridayId = c.req.param("id")!;
  try {
    const { getDb, query } = await import("../../db/sqlite.js");
    const db = await getDb();
    const result = query<{ cnt: number }>(db, "SELECT count(*) as cnt FROM rsvps WHERE friday_id = ? AND covered = 1 AND state = 'in'", [fridayId]);
    return c.json({ count: result[0]?.cnt ?? 0 });
  } catch {
    return c.json({ count: 0 });
  }
});

// DELETE /api/fridays/:id/enrollments/:eid — withdraw enrollment
fridays.delete("/:id/enrollments/:eid", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const eid = c.req.param("eid");

  try {
    await run(withdrawEnrollment({ enrollmentId: eid!, userId: user.id }));
    return c.json({ ok: true });
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "enrollment_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Enrollment not found");
    }
    return apiError(c, 500, "INTERNAL", "Withdrawal failed");
  }
});

// POST /api/fridays/:id/vote — submit ranked choice vote
fridays.post("/:id/vote", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();
  const fridayId = c.req.param("id")!;

  try {
    const vote = await run(
      Effect.gen(function* () {
        const voteRepo = yield* VoteRepo;
        const clock = yield* Clock;
        const rng = yield* RNG;

        const voteId = (yield* rng.uuid()) as any;
        const now = yield* clock.now();

        const voteRecord = {
          id: voteId,
          fridayId: fridayId as any,
          userId: user.id,
          ranking: body.ranking,
          createdAt: now,
        };

        return yield* voteRepo.upsert(voteRecord);
      }),
    );
    return c.json({ vote });
  } catch {
    return apiError(c, 500, "INTERNAL", "Vote submission failed");
  }
});

export { fridays };
