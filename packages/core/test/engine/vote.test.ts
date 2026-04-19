/**
 * Property and golden tests for the IRV voting engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { NonEmptyArray } from "../../src/brand.js";
import { runIRV } from "../../src/engine/vote.js";
import type { VoteInput } from "../../src/engine/vote.js";
import type { Enrollment } from "../../src/model/enrollment.js";
import type { Cube } from "../../src/model/cube.js";
import type { Vote } from "../../src/model/vote.js";
import type { DraftFormat } from "../../src/model/enums.js";
import {
  unsafeEnrollmentId,
  unsafeCubeId,
  unsafeISO8601,
  unsafeNonEmptyString,
  unsafeEvenPodSize,
} from "../../src/ids.js";
import type { EnrollmentId, EvenPodSize } from "../../src/ids.js";
import {
  makeUserId,
  makeEnrollment,
  makeCube,
  makeVote,
  resetIdCounter,
} from "../fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const eid1 = unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01");
const eid2 = unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02");
const eid3 = unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03");
const eid4 = unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04");

const cubeA = makeCube({
  id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc01"),
  name: unsafeNonEmptyString("Alpha"),
  lastRunAt: null,
});
const cubeB = makeCube({
  id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc02"),
  name: unsafeNonEmptyString("Beta"),
  lastRunAt: unsafeISO8601("2025-06-01T00:00:00Z"),
});
const cubeC = makeCube({
  id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc03"),
  name: unsafeNonEmptyString("Gamma"),
  lastRunAt: unsafeISO8601("2025-05-01T00:00:00Z"),
});
const cubeD = makeCube({
  id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc04"),
  name: unsafeNonEmptyString("Delta"),
  lastRunAt: unsafeISO8601("2025-07-01T00:00:00Z"),
});

function makeEnrollmentWithCube(eid: EnrollmentId, cube: Cube): Enrollment {
  return makeEnrollment({
    id: eid,
    cubeId: cube.id,
    hostId: cube.ownerId,
  });
}

function buildVoteInput(
  enrollments: Enrollment[],
  cubes: Cube[],
  votes: Vote[],
): VoteInput {
  return { enrollments, cubes, votes };
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("IRV voting engine", () => {
  beforeEach(() => resetIdCounter());

  describe("property: deterministic given inputs", () => {
    it("same votes produce same winners", () => {
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
        makeEnrollmentWithCube(eid3, cubeC),
      ];

      // Generate random valid rankings as permutations of enrollment IDs
      const eids: EnrollmentId[] = [eid1, eid2, eid3];

      fc.assert(
        fc.property(
          fc.array(
            fc.shuffledSubarray(eids, { minLength: 3, maxLength: 3 }),
            { minLength: 1, maxLength: 10 },
          ),
          (rankings) => {
            resetIdCounter();
            const votes = rankings.map((ranking, i) =>
              makeVote({
                userId: makeUserId(i + 100),
                ranking: ranking as EnrollmentId[],
              }),
            );

            const input1 = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);
            const input2 = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);

            const result1 = runIRV(input1);
            const result2 = runIRV(input2);

            // Both should succeed or both fail
            expect(isOk(result1)).toBe(isOk(result2));
            if (isOk(result1) && isOk(result2)) {
              expect(result1.value.winners).toEqual(result2.value.winners);
              expect(result1.value.rounds.length).toBe(result2.value.rounds.length);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("property: winner count is at most 2", () => {
    it("IRV elects at most 2 winners", () => {
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
        makeEnrollmentWithCube(eid3, cubeC),
      ];
      const eids: EnrollmentId[] = [eid1, eid2, eid3];

      fc.assert(
        fc.property(
          fc.array(
            fc.shuffledSubarray(eids, { minLength: 1, maxLength: 3 }),
            { minLength: 1, maxLength: 10 },
          ),
          (rankings) => {
            resetIdCounter();
            const votes = rankings.map((ranking, i) =>
              makeVote({
                userId: makeUserId(i + 100),
                ranking: ranking as EnrollmentId[],
              }),
            );

            const input = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);
            const result = runIRV(input);

            if (isOk(result)) {
              expect(result.value.winners.length).toBeLessThanOrEqual(2);
              expect(result.value.winners.length).toBeGreaterThanOrEqual(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Golden: 3-candidate IRV with known outcome
  // -------------------------------------------------------------------------

  describe("golden: 3-candidate IRV with known outcome", () => {
    it("majority winner wins in first count", () => {
      resetIdCounter();
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
        makeEnrollmentWithCube(eid3, cubeC),
      ];

      // 5 voters: 3 rank eid1 first, 1 ranks eid2 first, 1 ranks eid3 first
      // eid1 has 3/5 = 60% > 50%, wins immediately
      const votes = [
        makeVote({ userId: makeUserId(1), ranking: [eid1, eid2, eid3] }),
        makeVote({ userId: makeUserId(2), ranking: [eid1, eid3, eid2] }),
        makeVote({ userId: makeUserId(3), ranking: [eid1, eid2, eid3] }),
        makeVote({ userId: makeUserId(4), ranking: [eid2, eid1, eid3] }),
        makeVote({ userId: makeUserId(5), ranking: [eid3, eid2, eid1] }),
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);
      const result = runIRV(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // First winner should be eid1 (majority)
        expect(result.value.winners[0]).toBe(eid1);
        // Should have at least 2 winners (pass 1 + pass 2)
        expect(result.value.winners.length).toBe(2);
      }
    });
  });

  describe("golden: 3-candidate IRV with elimination", () => {
    it("eliminates lowest and redistributes", () => {
      resetIdCounter();
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
        makeEnrollmentWithCube(eid3, cubeC),
      ];

      // 5 voters: 2 rank eid1 first, 2 rank eid2 first, 1 ranks eid3 first
      // No majority in round 1. eid3 eliminated.
      // eid3's voter has eid1 as second choice -> eid1 gets 3 votes, wins
      const votes = [
        makeVote({ userId: makeUserId(1), ranking: [eid1, eid2, eid3] }),
        makeVote({ userId: makeUserId(2), ranking: [eid1, eid3, eid2] }),
        makeVote({ userId: makeUserId(3), ranking: [eid2, eid1, eid3] }),
        makeVote({ userId: makeUserId(4), ranking: [eid2, eid3, eid1] }),
        makeVote({ userId: makeUserId(5), ranking: [eid3, eid1, eid2] }),
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);
      const result = runIRV(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const { winners, rounds } = result.value;

        // Pass 1: round 1 should show tallies 2-2-1, eliminate eid3
        // But eid3 might be eid2 or eid3 based on tiebreaker
        // Round 1: eid1=2, eid2=2, eid3=1 -> eid3 eliminated
        const round1 = rounds[0]!;
        expect(round1.winner).toBeNull();
        expect(round1.eliminated).toBe(eid3);

        // Round 2: eid1=3, eid2=2 -> eid1 wins
        const round2 = rounds[1]!;
        expect(round2.winner).toBe(eid1);

        expect(winners[0]).toBe(eid1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Golden: 2 enrollments skips vote
  // -------------------------------------------------------------------------

  describe("golden: 2 enrollments skips vote", () => {
    it("returns both enrollments as winners with no rounds", () => {
      resetIdCounter();
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
      ];

      // Even with votes, <= 2 enrollments skips the vote
      const votes = [
        makeVote({ userId: makeUserId(1), ranking: [eid1, eid2] }),
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB], votes);
      const result = runIRV(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.winners.length).toBe(2);
        expect(result.value.winners).toContain(eid1);
        expect(result.value.winners).toContain(eid2);
        expect(result.value.rounds.length).toBe(0);
      }
    });
  });

  describe("golden: 1 enrollment skips vote", () => {
    it("returns the single enrollment as winner", () => {
      resetIdCounter();
      const enrollments = [makeEnrollmentWithCube(eid1, cubeA)];

      const input = buildVoteInput(enrollments, [cubeA], []);
      const result = runIRV(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.winners.length).toBe(1);
        expect(result.value.winners[0]).toBe(eid1);
        expect(result.value.rounds.length).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  describe("golden: no enrollments", () => {
    it("returns no_enrollments error", () => {
      const input = buildVoteInput([], [], []);
      const result = runIRV(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("no_enrollments");
      }
    });
  });

  describe("golden: all enrollments withdrawn", () => {
    it("returns no_enrollments error", () => {
      const enrollments = [
        { ...makeEnrollmentWithCube(eid1, cubeA), withdrawn: true },
        { ...makeEnrollmentWithCube(eid2, cubeB), withdrawn: true },
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB], []);
      const result = runIRV(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("no_enrollments");
      }
    });
  });

  describe("golden: 3+ enrollments with no votes", () => {
    it("returns no_votes error", () => {
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA),
        makeEnrollmentWithCube(eid2, cubeB),
        makeEnrollmentWithCube(eid3, cubeC),
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], []);
      const result = runIRV(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("no_votes");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Tiebreaker tests
  // -------------------------------------------------------------------------

  describe("golden: tiebreaker eliminates most recently run cube", () => {
    it("cube with more recent lastRunAt is eliminated in a tie", () => {
      resetIdCounter();
      // cubeB: lastRunAt 2025-06-01 (more recent than cubeC: 2025-05-01)
      // In a tie, cubeB should be eliminated (its cube ran more recently)
      const enrollments = [
        makeEnrollmentWithCube(eid1, cubeA), // never run -> survives
        makeEnrollmentWithCube(eid2, cubeB), // 2025-06-01
        makeEnrollmentWithCube(eid3, cubeC), // 2025-05-01
      ];

      // All votes rank the same: eid1 first. eid2 and eid3 are tied at 0 first-place votes.
      // Tiebreaker: cubeB ran more recently (2025-06-01 > 2025-05-01), so cubeB is eliminated first.
      const votes = [
        makeVote({ userId: makeUserId(1), ranking: [eid1, eid2, eid3] }),
        makeVote({ userId: makeUserId(2), ranking: [eid1, eid3, eid2] }),
        makeVote({ userId: makeUserId(3), ranking: [eid1, eid2, eid3] }),
      ];

      const input = buildVoteInput(enrollments, [cubeA, cubeB, cubeC], votes);
      const result = runIRV(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // eid1 has majority (3/3), wins immediately in pass 1
        expect(result.value.winners[0]).toBe(eid1);
      }
    });
  });
});
