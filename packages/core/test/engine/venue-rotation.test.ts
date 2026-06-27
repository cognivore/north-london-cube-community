/**
 * Property and golden tests for the two-venue Friday rotation.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  VENUE_ROTATION_ANCHOR,
  venueRotationIndex,
} from "../../src/engine/venue-rotation.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** The Friday that is `k` weeks after the anchor (k may be negative). */
function fridayPlusWeeks(k: number, anchor = VENUE_ROTATION_ANCHOR): string {
  const a = Date.parse(`${anchor}T00:00:00Z`);
  return new Date(a + k * MS_PER_WEEK).toISOString().slice(0, 10);
}

describe("venueRotationIndex", () => {
  it("the anchor Friday is slot 0 (odd)", () => {
    expect(venueRotationIndex(VENUE_ROTATION_ANCHOR)).toBe(0);
  });

  it("golden: alternates from 2026-07-03", () => {
    expect(venueRotationIndex("2026-07-03")).toBe(0); // odd  → Arcadia
    expect(venueRotationIndex("2026-07-10")).toBe(1); // even → BMC
    expect(venueRotationIndex("2026-07-17")).toBe(0);
    expect(venueRotationIndex("2026-07-24")).toBe(1);
    expect(venueRotationIndex("2026-07-31")).toBe(0);
    expect(venueRotationIndex("2026-08-07")).toBe(1);
  });

  it("the Friday before the anchor is slot 1 (even)", () => {
    expect(venueRotationIndex("2026-06-26")).toBe(1);
  });

  it("property: slot equals |weeks-from-anchor| parity for any Friday", () => {
    fc.assert(
      fc.property(fc.integer({ min: -520, max: 520 }), (k) => {
        const expected = ((k % 2) + 2) % 2;
        expect(venueRotationIndex(fridayPlusWeeks(k))).toBe(expected);
      }),
    );
  });

  it("property: consecutive Fridays always differ", () => {
    fc.assert(
      fc.property(fc.integer({ min: -520, max: 520 }), (k) => {
        expect(venueRotationIndex(fridayPlusWeeks(k))).not.toBe(
          venueRotationIndex(fridayPlusWeeks(k + 1)),
        );
      }),
    );
  });

  it("property: result is always 0 or 1 for arbitrary dates", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01") }),
        (d) => {
          const idx = venueRotationIndex(d.toISOString().slice(0, 10));
          expect(idx === 0 || idx === 1).toBe(true);
        },
      ),
    );
  });

  it("respects a custom anchor", () => {
    // With an anchor one week later, parity flips for the original anchor date.
    expect(venueRotationIndex("2026-07-03", "2026-07-10")).toBe(1);
    expect(venueRotationIndex("2026-07-10", "2026-07-10")).toBe(0);
  });
});
