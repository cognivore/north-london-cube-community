/**
 * Property and golden tests for the Friday state machine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { FridayState } from "../../src/model/friday.js";
import { transition } from "../../src/state/friday-machine.js";
import type { FridayEvent } from "../../src/state/friday-machine.js";
import {
  unsafeEnrollmentId,
  unsafeNonNegativeInt,
  unsafeEvenPodSize,
  unsafePositiveInt,
} from "../../src/ids.js";
import type { NonEmptyArray } from "../../src/brand.js";
import type { EnrollmentId, NonNegativeInt } from "../../src/ids.js";
import { makeVoteContext, makePodConfiguration, resetIdCounter } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allStateKinds: FridayState["kind"][] = [
  "scheduled",
  "open",
  "enrollment_closed",
  "vote_open",
  "vote_closed",
  "locked",
  "confirmed",
  "in_progress",
  "cancelled",
  "complete",
];

const terminalKinds: FridayState["kind"][] = ["cancelled", "complete"];
const nonTerminalKinds = allStateKinds.filter((k) => !terminalKinds.includes(k));

const dummyWinners: NonEmptyArray<EnrollmentId> = [
  unsafeEnrollmentId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
];

const dummyVoteContext = makeVoteContext([
  unsafeEnrollmentId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
  unsafeEnrollmentId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
  unsafeEnrollmentId("cccccccc-cccc-cccc-cccc-cccccccccccc"),
]);

function stateOfKind(kind: FridayState["kind"]): FridayState {
  switch (kind) {
    case "scheduled": return { kind: "scheduled" };
    case "open": return { kind: "open" };
    case "enrollment_closed": return { kind: "enrollment_closed" };
    case "vote_open": return { kind: "vote_open", vote: dummyVoteContext };
    case "vote_closed": return { kind: "vote_closed", winners: dummyWinners };
    case "locked": return { kind: "locked", config: makePodConfiguration() };
    case "confirmed": return { kind: "confirmed" };
    case "in_progress": return { kind: "in_progress" };
    case "cancelled": return { kind: "cancelled", reason: "admin" };
    case "complete": return { kind: "complete" };
  }
}

const allEvents: FridayEvent[] = [
  { kind: "open_friday" },
  { kind: "close_enrollments" },
  { kind: "open_vote", vote: dummyVoteContext },
  { kind: "skip_vote", winners: dummyWinners },
  { kind: "cancel_no_cubes" },
  { kind: "close_vote", winners: dummyWinners },
  { kind: "lock_friday", config: makePodConfiguration(), seated: 4 as NonNegativeInt },
  { kind: "confirm" },
  { kind: "cancel_insufficient" },
  { kind: "begin" },
  { kind: "complete" },
  { kind: "admin_cancel", reason: "test" },
];

// The valid transition table (state, event) -> expected next state kind
const VALID_TRANSITIONS: Map<string, FridayState["kind"]> = new Map([
  ["scheduled:open_friday", "open"],
  ["open:close_enrollments", "enrollment_closed"],
  ["enrollment_closed:open_vote", "vote_open"],
  ["enrollment_closed:skip_vote", "vote_closed"],
  ["enrollment_closed:cancel_no_cubes", "cancelled"],
  ["vote_open:close_vote", "vote_closed"],
  ["vote_closed:lock_friday", "locked"],
  ["locked:confirm", "confirmed"],
  ["locked:cancel_insufficient", "cancelled"],
  ["confirmed:begin", "in_progress"],
  ["in_progress:complete", "complete"],
]);

// admin_cancel works from all non-terminal states
for (const s of nonTerminalKinds) {
  VALID_TRANSITIONS.set(`${s}:admin_cancel`, "cancelled");
}

// ---------------------------------------------------------------------------
// fast-check arbitraries
// ---------------------------------------------------------------------------

const arbStateKind = fc.constantFrom(...allStateKinds);
const arbEvent = fc.constantFrom(...allEvents);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Friday state machine", () => {
  beforeEach(() => resetIdCounter());

  describe("property: no transition violates the transition table", () => {
    it("valid transitions produce the expected next state", () => {
      fc.assert(
        fc.property(arbStateKind, arbEvent, (stateKind, event) => {
          const state = stateOfKind(stateKind);
          const result = transition(state, event);
          const key = `${stateKind}:${event.kind}`;
          const expected = VALID_TRANSITIONS.get(key);

          if (expected !== undefined) {
            // Must succeed
            expect(isOk(result)).toBe(true);
            if (isOk(result)) {
              expect(result.value.kind).toBe(expected);
            }
          } else {
            // Must fail
            expect(isErr(result)).toBe(true);
          }
        }),
        { numRuns: 500 },
      );
    });
  });

  describe("property: terminal states reject all events", () => {
    it("cancelled rejects everything", () => {
      fc.assert(
        fc.property(arbEvent, (event) => {
          const result = transition({ kind: "cancelled", reason: "admin" }, event);
          expect(isErr(result)).toBe(true);
        }),
      );
    });

    it("complete rejects everything", () => {
      fc.assert(
        fc.property(arbEvent, (event) => {
          const result = transition({ kind: "complete" }, event);
          expect(isErr(result)).toBe(true);
        }),
      );
    });
  });

  describe("property: admin_cancel works from any non-terminal state", () => {
    it("always succeeds from non-terminal states", () => {
      const arbNonTerminal = fc.constantFrom(...nonTerminalKinds);
      fc.assert(
        fc.property(arbNonTerminal, fc.string(), (stateKind, reason) => {
          const state = stateOfKind(stateKind);
          const event: FridayEvent = { kind: "admin_cancel", reason };
          const result = transition(state, event);
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            expect(result.value.kind).toBe("cancelled");
          }
        }),
      );
    });

    it("fails from terminal states", () => {
      for (const k of terminalKinds) {
        const state = stateOfKind(k);
        const event: FridayEvent = { kind: "admin_cancel", reason: "test" };
        const result = transition(state, event);
        expect(isErr(result)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Golden: happy path
  // -------------------------------------------------------------------------

  describe("golden: full happy path", () => {
    it("scheduled -> open -> enrollment_closed -> vote_closed -> locked -> confirmed -> in_progress -> complete", () => {
      let state: FridayState = { kind: "scheduled" };

      // scheduled -> open
      let r = transition(state, { kind: "open_friday" });
      expect(isOk(r) && r.value.kind).toBe("open");
      state = isOk(r) ? r.value : state;

      // open -> enrollment_closed
      r = transition(state, { kind: "close_enrollments" });
      expect(isOk(r) && r.value.kind).toBe("enrollment_closed");
      state = isOk(r) ? r.value : state;

      // enrollment_closed -> vote_closed (skip vote)
      r = transition(state, { kind: "skip_vote", winners: dummyWinners });
      expect(isOk(r) && r.value.kind).toBe("vote_closed");
      state = isOk(r) ? r.value : state;

      // vote_closed -> locked
      const config = makePodConfiguration();
      r = transition(state, { kind: "lock_friday", config, seated: 4 as NonNegativeInt });
      expect(isOk(r) && r.value.kind).toBe("locked");
      state = isOk(r) ? r.value : state;

      // locked -> confirmed
      r = transition(state, { kind: "confirm" });
      expect(isOk(r) && r.value.kind).toBe("confirmed");
      state = isOk(r) ? r.value : state;

      // confirmed -> in_progress
      r = transition(state, { kind: "begin" });
      expect(isOk(r) && r.value.kind).toBe("in_progress");
      state = isOk(r) ? r.value : state;

      // in_progress -> complete
      r = transition(state, { kind: "complete" });
      expect(isOk(r) && r.value.kind).toBe("complete");
    });
  });

  describe("golden: happy path with vote", () => {
    it("enrollment_closed -> vote_open -> vote_closed", () => {
      let state: FridayState = { kind: "enrollment_closed" };

      const r1 = transition(state, { kind: "open_vote", vote: dummyVoteContext });
      expect(isOk(r1) && r1.value.kind).toBe("vote_open");
      state = isOk(r1) ? r1.value : state;

      const r2 = transition(state, { kind: "close_vote", winners: dummyWinners });
      expect(isOk(r2) && r2.value.kind).toBe("vote_closed");
    });
  });

  // -------------------------------------------------------------------------
  // Golden: cancel paths
  // -------------------------------------------------------------------------

  describe("golden: cancel paths", () => {
    it("enrollment_closed -> cancelled (no cubes)", () => {
      const state: FridayState = { kind: "enrollment_closed" };
      const r = transition(state, { kind: "cancel_no_cubes" });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual({ kind: "cancelled", reason: "no_cubes" });
      }
    });

    it("locked -> cancelled (insufficient RSVPs)", () => {
      const state: FridayState = { kind: "locked", config: makePodConfiguration() };
      const r = transition(state, { kind: "cancel_insufficient" });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual({ kind: "cancelled", reason: "insufficient_rsvps" });
      }
    });
  });
});
