import type {
  Duration,
  ISO8601,
  NonNegativeInt,
  PodId,
  PositiveInt,
  RoundId,
} from "../ids.js";
import type { RoundState } from "./enums.js";

// ---------------------------------------------------------------------------
// Extension — time added to a round
// ---------------------------------------------------------------------------

export type Extension = {
  readonly addedAt: ISO8601;
  readonly addedSeconds: Duration;
};

// ---------------------------------------------------------------------------
// TimerState — server-authoritative round timer
// ---------------------------------------------------------------------------

export type TimerState =
  | { readonly kind: "not_started" }
  | { readonly kind: "running"; readonly startedAt: ISO8601; readonly deadline: ISO8601; readonly elapsed: Duration }
  | { readonly kind: "paused"; readonly pausedAt: ISO8601; readonly remaining: Duration }
  | { readonly kind: "additional_turns"; readonly turnsRemaining: NonNegativeInt }
  | { readonly kind: "finished"; readonly finishedAt: ISO8601 };

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------

export type Round = {
  readonly id: RoundId;
  readonly podId: PodId;
  readonly roundNumber: PositiveInt;
  readonly state: RoundState;
  readonly startedAt: ISO8601 | null;
  readonly endedAt: ISO8601 | null;
  readonly timeLimit: Duration;
  readonly extensions: ReadonlyArray<Extension>;
  readonly timer: TimerState;
};
