/**
 * Pure, deterministic pairings engine.
 *
 * Dispatches by strategy kind:
 *  - "swiss"                → Swiss pairing (4/6/8 players, 3 rounds)
 *  - "round_robin_cross_team" → Team draft 3v3 (6 players, Latin-square)
 *  - "swiss_cross_team"     → Team draft 4v4 (8 players, cross-team Swiss)
 *
 * No side effects, no randomness, fully deterministic.
 */

import type { NonEmptyArray } from "../brand.js";
import type { EvenPodSize, UserId } from "../ids.js";
import type { Match, PlannedMatch } from "../model/match.js";
import type { Seat } from "../model/pod.js";
import type {
  PairingInput,
  PairingOutput,
} from "./pairings-types.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generatePairings(input: PairingInput): PairingOutput {
  const { template, seats, history, currentRound } = input;
  const { strategy, podSize } = template;

  // Validate seat count matches expected pod size
  if (seats.length !== (podSize as number)) {
    return {
      _tag: "Err",
      error: {
        kind: "invalid_pod_size",
        expected: podSize,
        got: seats.length,
      },
    };
  }

  switch (strategy.kind) {
    case "swiss":
      return generateSwiss(seats, history, currentRound as number, podSize);

    case "round_robin_cross_team":
      return generateRoundRobinCrossTeam(
        seats,
        currentRound as number,
        podSize,
      );

    case "swiss_cross_team":
      return generateSwissCrossTeam(
        seats,
        history,
        currentRound as number,
        podSize,
      );

    case "single_elimination":
      return {
        _tag: "Err",
        error: {
          kind: "impossible_constraint",
          reason: "single_elimination is not yet implemented",
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Match-point helpers
// ---------------------------------------------------------------------------

/**
 * Returns 3 for a win, 0 for a loss, 0 for a double-loss.
 * Draws in a best-of-3: each draw game is worth 1 point
 * but for match-level Swiss, a draw match (same wins) is not
 * possible in best-of-3 — the result is always decisive.
 * We award 3 for a match win, 0 for a loss.
 */
function matchPointsForPlayer(m: Match, playerId: UserId): number {
  const r = m.result;
  switch (r.kind) {
    case "pending":
    case "unfinished":
      return 0;
    case "double_loss":
      return 0;
    case "reported": {
      if (r.p1Wins > r.p2Wins) {
        return m.player1Id === playerId ? 3 : 0;
      }
      if (r.p2Wins > r.p1Wins) {
        return m.player2Id === playerId ? 3 : 0;
      }
      // Drawn match (equal game wins — unusual but possible in bo3 with draws)
      return 1;
    }
  }
}

type PlayerPoints = { readonly userId: UserId; readonly points: number };

function computeMatchPoints(
  seats: ReadonlyArray<Seat>,
  history: ReadonlyArray<Match>,
): PlayerPoints[] {
  const pointsMap = new Map<string, number>();

  for (const seat of seats) {
    pointsMap.set(seat.userId as string, 0);
  }

  for (const match of history) {
    const p1Key = match.player1Id as string;
    const p2Key = match.player2Id as string;
    if (pointsMap.has(p1Key)) {
      pointsMap.set(
        p1Key,
        (pointsMap.get(p1Key) ?? 0) + matchPointsForPlayer(match, match.player1Id),
      );
    }
    if (pointsMap.has(p2Key)) {
      pointsMap.set(
        p2Key,
        (pointsMap.get(p2Key) ?? 0) + matchPointsForPlayer(match, match.player2Id),
      );
    }
  }

  return seats.map((seat) => ({
    userId: seat.userId,
    points: pointsMap.get(seat.userId as string) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Previous-opponent tracking
// ---------------------------------------------------------------------------

function buildOpponentSet(
  history: ReadonlyArray<Match>,
): Map<string, Set<string>> {
  const opps = new Map<string, Set<string>>();

  const addPair = (a: string, b: string): void => {
    if (!opps.has(a)) opps.set(a, new Set());
    if (!opps.has(b)) opps.set(b, new Set());
    opps.get(a)!.add(b);
    opps.get(b)!.add(a);
  };

  for (const m of history) {
    addPair(m.player1Id as string, m.player2Id as string);
  }
  return opps;
}

function havePlayed(
  opps: Map<string, Set<string>>,
  a: UserId,
  b: UserId,
): boolean {
  return opps.get(a as string)?.has(b as string) ?? false;
}

// ---------------------------------------------------------------------------
// Swiss pairing (4/6/8 players, 3 rounds)
// ---------------------------------------------------------------------------

function generateSwiss(
  seats: NonEmptyArray<Seat>,
  history: ReadonlyArray<Match>,
  currentRound: number,
  _podSize: EvenPodSize,
): PairingOutput {
  const n = seats.length;

  // Round 1: seat-distance pairing
  if (currentRound === 1) {
    return okPairings(seatDistancePairings(seats, n));
  }

  // Rounds 2+: pair by match points, avoiding rematches
  return swissPointsPairing(seats, history);
}

/**
 * Seat-distance pairing: player i plays player (i + N/2) mod N.
 */
function seatDistancePairings(
  seats: ReadonlyArray<Seat>,
  n: number,
): PlannedMatch[] {
  const half = n / 2;
  const matches: PlannedMatch[] = [];
  for (let i = 0; i < half; i++) {
    const s1 = seats[i]!;
    const s2 = seats[i + half]!;
    matches.push({ player1Id: s1.userId, player2Id: s2.userId });
  }
  return matches;
}

/**
 * Swiss pairing by match points.
 *
 * Groups players by match points (descending). Tries to pair within
 * each group, avoiding rematches. Players that cannot be paired within
 * their group float down. If the only available pairing is a rematch,
 * it is allowed.
 *
 * Uses a greedy algorithm: sort players by (points desc, seatIndex asc),
 * then pair greedily, preferring unplayed opponents. This is deterministic
 * because seat order is the tiebreaker.
 */
function swissPointsPairing(
  seats: NonEmptyArray<Seat>,
  history: ReadonlyArray<Match>,
): PairingOutput {
  const standings = computeMatchPoints(seats, history);
  const opps = buildOpponentSet(history);

  // Sort by points descending, then seat index ascending for determinism
  const seatIndexMap = new Map<string, number>();
  for (const seat of seats) {
    seatIndexMap.set(seat.userId as string, seat.seatIndex as number);
  }

  const sorted = [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (
      (seatIndexMap.get(a.userId as string) ?? 0) -
      (seatIndexMap.get(b.userId as string) ?? 0)
    );
  });

  const result = greedyPair(sorted, opps);
  if (result !== null) {
    return okPairings(result);
  }

  // Fallback: if greedy fails (shouldn't for valid inputs), return error
  return {
    _tag: "Err",
    error: {
      kind: "impossible_constraint",
      reason: "Could not generate a valid Swiss pairing",
    },
  };
}

/**
 * Greedy pairing with backtracking.
 *
 * Attempts to pair the first unpaired player with the best available
 * partner (same points, no rematch). If no rematch-free partner exists,
 * allows rematches. Uses recursive backtracking to handle edge cases
 * where greedy choices create dead ends.
 */
function greedyPair(
  sorted: PlayerPoints[],
  opps: Map<string, Set<string>>,
): PlannedMatch[] | null {
  const n = sorted.length;
  const paired = new Array<boolean>(n).fill(false);
  const matches: PlannedMatch[] = [];

  function backtrack(): boolean {
    // Find first unpaired player
    let firstUnpaired = -1;
    for (let i = 0; i < n; i++) {
      if (!paired[i]) {
        firstUnpaired = i;
        break;
      }
    }
    if (firstUnpaired === -1) return true; // All paired

    const player = sorted[firstUnpaired]!;

    // Build candidate list: prefer same points + no rematch, then no rematch, then rematch
    const candidates: number[] = [];
    for (let j = firstUnpaired + 1; j < n; j++) {
      if (!paired[j]) candidates.push(j);
    }

    // Sort candidates: prefer (1) no rematch + same points, (2) no rematch, (3) rematch
    candidates.sort((a, b) => {
      const aPlayer = sorted[a]!;
      const bPlayer = sorted[b]!;
      const aRematch = havePlayed(opps, player.userId, aPlayer.userId);
      const bRematch = havePlayed(opps, player.userId, bPlayer.userId);
      const aSamePoints = aPlayer.points === player.points;
      const bSamePoints = bPlayer.points === player.points;

      // Prefer no-rematch over rematch
      if (aRematch !== bRematch) return aRematch ? 1 : -1;
      // Prefer same points
      if (aSamePoints !== bSamePoints) return aSamePoints ? -1 : 1;
      // Preserve existing order (closer points)
      return a - b;
    });

    for (const j of candidates) {
      const opponent = sorted[j]!;
      paired[firstUnpaired] = true;
      paired[j] = true;
      matches.push({ player1Id: player.userId, player2Id: opponent.userId });

      if (backtrack()) return true;

      // Undo
      paired[firstUnpaired] = false;
      paired[j] = false;
      matches.pop();
    }

    return false;
  }

  return backtrack() ? matches : null;
}

// ---------------------------------------------------------------------------
// Team draft 3v3 — Round-robin cross-team (Latin square)
// ---------------------------------------------------------------------------

/**
 * 6 players, seats 0,2,4 -> Team A; seats 1,3,5 -> Team B.
 * 3 rounds, every A plays every B exactly once.
 *
 * Latin square:
 *   Round 1: A0-B0, A1-B1, A2-B2
 *   Round 2: A0-B1, A1-B2, A2-B0
 *   Round 3: A0-B2, A1-B0, A2-B1
 */
function generateRoundRobinCrossTeam(
  seats: NonEmptyArray<Seat>,
  currentRound: number,
  podSize: EvenPodSize,
): PairingOutput {
  if ((podSize as number) !== 6) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: `round_robin_cross_team requires pod size 6, got ${podSize as number}`,
      },
    };
  }

  if (currentRound < 1 || currentRound > 3) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: `round_robin_cross_team supports rounds 1-3, got ${currentRound}`,
      },
    };
  }

  const { teamA, teamB } = splitTeams(seats);

  if (teamA.length !== 3 || teamB.length !== 3) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: `Expected 3v3, got ${teamA.length}v${teamB.length}`,
      },
    };
  }

  const roundIndex = currentRound - 1; // 0, 1, or 2
  const matches: PlannedMatch[] = [];

  for (let i = 0; i < 3; i++) {
    const aPlayer = teamA[i]!;
    const bPlayer = teamB[(i + roundIndex) % 3]!;
    matches.push({ player1Id: aPlayer, player2Id: bPlayer });
  }

  return okPairings(matches);
}

// ---------------------------------------------------------------------------
// Team draft 4v4 — Swiss-biased cross-team
// ---------------------------------------------------------------------------

/**
 * 8 players, seats 0,2,4,6 -> Team A; seats 1,3,5,7 -> Team B.
 * 3 rounds, all cross-team, no intra-team matches.
 *
 * Round 1: seat-distance (A0-B0, A1-B1, A2-B2, A3-B3)
 * Rounds 2,3: Swiss-biased cross-team pairing — pair by similar
 *   match points, avoid rematches, balanced miss pattern.
 *   Each A misses exactly one B over 3 rounds.
 */
function generateSwissCrossTeam(
  seats: NonEmptyArray<Seat>,
  history: ReadonlyArray<Match>,
  currentRound: number,
  podSize: EvenPodSize,
): PairingOutput {
  if ((podSize as number) !== 8) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: `swiss_cross_team requires pod size 8, got ${podSize as number}`,
      },
    };
  }

  const { teamA, teamB } = splitTeams(seats);

  if (teamA.length !== 4 || teamB.length !== 4) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: `Expected 4v4, got ${teamA.length}v${teamB.length}`,
      },
    };
  }

  // Round 1: seat-distance — A0-B0, A1-B1, A2-B2, A3-B3
  if (currentRound === 1) {
    const matches: PlannedMatch[] = [];
    for (let i = 0; i < 4; i++) {
      matches.push({ player1Id: teamA[i]!, player2Id: teamB[i]! });
    }
    return okPairings(matches);
  }

  // Rounds 2,3: Swiss-biased cross-team
  return swissCrossTeamPairing(seats, teamA, teamB, history);
}

/**
 * Swiss-biased cross-team pairing for 4v4.
 *
 * Pairs each A player with a B player, preferring:
 *   1. Similar match points
 *   2. No rematch
 *   3. Balanced misses (each A misses exactly 1 B over 3 rounds)
 *
 * Uses minimum-weight bipartite matching via the Hungarian-like
 * backtracking approach (sufficient for N=4).
 */
function swissCrossTeamPairing(
  seats: ReadonlyArray<Seat>,
  teamA: UserId[],
  teamB: UserId[],
  history: ReadonlyArray<Match>,
): PairingOutput {
  const standings = computeMatchPoints(seats, history);
  const pointsMap = new Map<string, number>();
  for (const s of standings) {
    pointsMap.set(s.userId as string, s.points);
  }

  const opps = buildOpponentSet(history);

  // Cost matrix: teamA[i] vs teamB[j]
  // Lower cost = better pairing
  const n = teamA.length; // 4
  const cost: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    const aId = teamA[i]!;
    const aPoints = pointsMap.get(aId as string) ?? 0;

    for (let j = 0; j < n; j++) {
      const bId = teamB[j]!;
      const bPoints = pointsMap.get(bId as string) ?? 0;

      // Point difference penalty (major factor)
      const pointDiff = Math.abs(aPoints - bPoints);

      // Rematch penalty
      const rematchPenalty = havePlayed(opps, aId, bId) ? 100 : 0;

      row.push(pointDiff + rematchPenalty);
    }
    cost.push(row);
  }

  // Find minimum-cost perfect matching via brute-force (4! = 24 permutations)
  const bestAssignment = minCostPerfectMatching(cost, n);

  if (bestAssignment === null) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: "Could not find valid cross-team pairing",
      },
    };
  }

  const matches: PlannedMatch[] = [];
  for (let i = 0; i < n; i++) {
    matches.push({
      player1Id: teamA[i]!,
      player2Id: teamB[bestAssignment[i]!]!,
    });
  }

  return okPairings(matches);
}

/**
 * Brute-force minimum-cost perfect matching for an NxN cost matrix.
 * Returns the column assignment for each row, or null if impossible.
 * For N=4, this evaluates 24 permutations — perfectly acceptable.
 */
function minCostPerfectMatching(
  cost: number[][],
  n: number,
): number[] | null {
  let bestCost = Infinity;
  let bestPerm: number[] | null = null;

  const perm: number[] = [];
  const used = new Array<boolean>(n).fill(false);

  function search(row: number, currentCost: number): void {
    if (row === n) {
      if (currentCost < bestCost) {
        bestCost = currentCost;
        bestPerm = [...perm];
      }
      return;
    }

    for (let col = 0; col < n; col++) {
      if (!used[col]) {
        const newCost = currentCost + cost[row]![col]!;
        // Prune if already worse than best
        if (newCost >= bestCost) continue;

        used[col] = true;
        perm.push(col);
        search(row + 1, newCost);
        perm.pop();
        used[col] = false;
      }
    }
  }

  search(0, 0);
  return bestPerm;
}

// ---------------------------------------------------------------------------
// Team-splitting helper
// ---------------------------------------------------------------------------

/**
 * Split seats into two teams by seat index parity.
 * Even indices (0, 2, 4, ...) → Team A
 * Odd indices  (1, 3, 5, ...) → Team B
 *
 * Returns user IDs sorted by seat index within each team.
 */
function splitTeams(seats: ReadonlyArray<Seat>): {
  teamA: UserId[];
  teamB: UserId[];
} {
  const sorted = [...seats].sort(
    (a, b) => (a.seatIndex as number) - (b.seatIndex as number),
  );

  const teamA: UserId[] = [];
  const teamB: UserId[] = [];

  for (const seat of sorted) {
    if ((seat.seatIndex as number) % 2 === 0) {
      teamA.push(seat.userId);
    } else {
      teamB.push(seat.userId);
    }
  }

  return { teamA, teamB };
}

// ---------------------------------------------------------------------------
// Output helper
// ---------------------------------------------------------------------------

function okPairings(matches: PlannedMatch[]): PairingOutput {
  if (matches.length === 0) {
    return {
      _tag: "Err",
      error: {
        kind: "impossible_constraint",
        reason: "Generated zero pairings",
      },
    };
  }
  return {
    _tag: "Ok",
    pairings: matches as NonEmptyArray<PlannedMatch>,
  };
}
