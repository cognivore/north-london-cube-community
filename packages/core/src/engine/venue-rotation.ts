/**
 * Two-venue Friday rotation — pure, deterministic, no clock / no IO.
 *
 * The community plays at two alternating venues: "odd" Fridays at one, "even"
 * Fridays at the other. Parity is counted from a fixed anchor Friday so it
 * stays stable across month and year boundaries (unlike "nth Friday of the
 * month", which can land two same-parity Fridays back to back at month edges).
 *
 *   index 0 → odd  Friday — the anchor week, and every other week after it
 *   index 1 → even Friday
 *
 * The server maps these indices onto concrete venue ids; the mapping lives in
 * the server package (venue-rotation.ts) so core stays free of venue identity.
 */

/** Anchor Friday. 2026-07-03 is a Friday and is "odd Friday #1" → index 0. */
export const VENUE_ROTATION_ANCHOR = "2026-07-03";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Which slot (0 or 1) of the two-venue rotation a Friday on `date` uses.
 * `date` is an ISO `YYYY-MM-DD` day (typically a Friday); any day is tolerated
 * and binned by the 7-day week relative to the anchor. Dates before the anchor
 * parity-match correctly too (symmetric modulo).
 */
export function venueRotationIndex(
  date: string,
  anchor: string = VENUE_ROTATION_ANCHOR,
): 0 | 1 {
  const d = Date.parse(`${date}T00:00:00Z`);
  const a = Date.parse(`${anchor}T00:00:00Z`);
  const weeks = Math.round((d - a) / MS_PER_WEEK);
  return (((weeks % 2) + 2) % 2) as 0 | 1;
}
