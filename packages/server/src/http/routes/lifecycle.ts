/**
 * Lifecycle routes — create fridays, advance state, start rounds, complete rounds.
 * These are the missing pieces that make the system actually usable.
 */

import { Hono } from "hono";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import {
  createFriday, advanceFriday, startRound, completeRound,
} from "../../programs/friday-lifecycle.js";
import { VenueRepo, FridayRepo, PodRepo, RoundRepo, MatchRepo, SeatRepo } from "../../repos/types.js";
import { computeStandings } from "@cubehall/core";
import type { NonEmptyArray } from "@cubehall/core";

const lifecycle = new Hono<AppEnv>();

// POST /api/lifecycle/fridays — create a new Friday
lifecycle.post("/fridays", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const body = await c.req.json();

  try {
    const friday = await run(createFriday({ date: body.date, venueId: body.venueId }));
    return c.json({ friday }, 201);
  } catch (e: unknown) {
    return apiError(c, 500, "INTERNAL", `Failed to create friday: ${extractMsg(e)}`);
  }
});

// POST /api/lifecycle/fridays/:id/advance — advance to next state
lifecycle.post("/fridays/:id/advance", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("id")!;

  try {
    const friday = await run(advanceFriday(fridayId));
    return c.json({ friday });
  } catch (e: unknown) {
    return apiError(c, 500, "INTERNAL", `Failed to advance friday: ${extractMsg(e)}`);
  }
});

// POST /api/lifecycle/pods/:id/rounds/:n/start — start a round (generates pairings)
lifecycle.post("/pods/:id/rounds/:n/start", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id")!;
  const roundNumber = parseInt(c.req.param("n")!, 10);

  try {
    const result = await run(startRound(podId, roundNumber));
    if (!result) return apiError(c, 404, "NOT_FOUND", "Pod or round not found");
    return c.json(result);
  } catch (e: unknown) {
    return apiError(c, 500, "INTERNAL", `Failed to start round: ${extractMsg(e)}`);
  }
});

// POST /api/lifecycle/pods/:id/rounds/:n/complete — complete a round
lifecycle.post("/pods/:id/rounds/:n/complete", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id")!;
  const roundNumber = parseInt(c.req.param("n")!, 10);

  try {
    const result = await run(completeRound(podId, roundNumber));
    if (!result) return apiError(c, 400, "INCOMPLETE", "Not all matches reported yet");
    return c.json(result);
  } catch (e: unknown) {
    return apiError(c, 500, "INTERNAL", `Failed to complete round: ${extractMsg(e)}`);
  }
});

// GET /api/lifecycle/pods/:id/standings — compute standings
lifecycle.get("/pods/:id/standings", async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id")!;

  try {
    const standings = await run(
      Effect.gen(function* () {
        const seatRepo = yield* SeatRepo;
        const matchRepo = yield* MatchRepo;

        const seats = yield* seatRepo.findByPod(podId as any);
        const matches = yield* matchRepo.findByPod(podId as any);
        const playerIds = seats.map(s => s.userId);

        if (playerIds.length === 0) return [];
        return computeStandings(playerIds as NonEmptyArray<any>, matches);
      }),
    );
    return c.json({ standings });
  } catch (e: unknown) {
    return apiError(c, 500, "INTERNAL", `Failed to compute standings: ${extractMsg(e)}`);
  }
});

// GET /api/lifecycle/venues — list venues (public, no auth needed)
lifecycle.get("/venues", async (c) => {
  const run = c.get("effectRuntime");
  try {
    const venues = await run(
      Effect.gen(function* () {
        const venueRepo = yield* VenueRepo;
        return yield* venueRepo.findAll();
      }),
    );
    return c.json({ venues });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to list venues");
  }
});

function extractMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    const str = String(e);
    const match = str.match(/"message"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
    const kindMatch = str.match(/"kind"\s*:\s*"([^"]+)"/);
    if (kindMatch?.[1]) return kindMatch[1];
  } catch {}
  return "unknown error";
}

export { lifecycle };
