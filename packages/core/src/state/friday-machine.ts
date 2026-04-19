/**
 * Friday state machine — pure transition function.
 * Total case analysis via TypeScript exhaustiveness checking.
 */

import type { NonEmptyArray, Result } from "../brand.js";
import { err, ok } from "../brand.js";
import type { EnrollmentId, NonNegativeInt } from "../ids.js";
import type { CancelReason, FridayState, VoteContext } from "../model/friday.js";
import type { PodConfiguration } from "../model/pod.js";

// ---------------------------------------------------------------------------
// FridayEvent — inputs to the state machine
// ---------------------------------------------------------------------------

export type FridayEvent =
  | { readonly kind: "open_friday" }
  | { readonly kind: "close_enrollments" }
  | { readonly kind: "open_vote"; readonly vote: VoteContext }
  | { readonly kind: "skip_vote"; readonly winners: NonEmptyArray<EnrollmentId> }
  | { readonly kind: "cancel_no_cubes" }
  | { readonly kind: "close_vote"; readonly winners: NonEmptyArray<EnrollmentId> }
  | { readonly kind: "lock_friday"; readonly config: PodConfiguration; readonly seated: NonNegativeInt }
  | { readonly kind: "confirm" }
  | { readonly kind: "cancel_insufficient" }
  | { readonly kind: "begin" }
  | { readonly kind: "complete" }
  | { readonly kind: "admin_cancel"; readonly reason: string };

// ---------------------------------------------------------------------------
// TransitionError
// ---------------------------------------------------------------------------

export type TransitionError = {
  readonly from: FridayState["kind"];
  readonly event: FridayEvent["kind"];
  readonly message: string;
};

// ---------------------------------------------------------------------------
// transition — pure, total
// ---------------------------------------------------------------------------

export function transition(
  state: FridayState,
  event: FridayEvent,
): Result<FridayState, TransitionError> {
  // Admin cancel from any non-terminal state
  if (event.kind === "admin_cancel") {
    if (state.kind === "cancelled" || state.kind === "complete") {
      return err({
        from: state.kind,
        event: event.kind,
        message: `Cannot cancel a Friday in terminal state "${state.kind}"`,
      });
    }
    return ok({ kind: "cancelled", reason: "admin" as CancelReason });
  }

  switch (state.kind) {
    case "scheduled": {
      if (event.kind === "open_friday") {
        return ok({ kind: "open" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "open": {
      if (event.kind === "close_enrollments") {
        return ok({ kind: "enrollment_closed" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "enrollment_closed": {
      if (event.kind === "open_vote") {
        return ok({ kind: "vote_open", vote: event.vote });
      }
      if (event.kind === "skip_vote") {
        return ok({ kind: "vote_closed", winners: event.winners });
      }
      if (event.kind === "cancel_no_cubes") {
        return ok({ kind: "cancelled", reason: "no_cubes" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "vote_open": {
      if (event.kind === "close_vote") {
        return ok({ kind: "vote_closed", winners: event.winners });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "vote_closed": {
      if (event.kind === "lock_friday") {
        return ok({ kind: "locked", config: event.config });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "locked": {
      if (event.kind === "confirm") {
        return ok({ kind: "confirmed" });
      }
      if (event.kind === "cancel_insufficient") {
        return ok({ kind: "cancelled", reason: "insufficient_rsvps" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "confirmed": {
      if (event.kind === "begin") {
        return ok({ kind: "in_progress" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "in_progress": {
      if (event.kind === "complete") {
        return ok({ kind: "complete" });
      }
      return invalidTransition(state.kind, event.kind);
    }

    case "cancelled":
      return err({
        from: "cancelled",
        event: event.kind,
        message: "Cannot transition from terminal state 'cancelled'",
      });

    case "complete":
      return err({
        from: "complete",
        event: event.kind,
        message: "Cannot transition from terminal state 'complete'",
      });
  }

  // Exhaustiveness check
  const _exhaustive: never = state;
  return _exhaustive;
}

// ---------------------------------------------------------------------------
// RSVP / enrollment / vote acceptance checks
// ---------------------------------------------------------------------------

const RSVP_ACCEPTING_STATES: ReadonlySet<FridayState["kind"]> = new Set([
  "open",
  "enrollment_closed",
  "vote_open",
  "vote_closed",
]);

const ENROLLMENT_ACCEPTING_STATES: ReadonlySet<FridayState["kind"]> = new Set([
  "open",
]);

const VOTE_ACCEPTING_STATES: ReadonlySet<FridayState["kind"]> = new Set([
  "vote_open",
]);

export const canAcceptRsvp = (state: FridayState): boolean =>
  RSVP_ACCEPTING_STATES.has(state.kind);

export const canAcceptEnrollment = (state: FridayState): boolean =>
  ENROLLMENT_ACCEPTING_STATES.has(state.kind);

export const canAcceptVote = (state: FridayState): boolean =>
  VOTE_ACCEPTING_STATES.has(state.kind);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalidTransition(
  from: FridayState["kind"],
  event: FridayEvent["kind"],
): Result<never, TransitionError> {
  return err({
    from,
    event,
    message: `Invalid transition: "${event}" from state "${from}"`,
  });
}
