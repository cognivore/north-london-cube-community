/**
 * Cube programs — CRUD for personal cubes.
 */

import { Effect } from "effect";
import type { Cube } from "@cubehall/core";
import type { NonEmptyArray } from "@cubehall/core";
import type { DraftFormat } from "@cubehall/core";
import {
  unsafeCubeId, unsafeUserId, unsafeNonEmptyString,
  unsafeUrl, unsafePositiveInt, unsafeEvenPodSize,
} from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { CubeRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CubeError =
  | { readonly kind: "cube_not_found" }
  | { readonly kind: "not_owner" }
  | RepoError;

// ---------------------------------------------------------------------------
// Create cube
// ---------------------------------------------------------------------------

export const createCube = (input: {
  userId: string;
  name: string;
  cubecobraUrl: string;
  supportedFormats: NonEmptyArray<DraftFormat>;
  preferredPodSize: 4 | 6 | 8;
  minPodSize: 4 | 6 | 8;
  maxPodSize: 4 | 6 | 8;
}) =>
  Effect.gen(function* () {
    const rng = yield* RNG;
    const logger = yield* Logger;
    const cubeRepo = yield* CubeRepo;

    // Validate CubeCobra domain
    if (!isCubecobraUrl(input.cubecobraUrl)) {
      return yield* Effect.fail<CubeError>({ kind: "cube_not_found" });
    }

    const cubeId = unsafeCubeId(yield* rng.uuid());
    const cubecobraId = extractCubecobraId(input.cubecobraUrl);

    const cube: Cube = {
      id: cubeId,
      ownerId: unsafeUserId(input.userId),
      name: unsafeNonEmptyString(input.name),
      cubecobraUrl: unsafeUrl(input.cubecobraUrl),
      cubecobraId,
      cardCount: unsafePositiveInt(360), // default, will be updated from cubecobra
      supportedFormats: input.supportedFormats,
      preferredPodSize: unsafeEvenPodSize(input.preferredPodSize),
      minPodSize: unsafeEvenPodSize(input.minPodSize),
      maxPodSize: unsafeEvenPodSize(input.maxPodSize),
      tags: [],
      lastRunAt: null,
      retired: false,
    };

    yield* cubeRepo.create(cube);
    yield* logger.info("Cube created", { cubeId, ownerId: input.userId });

    return cube;
  });

// ---------------------------------------------------------------------------
// Update cube
// ---------------------------------------------------------------------------

export const updateCube = (input: {
  cubeId: string;
  userId: string;
  name?: string;
  cubecobraUrl?: string;
  supportedFormats?: NonEmptyArray<DraftFormat>;
  preferredPodSize?: 4 | 6 | 8;
  minPodSize?: 4 | 6 | 8;
  maxPodSize?: 4 | 6 | 8;
  retired?: boolean;
}) =>
  Effect.gen(function* () {
    const logger = yield* Logger;
    const cubeRepo = yield* CubeRepo;

    const cubeId = unsafeCubeId(input.cubeId);
    const userId = unsafeUserId(input.userId);

    const cube = yield* cubeRepo.findById(cubeId);
    if (!cube) {
      return yield* Effect.fail<CubeError>({ kind: "cube_not_found" });
    }
    if (cube.ownerId !== userId) {
      return yield* Effect.fail<CubeError>({ kind: "not_owner" });
    }

    const updated: Cube = {
      ...cube,
      ...(input.name !== undefined && { name: unsafeNonEmptyString(input.name) }),
      ...(input.cubecobraUrl !== undefined && {
        cubecobraUrl: unsafeUrl(input.cubecobraUrl),
        cubecobraId: extractCubecobraId(input.cubecobraUrl),
      }),
      ...(input.supportedFormats !== undefined && { supportedFormats: input.supportedFormats }),
      ...(input.preferredPodSize !== undefined && { preferredPodSize: unsafeEvenPodSize(input.preferredPodSize) }),
      ...(input.minPodSize !== undefined && { minPodSize: unsafeEvenPodSize(input.minPodSize) }),
      ...(input.maxPodSize !== undefined && { maxPodSize: unsafeEvenPodSize(input.maxPodSize) }),
      ...(input.retired !== undefined && { retired: input.retired }),
    };

    yield* cubeRepo.update(updated);
    yield* logger.info("Cube updated", { cubeId: input.cubeId });

    return updated;
  });

// ---------------------------------------------------------------------------
// List cubes
// ---------------------------------------------------------------------------

export const listMyCubes = (userId: string) =>
  Effect.gen(function* () {
    const cubeRepo = yield* CubeRepo;
    return yield* cubeRepo.findByOwner(unsafeUserId(userId));
  });

export const listAllCubes = () =>
  Effect.gen(function* () {
    const cubeRepo = yield* CubeRepo;
    return yield* cubeRepo.findAll();
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCubecobraUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "cubecobra.com" || u.hostname === "www.cubecobra.com";
  } catch {
    return false;
  }
}

function extractCubecobraId(url: string): string {
  const match = url.match(/cubecobra\.com\/cube\/(?:overview|list|playtest)\/([^/?#]+)/);
  return match?.[1] ?? url;
}
