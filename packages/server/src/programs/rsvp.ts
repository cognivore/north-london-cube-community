/**
 * RSVP programs — advanced state machine with even-pairing + grace period.
 *
 * States: pending → confirmed → locked → attended/no_show
 *
 * When total active RSVPs is odd: new RSVP goes to "pending" (withdrawable).
 * When total becomes even: both the new person and the previously-pending
 * person become "confirmed". A 30-min grace timer starts per person.
 *
 * During grace (confirmed): can withdraw.  Partner gets demoted to pending.
 * After grace: scheduler runs matching → locks them → sends email.
 * After lock: cannot withdraw.
 *
 * No-show: 2 in 60 days → 90-day RSVP ban.
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
import { FridayRepo, RsvpRepo, UserRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";
import { scheduleGraceLock, cancelGraceLock } from "../scheduler.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RsvpError =
  | { readonly kind: "friday_not_found" }
  | { readonly kind: "rsvp_not_accepted"; readonly fridayState: string }
  | { readonly kind: "user_banned"; readonly until: string }
  | { readonly kind: "already_in" }
  | { readonly kind: "not_rsvpd" }
  | { readonly kind: "withdrawal_blocked"; readonly reason: string }
  | RepoError;

// Active RSVP states (count toward even/odd)
const ACTIVE_STATES = new Set(["pending", "confirmed", "locked", "seated"]);

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

    // Check no-show ban: 2+ no-shows in last 60 days → 90-day ban
    yield* Effect.tryPromise({
      try: async () => {
        const { getDb, query } = await import("../db/sqlite.js");
        const db = await getDb();
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const noShows = query<{ cnt: number }>(db,
          "SELECT count(*) as cnt FROM rsvps WHERE user_id = ? AND state = 'no_show' AND created_at > ?",
          [userId, sixtyDaysAgo],
        );
        if ((noShows[0]?.cnt ?? 0) >= 2) {
          throw { kind: "user_banned", until: "90 days from last no-show" };
        }
      },
      catch: (e: any) => {
        if (e?.kind === "user_banned") return e;
        return undefined as never;
      },
    });

    // Check for existing active RSVP
    const existing = yield* rsvpRepo.findByFridayAndUser(fridayId, userId);
    if (existing && ACTIVE_STATES.has(existing.state)) {
      return yield* Effect.fail<RsvpError>({ kind: "already_in" });
    }

    const now = yield* clock.now();

    // Count current active RSVPs
    const allRsvps = yield* rsvpRepo.findByFriday(fridayId);
    const activeCount = allRsvps.filter(r => ACTIVE_STATES.has(r.state)).length;

    // After this RSVP, count will be activeCount + 1
    const willBeEven = (activeCount + 1) % 2 === 0;

    // Determine initial state
    const initialState: RsvpState = willBeEven ? "confirmed" : "pending";

    let newRsvpId: string;
    if (existing) {
      // Re-RSVP
      newRsvpId = existing.id as string;
      yield* rsvpRepo.updateState(existing.id, initialState, now);
      yield* logger.info("RSVP re-activated", { fridayId: input.fridayId, userId: input.userId, state: initialState });
    } else {
      // New RSVP
      const rsvpId = unsafeRsvpId(yield* rng.uuid());
      newRsvpId = rsvpId as string;
      const rsvp: Rsvp = {
        id: rsvpId,
        fridayId,
        userId,
        state: initialState,
        createdAt: now,
        lastTransitionAt: now,
      };
      yield* rsvpRepo.create(rsvp);
    }

    // Store covered flag
    if (input.covered) {
      yield* Effect.tryPromise({
        try: async () => {
          const { getDb, run: dbRun, persist: dbPersist } = await import("../db/sqlite.js");
          const db = await getDb();
          dbRun(db, "UPDATE rsvps SET covered = 1 WHERE friday_id = ? AND user_id = ?", [fridayId, userId]);
          dbPersist();
        },
        catch: () => ({ kind: "db_error" as const, cause: "covered update failed" }),
      });
    }

    // If count is now even: confirm the previously-pending person too + schedule grace timers
    if (willBeEven) {
      const pendingRsvp = allRsvps.find(r => r.state === "pending");
      if (pendingRsvp) {
        yield* rsvpRepo.updateState(pendingRsvp.id, "confirmed" as RsvpState, now);
        yield* logger.info("Paired RSVP confirmed", { userId: pendingRsvp.userId });
        // Schedule grace timer for the partner
        scheduleGraceLock(pendingRsvp.id as string, input.fridayId);
      }

      // Schedule grace timer for the new person
      scheduleGraceLock(newRsvpId, input.fridayId);

      // Notify coordinators about covered RSVPs if applicable
      if (input.covered) {
        yield* notifyCoordinatorsCovered(input.fridayId);
      }
    }

    yield* logger.info("RSVP created", { fridayId: input.fridayId, userId: input.userId, state: initialState, covered: !!input.covered });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "rsvp", id: fridayId },
      action: "rsvp.created",
      before: null,
      after: initialState,
    });
    yield* eventBus.publish({ kind: "rsvp.created", fridayId, userId });

    return { state: initialState, paired: willBeEven };
  });

// ---------------------------------------------------------------------------
// RSVP Out (withdraw)
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

    const existing = yield* rsvpRepo.findByFridayAndUser(fridayId, userId);
    if (!existing || !ACTIVE_STATES.has(existing.state)) {
      return yield* Effect.fail<RsvpError>({ kind: "not_rsvpd" });
    }

    // Locked = committed. Cannot withdraw.
    if (existing.state === "locked" || existing.state === "seated") {
      return yield* Effect.fail<RsvpError>({
        kind: "withdrawal_blocked",
        reason: "You're locked in — this is a commitment to attend.",
      });
    }

    // Pending and confirmed can withdraw.
    // Cancel grace timer for the withdrawing person.
    cancelGraceLock(existing.id as string);

    const nowISO = yield* clock.now();
    yield* rsvpRepo.updateState(existing.id, "cancelled_by_user" as RsvpState, nowISO);

    // If withdrawal makes count odd: demote the last confirmed person back to pending
    const allRsvps = yield* rsvpRepo.findByFriday(fridayId);
    const activeAfter = allRsvps.filter(r =>
      ACTIVE_STATES.has(r.state) && r.userId !== userId
    );
    if (activeAfter.length % 2 === 1) {
      // Find the most recent confirmed person and demote to pending
      const lastConfirmed = activeAfter
        .filter(r => r.state === "confirmed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (lastConfirmed) {
        cancelGraceLock(lastConfirmed.id as string);
        yield* rsvpRepo.updateState(lastConfirmed.id, "pending" as RsvpState, nowISO);
        yield* logger.info("Demoted to pending (partner withdrew)", { userId: lastConfirmed.userId });
      }
    }

    yield* logger.info("RSVP cancelled", { fridayId: input.fridayId, userId: input.userId });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "rsvp", id: existing.id },
      action: "rsvp.cancelled",
      before: existing.state,
      after: "cancelled_by_user",
    });
    yield* eventBus.publish({ kind: "rsvp.cancelled", fridayId, userId });

    return { state: "cancelled_by_user" as RsvpState };
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notifyCoordinatorsCovered(fridayId: string) {
  return Effect.tryPromise({
    try: async () => {
      const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
      const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@cube.london";
      if (!SENDGRID_API_KEY) return;

      const { getDb, query } = await import("../db/sqlite.js");
      const db = await getDb();
      const coordinators = query<{ email: string }>(db, "SELECT email FROM users WHERE role = 'coordinator'");
      const result = query<{ cnt: number }>(db,
        "SELECT count(*) as cnt FROM rsvps WHERE friday_id = ? AND covered = 1 AND state IN ('pending','confirmed','locked','seated')",
        [fridayId]);
      const coveredCount = result[0]?.cnt ?? 0;
      const friday = query<{ date: string }>(db, "SELECT date FROM fridays WHERE id = ?", [fridayId]);
      const date = friday[0]?.date ?? "upcoming Friday";

      for (const coord of coordinators) {
        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SENDGRID_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: process.env.TEST_MODE === "true" ? "jm@memorici.de" : coord.email }] }],
            from: { email: FROM_EMAIL, name: "Cubehall" },
            subject: `${process.env.TEST_MODE === "true" ? "[TEST] " : ""}${coveredCount} covered RSVP${coveredCount !== 1 ? "s" : ""} for ${date}`,
            content: [{
              type: "text/plain",
              value: `${coveredCount} attendee${coveredCount !== 1 ? "s" : ""} for ${date} need${coveredCount === 1 ? "s" : ""} entry covered.\n\nDefault: split evenly among other attendees.\nNo names shown — anonymous.`,
            }],
          }),
        });
      }
    },
    catch: (e) => {
      console.error("Failed to notify coordinators:", e);
      return undefined as never;
    },
  });
}
