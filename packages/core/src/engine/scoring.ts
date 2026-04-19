/**
 * Standings computation engine — pure functions, no IO.
 *
 * Computes standings from match data using standard Swiss-style scoring:
 * - matchPoints: 3 per match win, 0 per loss, 1 per draw
 * - gamePoints: 3 per game win, 0 per loss, 1 per draw
 * - omwPercent: average of opponents' match win percentages (floor 0.33)
 * - gwPercent: player's own game win percentage
 *
 * Ranking: matchPoints desc -> omwPercent desc -> gwPercent desc -> userId asc
 */

import type { NonEmptyArray } from "../brand.js";
import type { NonNegativeInt, PositiveInt, UserId } from "../ids.js";
import type { Match, MatchResult } from "../model/match.js";
import type { Seat } from "../model/pod.js";
import type { Standing } from "./pairings-types.js";

// ---------------------------------------------------------------------------
// Internal accumulators
// ---------------------------------------------------------------------------

type PlayerStats = {
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  gameWins: number;
  gameLosses: number;
  gameDraws: number;
  opponents: string[];
};

const OMW_FLOOR = 0.33;

// ---------------------------------------------------------------------------
// Match result analysis
// ---------------------------------------------------------------------------

/**
 * Determine the match outcome for player1 from a reported match result.
 * Returns 'win' | 'loss' | 'draw'.
 */
function matchOutcome(
  result: MatchResult,
): { p1: "win" | "loss" | "draw"; p2: "win" | "loss" | "draw" } | null {
  if (result.kind === "reported") {
    if (result.p1Wins > result.p2Wins) {
      return { p1: "win", p2: "loss" };
    } else if (result.p2Wins > result.p1Wins) {
      return { p1: "loss", p2: "win" };
    } else {
      return { p1: "draw", p2: "draw" };
    }
  }

  if (result.kind === "double_loss") {
    return { p1: "loss", p2: "loss" };
  }

  // pending and unfinished matches do not contribute to standings
  return null;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

function initStats(): PlayerStats {
  return {
    matchWins: 0,
    matchLosses: 0,
    matchDraws: 0,
    gameWins: 0,
    gameLosses: 0,
    gameDraws: 0,
    opponents: [],
  };
}

function computeMatchPoints(stats: PlayerStats): number {
  return stats.matchWins * 3 + stats.matchDraws * 1;
}

function computeGamePoints(stats: PlayerStats): number {
  return stats.gameWins * 3 + stats.gameDraws * 1;
}

/**
 * Match win percentage for a player. If they've played no reportable matches,
 * returns the floor value (0.33).
 */
function matchWinPercent(stats: PlayerStats): number {
  const totalMatchPoints = stats.matchWins * 3 + stats.matchDraws * 1;
  const maxMatchPoints = (stats.matchWins + stats.matchLosses + stats.matchDraws) * 3;
  if (maxMatchPoints === 0) return OMW_FLOOR;
  return Math.max(totalMatchPoints / maxMatchPoints, OMW_FLOOR);
}

/**
 * Game win percentage for a player. If they've played no reportable games,
 * returns 0.
 */
function gameWinPercent(stats: PlayerStats): number {
  const totalGamePoints = stats.gameWins * 3 + stats.gameDraws * 1;
  const maxGamePoints = (stats.gameWins + stats.gameLosses + stats.gameDraws) * 3;
  if (maxGamePoints === 0) return 0;
  return totalGamePoints / maxGamePoints;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute standings from player IDs and match history.
 *
 * Only "reported" and "double_loss" matches contribute to standings.
 * Pending and unfinished matches are ignored.
 *
 * Rankings form a total order — no two players share the same rank.
 * Ties are broken by userId as a last resort.
 */
export function computeStandings(
  playerIds: NonEmptyArray<UserId>,
  matches: ReadonlyArray<Match>,
): NonEmptyArray<Standing> {
  // Initialize stats for all players
  const statsMap = new Map<string, PlayerStats>();
  for (const pid of playerIds) {
    statsMap.set(pid as string, initStats());
  }

  // Accumulate stats from matches
  for (const match of matches) {
    const p1 = match.player1Id as string;
    const p2 = match.player2Id as string;

    const outcome = matchOutcome(match.result);
    if (outcome === null) continue;

    // Ensure both players have stats entries (they should from playerIds, but be safe)
    if (!statsMap.has(p1)) statsMap.set(p1, initStats());
    if (!statsMap.has(p2)) statsMap.set(p2, initStats());

    const s1 = statsMap.get(p1)!;
    const s2 = statsMap.get(p2)!;

    // Record opponents
    s1.opponents.push(p2);
    s2.opponents.push(p1);

    // Match outcomes
    if (outcome.p1 === "win") {
      s1.matchWins++;
      s2.matchLosses++;
    } else if (outcome.p1 === "loss") {
      s1.matchLosses++;
      if (outcome.p2 === "win") {
        s2.matchWins++;
      } else {
        // double_loss: both get losses
        s2.matchLosses++;
      }
    } else {
      // draw
      s1.matchDraws++;
      s2.matchDraws++;
    }

    // Game-level points (only for reported matches with game detail)
    if (match.result.kind === "reported") {
      const r = match.result;
      s1.gameWins += r.p1Wins;
      s1.gameLosses += r.p2Wins;
      s1.gameDraws += r.draws;

      s2.gameWins += r.p2Wins;
      s2.gameLosses += r.p1Wins;
      s2.gameDraws += r.draws;
    }
    // double_loss: no game points awarded
  }

  // Compute OMW% for each player
  // First compute each player's MWP, then average opponents' MWPs
  const mwpMap = new Map<string, number>();
  for (const pid of playerIds) {
    const stats = statsMap.get(pid as string)!;
    mwpMap.set(pid as string, matchWinPercent(stats));
  }

  const omwMap = new Map<string, number>();
  for (const pid of playerIds) {
    const stats = statsMap.get(pid as string)!;
    if (stats.opponents.length === 0) {
      omwMap.set(pid as string, OMW_FLOOR);
    } else {
      const opponentMwps = stats.opponents.map((opp) => mwpMap.get(opp) ?? OMW_FLOOR);
      const avgOmw = opponentMwps.reduce((sum, v) => sum + v, 0) / opponentMwps.length;
      omwMap.set(pid as string, avgOmw);
    }
  }

  // Build unsorted standings
  const unsorted = playerIds.map((pid) => {
    const stats = statsMap.get(pid as string)!;
    return {
      userId: pid,
      matchPoints: computeMatchPoints(stats) as NonNegativeInt,
      gamePoints: computeGamePoints(stats) as NonNegativeInt,
      omwPercent: omwMap.get(pid as string) ?? OMW_FLOOR,
      gwPercent: gameWinPercent(stats),
      rank: 1 as PositiveInt, // placeholder, assigned after sort
    };
  });

  // Sort: matchPoints desc -> omwPercent desc -> gwPercent desc -> userId asc
  unsorted.sort((a, b) => {
    if (a.matchPoints !== b.matchPoints) return (b.matchPoints as number) - (a.matchPoints as number);
    if (a.omwPercent !== b.omwPercent) return b.omwPercent - a.omwPercent;
    if (a.gwPercent !== b.gwPercent) return b.gwPercent - a.gwPercent;
    // Last resort: userId lexicographic ascending for total order
    return (a.userId as string) < (b.userId as string) ? -1 : 1;
  });

  // Assign ranks (1-indexed, strict total order)
  const standings: Standing[] = unsorted.map((s, idx) => ({
    ...s,
    rank: (idx + 1) as PositiveInt,
  }));

  return standings as NonEmptyArray<Standing>;
}

// ---------------------------------------------------------------------------
// Team score computation
// ---------------------------------------------------------------------------

/**
 * Compute team scores from standings and seat assignments.
 *
 * Each player's match points contribute to their team's total.
 * The team with the higher total wins; equal totals produce a draw.
 */
export function computeTeamScore(
  standings: ReadonlyArray<Standing>,
  seats: ReadonlyArray<Seat>,
): { teamA: number; teamB: number; winner: "A" | "B" | "draw" } {
  // Build lookup: userId -> team
  const teamMap = new Map<string, string>();
  for (const seat of seats) {
    if (seat.team !== null) {
      teamMap.set(seat.userId as string, seat.team as string);
    }
  }

  let teamA = 0;
  let teamB = 0;

  for (const standing of standings) {
    const team = teamMap.get(standing.userId as string);
    if (team === "A") {
      teamA += standing.matchPoints as number;
    } else if (team === "B") {
      teamB += standing.matchPoints as number;
    }
  }

  const winner: "A" | "B" | "draw" =
    teamA > teamB ? "A" : teamB > teamA ? "B" : "draw";

  return { teamA, teamB, winner };
}
