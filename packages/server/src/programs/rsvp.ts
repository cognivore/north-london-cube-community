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

export const rsvpIn = (input: { fridayId: string; userId: string }) =>
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
    yield* logger.info("RSVP created", { fridayId: input.fridayId, userId: input.userId });
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
