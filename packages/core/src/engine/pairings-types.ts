/**
 * Types for the pairings engine — separated from implementation
 * so model types can reference them without circular dependencies.
 */

import type { NonEmptyArray } from "../brand.js";
import type {
  EvenPodSize,
  NonNegativeInt,
  PositiveInt,
  UserId,
} from "../ids.js";
import type { DraftFormat } from "../model/enums.js";
import type { Match, PlannedMatch } from "../model/match.js";
import type { Seat } from "../model/pod.js";

// ---------------------------------------------------------------------------
// Tiebreaker
// ---------------------------------------------------------------------------

export const TIEBREAKERS = [
  "match_points",
  "opponent_match_win_percent",
  "game_win_percent",
  "head_to_head",
  "random",
] as const;

export type Tiebreaker = (typeof TIEBREAKERS)[number];

// ---------------------------------------------------------------------------
// PairingStrategy
// ---------------------------------------------------------------------------

export type PairingStrategy =
  | { readonly kind: "swiss"; readonly tiebreakers: ReadonlyArray<Tiebreaker> }
  | { readonly kind: "round_robin_cross_team"; readonly teamSize: PositiveInt }
  | { readonly kind: "swiss_cross_team"; readonly teamSize: PositiveInt }
  | { readonly kind: "single_elimination" };

// ---------------------------------------------------------------------------
// PairingsTemplate
// ---------------------------------------------------------------------------

export type PairingsTemplate = {
  readonly format: DraftFormat;
  readonly podSize: EvenPodSize;
  readonly rounds: PositiveInt;
  readonly strategy: PairingStrategy;
};

// ---------------------------------------------------------------------------
// PairingInput / Output
// ---------------------------------------------------------------------------

export type PairingInput = {
  readonly template: PairingsTemplate;
  readonly seats: NonEmptyArray<Seat>;
  readonly history: ReadonlyArray<Match>;
  readonly currentRound: PositiveInt;
};

export type PairingOutput =
  | { readonly _tag: "Ok"; readonly pairings: NonEmptyArray<PlannedMatch> }
  | { readonly _tag: "Err"; readonly error: PairingError };

export type PairingError =
  | { readonly kind: "invalid_pod_size"; readonly expected: EvenPodSize; readonly got: number }
  | { readonly kind: "impossible_constraint"; readonly reason: string };

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

export type Standing = {
  readonly userId: UserId;
  readonly matchPoints: NonNegativeInt;
  readonly gamePoints: NonNegativeInt;
  readonly omwPercent: number;
  readonly gwPercent: number;
  readonly rank: PositiveInt;
};
