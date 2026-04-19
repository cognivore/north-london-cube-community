import type { NonEmptyArray } from "../brand.js";
import type {
  EnrollmentId,
  FridayId,
  ISO8601,
  LocalDate,
  VenueId,
} from "../ids.js";
import type { PodConfiguration } from "./pod.js";

// ---------------------------------------------------------------------------
// VoteContext — attached to vote_open state
// ---------------------------------------------------------------------------

export type VoteContext = {
  readonly candidates: NonEmptyArray<EnrollmentId>;
  readonly opensAt: ISO8601;
  readonly closesAt: ISO8601;
};

// ---------------------------------------------------------------------------
// CancelReason
// ---------------------------------------------------------------------------

export type CancelReason =
  | "no_cubes"
  | "insufficient_rsvps"
  | "admin";

// ---------------------------------------------------------------------------
// FridayState — discriminated union (the central state machine)
// ---------------------------------------------------------------------------

export type FridayState =
  | { readonly kind: "scheduled" }
  | { readonly kind: "open" }
  | { readonly kind: "enrollment_closed" }
  | { readonly kind: "vote_open"; readonly vote: VoteContext }
  | { readonly kind: "vote_closed"; readonly winners: NonEmptyArray<EnrollmentId> }
  | { readonly kind: "locked"; readonly config: PodConfiguration }
  | { readonly kind: "confirmed" }
  | { readonly kind: "cancelled"; readonly reason: CancelReason }
  | { readonly kind: "in_progress" }
  | { readonly kind: "complete" };

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
