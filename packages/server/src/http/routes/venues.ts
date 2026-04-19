/**
 * Venue routes — list venues.
 */

import { Hono } from "hono";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError } from "../middleware.js";
import { VenueRepo } from "../../repos/types.js";

const venues = new Hono<AppEnv>();

// GET /api/venues
venues.get("/", async (c) => {
  const run = c.get("effectRuntime");
  try {
    const list = await run(
      Effect.gen(function* () {
        const venueRepo = yield* VenueRepo;
        return yield* venueRepo.findAll();
      }),
    );
    return c.json({ venues: list });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list venues: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  }
});

export { venues };
