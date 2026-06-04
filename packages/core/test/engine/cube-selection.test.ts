/**
 * Property and golden tests for the cube-selection algorithm.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { NonEmptyArray } from "../../src/brand.js";
import {
  decidePodCount,
  selectCubesByRecency,
} from "../../src/engine/cube-selection.js";
import type { Cube } from "../../src/model/cube.js";
import type { Enrollment } from "../../src/model/enrollment.js";
import {
  unsafeCubeId,
  unsafeEnrollmentId,
  unsafeFridayId,
  unsafeISO8601,
  unsafeNonEmptyString,
} from "../../src/ids.js";
import type { DraftFormat } from "../../src/model/enums.js";
import { makeCube, makeEnrollment, makeUserId } from "../fixtures.js";

function paddedHex(n: number): string {
  return n.toString(16).padStart(12, "0");
}

function buildCube(n: number, lastRunAt: string | null, name?: string): Cube {
  return makeCube({
    id: unsafeCubeId(`cccccccc-0000-0000-0000-${paddedHex(n)}`),
    name: unsafeNonEmptyString(name ?? `Cube ${n}`),
    lastRunAt: lastRunAt ? unsafeISO8601(lastRunAt) : null,
  });
}

function buildEnrollment(cube: Cube, n: number): Enrollment {
  return makeEnrollment({
    id: unsafeEnrollmentId(`eeeeeeee-0000-0000-0000-${paddedHex(n)}`),
    fridayId: unsafeFridayId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    cubeId: cube.id,
    hostId: makeUserId(n + 1),
  });
}

describe("selectCubesByRecency", () => {
  it("picks the oldest cube first when count = 1", () => {
    const cubeA = buildCube(1, "2026-04-01T00:00:00Z", "Alpha");
    const cubeB = buildCube(2, "2026-01-15T00:00:00Z", "Beta");
    const cubeC = buildCube(3, "2026-05-20T00:00:00Z", "Gamma");
    const enrollments = [cubeA, cubeB, cubeC].map((c, i) => buildEnrollment(c, i));

    const { selected, notSelected } = selectCubesByRecency(
      enrollments,
      [cubeA, cubeB, cubeC],
      1,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]!.cubeId).toBe(cubeB.id);
    expect(notSelected).toHaveLength(2);
  });

  it("treats null lastRunAt as oldest possible (sorts first)", () => {
    const played = buildCube(1, "2026-01-01T00:00:00Z", "Played");
    const fresh = buildCube(2, null, "Fresh");
    const enrollments = [
      buildEnrollment(played, 0),
      buildEnrollment(fresh, 1),
    ];

    const { selected } = selectCubesByRecency(enrollments, [played, fresh], 1);

    expect(selected[0]!.cubeId).toBe(fresh.id);
  });

  it("breaks lastRunAt ties alphabetically by cube name", () => {
    const same = "2026-03-01T00:00:00Z";
    const cubeZ = buildCube(1, same, "Zeta");
    const cubeA = buildCube(2, same, "Alpha");
    const cubeM = buildCube(3, same, "Mu");
    const enrollments = [
      buildEnrollment(cubeZ, 0),
      buildEnrollment(cubeA, 1),
      buildEnrollment(cubeM, 2),
    ];

    const { selected } = selectCubesByRecency(
      enrollments,
      [cubeZ, cubeA, cubeM],
      3,
    );

    const orderedNames = selected.map(
      (e) =>
        [cubeZ, cubeA, cubeM].find((c) => c.id === e.cubeId)!.name as string,
    );
    expect(orderedNames).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  it("returns empty selected when count = 0", () => {
    const cube = buildCube(1, null);
    const enrollments = [buildEnrollment(cube, 0)];
    const { selected, notSelected } = selectCubesByRecency(
      enrollments,
      [cube],
      0,
    );
    expect(selected).toEqual([]);
    expect(notSelected).toHaveLength(1);
  });

  it("caps count at the number of enrollments", () => {
    const cube = buildCube(1, null);
    const enrollments = [buildEnrollment(cube, 0)];
    const { selected, notSelected } = selectCubesByRecency(
      enrollments,
      [cube],
      99,
    );
    expect(selected).toHaveLength(1);
    expect(notSelected).toEqual([]);
  });

  it("property: selected ∪ notSelected == input enrollments, no duplicates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (cubeCount, requested) => {
          const cubes: Cube[] = [];
          for (let i = 0; i < cubeCount; i++) {
            const ts =
              i % 3 === 0
                ? null
                : `2026-0${(i % 9) + 1}-01T00:00:00Z`;
            cubes.push(buildCube(i + 1, ts, `Cube ${i + 1}`));
          }
          const enrollments = cubes.map((c, i) => buildEnrollment(c, i));
          const { selected, notSelected } = selectCubesByRecency(
            enrollments,
            cubes,
            requested,
          );
          const seen = new Set<string>();
          for (const e of [...selected, ...notSelected]) {
            seen.add(e.id as string);
          }
          expect(seen.size).toBe(enrollments.length);
          expect(selected.length).toBe(Math.min(requested, enrollments.length));
        },
      ),
    );
  });

  it("property: selected timestamps are <= every notSelected timestamp", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seed: fc.integer({ min: 1, max: 9999 }),
            ts: fc.option(fc.integer({ min: 0, max: 1_000_000_000 }), {
              nil: null,
            }),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        fc.integer({ min: 1, max: 10 }),
        (entries, requested) => {
          // Deduplicate by seed so each cube is unique
          const unique = new Map<number, { ts: number | null }>();
          for (const e of entries) {
            if (!unique.has(e.seed)) unique.set(e.seed, { ts: e.ts });
          }
          const items = [...unique.entries()].map(([seed, v], i) => ({
            seed,
            cube: buildCube(
              seed,
              v.ts === null ? null : new Date(v.ts).toISOString(),
              `Cube ${seed}`,
            ),
            i,
          }));
          const cubes = items.map((x) => x.cube);
          const enrollments = items.map((x) => buildEnrollment(x.cube, x.i));
          const { selected, notSelected } = selectCubesByRecency(
            enrollments,
            cubes,
            requested,
          );
          const cubeById = new Map(cubes.map((c) => [c.id as string, c]));
          const tsOf = (e: Enrollment): number => {
            const c = cubeById.get(e.cubeId as string)!;
            return c.lastRunAt ? Date.parse(c.lastRunAt) : 0;
          };
          for (const s of selected) {
            for (const n of notSelected) {
              // Either the selected cube is strictly older, OR it ties on
              // timestamp (in which case the name tiebreaker put it first).
              expect(tsOf(s)).toBeLessThanOrEqual(tsOf(n));
            }
          }
        },
      ),
    );
  });
});

describe("decidePodCount", () => {
  it("returns 0 when nobody is enrolled", () => {
    expect(
      decidePodCount({
        attendees: 10,
        enrollments: 0,
        maxPodsAtVenue: 2,
      }),
    ).toBe(0);
  });

  it("returns 0 when nobody is attending", () => {
    expect(
      decidePodCount({
        attendees: 0,
        enrollments: 3,
        maxPodsAtVenue: 2,
      }),
    ).toBe(0);
  });

  it("floors at 1 pod for any positive attendance + at least one cube", () => {
    expect(
      decidePodCount({
        attendees: 2,
        enrollments: 1,
        maxPodsAtVenue: 2,
      }),
    ).toBe(1);
  });

  it("requests a second pod once attendance crosses pod-size threshold", () => {
    expect(
      decidePodCount({
        attendees: 9,
        enrollments: 2,
        maxPodsAtVenue: 2,
      }),
    ).toBe(2);
  });

  it("caps at venue.maxPods", () => {
    expect(
      decidePodCount({
        attendees: 32,
        enrollments: 5,
        maxPodsAtVenue: 2,
      }),
    ).toBe(2);
  });

  it("caps at enrollments.length", () => {
    expect(
      decidePodCount({
        attendees: 32,
        enrollments: 1,
        maxPodsAtVenue: 4,
      }),
    ).toBe(1);
  });
});
