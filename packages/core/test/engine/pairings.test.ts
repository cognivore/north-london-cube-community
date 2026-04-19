/**
 * Property and golden tests for the pairings engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { generatePairings } from "../../src/engine/pairings.js";
import type {
  PairingsTemplate,
  PairingInput,
  PairingOutput,
} from "../../src/engine/pairings-types.js";
import type { Seat } from "../../src/model/pod.js";
import type { Match, PlannedMatch } from "../../src/model/match.js";
import {
  unsafePodId,
  unsafeEvenPodSize,
  unsafePositiveInt,
} from "../../src/ids.js";
import type { EvenPodSize, NonNegativeInt, PositiveInt, UserId } from "../../src/ids.js";
import type { NonEmptyArray } from "../../src/brand.js";
import { makeSeat, makeUserId, makeMatch, reportedResult, resetIdCounter, makePairingsTemplate } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POD_ID = unsafePodId("dddddddd-dddd-dddd-dddd-dddddddddddd");

function makeSeats(count: number, withTeams: boolean = false): NonEmptyArray<Seat> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const team = withTeams ? (i % 2 === 0 ? "A" : "B") as "A" | "B" : null;
    seats.push(makeSeat(POD_ID, i, makeUserId(i + 1), team));
  }
  return seats as NonEmptyArray<Seat>;
}

function swissTemplate(podSize: 4 | 6 | 8): PairingsTemplate {
  return makePairingsTemplate({
    format: "swiss_draft",
    podSize: podSize as EvenPodSize,
    rounds: 3 as PositiveInt,
    strategy: { kind: "swiss", tiebreakers: ["match_points", "opponent_match_win_percent", "game_win_percent"] },
  });
}

function roundRobin3v3Template(): PairingsTemplate {
  return makePairingsTemplate({
    format: "team_draft_3v3",
    podSize: 6 as EvenPodSize,
    rounds: 3 as PositiveInt,
    strategy: { kind: "round_robin_cross_team", teamSize: 3 as PositiveInt },
  });
}

function swiss4v4Template(): PairingsTemplate {
  return makePairingsTemplate({
    format: "team_draft_4v4",
    podSize: 8 as EvenPodSize,
    rounds: 3 as PositiveInt,
    strategy: { kind: "swiss_cross_team", teamSize: 4 as PositiveInt },
  });
}

function assertOkPairings(output: PairingOutput): NonEmptyArray<PlannedMatch> {
  expect(output._tag).toBe("Ok");
  if (output._tag !== "Ok") throw new Error("Expected Ok");
  return output.pairings;
}

function buildMatchFromPlanned(
  planned: PlannedMatch,
  p1Wins: 0 | 1 | 2,
  p2Wins: 0 | 1 | 2,
): Match {
  return makeMatch({
    player1Id: planned.player1Id,
    player2Id: planned.player2Id,
    result: reportedResult(p1Wins, p2Wins),
  });
}

// ---------------------------------------------------------------------------
// Swiss pairing property tests
// ---------------------------------------------------------------------------

describe("Swiss pairings", () => {
  beforeEach(() => resetIdCounter());

  describe("property: every player is paired every round", () => {
    it("round 1 with 4/6/8 players", () => {
      const arbPodSize = fc.constantFrom(4, 6, 8) as fc.Arbitrary<4 | 6 | 8>;
      fc.assert(
        fc.property(arbPodSize, (podSize) => {
          resetIdCounter();
          const seats = makeSeats(podSize);
          const template = swissTemplate(podSize);
          const input: PairingInput = {
            template,
            seats,
            history: [],
            currentRound: 1 as PositiveInt,
          };
          const output = generatePairings(input);
          const pairings = assertOkPairings(output);

          // Each pairing should have exactly podSize / 2 matches
          expect(pairings.length).toBe(podSize / 2);

          // Every player should appear exactly once
          const playerIds = new Set<string>();
          for (const p of pairings) {
            playerIds.add(p.player1Id as string);
            playerIds.add(p.player2Id as string);
          }
          expect(playerIds.size).toBe(podSize);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("property: no duplicate pairings unless forced", () => {
    it("across 3 rounds with 4 players, pairings avoid rematches when possible", () => {
      resetIdCounter();
      const seats = makeSeats(4);
      const template = swissTemplate(4);

      // Round 1
      const r1Input: PairingInput = { template, seats, history: [], currentRound: 1 as PositiveInt };
      const r1Output = generatePairings(r1Input);
      const r1Pairings = assertOkPairings(r1Output);

      // Create match results (player 1 always wins)
      const r1Matches: Match[] = r1Pairings.map((p) => buildMatchFromPlanned(p, 2, 0));

      // Round 2
      const r2Input: PairingInput = { template, seats, history: r1Matches, currentRound: 2 as PositiveInt };
      const r2Output = generatePairings(r2Input);
      const r2Pairings = assertOkPairings(r2Output);

      // Check no rematch from round 1 (with 4 players and 2 matches per round this is always avoidable)
      const r1PairSet = new Set(r1Pairings.map(p => pairKey(p.player1Id, p.player2Id)));
      for (const p of r2Pairings) {
        const key = pairKey(p.player1Id, p.player2Id);
        expect(r1PairSet.has(key)).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Golden: 4-player Swiss across 3 rounds
  // -------------------------------------------------------------------------

  describe("golden: 4-player Swiss across 3 rounds", () => {
    it("produces valid pairings for all 3 rounds", () => {
      resetIdCounter();
      const seats = makeSeats(4);
      const template = swissTemplate(4);
      const allPlayed = new Set<string>();

      let history: Match[] = [];

      for (let round = 1; round <= 3; round++) {
        const input: PairingInput = {
          template,
          seats,
          history,
          currentRound: round as PositiveInt,
        };
        const output = generatePairings(input);
        const pairings = assertOkPairings(output);

        expect(pairings.length).toBe(2);

        // Track pairings
        for (const p of pairings) {
          allPlayed.add(pairKey(p.player1Id, p.player2Id));
        }

        // All players appear each round
        const players = new Set<string>();
        for (const p of pairings) {
          players.add(p.player1Id as string);
          players.add(p.player2Id as string);
        }
        expect(players.size).toBe(4);

        // Build match results: higher-seeded player wins
        const matches = pairings.map((p) => buildMatchFromPlanned(p, 2, 1));
        history = [...history, ...matches];
      }

      // With 4 players, there are C(4,2) = 6 possible pairs.
      // Over 3 rounds we have 6 match slots — so each pair should ideally be seen once.
      // The Swiss algo avoids rematches where possible.
      expect(allPlayed.size).toBe(6); // C(4,2)=6 unique pairs, 3 rounds × 2 matches = 6 slots, no rematches needed
    });
  });
});

// ---------------------------------------------------------------------------
// 3v3 round-robin cross-team tests
// ---------------------------------------------------------------------------

describe("3v3 round-robin cross-team", () => {
  beforeEach(() => resetIdCounter());

  describe("property: every team A plays every team B exactly once across 3 rounds", () => {
    it("produces a complete Latin square", () => {
      const seats = makeSeats(6, true);
      const template = roundRobin3v3Template();
      const crossPairs = new Map<string, number>(); // "A_userId:B_userId" -> count

      for (let round = 1; round <= 3; round++) {
        const input: PairingInput = {
          template,
          seats,
          history: [],
          currentRound: round as PositiveInt,
        };
        const output = generatePairings(input);
        const pairings = assertOkPairings(output);

        expect(pairings.length).toBe(3);

        for (const p of pairings) {
          const key = `${p.player1Id as string}:${p.player2Id as string}`;
          crossPairs.set(key, (crossPairs.get(key) ?? 0) + 1);
        }
      }

      // 3 team-A players x 3 team-B players = 9 unique cross-team pairs
      expect(crossPairs.size).toBe(9);
      // Each pair appears exactly once
      for (const [, count] of crossPairs) {
        expect(count).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Golden: 6-player 3v3 round-robin verification
  // -------------------------------------------------------------------------

  describe("golden: 6-player 3v3 round-robin", () => {
    it("round 1 pairs A0-B0, A1-B1, A2-B2", () => {
      resetIdCounter();
      const seats = makeSeats(6, true);
      const template = roundRobin3v3Template();

      const input: PairingInput = {
        template,
        seats,
        history: [],
        currentRound: 1 as PositiveInt,
      };

      const output = generatePairings(input);
      const pairings = assertOkPairings(output);

      // Team A: seat 0, 2, 4 (users 1, 3, 5)
      // Team B: seat 1, 3, 5 (users 2, 4, 6)
      // Round 1 Latin square offset 0: A[0]-B[0], A[1]-B[1], A[2]-B[2]
      expect(pairings[0].player1Id).toBe(makeUserId(1));
      expect(pairings[0].player2Id).toBe(makeUserId(2));
      expect(pairings[1].player1Id).toBe(makeUserId(3));
      expect(pairings[1].player2Id).toBe(makeUserId(4));
      expect(pairings[2].player1Id).toBe(makeUserId(5));
      expect(pairings[2].player2Id).toBe(makeUserId(6));
    });

    it("round 2 pairs A0-B1, A1-B2, A2-B0", () => {
      resetIdCounter();
      const seats = makeSeats(6, true);
      const template = roundRobin3v3Template();

      const input: PairingInput = {
        template,
        seats,
        history: [],
        currentRound: 2 as PositiveInt,
      };

      const output = generatePairings(input);
      const pairings = assertOkPairings(output);

      expect(pairings[0].player1Id).toBe(makeUserId(1));
      expect(pairings[0].player2Id).toBe(makeUserId(4));
      expect(pairings[1].player1Id).toBe(makeUserId(3));
      expect(pairings[1].player2Id).toBe(makeUserId(6));
      expect(pairings[2].player1Id).toBe(makeUserId(5));
      expect(pairings[2].player2Id).toBe(makeUserId(2));
    });
  });
});

// ---------------------------------------------------------------------------
// 4v4 Swiss cross-team tests
// ---------------------------------------------------------------------------

describe("4v4 Swiss cross-team", () => {
  beforeEach(() => resetIdCounter());

  describe("property: no intra-team pairings ever", () => {
    it("all pairings are cross-team", () => {
      const seats = makeSeats(8, true);
      const template = swiss4v4Template();

      // Team A: seats 0,2,4,6 (users 1,3,5,7) — even indices
      // Team B: seats 1,3,5,7 (users 2,4,6,8) — odd indices
      const teamA = new Set<string>(["1", "3", "5", "7"].map(n => makeUserId(parseInt(n)) as string));

      let history: Match[] = [];

      for (let round = 1; round <= 3; round++) {
        resetIdCounter();
        const freshSeats = makeSeats(8, true);
        const input: PairingInput = {
          template,
          seats: freshSeats,
          history,
          currentRound: round as PositiveInt,
        };
        const output = generatePairings(input);
        const pairings = assertOkPairings(output);

        expect(pairings.length).toBe(4);

        for (const p of pairings) {
          const p1IsA = teamA.has(p.player1Id as string);
          const p2IsA = teamA.has(p.player2Id as string);
          // One must be A, one must be B
          expect(p1IsA !== p2IsA).toBe(true);
        }

        const matches = pairings.map((p) => buildMatchFromPlanned(p, 2, 1));
        history = [...history, ...matches];
      }
    });
  });

  describe("property: each player plays 3 distinct opponents across 3 rounds (when possible)", () => {
    it("no player plays fewer than 3 matches", () => {
      resetIdCounter();
      const seats = makeSeats(8, true);
      const template = swiss4v4Template();

      let history: Match[] = [];
      const opponentMap = new Map<string, Set<string>>();

      for (let round = 1; round <= 3; round++) {
        const input: PairingInput = {
          template,
          seats,
          history,
          currentRound: round as PositiveInt,
        };
        const output = generatePairings(input);
        const pairings = assertOkPairings(output);

        for (const p of pairings) {
          const p1 = p.player1Id as string;
          const p2 = p.player2Id as string;
          if (!opponentMap.has(p1)) opponentMap.set(p1, new Set());
          if (!opponentMap.has(p2)) opponentMap.set(p2, new Set());
          opponentMap.get(p1)!.add(p2);
          opponentMap.get(p2)!.add(p1);
        }

        const matches = pairings.map((p) => buildMatchFromPlanned(p, 2, 1));
        history = [...history, ...matches];
      }

      // Each player should have played 3 matches
      for (const [, opponents] of opponentMap) {
        expect(opponents.size).toBe(3);
      }
    });
  });

  describe("golden: round 1 seat-distance pairing for 4v4", () => {
    it("A0-B0, A1-B1, A2-B2, A3-B3", () => {
      resetIdCounter();
      const seats = makeSeats(8, true);
      const template = swiss4v4Template();

      const input: PairingInput = {
        template,
        seats,
        history: [],
        currentRound: 1 as PositiveInt,
      };

      const output = generatePairings(input);
      const pairings = assertOkPairings(output);

      expect(pairings.length).toBe(4);
      // Team A: users at even seats (1,3,5,7), Team B: users at odd seats (2,4,6,8)
      expect(pairings[0].player1Id).toBe(makeUserId(1));
      expect(pairings[0].player2Id).toBe(makeUserId(2));
      expect(pairings[1].player1Id).toBe(makeUserId(3));
      expect(pairings[1].player2Id).toBe(makeUserId(4));
    });
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("Pairings error cases", () => {
  beforeEach(() => resetIdCounter());

  it("rejects mismatched seat count", () => {
    const seats = makeSeats(4);
    const template = swissTemplate(6);

    const input: PairingInput = {
      template,
      seats,
      history: [],
      currentRound: 1 as PositiveInt,
    };

    const output = generatePairings(input);
    expect(output._tag).toBe("Err");
    if (output._tag === "Err") {
      expect(output.error.kind).toBe("invalid_pod_size");
    }
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pairKey(a: UserId, b: UserId): string {
  const ids = [a as string, b as string].sort();
  return `${ids[0]}:${ids[1]}`;
}
