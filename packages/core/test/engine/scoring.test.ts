/**
 * Property and golden tests for the scoring engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { NonEmptyArray } from "../../src/brand.js";
import { computeStandings, computeTeamScore } from "../../src/engine/scoring.js";
import type { Standing } from "../../src/engine/pairings-types.js";
import type { Match } from "../../src/model/match.js";
import type { Seat } from "../../src/model/pod.js";
import type { UserId, PositiveInt, NonNegativeInt } from "../../src/ids.js";
import {
  makeUserId,
  makeMatch,
  makeSeat,
  reportedResult,
  resetIdCounter,
} from "../fixtures.js";
import { unsafePodId } from "../../src/ids.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POD_ID = unsafePodId("dddddddd-dddd-dddd-dddd-dddddddddddd");

function playerIds(n: number): NonEmptyArray<UserId> {
  const ids: UserId[] = [];
  for (let i = 1; i <= n; i++) {
    ids.push(makeUserId(i));
  }
  return ids as NonEmptyArray<UserId>;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Scoring engine", () => {
  beforeEach(() => resetIdCounter());

  describe("property: tiebreakers produce a total order (no ties in rank)", () => {
    it("ranks are unique for any set of players and matches", () => {
      // Generate random 4-player pods with random match results
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              p1Index: fc.integer({ min: 0, max: 3 }),
              p2Index: fc.integer({ min: 0, max: 3 }),
              p1Wins: fc.constantFrom(0, 1, 2) as fc.Arbitrary<0 | 1 | 2>,
              p2Wins: fc.constantFrom(0, 1, 2) as fc.Arbitrary<0 | 1 | 2>,
            }),
            { minLength: 1, maxLength: 6 },
          ),
          (matchSpecs) => {
            resetIdCounter();
            const ids = playerIds(4);

            // Filter out self-matches
            const validSpecs = matchSpecs.filter((s) => s.p1Index !== s.p2Index);
            if (validSpecs.length === 0) return; // skip if no valid matches

            const matches: Match[] = validSpecs.map((s) =>
              makeMatch({
                player1Id: ids[s.p1Index]!,
                player2Id: ids[s.p2Index]!,
                result: reportedResult(s.p1Wins, s.p2Wins),
              }),
            );

            const standings = computeStandings(ids, matches);

            // All ranks should be unique
            const ranks = standings.map((s) => s.rank as number);
            const uniqueRanks = new Set(ranks);
            expect(uniqueRanks.size).toBe(4);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("property: rank values are 1..N with no gaps", () => {
    it("ranks are consecutive from 1", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 8 }),
          (n) => {
            resetIdCounter();
            const ids = playerIds(n);
            // No matches, so all have 0 match points — order by userId
            const standings = computeStandings(ids, []);

            const ranks = standings.map((s) => s.rank as number).sort((a, b) => a - b);
            for (let i = 0; i < n; i++) {
              expect(ranks[i]).toBe(i + 1);
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("property: winner always has rank 1", () => {
    it("a player who wins all matches has the top rank", () => {
      resetIdCounter();
      const ids = playerIds(4);
      const winner = ids[0]!;

      // Winner beats everyone
      const matches: Match[] = [
        makeMatch({ player1Id: winner, player2Id: ids[1]!, result: reportedResult(2, 0) }),
        makeMatch({ player1Id: winner, player2Id: ids[2]!, result: reportedResult(2, 0) }),
        makeMatch({ player1Id: winner, player2Id: ids[3]!, result: reportedResult(2, 0) }),
      ];

      const standings = computeStandings(ids, matches);
      const winnerStanding = standings.find(
        (s) => (s.userId as string) === (winner as string),
      );
      expect(winnerStanding).toBeDefined();
      expect(winnerStanding!.rank).toBe(1);
    });
  });

  describe("property: computeStandings is deterministic", () => {
    it("same inputs produce same output", () => {
      resetIdCounter();
      const ids = playerIds(4);
      const matches: Match[] = [
        makeMatch({ player1Id: ids[0]!, player2Id: ids[1]!, result: reportedResult(2, 1) }),
        makeMatch({ player1Id: ids[2]!, player2Id: ids[3]!, result: reportedResult(0, 2) }),
      ];

      const standings1 = computeStandings(ids, matches);
      const standings2 = computeStandings(ids, matches);

      expect(standings1).toEqual(standings2);
    });
  });

  // -------------------------------------------------------------------------
  // Golden: simple 4-player scenario
  // -------------------------------------------------------------------------

  describe("golden: simple 4-player scenario with known standings", () => {
    it("computes correct match points and ranks", () => {
      resetIdCounter();
      const ids = playerIds(4);
      // P1 beats P2, P3 beats P4, P1 beats P3 => P1 first, P3 second
      const matches: Match[] = [
        makeMatch({ player1Id: ids[0]!, player2Id: ids[1]!, result: reportedResult(2, 0) }),
        makeMatch({ player1Id: ids[2]!, player2Id: ids[3]!, result: reportedResult(2, 1) }),
        makeMatch({ player1Id: ids[0]!, player2Id: ids[2]!, result: reportedResult(2, 0) }),
        makeMatch({ player1Id: ids[1]!, player2Id: ids[3]!, result: reportedResult(2, 1) }),
      ];

      const standings = computeStandings(ids, matches);

      // P1: 2 wins = 6 match points
      const p1 = standings.find((s) => (s.userId as string) === (ids[0]! as string))!;
      expect(p1.matchPoints).toBe(6);
      expect(p1.rank).toBe(1);

      // P3: 1 win = 3 match points
      const p3 = standings.find((s) => (s.userId as string) === (ids[2]! as string))!;
      expect(p3.matchPoints).toBe(3);

      // P2: 0 wins from P1 loss, 1 win from P4 = 3 match points
      const p2 = standings.find((s) => (s.userId as string) === (ids[1]! as string))!;
      expect(p2.matchPoints).toBe(3);

      // P4: 0 wins = 0 match points
      const p4 = standings.find((s) => (s.userId as string) === (ids[3]! as string))!;
      expect(p4.matchPoints).toBe(0);
      expect(p4.rank).toBe(4);

      // All ranks are unique and consecutive
      const ranks = standings.map((s) => s.rank as number).sort((a, b) => a - b);
      expect(ranks).toEqual([1, 2, 3, 4]);
    });
  });

  describe("golden: no matches => all tied at 0 points, ordered by userId", () => {
    it("all have 0 match points and OMW floor", () => {
      resetIdCounter();
      const ids = playerIds(4);
      const standings = computeStandings(ids, []);

      for (const s of standings) {
        expect(s.matchPoints).toBe(0);
        expect(s.omwPercent).toBeCloseTo(0.33, 1);
      }

      const ranks = standings.map((s) => s.rank as number).sort((a, b) => a - b);
      expect(ranks).toEqual([1, 2, 3, 4]);
    });
  });

  describe("golden: double loss awards 0 points to both", () => {
    it("both players get 0 from a double loss", () => {
      resetIdCounter();
      const ids = playerIds(2) as NonEmptyArray<UserId>;
      const matches: Match[] = [
        makeMatch({
          player1Id: ids[0]!,
          player2Id: ids[1]!,
          result: { kind: "double_loss" },
        }),
      ];

      const standings = computeStandings(ids, matches);
      for (const s of standings) {
        expect(s.matchPoints).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Team scores
  // -------------------------------------------------------------------------

  describe("golden: team score computation", () => {
    it("sums match points by team", () => {
      resetIdCounter();
      const ids = playerIds(4);

      // Team A: player 1, 3 (seats 0, 2)
      // Team B: player 2, 4 (seats 1, 3)
      const seats: Seat[] = [
        makeSeat(POD_ID, 0, ids[0]!, "A"),
        makeSeat(POD_ID, 1, ids[1]!, "B"),
        makeSeat(POD_ID, 2, ids[2]!, "A"),
        makeSeat(POD_ID, 3, ids[3]!, "B"),
      ];

      // P1 wins (3pts), P2 loses (0pts), P3 loses (0pts), P4 wins (3pts)
      const matches: Match[] = [
        makeMatch({ player1Id: ids[0]!, player2Id: ids[1]!, result: reportedResult(2, 0) }),
        makeMatch({ player1Id: ids[3]!, player2Id: ids[2]!, result: reportedResult(2, 0) }),
      ];

      const standings = computeStandings(ids, matches);
      const teamScore = computeTeamScore(standings, seats);

      expect(teamScore.teamA).toBe(3); // P1: 3, P3: 0
      expect(teamScore.teamB).toBe(3); // P2: 0, P4: 3
      expect(teamScore.winner).toBe("draw");
    });
  });
});
