/**
 * Enrollment programs — host enrolling cubes for a Friday.
 */

import { Effect } from "effect";
import { canAcceptEnrollment } from "@cubehall/core";
import {
  unsafeEnrollmentId, unsafeFridayId, unsafeUserId, unsafeCubeId,
} from "@cubehall/core";
import type { Enrollment } from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { EventBus } from "../capabilities/event-bus.js";
import { Audit } from "../capabilities/audit.js";
import { FridayRepo, EnrollmentRepo, CubeRepo, UserRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type EnrollmentError =
  | { readonly kind: "friday_not_found" }
  | { readonly kind: "cube_not_found" }
  | { readonly kind: "not_host_capable" }
  | { readonly kind: "not_cube_owner" }
  | { readonly kind: "enrollment_not_accepted"; readonly fridayState: string }
  | { readonly kind: "already_enrolled" }
  | { readonly kind: "cube_retired" }
  | { readonly kind: "enrollment_not_found" }
  | RepoError;

// ---------------------------------------------------------------------------
// Enroll cube
// ---------------------------------------------------------------------------

export const enrollCube = (input: {
  fridayId: string;
  cubeId: string;
  userId: string;
}) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const audit = yield* Audit;
    const fridayRepo = yield* FridayRepo;
    const enrollmentRepo = yield* EnrollmentRepo;
    const cubeRepo = yield* CubeRepo;
    const userRepo = yield* UserRepo;

    const fridayId = unsafeFridayId(input.fridayId);
    const cubeId = unsafeCubeId(input.cubeId);
    const userId = unsafeUserId(input.userId);

    // Validate friday
    const friday = yield* fridayRepo.findById(fridayId);
    if (!friday) {
      return yield* Effect.fail<EnrollmentError>({ kind: "friday_not_found" });
    }
    if (!canAcceptEnrollment(friday.state)) {
      return yield* Effect.fail<EnrollmentError>({
        kind: "enrollment_not_accepted",
        fridayState: friday.state.kind,
      });
    }

    // Validate user exists
    const user = yield* userRepo.findById(userId);
    if (!user) {
      return yield* Effect.fail<EnrollmentError>({ kind: "not_host_capable" });
    }

    // Validate cube
    const cube = yield* cubeRepo.findById(cubeId);
    if (!cube) {
      return yield* Effect.fail<EnrollmentError>({ kind: "cube_not_found" });
    }
    if (cube.ownerId !== userId) {
      return yield* Effect.fail<EnrollmentError>({ kind: "not_cube_owner" });
    }
    if (cube.retired) {
      return yield* Effect.fail<EnrollmentError>({ kind: "cube_retired" });
    }

    // Check one-cube-per-friday-per-host
    const existing = yield* enrollmentRepo.findActiveByFriday(fridayId);
    const alreadyEnrolled = existing.some(
      (e) => e.hostId === userId && !e.withdrawn,
    );
    if (alreadyEnrolled) {
      return yield* Effect.fail<EnrollmentError>({ kind: "already_enrolled" });
    }

    const now = yield* clock.now();
    const enrollmentId = unsafeEnrollmentId(yield* rng.uuid());
    const enrollment: Enrollment = {
      id: enrollmentId,
      fridayId,
      cubeId,
      hostId: userId,
      createdAt: now,
      withdrawn: false,
    };

    yield* enrollmentRepo.create(enrollment);
    yield* logger.info("Cube enrolled", {
      fridayId: input.fridayId,
      cubeId: input.cubeId,
      hostId: input.userId,
    });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "enrollment", id: enrollmentId },
      action: "cube.enrolled",
      before: null,
      after: enrollment as unknown as null,
    });
    yield* eventBus.publish({
      kind: "cube.enrolled",
      fridayId,
      cubeId,
      hostId: userId,
    });

    return enrollment;
  });

// ---------------------------------------------------------------------------
// Withdraw enrollment
// ---------------------------------------------------------------------------

export const withdrawEnrollment = (input: {
  enrollmentId: string;
  userId: string;
}) =>
  Effect.gen(function* () {
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const audit = yield* Audit;
    const enrollmentRepo = yield* EnrollmentRepo;
    const fridayRepo = yield* FridayRepo;

    const enrollmentId = unsafeEnrollmentId(input.enrollmentId);
    const userId = unsafeUserId(input.userId);

    const enrollment = yield* enrollmentRepo.findById(enrollmentId);
    if (!enrollment) {
      return yield* Effect.fail<EnrollmentError>({ kind: "enrollment_not_found" });
    }

    if (enrollment.hostId !== userId) {
      return yield* Effect.fail<EnrollmentError>({ kind: "not_cube_owner" });
    }

    const friday = yield* fridayRepo.findById(enrollment.fridayId);
    if (!friday || !canAcceptEnrollment(friday.state)) {
      return yield* Effect.fail<EnrollmentError>({
        kind: "enrollment_not_accepted",
        fridayState: friday?.state.kind ?? "unknown",
      });
    }

    yield* enrollmentRepo.withdraw(enrollmentId);
    yield* logger.info("Enrollment withdrawn", {
      enrollmentId: input.enrollmentId,
      fridayId: enrollment.fridayId,
    });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "enrollment", id: enrollmentId },
      action: "cube.withdrawn",
      before: false,
      after: true,
    });
    yield* eventBus.publish({
      kind: "cube.withdrawn",
      fridayId: enrollment.fridayId,
      cubeId: enrollment.cubeId,
    });
  });
