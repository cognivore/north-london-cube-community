import type {
  FridayId,
  ISO8601,
  LocalDate,
  VenueId,
} from "../ids.js";

// ---------------------------------------------------------------------------
// CancelReason
// ---------------------------------------------------------------------------

export type CancelReason =
  | "no_cubes"
  | "insufficient_rsvps"
  | "admin";

// ---------------------------------------------------------------------------
// FridayState — discriminated union (the central state machine)
//
// Linear path:  scheduled → open → locked → confirmed → in_progress → complete
// Cancelled is reachable from any non-terminal state.
//
// "open"      — enrollments + RSVPs accepted
// "locked"    — enrollments closed, the least-recently-played cube has been
//               picked, pods exist. Seating may not be finalized.
// "confirmed" — seating final, ready to fire
// "in_progress" — rounds are being played
// "complete" / "cancelled" — terminal
// ---------------------------------------------------------------------------

export type FridayState =
  | { readonly kind: "scheduled" }
  | { readonly kind: "open" }
  | { readonly kind: "locked" }
  | { readonly kind: "confirmed" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "complete" }
  | { readonly kind: "cancelled"; readonly reason: CancelReason };

// ---------------------------------------------------------------------------
// Friday
// ---------------------------------------------------------------------------

export type Friday = {
  readonly id: FridayId;
  readonly date: LocalDate;
  readonly venueId: VenueId;
  readonly state: FridayState;
  readonly createdAt: ISO8601;
  readonly lockedAt: ISO8601 | null;
  readonly confirmedAt: ISO8601 | null;
  readonly completedAt: ISO8601 | null;
};

// ---------------------------------------------------------------------------
// Terminal state check
// ---------------------------------------------------------------------------

export const isFridayTerminal = (state: FridayState): boolean =>
  state.kind === "cancelled" || state.kind === "complete";
