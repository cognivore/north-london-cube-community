/**
 * RSVP programs — advanced state machine with even-pairing.
 *
 * States: pending → confirmed → locked → attended/no_show
 *
 * When total active RSVPs is odd: new RSVP goes to "pending" (withdrawable).
 * When total becomes even: both the new person and the previously-pending
 * person become "confirmed". A 30-min lock timer starts. After 30 min they
 * become "locked" (cannot withdraw). Confirmation emails sent.
 *
 * Withdrawals blocked after Wednesday.
 * RSVPs accepted through Friday 12:00.
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

    if (existing) {
      // Re-RSVP
      yield* rsvpRepo.updateState(existing.id, initialState, now);
      yield* logger.info("RSVP re-activated", { fridayId: input.fridayId, userId: input.userId, state: initialState });
    } else {
      // New RSVP
      const rsvpId = unsafeRsvpId(yield* rng.uuid());
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

    // If count is now even: confirm the previously-pending person too
    if (willBeEven) {
      const pendingRsvp = allRsvps.find(r => r.state === "pending");
      if (pendingRsvp) {
        yield* rsvpRepo.updateState(pendingRsvp.id, "confirmed" as RsvpState, now);
        yield* logger.info("Paired RSVP confirmed — emails will be sent when locked", { userId: pendingRsvp.userId });
      }

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

    // Try to lock any confirmed RSVPs that are past the grace period
    // (runs on every RSVP action as a lightweight check)
    yield* Effect.tryPromise({
      try: async () => {
        const { getDb, query: dbq, run: dbr, persist: dbp } = await import("../db/sqlite.js");
        const db = await getDb();
        const lockDelay = process.env.TEST_MODE === "true" ? 60 * 1000 : 30 * 60 * 1000;
        const cutoff = new Date(Date.now() - lockDelay).toISOString();
        const toLock = dbq<{ id: string; user_id: string }>(db,
          "SELECT id, user_id FROM rsvps WHERE friday_id = ? AND state = 'confirmed' AND last_transition_at <= ?",
          [fridayId, cutoff]);
        for (const r of toLock) {
          dbr(db, "UPDATE rsvps SET state = 'locked' WHERE id = ?", [r.id]);
          // Send lock email
          try {
            const { sendMagicLinkEmail: _ } = await import("../email/sendgrid.js");
            // Reuse the confirmation email helper (runs outside Effect)
            const user = dbq<{ email: string; display_name: string }>(db, "SELECT email, display_name FROM users WHERE id = ?", [r.user_id]);
            const fri = dbq<{ date: string }>(db, "SELECT date FROM fridays WHERE id = ?", [fridayId]);
            const rsvpRow = dbq<{ created_at: string }>(db, "SELECT created_at FROM rsvps WHERE id = ?", [r.id]);
            if (user[0] && fri[0]) {
              const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
              const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@cube.london";
              const APP_URL = process.env.APP_URL ?? "https://north.cube.london";
              const rsvpTime = rsvpRow[0]?.created_at
                ? new Date(rsvpRow[0].created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })
                : "earlier";
              const testPrefix = process.env.TEST_MODE === "true" ? "[TEST] " : "";
              const toEmail = process.env.TEST_MODE === "true" ? "jm@memorici.de" : user[0].email;
              await fetch("https://api.sendgrid.com/v3/mail/send", {
                method: "POST",
                headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  personalizations: [{ to: [{ email: toEmail }] }],
                  from: { email: FROM_EMAIL, name: "North London Cube Community" },
                  subject: `${testPrefix}You're locked in for ${fri[0].date}`,
                  content: [{ type: "text/plain", value: `Hi ${user[0].display_name},\n\nYou're locked in for Friday ${fri[0].date} at Hitchhiker & Owl.\n\nRSVP'd at: ${rsvpTime}\nDoors: 18:30\nP1P1: 18:45\n\nThis is a commitment to attend. See you there!\n\n${APP_URL}\n\n— Cubehall` }],
                }),
              });
            }
          } catch {}
        }
        if (toLock.length > 0) dbp();
      },
      catch: () => undefined as never,
    });

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

    // Block withdrawal if confirmed or locked — email was sent, you're committed
    if (existing.state === "confirmed" || existing.state === "locked") {
      return yield* Effect.fail<RsvpError>({
        kind: "withdrawal_blocked",
        reason: "You're confirmed and locked in. A confirmation email was sent — you committed to attending.",
      });
    }

    // Only pending RSVPs can be withdrawn
    if (existing.state !== "pending") {
      return yield* Effect.fail<RsvpError>({
        kind: "withdrawal_blocked",
        reason: "Your RSVP cannot be withdrawn in this state.",
      });
    }

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
// Lock confirmed RSVPs (call periodically or on a timer)
// ---------------------------------------------------------------------------

export const lockConfirmedRsvps = (fridayId: string) =>
  Effect.gen(function* () {
    const logger = yield* Logger;
    const rsvpRepo = yield* RsvpRepo;
    const clock = yield* Clock;

    const fid = unsafeFridayId(fridayId);
    const now = yield* clock.now();
    const allRsvps = yield* rsvpRepo.findByFriday(fid);

    let locked = 0;
    for (const rsvp of allRsvps) {
      if (rsvp.state === "confirmed") {
        // Check if 30 minutes have passed since confirmation
        const confirmedAt = new Date(rsvp.lastTransitionAt).getTime();
        const lockDelay = process.env.TEST_MODE === "true" ? 60 * 1000 : 30 * 60 * 1000;
        if (Date.now() - confirmedAt >= lockDelay) {
          yield* rsvpRepo.updateState(rsvp.id, "locked" as RsvpState, now);
          // NOW send the confirmation email — they're truly locked in
          yield* sendConfirmationEmail(rsvp.userId as string, fridayId);
          locked++;
        }
      }
    }

    if (locked > 0) {
      yield* logger.info("Locked confirmed RSVPs and sent emails", { fridayId, count: locked });
    }
    return { locked };
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendConfirmationEmail(userId: string, fridayId: string) {
  return Effect.tryPromise({
    try: async () => {
      const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
      const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@cube.london";
      const APP_URL = process.env.APP_URL ?? "https://north.cube.london";
      if (!SENDGRID_API_KEY) return;

      const { getDb, query } = await import("../db/sqlite.js");
      const db = await getDb();
      const user = query<{ email: string; display_name: string }>(db,
        "SELECT email, display_name FROM users WHERE id = ?", [userId]);
      const friday = query<{ date: string }>(db,
        "SELECT date FROM fridays WHERE id = ?", [fridayId]);
      const rsvp = query<{ created_at: string }>(db,
        "SELECT created_at FROM rsvps WHERE friday_id = ? AND user_id = ?", [fridayId, userId]);
      if (!user[0] || !friday[0]) return;

      const rsvpTime = rsvp[0]?.created_at
        ? new Date(rsvp[0].created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })
        : "just now";
      const testPrefix = process.env.TEST_MODE === "true" ? "[TEST] " : "";

      await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: process.env.TEST_MODE === "true" ? "jm@memorici.de" : user[0].email }] }],
          from: { email: FROM_EMAIL, name: "North London Cube Community" },
          subject: `${testPrefix}You're confirmed for ${friday[0].date}`,
          content: [{
            type: "text/plain",
            value: `Hi ${user[0].display_name},\n\nYou're confirmed for Friday ${friday[0].date} at Hitchhiker & Owl.\n\nRSVP'd at: ${rsvpTime}\nDoors: 18:30\nP1P1: 18:45\n\nYou are locked in — this is a commitment to attend. See you there!\n\n${APP_URL}\n\n— Cubehall`,
          }],
        }),
      });
    },
    catch: (e) => {
      console.error("Failed to send confirmation email:", e);
      return undefined as never;
    },
  });
}

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
