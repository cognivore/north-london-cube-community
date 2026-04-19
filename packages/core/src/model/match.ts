import type {
  ISO8601,
  MatchId,
  RoundId,
  UserId,
} from "../ids.js";

// ---------------------------------------------------------------------------
// MatchResult — discriminated union
// ---------------------------------------------------------------------------

export type MatchResult =
  | { readonly kind: "pending" }
  | { readonly kind: "reported"; readonly p1Wins: 0 | 1 | 2; readonly p2Wins: 0 | 1 | 2; readonly draws: 0 | 1 | 2 | 3 }
  | { readonly kind: "double_loss" }
  | { readonly kind: "unfinished"; readonly p1Wins: 0 | 1; readonly p2Wins: 0 | 1; readonly draws: number };

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export type Match = {
  readonly id: MatchId;
  readonly roundId: RoundId;
  readonly player1Id: UserId;
  readonly player2Id: UserId;
  readonly result: MatchResult;
  readonly submittedAt: ISO8601 | null;
  readonly submittedBy: UserId | null;
};

// ---------------------------------------------------------------------------
// PlannedMatch — output of pairings engine
// ---------------------------------------------------------------------------

export type PlannedMatch = {
  readonly player1Id: UserId;
  readonly player2Id: UserId;
};
