/**
 * Pod routes — pod detail, pairings, timer, round management, match results.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import { reportMatch } from "../../programs/match-report.js";
import { PodRepo, SeatRepo, RoundRepo, MatchRepo } from "../../repos/types.js";

const pods = new Hono<AppEnv>();

// GET /api/pods/:id — pod detail
pods.get("/:id", async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id")!;

  try {
    const detail = await run(
      Effect.gen(function* () {
        const podRepo = yield* PodRepo;
        const seatRepo = yield* SeatRepo;
        const roundRepo = yield* RoundRepo;
        const matchRepo = yield* MatchRepo;

        const pod = yield* podRepo.findById(podId as any);
        if (!pod) return null;

        const seats = yield* seatRepo.findByPod(pod.id);
        const rounds = yield* roundRepo.findByPod(pod.id);
        const matches = yield* matchRepo.findByPod(pod.id);

        return { pod, seats, rounds, matches };
      }),
    );

    if (!detail) {
      return apiError(c, 404, "NOT_FOUND", "Pod not found");
    }

    // Enrich with player names + DCI numbers
    let players: Record<string, { displayName: string; dciNumber: number | null }> = {};
    try {
      const { getDb, query } = await import("../../db/sqlite.js");
      const db = await getDb();
      for (const s of detail.seats) {
        const rows = query<{ display_name: string; dci_number: number | null }>(
          db, "SELECT display_name, dci_number FROM users WHERE id = ?", [s.userId],
        );
        if (rows[0]) {
          players[s.userId as string] = {
            displayName: rows[0].display_name,
            dciNumber: rows[0].dci_number ?? null,
          };
        }
      }
    } catch {}

    return c.json({ ...detail, players });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to load pod");
  }
});

// GET /api/pods/:id/pairings — current round pairings
pods.get("/:id/pairings", async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id");

  try {
    const data = await run(
      Effect.gen(function* () {
        const roundRepo = yield* RoundRepo;
        const matchRepo = yield* MatchRepo;

        const rounds = yield* roundRepo.findByPod(podId as any);
        const currentRound = rounds.find((r) => r.state === "in_progress") ?? rounds[rounds.length - 1];

        if (!currentRound) return { pairings: [], round: null };

        const matches = yield* matchRepo.findByRound(currentRound.id);
        return { pairings: matches, round: currentRound };
      }),
    );

    // Enrich with player names
    let players: Record<string, { displayName: string; dciNumber: number | null }> = {};
    try {
      const { getDb, query } = await import("../../db/sqlite.js");
      const db = await getDb();
      const ids = new Set(data.pairings.flatMap((m: any) => [m.player1Id, m.player2Id]));
      for (const uid of ids) {
        const rows = query<{ display_name: string; dci_number: number | null }>(
          db, "SELECT display_name, dci_number FROM users WHERE id = ?", [uid]);
        if (rows[0]) players[uid as string] = { displayName: rows[0].display_name, dciNumber: rows[0].dci_number ?? null };
      }
    } catch {}

    return c.json({ ...data, players });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to load pairings");
  }
});

// GET /api/pods/:id/timer — SSE endpoint for live timer
pods.get("/:id/timer", (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    let running = true;
    stream.onAbort(() => { running = false; });

    while (running) {
      try {
        const data = await run(
          Effect.gen(function* () {
            const roundRepo = yield* RoundRepo;
            const rounds = yield* roundRepo.findByPod(podId as any);
            const current = rounds.find((r) => r.state === "in_progress");
            return current ? current.timer : { kind: "not_started" as const };
          }),
        );

        await stream.writeSSE({
          data: JSON.stringify(data),
          event: "timer",
        });
      } catch {
        await stream.writeSSE({
          data: JSON.stringify({ kind: "not_started" }),
          event: "timer",
        });
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  });
});

// POST /api/pods/:id/rounds/:n/start — host starts a round
pods.post("/:id/rounds/:n/start", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id");
  const roundNumber = parseInt(c.req.param("n")!, 10);

  try {
    const result = await run(
      Effect.gen(function* () {
        const roundRepo = yield* RoundRepo;
        const rounds = yield* roundRepo.findByPod(podId as any);
        const round = rounds.find((r) => r.roundNumber === roundNumber);
        if (!round) return null;
        yield* roundRepo.updateState(round.id, "in_progress");
        return round;
      }),
    );

    if (!result) return apiError(c, 404, "NOT_FOUND", "Round not found");
    return c.json({ round: result });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to start round");
  }
});

// POST /api/matches/:id/result — report match result
pods.post("/matches/:id/result", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();
  const matchId = c.req.param("id")!;

  try {
    const result = await run(
      reportMatch({
        matchId,
        userId: user.id,
        p1Wins: body.p1Wins,
        p2Wins: body.p2Wins,
        draws: body.draws,
      }),
    );
    return c.json({ result });
  } catch (e: unknown) {
    const error = e as { kind?: string };
    if (error.kind === "match_not_found") return apiError(c, 404, "NOT_FOUND", "Match not found");
    if (error.kind === "not_a_player") return apiError(c, 403, "FORBIDDEN", "Not a player in this match");
    if (error.kind === "already_reported") return apiError(c, 409, "CONFLICT", "Already reported");
    return apiError(c, 500, "INTERNAL", "Failed to report match");
  }
});

export { pods };
