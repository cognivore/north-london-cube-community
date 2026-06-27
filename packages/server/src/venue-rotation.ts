/**
 * Maps the pure core rotation (venueRotationIndex) onto concrete venue ids,
 * and holds the canonical seed data for the two rotation venues. Both the
 * startup seed and the idempotent migration import these so there is exactly
 * one source of truth for venue identity + details.
 *
 *   odd  Fridays (index 0) → Arcadia Games
 *   even Fridays (index 1) → BMC Holloway Road
 */

import { venueRotationIndex } from "@cubehall/core";

/** Odd Fridays. Reuses the historical canonical id so existing fridays + the
 *  landing page's canonical lookup keep resolving. */
export const ARCADIA_VENUE_ID = "d0000000-0000-0000-0000-000000000001";
/** Even Fridays. */
export const BMC_VENUE_ID = "d0000000-0000-0000-0000-000000000002";

/** index → venue id. Order matches venueRotationIndex (0 = odd, 1 = even). */
export const ROTATION_VENUE_IDS = [ARCADIA_VENUE_ID, BMC_VENUE_ID] as const;

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
  address: "46-48 Essex Street, Temple, London WC2R 3JF",
  capacity: 16,
  maxPods: 2,
  houseCreditPerPlayer: 700,
  active: 1,
  mapUrl:
    "https://www.google.com/maps/search/?api=1&query=Arcadia%20Games%2046-48%20Essex%20Street%20London%20WC2R%203JF",
};

export const BMC_SEED: VenueSeed = {
  id: BMC_VENUE_ID,
  name: "BMC Holloway Road",
  // Exact street address + map link TBC — fill in via the admin venue editor
  // (or update this seed). Templates/landing degrade gracefully when blank.
  address: "",
  capacity: 16,
  maxPods: 2,
  houseCreditPerPlayer: 700,
  active: 1,
  mapUrl: "",
};

/** The legacy single-venue name we convert into Arcadia on migration. */
export const LEGACY_OWL_NAME = "The Owl & Hitchhiker";

/** Which venue id a Friday on `date` (YYYY-MM-DD) plays at, per the rotation. */
export function venueIdForDate(date: string): string {
  return ROTATION_VENUE_IDS[venueRotationIndex(date)];
}
