/**
 * Cube selection — pure function, no IO.
 *
 * Picks the N least-recently-played cubes from a set of enrollments for a
 * single Friday. Cubes that have never been played sort first (timestamp 0).
 * Alphabetical-by-name is the tiebreaker so the result is deterministic even
 * when every cube shares the same `lastRunAt`.
 *
 * Inputs: enrollments + the cubes they reference (lookup map).
 * Output: { selected, notSelected } — both in selection order. `selected`
 * length === min(count, enrollments.length).
 */

import type { Cube } from "../model/cube.js";
import type { Enrollment } from "../model/enrollment.js";

export type CubeSelectionResult = {
  readonly selected: ReadonlyArray<Enrollment>;
  readonly notSelected: ReadonlyArray<Enrollment>;
};

/**
 * Determine how many cubes (and therefore pods) a Friday should run for a
 * given locked-in attendee count, capped by the number of enrolled cubes and
 * the venue's pod ceiling.
 *
 * Floors at 1 whenever there is at least one enrollment, so a half-attended
 * Friday still fires a single pod that admins can shrink to size 4.
 */
export function decidePodCount(input: {
  readonly attendees: number;
  readonly enrollments: number;
  readonly maxPodsAtVenue: number;
  readonly preferredPodSize?: number; // defaults to 8 — the upper bound on a single pod
}): number {
  const { attendees, enrollments, maxPodsAtVenue } = input;
  const podSize = input.preferredPodSize ?? 8;
  if (enrollments <= 0) return 0;
  if (attendees <= 0) return 0;
  const desired = Math.max(1, Math.ceil(attendees / podSize));
  return Math.max(1, Math.min(desired, enrollments, maxPodsAtVenue));
}

/**
 * Pick the N least-recently-played cubes. Returns the chosen enrollments in
 * recency order (oldest first) and the remainder as `notSelected`.
 */
export function selectCubesByRecency(
  enrollments: ReadonlyArray<Enrollment>,
  cubes: ReadonlyArray<Cube>,
  count: number,
): CubeSelectionResult {
  const cubeById = new Map<string, Cube>();
  for (const c of cubes) cubeById.set(c.id as string, c);

  const sorted = [...enrollments].sort((a, b) => {
    const cubeA = cubeById.get(a.cubeId as string);
    const cubeB = cubeById.get(b.cubeId as string);
    const lastA = cubeA?.lastRunAt ? Date.parse(cubeA.lastRunAt) : 0;
    const lastB = cubeB?.lastRunAt ? Date.parse(cubeB.lastRunAt) : 0;
    if (lastA !== lastB) return lastA - lastB;
    const nameA = (cubeA?.name as string | undefined) ?? "";
    const nameB = (cubeB?.name as string | undefined) ?? "";
    return nameA.localeCompare(nameB);
  });

  const n = Math.max(0, Math.min(count, sorted.length));
  return {
    selected: sorted.slice(0, n),
    notSelected: sorted.slice(n),
  };
}
