/**
 * Me route — current user profile.
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import { UserRepo } from "../../repos/types.js";
import { Effect } from "effect";
import {
  unsafeNonEmptyString,
} from "@cubehall/core";
import type { UserProfile, DraftFormat, NonEmptyArray } from "@cubehall/core";
import { unsafeNonNegativeInt } from "@cubehall/core";

const me = new Hono<AppEnv>();

// GET /api/me — current user + DCI number
me.get("/", authMiddleware(), async (c) => {
  const user = c.get("user");
  // Fetch DCI number from DB (not in the core User type)
  let dciNumber: number | null = null;
  try {
    const { getDb, query } = await import("../../db/sqlite.js");
    const db = await getDb();
    const rows = query<{ dci_number: number | null }>(db, "SELECT dci_number FROM users WHERE id = ?", [user.id]);
    dciNumber = rows[0]?.dci_number ?? null;
  } catch {}
  return c.json({ user: { ...user, dciNumber } });
});

// PATCH /api/me — update profile
me.patch("/", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();

  try {
    await run(
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;

        const profile: UserProfile = {
          ...user.profile,
          ...(body.preferredFormats !== undefined && { preferredFormats: body.preferredFormats }),
          ...(body.fallbackFormats !== undefined && { fallbackFormats: body.fallbackFormats }),
          ...(body.hostCapable !== undefined && { hostCapable: body.hostCapable }),
          ...(body.bio !== undefined && { bio: body.bio }),
        };

        yield* userRepo.updateProfile(user.id, profile);

        if (body.displayName !== undefined) {
          yield* userRepo.update({
            ...user,
            displayName: unsafeNonEmptyString(body.displayName),
            profile,
          });
        }
      }),
    );

    return c.json({ ok: true });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to update profile");
  }
});

export { me };
