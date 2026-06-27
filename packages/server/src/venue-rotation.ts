/**
 * Maps the pure core rotation (venueRotationIndex) onto the two real,
 * coordinator-created venues, and holds their seed data for fresh installs.
 * One source of truth for venue identity so seed + migration agree.
 *
 *   odd  Fridays (index 0) → Arcadia Games
 *   even Fridays (index 1) → Bad Moon Cafe (Holloway Rd)  ("BMC")
 *
 * These ids are the real venue rows that already exist in production; never
 * duplicate them.
 */

import { venueRotationIndex } from "@cubehall/core";

/** Odd Fridays — Arcadia Games, Temple. */
export const ARCADIA_VENUE_ID = "65b5de32-cbb2-44a9-a254-0c0b9cd20849";
/** Even Fridays — Bad Moon Cafe on Holloway Rd ("BMC"). */
export const BAD_MOON_VENUE_ID = "bf396686-777e-4dff-ac15-4eee93eb493e";

/** index → venue id. Order matches venueRotationIndex (0 = odd, 1 = even). */
export const ROTATION_VENUE_IDS = [ARCADIA_VENUE_ID, BAD_MOON_VENUE_ID] as const;

export type VenueSeed = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly capacity: number;
  readonly maxPods: number;
  readonly houseCreditPerPlayer: number;
  readonly active: number;
  readonly mapUrl: string;
};

export const ARCADIA_SEED: VenueSeed = {
  id: ARCADIA_VENUE_ID,
  name: "Arcadia Games",
  address: "46 Essex St., Temple, London WC2R 3JF",
  capacity: 8,
  maxPods: 1,
  houseCreditPerPlayer: 1400,
  active: 1,
  mapUrl: "https://maps.app.goo.gl/ZuBqaM4FWVjNGm84A",
};

export const BAD_MOON_SEED: VenueSeed = {
  id: BAD_MOON_VENUE_ID,
  name: "Bad Moon Cafe (Holloway Rd)",
  address: "Arch 5, 303 Holloway Rd, London N7 8HS",
  capacity: 16,
  maxPods: 2,
  houseCreditPerPlayer: 700,
  active: 1,
  mapUrl: "https://maps.app.goo.gl/49t27kY8y69MBvtZA",
};

/** Both rotation venues, in slot order. */
export const ROTATION_SEEDS: ReadonlyArray<VenueSeed> = [ARCADIA_SEED, BAD_MOON_SEED];

/** Which venue id a Friday on `date` (YYYY-MM-DD) plays at, per the rotation. */
export function venueIdForDate(date: string): string {
  return ROTATION_VENUE_IDS[venueRotationIndex(date)];
}
