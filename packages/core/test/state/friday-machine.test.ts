/**
 * Property and golden tests for the Friday state machine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { FridayState } from "../../src/model/friday.js";
import { transition } from "../../src/state/friday-machine.js";
import type { FridayEvent } from "../../src/state/friday-machine.js";
import { resetIdCounter } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allStateKinds: FridayState["kind"][] = [
  "scheduled",
  "open",
  "locked",
  "confirmed",
  "in_progress",
  "cancelled",
  "complete",
];

const terminalKinds: FridayState["kind"][] = ["cancelled", "complete"];
const nonTerminalKinds = allStateKinds.filter((k) => !terminalKinds.includes(k));

function stateOfKind(kind: FridayState["kind"]): FridayState {
  switch (kind) {
    case "scheduled": return { kind: "scheduled" };
    case "open": return { kind: "open" };
    case "locked": return { kind: "locked" };
    case "confirmed": return { kind: "confirmed" };
    case "in_progress": return { kind: "in_progress" };
    case "cancelled": return { kind: "cancelled", reason: "admin" };
    case "complete": return { kind: "complete" };
  }
}

const allEvents: FridayEvent[] = [
  { kind: "open_friday" },
  { kind: "close_enrollments" },
  { kind: "cancel_no_cubes" },
  { kind: "confirm" },
  { kind: "cancel_insufficient" },
  { kind: "begin" },
  { kind: "complete" },
  { kind: "admin_cancel", reason: "test" },
];

// The valid transition table (state, event) -> expected next state kind
const VALID_TRANSITIONS: Map<string, FridayState["kind"]> = new Map([
  ["scheduled:open_friday", "open"],
  ["open:close_enrollments", "locked"],
  ["open:cancel_no_cubes", "cancelled"],
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
            expect(isOk(result)).toBe(true);
            if (isOk(result)) {
              expect(result.value.kind).toBe(expected);
            }
          } else {
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
    it("scheduled -> open -> locked -> confirmed -> in_progress -> complete", () => {
      let state: FridayState = { kind: "scheduled" };

      let r = transition(state, { kind: "open_friday" });
      expect(isOk(r) && r.value.kind).toBe("open");
      state = isOk(r) ? r.value : state;

      r = transition(state, { kind: "close_enrollments" });
      expect(isOk(r) && r.value.kind).toBe("locked");
      state = isOk(r) ? r.value : state;

      r = transition(state, { kind: "confirm" });
      expect(isOk(r) && r.value.kind).toBe("confirmed");
      state = isOk(r) ? r.value : state;

      r = transition(state, { kind: "begin" });
      expect(isOk(r) && r.value.kind).toBe("in_progress");
      state = isOk(r) ? r.value : state;

      r = transition(state, { kind: "complete" });
      expect(isOk(r) && r.value.kind).toBe("complete");
    });
  });

  // -------------------------------------------------------------------------
  // Golden: cancel paths
  // -------------------------------------------------------------------------

  describe("golden: cancel paths", () => {
    it("open -> cancelled (no cubes)", () => {
      const state: FridayState = { kind: "open" };
      const r = transition(state, { kind: "cancel_no_cubes" });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual({ kind: "cancelled", reason: "no_cubes" });
      }
    });

    it("locked -> cancelled (insufficient RSVPs)", () => {
      const state: FridayState = { kind: "locked" };
      const r = transition(state, { kind: "cancel_insufficient" });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual({ kind: "cancelled", reason: "insufficient_rsvps" });
      }
    });
  });
});
