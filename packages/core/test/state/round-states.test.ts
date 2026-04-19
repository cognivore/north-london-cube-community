/**
 * Property and golden tests for round state transitions.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { RoundState } from "../../src/model/enums.js";
import { transitionRound } from "../../src/state/round-states.js";
import type { RoundEvent } from "../../src/state/round-states.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const allRoundStates: RoundState[] = ["pending", "in_progress", "complete"];
const terminalRoundStates: RoundState[] = ["complete"];

const allRoundEvents: RoundEvent[] = [
  { kind: "start_round" },
  { kind: "complete_round" },
];

// Valid transition table
const VALID_ROUND_TRANSITIONS: Map<string, RoundState> = new Map([
  ["pending:start_round", "in_progress"],
  ["in_progress:complete_round", "complete"],
]);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbRoundState = fc.constantFrom(...allRoundStates);
const arbRoundEvent = fc.constantFrom(...allRoundEvents);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Round state machine", () => {
  describe("property: transitions match the transition table", () => {
    it("valid transitions produce expected state, invalid produce errors", () => {
      fc.assert(
        fc.property(arbRoundState, arbRoundEvent, (state, event) => {
          const result = transitionRound(state, event);
          const key = `${state}:${event.kind}`;
          const expected = VALID_ROUND_TRANSITIONS.get(key);

          if (expected !== undefined) {
            expect(isOk(result)).toBe(true);
            if (isOk(result)) {
              expect(result.value).toBe(expected);
            }
          } else {
            expect(isErr(result)).toBe(true);
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: valid lifecycle pending -> in_progress -> complete", () => {
    it("the full happy path always succeeds", () => {
      let state: RoundState = "pending";

      const r1 = transitionRound(state, { kind: "start_round" });
      expect(isOk(r1)).toBe(true);
      state = isOk(r1) ? r1.value : state;
      expect(state).toBe("in_progress");

      const r2 = transitionRound(state, { kind: "complete_round" });
      expect(isOk(r2)).toBe(true);
      state = isOk(r2) ? r2.value : state;
      expect(state).toBe("complete");
    });
  });

  describe("property: terminal states reject all events", () => {
    it("complete rejects everything", () => {
      fc.assert(
        fc.property(arbRoundEvent, (event) => {
          const result = transitionRound("complete", event);
          expect(isErr(result)).toBe(true);
        }),
      );
    });
  });

  describe("property: non-forward transitions are invalid", () => {
    it("pending rejects complete_round", () => {
      const result = transitionRound("pending", { kind: "complete_round" });
      expect(isErr(result)).toBe(true);
    });

    it("in_progress rejects start_round", () => {
      const result = transitionRound("in_progress", { kind: "start_round" });
      expect(isErr(result)).toBe(true);
    });
  });
});
