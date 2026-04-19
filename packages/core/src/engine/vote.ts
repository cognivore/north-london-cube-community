/**
 * Instant Runoff Voting (IRV) engine.
 *
 * Pure, deterministic, and total. No side effects.
 *
 * Algorithm:
 *   1. Run IRV to select a first-place winner.
 *   2. Remove that winner from every ballot.
 *   3. Run IRV again to select a second-place winner.
 *
 * IRV round:
 *   - Count first-choice votes for each remaining candidate.
 *   - If any candidate has a strict majority (> 50%), they win.
 *   - Otherwise, eliminate the candidate with the fewest first-choice votes.
 *     Tie in elimination broken by: (a) cube with the most-recent lastRunAt
 *     is eliminated first (i.e. we *keep* the cube not run recently);
 *     (b) reverse-alphabetical on cube name (Z before A, so A survives).
 *   - Redistribute eliminated candidate's ballots to each voter's next choice.
 *   - Repeat until a winner emerges or one candidate remains.
 */

import type { NonEmptyArray, Result } from "../brand.js";
import { err, isNonEmpty, ok } from "../brand.js";
import type { EnrollmentId, ISO8601 } from "../ids.js";
import type { Cube } from "../model/cube.js";
import type { Enrollment } from "../model/enrollment.js";
import type { Vote } from "../model/vote.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type VoteInput = {
  readonly votes: ReadonlyArray<Vote>;
  readonly enrollments: ReadonlyArray<Enrollment>;
  readonly cubes: ReadonlyArray<Cube>;
};

export type VoteResult = {
  readonly winners: NonEmptyArray<EnrollmentId>;
  readonly rounds: ReadonlyArray<IRVRound>;
};

export type IRVRound = {
  readonly roundNumber: number;
  readonly tallies: ReadonlyArray<{ enrollmentId: EnrollmentId; votes: number }>;
  readonly eliminated: EnrollmentId | null;
  readonly winner: EnrollmentId | null;
};

export type VoteError =
  | { readonly kind: "no_enrollments" }
  | { readonly kind: "no_votes" };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runIRV(input: VoteInput): Result<VoteResult, VoteError> {
  const { votes, enrollments, cubes } = input;

  // Filter to active (non-withdrawn) enrollments.
  const activeEnrollments = enrollments.filter((e) => !e.withdrawn);

  if (activeEnrollments.length === 0) {
    return err({ kind: "no_enrollments" });
  }

  // For <= 2 enrollments, skip the vote entirely.
  const activeIds = activeEnrollments.map((e) => e.id);
  if (activeIds.length <= 2) {
    // Guaranteed non-empty because length >= 1.
    return ok({
      winners: activeIds as NonEmptyArray<EnrollmentId>,
      rounds: [],
    });
  }

  // Abstaining users are not counted — only process submitted votes.
  if (votes.length === 0) {
    return err({ kind: "no_votes" });
  }

  // Build lookup maps for tiebreaking.
  const cubeById = new Map<string, Cube>();
  for (const c of cubes) {
    cubeById.set(c.id as string, c);
  }

  const enrollmentById = new Map<string, Enrollment>();
  for (const e of activeEnrollments) {
    enrollmentById.set(e.id as string, e);
  }

  // Build the candidate set (active enrollment IDs).
  const candidateSet = new Set<string>(activeIds.map((id) => id as string));

  // Build ballots: each vote's ranking, filtered to only active enrollment IDs.
  const ballots: string[][] = votes.map((v) =>
    (v.ranking as ReadonlyArray<EnrollmentId>)
      .map((id) => id as string)
      .filter((id) => candidateSet.has(id)),
  );

  // --- Pass 1: elect first winner ---
  const pass1 = runSingleIRV(
    ballots.map((b) => [...b]),
    new Set(candidateSet),
    enrollmentById,
    cubeById,
    1,
  );

  if (pass1.winner === null) {
    // Should not happen if there is at least one candidate and one vote,
    // but handle defensively.
    return err({ kind: "no_votes" });
  }

  const allRounds: IRVRound[] = [...pass1.rounds];
  const winners: EnrollmentId[] = [pass1.winner as EnrollmentId];

  // --- Pass 2: elect second winner ---
  // Remove the first winner from every ballot and from the candidate set.
  const remainingCandidates = new Set(candidateSet);
  remainingCandidates.delete(pass1.winner);

  if (remainingCandidates.size > 0) {
    const strippedBallots = ballots.map((b) =>
      b.filter((id) => id !== pass1.winner),
    );

    const pass2 = runSingleIRV(
      strippedBallots,
      remainingCandidates,
      enrollmentById,
      cubeById,
      allRounds.length + 1,
    );

    allRounds.push(...pass2.rounds);

    if (pass2.winner !== null) {
      winners.push(pass2.winner as EnrollmentId);
    }
  }

  if (!isNonEmpty(winners)) {
    return err({ kind: "no_votes" });
  }

  return ok({ winners, rounds: allRounds });
}

// ---------------------------------------------------------------------------
// Single-seat IRV
// ---------------------------------------------------------------------------

type SingleIRVResult = {
  readonly winner: string | null;
  readonly rounds: IRVRound[];
};

function runSingleIRV(
  ballots: string[][],
  candidates: Set<string>,
  enrollmentById: Map<string, Enrollment>,
  cubeById: Map<string, Cube>,
  startingRoundNumber: number,
): SingleIRVResult {
  const rounds: IRVRound[] = [];
  let roundNumber = startingRoundNumber;
  const remaining = new Set(candidates);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Count first-choice votes among remaining candidates.
    const tallyCounts = new Map<string, number>();
    for (const c of remaining) {
      tallyCounts.set(c, 0);
    }

    let totalVotes = 0;
    for (const ballot of ballots) {
      const top = firstActiveChoice(ballot, remaining);
      if (top !== null) {
        tallyCounts.set(top, (tallyCounts.get(top) ?? 0) + 1);
        totalVotes++;
      }
    }

    // Build a deterministically-sorted tally array for the round record.
    const tallies = sortedTallies(tallyCounts, enrollmentById, cubeById);

    // If no votes remain, no winner can be chosen.
    if (totalVotes === 0) {
      rounds.push({
        roundNumber,
        tallies: tallies.map(([id, v]) => ({
          enrollmentId: id as EnrollmentId,
          votes: v,
        })),
        eliminated: null,
        winner: null,
      });
      return { winner: null, rounds };
    }

    // Check for majority winner.
    const majorityThreshold = totalVotes / 2;
    const topCandidate = tallies[0];
    if (topCandidate !== undefined && topCandidate[1] > majorityThreshold) {
      rounds.push({
        roundNumber,
        tallies: tallies.map(([id, v]) => ({
          enrollmentId: id as EnrollmentId,
          votes: v,
        })),
        eliminated: null,
        winner: topCandidate[0] as EnrollmentId,
      });
      return { winner: topCandidate[0], rounds };
    }

    // If only one candidate remains, they win regardless.
    if (remaining.size === 1) {
      const sole = [...remaining][0]!;
      rounds.push({
        roundNumber,
        tallies: tallies.map(([id, v]) => ({
          enrollmentId: id as EnrollmentId,
          votes: v,
        })),
        eliminated: null,
        winner: sole as EnrollmentId,
      });
      return { winner: sole, rounds };
    }

    // Eliminate the candidate with the fewest first-choice votes.
    // Ties broken by tiebreaker (last element in tallies = worst performer).
    const toEliminate = tallies[tallies.length - 1]!;

    rounds.push({
      roundNumber,
      tallies: tallies.map(([id, v]) => ({
        enrollmentId: id as EnrollmentId,
        votes: v,
      })),
      eliminated: toEliminate[0] as EnrollmentId,
      winner: null,
    });

    remaining.delete(toEliminate[0]);
    roundNumber++;

    // If only one remains after elimination, run one more count to confirm.
    // (The while-loop will handle this on the next iteration.)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the first element of `ballot` that is still in `remaining`,
 * or null if the ballot is exhausted.
 */
function firstActiveChoice(
  ballot: ReadonlyArray<string>,
  remaining: ReadonlySet<string>,
): string | null {
  for (const id of ballot) {
    if (remaining.has(id)) return id;
  }
  return null;
}

/**
 * Sort tally entries deterministically.
 *
 * Primary: descending by vote count (most votes first).
 * Secondary (tiebreaker for elimination — we need the *last* element to be
 * the one eliminated): among tied candidates, the one to *keep* sorts first
 * (i.e. sorts earlier), and the one to *eliminate* sorts last.
 *
 * Elimination tiebreaker rules:
 *   (a) Cube run most recently (largest lastRunAt) is eliminated first.
 *       A cube never run (lastRunAt === null) is treated as "longest ago"
 *       and thus *kept* (sorts earlier / survives).
 *   (b) Reverse-alphabetical on cube name: "Z" eliminated before "A".
 *       So alphabetical ascending means "A" survives (sorts earlier).
 *
 * Since the candidate to eliminate is the *last* in the sorted array among
 * ties, we sort the one we want to *eliminate* to the end.
 */
function sortedTallies(
  tallyCounts: Map<string, number>,
  enrollmentById: Map<string, Enrollment>,
  cubeById: Map<string, Cube>,
): Array<[string, number]> {
  const entries = [...tallyCounts.entries()];

  entries.sort((a, b) => {
    // Primary: descending vote count.
    const voteDiff = b[1] - a[1];
    if (voteDiff !== 0) return voteDiff;

    // Tied on votes — apply tiebreaker to decide elimination order.
    // Among tied candidates, the one to *survive* sorts earlier (lower index).
    // The one to be *eliminated* sorts later (higher index / end of array).

    const cubeA = getCubeForEnrollment(a[0], enrollmentById, cubeById);
    const cubeB = getCubeForEnrollment(b[0], enrollmentById, cubeById);

    // (a) lastRunAt: cube not run recently should survive (sort earlier).
    //     Cube run most recently should be eliminated (sort later).
    //     null (never run) is treated as the distant past — survives.
    const lastRunA = cubeA?.lastRunAt ?? null;
    const lastRunB = cubeB?.lastRunAt ?? null;

    const timeA = lastRunTimestamp(lastRunA);
    const timeB = lastRunTimestamp(lastRunB);

    // Lower timestamp = ran longer ago = survives = sort earlier.
    // Higher timestamp = ran more recently = eliminate = sort later.
    if (timeA !== timeB) return timeA - timeB;

    // (b) Alphabetical ascending on cube name: "A" survives, "Z" eliminated.
    const nameA = cubeA?.name ?? "";
    const nameB = cubeB?.name ?? "";
    return (nameA as string).localeCompare(nameB as string);
  });

  return entries;
}

function getCubeForEnrollment(
  enrollmentId: string,
  enrollmentById: Map<string, Enrollment>,
  cubeById: Map<string, Cube>,
): Cube | undefined {
  const enrollment = enrollmentById.get(enrollmentId);
  if (enrollment === undefined) return undefined;
  return cubeById.get(enrollment.cubeId as string);
}

/**
 * Convert an ISO8601 timestamp (or null) into a numeric value for comparison.
 * null (never run) maps to -Infinity so it sorts as "longest ago".
 */
function lastRunTimestamp(lastRunAt: ISO8601 | null): number {
  if (lastRunAt === null) return -Infinity;
  return new Date(lastRunAt as string).getTime();
}
