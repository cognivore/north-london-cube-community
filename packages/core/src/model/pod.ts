import type { NonEmptyArray } from "../brand.js";
import type {
  CubeId,
  EvenPodSize,
  FridayId,
  NonNegativeInt,
  PodId,
  PositiveInt,
  TeamId,
  UserId,
} from "../ids.js";
import type { DraftFormat, PodState } from "./enums.js";
import type { PairingsTemplate } from "../engine/pairings-types.js";

// ---------------------------------------------------------------------------
// Seat
// ---------------------------------------------------------------------------

export type Seat = {
  readonly podId: PodId;
  readonly seatIndex: NonNegativeInt;
  readonly userId: UserId;
  readonly team: TeamId | null;
};

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

export type Pod = {
  readonly id: PodId;
  readonly fridayId: FridayId;
  readonly cubeId: CubeId;
  readonly hostId: UserId;
  readonly format: DraftFormat;
  readonly seats: ReadonlyArray<Seat>;
  readonly state: PodState;
  readonly pairingsTemplate: PairingsTemplate;
};

// ---------------------------------------------------------------------------
// ExclusionReason
// ---------------------------------------------------------------------------

export type ExclusionReason =
  | "over_capacity"
  | "format_mismatch"
  | "banned";

// ---------------------------------------------------------------------------
// PlannedPod — output of pod-packing algorithm
// ---------------------------------------------------------------------------

export type PlannedPod = {
  readonly cubeId: CubeId;
  readonly hostId: UserId;
  readonly format: DraftFormat;
  readonly size: EvenPodSize;
  readonly seats: NonEmptyArray<{ readonly seatIndex: NonNegativeInt; readonly userId: UserId }>;
};

// ---------------------------------------------------------------------------
// PodConfiguration — attached to locked state
// ---------------------------------------------------------------------------

export type PodConfiguration = {
  readonly pods: NonEmptyArray<PlannedPod>;
  readonly waitlisted: ReadonlyArray<UserId>;
  readonly excluded: ReadonlyArray<{ readonly userId: UserId; readonly reason: ExclusionReason }>;
  readonly summary: {
    readonly seated: NonNegativeInt;
    readonly rsvpd: NonNegativeInt;
    readonly capacity: PositiveInt;
  };
};
