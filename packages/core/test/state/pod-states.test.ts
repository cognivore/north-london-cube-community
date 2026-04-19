/**
 * Property and golden tests for pod state transitions.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { PodState } from "../../src/model/enums.js";
import { transitionPod } from "../../src/state/pod-states.js";
import type { PodEvent } from "../../src/state/pod-states.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const allPodStates: PodState[] = ["drafting", "building", "playing", "complete", "cancelled"];
const terminalPodStates: PodState[] = ["complete", "cancelled"];
const nonTerminalPodStates: PodState[] = ["drafting", "building", "playing"];

const allPodEvents: PodEvent[] = [
  { kind: "start_building" },
  { kind: "start_playing" },
  { kind: "complete_pod" },
  { kind: "cancel_pod" },
];

// Valid transition table
const VALID_POD_TRANSITIONS: Map<string, PodState> = new Map([
  ["drafting:start_building", "building"],
  ["building:start_playing", "playing"],
  ["playing:complete_pod", "complete"],
  // cancel_pod from non-terminal states
  ["drafting:cancel_pod", "cancelled"],
  ["building:cancel_pod", "cancelled"],
  ["playing:cancel_pod", "cancelled"],
]);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbPodState = fc.constantFrom(...allPodStates);
const arbPodEvent = fc.constantFrom(...allPodEvents);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pod state machine", () => {
  describe("property: transitions match the transition table", () => {
    it("valid transitions produce expected state, invalid produce errors", () => {
      fc.assert(
        fc.property(arbPodState, arbPodEvent, (state, event) => {
          const result = transitionPod(state, event);
          const key = `${state}:${event.kind}`;
          const expected = VALID_POD_TRANSITIONS.get(key);

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

  describe("property: valid lifecycle drafting -> building -> playing -> complete", () => {
    it("the full happy path always succeeds", () => {
      let state: PodState = "drafting";

      const r1 = transitionPod(state, { kind: "start_building" });
      expect(isOk(r1)).toBe(true);
      state = isOk(r1) ? r1.value : state;
      expect(state).toBe("building");

      const r2 = transitionPod(state, { kind: "start_playing" });
      expect(isOk(r2)).toBe(true);
      state = isOk(r2) ? r2.value : state;
      expect(state).toBe("playing");

      const r3 = transitionPod(state, { kind: "complete_pod" });
      expect(isOk(r3)).toBe(true);
      state = isOk(r3) ? r3.value : state;
      expect(state).toBe("complete");
    });
  });

  describe("property: terminal states reject all events", () => {
    it("complete rejects everything", () => {
      fc.assert(
        fc.property(arbPodEvent, (event) => {
          const result = transitionPod("complete", event);
          expect(isErr(result)).toBe(true);
        }),
      );
    });

    it("cancelled rejects everything", () => {
      fc.assert(
        fc.property(arbPodEvent, (event) => {
          const result = transitionPod("cancelled", event);
          expect(isErr(result)).toBe(true);
        }),
      );
    });
  });

  describe("property: cancel_pod works from all non-terminal states", () => {
    it("always succeeds from non-terminal states", () => {
      const arbNonTerminal = fc.constantFrom(...nonTerminalPodStates);
      fc.assert(
        fc.property(arbNonTerminal, (state) => {
          const result = transitionPod(state, { kind: "cancel_pod" });
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            expect(result.value).toBe("cancelled");
          }
        }),
      );
    });
  });
});
