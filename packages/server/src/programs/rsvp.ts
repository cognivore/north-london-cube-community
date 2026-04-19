/**
 * RSVP programs — /in and /out for Friday events.
 */

import { Effect } from "effect";
import { canAcceptRsvp } from "@cubehall/core";
import {
  unsafeRsvpId, unsafeFridayId, unsafeUserId, unsafeISO8601,
} from "@cubehall/core";
import type { Rsvp, RsvpState } from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { EventBus } from "../capabilities/event-bus.js";
import { Audit } from "../capabilities/audit.js";
import { FridayRepo, RsvpRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RsvpError =
  | { readonly kind: "friday_not_found" }
  | { readonly kind: "rsvp_not_accepted"; readonly fridayState: string }
  | { readonly kind: "user_banned" }
  | { readonly kind: "already_in" }
  | { readonly kind: "not_rsvpd" }
  | RepoError;

// ---------------------------------------------------------------------------
// RSVP In
// ---------------------------------------------------------------------------

export const rsvpIn = (input: { fridayId: string; userId: string; covered?: boolean }) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const audit = yield* Audit;
    const fridayRepo = yield* FridayRepo;
    const rsvpRepo = yield* RsvpRepo;

    const fridayId = unsafeFridayId(input.fridayId);
    const userId = unsafeUserId(input.userId);

    const friday = yield* fridayRepo.findById(fridayId);
    if (!friday) {
      return yield* Effect.fail<RsvpError>({ kind: "friday_not_found" });
    }

    if (!canAcceptRsvp(friday.state)) {
      return yield* Effect.fail<RsvpError>({
        kind: "rsvp_not_accepted",
        fridayState: friday.state.kind,
      });
    }

    // Check for existing RSVP
    const existing = yield* rsvpRepo.findByFridayAndUser(fridayId, userId);
    if (existing && existing.state === "in") {
      return yield* Effect.fail<RsvpError>({ kind: "already_in" });
    }

    const now = yield* clock.now();

    if (existing) {
      // Re-RSVP (was cancelled, now back in)
      yield* rsvpRepo.updateState(existing.id, "in" as RsvpState, now);
      yield* logger.info("RSVP re-activated", { fridayId: input.fridayId, userId: input.userId });
      yield* audit.record({
        actorId: userId,
        subject: { kind: "rsvp", id: existing.id },
        action: "rsvp.reactivated",
        before: existing.state,
        after: "in",
      });
      yield* eventBus.publish({ kind: "rsvp.created", fridayId, userId });
      return { ...existing, state: "in" as RsvpState, lastTransitionAt: now };
    }

    // New RSVP
    const rsvpId = unsafeRsvpId(yield* rng.uuid());
    const rsvp: Rsvp = {
      id: rsvpId,
      fridayId,
      userId,
      state: "in",
      createdAt: now,
      lastTransitionAt: now,
    };

    yield* rsvpRepo.create(rsvp);

    // Store covered flag directly in DB
    if (input.covered) {
      yield* Effect.tryPromise({
        try: async () => {
          const { getDb, run: dbRun, persist: dbPersist } = await import("../db/sqlite.js");
          const db = await getDb();
          dbRun(db, "UPDATE rsvps SET covered = 1 WHERE id = ?", [rsvpId]);
          dbPersist();
        },
        catch: () => ({ kind: "db_error" as const, cause: "covered update failed" }),
      });

      // Email coordinators
      yield* Effect.tryPromise({
        try: async () => {
          const { getDb, query: dbQuery } = await import("../db/sqlite.js");
          const db = await getDb();
          const coordinators = dbQuery<{ email: string }>(db, "SELECT email FROM users WHERE role = 'coordinator'");
          const { sendMagicLinkEmail } = await import("../email/sendgrid.js"); // reuse the transport
          for (const coord of coordinators) {
            await sendCoveredNotification(coord.email, input.fridayId);
          }
        },
        catch: (e) => {
          console.error("Failed to notify coordinators:", e);
          return undefined as never;
        },
      });
    }

    yield* logger.info("RSVP created", { fridayId: input.fridayId, userId: input.userId, covered: !!input.covered });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "rsvp", id: rsvpId },
      action: "rsvp.created",
      before: null,
      after: "in",
    });
    yield* eventBus.publish({ kind: "rsvp.created", fridayId, userId });

    return rsvp;
  });

// ---------------------------------------------------------------------------
// RSVP Out
// ---------------------------------------------------------------------------

export const rsvpOut = (input: { fridayId: string; userId: string }) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const audit = yield* Audit;
    const fridayRepo = yield* FridayRepo;
    const rsvpRepo = yield* RsvpRepo;

    const fridayId = unsafeFridayId(input.fridayId);
    const userId = unsafeUserId(input.userId);

    const friday = yield* fridayRepo.findById(fridayId);
    if (!friday) {
      return yield* Effect.fail<RsvpError>({ kind: "friday_not_found" });
    }

    if (!canAcceptRsvp(friday.state)) {
      return yield* Effect.fail<RsvpError>({
        kind: "rsvp_not_accepted",
        fridayState: friday.state.kind,
      });
    }

    const existing = yield* rsvpRepo.findByFridayAndUser(fridayId, userId);
    if (!existing || existing.state !== "in") {
      return yield* Effect.fail<RsvpError>({ kind: "not_rsvpd" });
    }

    const now = yield* clock.now();
    yield* rsvpRepo.updateState(existing.id, "cancelled_by_user" as RsvpState, now);

    yield* logger.info("RSVP cancelled", { fridayId: input.fridayId, userId: input.userId });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "rsvp", id: existing.id },
      action: "rsvp.cancelled",
      before: "in",
      after: "cancelled_by_user",
    });
    yield* eventBus.publish({ kind: "rsvp.cancelled", fridayId, userId });

    return { ...existing, state: "cancelled_by_user" as RsvpState, lastTransitionAt: now };
  });

// ---------------------------------------------------------------------------
// Notify coordinators about covered RSVPs
// ---------------------------------------------------------------------------

async function sendCoveredNotification(coordinatorEmail: string, fridayId: string): Promise<void> {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
  const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@cube.london";
  if (!SENDGRID_API_KEY) return;

  // Count total covered for this friday (don't reveal WHO)
  const { getDb, query: dbQuery } = await import("../db/sqlite.js");
  const db = await getDb();
  const result = dbQuery<{ cnt: number }>(db, "SELECT count(*) as cnt FROM rsvps WHERE friday_id = ? AND covered = 1 AND state = 'in'", [fridayId]);
  const coveredCount = result[0]?.cnt ?? 0;

  const friday = dbQuery<{ date: string }>(db, "SELECT date FROM fridays WHERE id = ?", [fridayId]);
  const date = friday[0]?.date ?? "upcoming Friday";

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: coordinatorEmail }] }],
      from: { email: FROM_EMAIL, name: "Cubehall" },
      subject: `${coveredCount} covered RSVP${coveredCount !== 1 ? "s" : ""} for ${date}`,
      content: [{
        type: "text/plain",
        value: `${coveredCount} attendee${coveredCount !== 1 ? "s" : ""} for ${date} need${coveredCount === 1 ? "s" : ""} their entry covered.\n\nThe default is to split the cost evenly among other attendees (£${(7 * coveredCount / Math.max(1, 8 - coveredCount)).toFixed(2)} extra each if 8 attend).\n\nNo names are shown — this is anonymous.`,
      }],
    }),
  });
}
