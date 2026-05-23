/**
 * Friday state machine — pure transition function.
 * Total case analysis via TypeScript exhaustiveness checking.
 *
 * Linear path:
 *   scheduled --open_friday-->      open
 *   open      --close_enrollments-> locked        (cube is picked + pods formed
 *                                                  by the lifecycle driver as
 *                                                  part of this transition)
 *   open      --cancel_no_cubes-->  cancelled
 *   locked    --confirm-->          confirmed
 *   locked    --cancel_insufficient->cancelled
 *   confirmed --begin-->            in_progress
 *   in_progress --complete-->       complete
 *   * --admin_cancel--> cancelled  (from any non-terminal)
 */

import type { Result } from "../brand.js";
import { err, ok } from "../brand.js";
import type { CancelReason, FridayState } from "../model/friday.js";

// ---------------------------------------------------------------------------
// FridayEvent — inputs to the state machine
// ---------------------------------------------------------------------------

export type FridayEvent =
  | { readonly kind: "open_friday" }
  | { readonly kind: "close_enrollments" }
  | { readonly kind: "cancel_no_cubes" }
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
        return ok({ kind: "locked" });
      }
      if (event.kind === "cancel_no_cubes") {
        return ok({ kind: "cancelled", reason: "no_cubes" });
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
// RSVP / enrollment acceptance checks
// ---------------------------------------------------------------------------

const RSVP_ACCEPTING_STATES: ReadonlySet<FridayState["kind"]> = new Set([
  "open",
]);

const ENROLLMENT_ACCEPTING_STATES: ReadonlySet<FridayState["kind"]> = new Set([
  "open",
]);

export const canAcceptRsvp = (state: FridayState): boolean =>
  RSVP_ACCEPTING_STATES.has(state.kind);

export const canAcceptEnrollment = (state: FridayState): boolean =>
  ENROLLMENT_ACCEPTING_STATES.has(state.kind);

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
