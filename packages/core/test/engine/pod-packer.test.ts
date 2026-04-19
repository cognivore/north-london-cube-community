/**
 * Property and golden tests for the pod-packing algorithm.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "../../src/brand.js";
import type { NonEmptyArray } from "../../src/brand.js";
import { packPods } from "../../src/engine/pod-packer.js";
import type { PackPodsInput } from "../../src/engine/pod-packer.js";
import type { DraftFormat } from "../../src/model/enums.js";
import type { Cube } from "../../src/model/cube.js";
import type { UserProfile } from "../../src/model/user.js";
import {
  unsafeCubeId,
  unsafeEvenPodSize,
  unsafePositiveInt,
  unsafeNonNegativeInt,
  unsafeISO8601,
} from "../../src/ids.js";
import type { CubeId, EvenPodSize, ISO8601, UserId } from "../../src/ids.js";
import {
  makeUserId,
  makeUserProfile,
  makeCube,
  makeVenue,
  makeRsvpEntry,
  resetIdCounter,
} from "../fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRsvps(
  count: number,
  profileOverrides?: Partial<UserProfile>,
): PackPodsInput["rsvps"] {
  const rsvps: PackPodsInput["rsvps"][number][] = [];
  for (let i = 0; i < count; i++) {
    const hour = (i + 1).toString().padStart(2, "0");
    rsvps.push(
      makeRsvpEntry(makeUserId(i + 1), `2025-01-10T${hour}:00:00Z`, profileOverrides),
    );
  }
  return rsvps;
}

function singleCubeInput(
  rsvpCount: number,
  podSizeRange: { min: 4 | 6 | 8; max: 4 | 6 | 8 } = { min: 4, max: 8 },
  capacity: number = 16,
): PackPodsInput {
  const hostId = makeUserId(999);
  const cube = makeCube({
    minPodSize: podSizeRange.min as EvenPodSize,
    maxPodSize: podSizeRange.max as EvenPodSize,
    ownerId: hostId,
  });

  const rsvps = [
    makeRsvpEntry(hostId, "2025-01-10T00:00:00Z"),
    ...buildRsvps(rsvpCount - 1),
  ];

  return {
    rsvps,
    cubes: [{ cube, hostId, format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
      PackPodsInput["cubes"][number]
    >,
    venue: makeVenue({ capacity }),
  };
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Pod packer", () => {
  beforeEach(() => resetIdCounter());

  describe("property: produced configuration never exceeds venue capacity", () => {
    it("total seated never exceeds capacity", () => {
      // Test with various RSVP counts from 4 to 20
      const arbRsvpCount = fc.integer({ min: 4, max: 20 });
      const arbCapacity = fc.integer({ min: 4, max: 20 });

      fc.assert(
        fc.property(arbRsvpCount, arbCapacity, (rsvpCount, capacity) => {
          resetIdCounter();
          const input = singleCubeInput(rsvpCount, { min: 4, max: 8 }, capacity);
          const result = packPods(input);

          if (isOk(result)) {
            const config = result.value;
            const totalSeated = config.pods.reduce((sum, p) => sum + p.seats.length, 0);
            expect(totalSeated).toBeLessThanOrEqual(capacity);
          }
          // If err, that is fine - not enough players or capacity
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("property: seated count <= RSVP count", () => {
    it("never seats more people than RSVPd", () => {
      const arbRsvpCount = fc.integer({ min: 4, max: 16 });

      fc.assert(
        fc.property(arbRsvpCount, (rsvpCount) => {
          resetIdCounter();
          const input = singleCubeInput(rsvpCount);
          const result = packPods(input);

          if (isOk(result)) {
            const config = result.value;
            const totalSeated = config.pods.reduce((sum, p) => sum + p.seats.length, 0);
            expect(totalSeated).toBeLessThanOrEqual(rsvpCount);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("property: every host of a selected cube is seated in their own pod (if capacity permits)", () => {
    it("host appears in their own pod when enough players", () => {
      // Use 8 RSVPs to ensure enough for a pod
      resetIdCounter();
      const hostId = makeUserId(999);
      const cube = makeCube({
        ownerId: hostId,
        minPodSize: 4 as EvenPodSize,
        maxPodSize: 8 as EvenPodSize,
      });

      const rsvps = [
        makeRsvpEntry(hostId, "2025-01-10T00:00:00Z"),
        ...buildRsvps(7),
      ];

      const input: PackPodsInput = {
        rsvps,
        cubes: [{ cube, hostId, format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
          PackPodsInput["cubes"][number]
        >,
        venue: makeVenue({ capacity: 16 }),
      };

      const result = packPods(input);
      expect(isOk(result)).toBe(true);

      if (isOk(result)) {
        const config = result.value;
        // Find the pod with this cube
        const hostPod = config.pods.find(
          (p) => (p.cubeId as string) === (cube.id as string),
        );
        expect(hostPod).toBeDefined();
        if (hostPod) {
          const hostSeated = hostPod.seats.some(
            (s) => (s.userId as string) === (hostId as string),
          );
          expect(hostSeated).toBe(true);
        }
      }
    });
  });

  describe("property: algorithm is deterministic given same inputs", () => {
    it("same input always produces same output", () => {
      resetIdCounter();
      const input1 = singleCubeInput(8);
      resetIdCounter();
      const input2 = singleCubeInput(8);

      const result1 = packPods(input1);
      const result2 = packPods(input2);

      expect(result1).toEqual(result2);
    });
  });

  // -------------------------------------------------------------------------
  // Golden tests
  // -------------------------------------------------------------------------

  describe("golden: exact 4-player pod with single cube", () => {
    it("seats all 4 players", () => {
      resetIdCounter();
      const input = singleCubeInput(4, { min: 4, max: 4 });
      const result = packPods(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const config = result.value;
        expect(config.pods.length).toBe(1);
        expect(config.pods[0].seats.length).toBe(4);
        expect(config.pods[0].size).toBe(4);
        expect(config.waitlisted.length).toBe(0);
      }
    });
  });

  describe("golden: too few players for minimum pod size", () => {
    it("returns error when only 3 RSVPs for min-4 pod", () => {
      resetIdCounter();
      const hostId = makeUserId(999);
      const cube = makeCube({
        ownerId: hostId,
        minPodSize: 4 as EvenPodSize,
        maxPodSize: 8 as EvenPodSize,
      });

      const rsvps = [
        makeRsvpEntry(hostId, "2025-01-10T00:00:00Z"),
        ...buildRsvps(2),
      ];

      const input: PackPodsInput = {
        rsvps,
        cubes: [{ cube, hostId, format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
          PackPodsInput["cubes"][number]
        >,
        venue: makeVenue({ capacity: 16 }),
      };

      const result = packPods(input);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("no_valid_config");
      }
    });
  });

  describe("golden: banned users are excluded", () => {
    it("banned user is excluded from seating", () => {
      resetIdCounter();
      const hostId = makeUserId(999);
      const cube = makeCube({
        ownerId: hostId,
        minPodSize: 4 as EvenPodSize,
        maxPodSize: 4 as EvenPodSize,
      });

      const bannedUser = makeUserId(50);
      const rsvps = [
        makeRsvpEntry(hostId, "2025-01-10T00:00:00Z"),
        makeRsvpEntry(makeUserId(1), "2025-01-10T01:00:00Z"),
        makeRsvpEntry(makeUserId(2), "2025-01-10T02:00:00Z"),
        makeRsvpEntry(makeUserId(3), "2025-01-10T03:00:00Z"),
        makeRsvpEntry(bannedUser, "2025-01-10T04:00:00Z", {
          banned: {
            kind: "banned",
            until: unsafeISO8601("2099-01-01T00:00:00Z"),
            reason: "test",
          },
        }),
      ];

      const input: PackPodsInput = {
        rsvps,
        cubes: [{ cube, hostId, format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
          PackPodsInput["cubes"][number]
        >,
        venue: makeVenue({ capacity: 16 }),
      };

      const result = packPods(input);
      expect(isOk(result)).toBe(true);

      if (isOk(result)) {
        const config = result.value;
        // Banned user should be excluded
        const bannedExcluded = config.excluded.some(
          (e) => (e.userId as string) === (bannedUser as string) && e.reason === "banned",
        );
        expect(bannedExcluded).toBe(true);
        // Banned user should not be seated
        const bannedSeated = config.pods.some((p) =>
          p.seats.some((s) => (s.userId as string) === (bannedUser as string)),
        );
        expect(bannedSeated).toBe(false);
      }
    });
  });

  describe("golden: no RSVPs returns error", () => {
    it("returns no_rsvps error", () => {
      resetIdCounter();
      const cube = makeCube();
      const input: PackPodsInput = {
        rsvps: [],
        cubes: [{ cube, hostId: makeUserId(999), format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
          PackPodsInput["cubes"][number]
        >,
        venue: makeVenue({ capacity: 16 }),
      };

      const result = packPods(input);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("no_rsvps");
      }
    });
  });

  describe("golden: exceeds max pods", () => {
    it("returns error when cubes exceed maxPods", () => {
      resetIdCounter();
      const cube1 = makeCube();
      const cube2 = makeCube();
      const cube3 = makeCube();

      const rsvps = buildRsvps(12);

      const input: PackPodsInput = {
        rsvps,
        cubes: [
          { cube: cube1, hostId: makeUserId(1), format: "swiss_draft" as DraftFormat },
          { cube: cube2, hostId: makeUserId(2), format: "swiss_draft" as DraftFormat },
          { cube: cube3, hostId: makeUserId(3), format: "swiss_draft" as DraftFormat },
        ] as unknown as NonEmptyArray<PackPodsInput["cubes"][number]>,
        venue: makeVenue({ capacity: 16, maxPods: 2 }),
      };

      const result = packPods(input);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("exceeds_max_pods");
      }
    });
  });

  describe("golden: format-mismatch users are excluded", () => {
    it("user who accepts no selected format is excluded", () => {
      resetIdCounter();
      const hostId = makeUserId(999);
      const cube = makeCube({
        ownerId: hostId,
        minPodSize: 4 as EvenPodSize,
        maxPodSize: 4 as EvenPodSize,
      });

      const mismatchUser = makeUserId(50);
      const rsvps = [
        makeRsvpEntry(hostId, "2025-01-10T00:00:00Z"),
        makeRsvpEntry(makeUserId(1), "2025-01-10T01:00:00Z"),
        makeRsvpEntry(makeUserId(2), "2025-01-10T02:00:00Z"),
        makeRsvpEntry(makeUserId(3), "2025-01-10T03:00:00Z"),
        makeRsvpEntry(mismatchUser, "2025-01-10T04:00:00Z", {
          preferredFormats: ["rochester"] as NonEmptyArray<DraftFormat>,
          fallbackFormats: ["grid"],
        }),
      ];

      const input: PackPodsInput = {
        rsvps,
        cubes: [{ cube, hostId, format: "swiss_draft" as DraftFormat }] as NonEmptyArray<
          PackPodsInput["cubes"][number]
        >,
        venue: makeVenue({ capacity: 16 }),
      };

      const result = packPods(input);
      expect(isOk(result)).toBe(true);

      if (isOk(result)) {
        const config = result.value;
        const mismatchExcluded = config.excluded.some(
          (e) => (e.userId as string) === (mismatchUser as string) && e.reason === "format_mismatch",
        );
        expect(mismatchExcluded).toBe(true);
      }
    });
  });
});
