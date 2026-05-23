/**
 * Friday lifecycle programs — the full state machine driver.
 * Creates fridays, drives transitions, packs pods, generates pairings.
 */

import { Effect } from "effect";
import {
  transition,
  unsafeFridayId, unsafeLocalDate, unsafeISO8601,
  unsafePositiveInt, unsafePodId,
  unsafeRoundId, unsafeMatchId,
  unsafeEvenPodSize, unsafeDuration,
  isOk, isNonEmpty,
  generatePairings,
} from "@cubehall/core";
import type {
  Friday, Enrollment, Cube,
  PlannedPod, DraftFormat,
  PairingsTemplate, PairingStrategy,
} from "@cubehall/core";
import type { FridayEvent } from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { EventBus } from "../capabilities/event-bus.js";
import {
  FridayRepo, EnrollmentRepo,
  CubeRepo, VenueRepo, PodRepo, SeatRepo, RoundRepo, MatchRepo, UserRepo,
} from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type FridayLifecycleError =
  | { readonly kind: "friday_not_found" }
  | { readonly kind: "venue_not_found" }
  | { readonly kind: "transition_failed"; readonly message: string }
  | { readonly kind: "no_cubes" }
  | { readonly kind: "insufficient_players" }
  | { readonly kind: "pack_failed"; readonly message: string }
  | RepoError;

// ---------------------------------------------------------------------------
// Create a new Friday
// ---------------------------------------------------------------------------

export const createFriday = (input: { date: string; venueId: string }) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const fridayRepo = yield* FridayRepo;
    const venueRepo = yield* VenueRepo;

    const venue = yield* venueRepo.findById(input.venueId as any);
    if (!venue) {
      return yield* Effect.fail<FridayLifecycleError>({ kind: "venue_not_found" });
    }

    const now = yield* clock.now();
    const fridayId = unsafeFridayId(yield* rng.uuid());

    const friday: Friday = {
      id: fridayId,
      date: unsafeLocalDate(input.date),
      venueId: venue.id,
      state: { kind: "scheduled" },
      createdAt: now,
      lockedAt: null,
      confirmedAt: null,
      completedAt: null,
    };

    yield* fridayRepo.create(friday);
    yield* logger.info("Friday created", { fridayId, date: input.date });
    return friday;
  });

// ---------------------------------------------------------------------------
// Advance Friday state — the universal transition driver
// ---------------------------------------------------------------------------

export const advanceFriday = (fridayId: string) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const fridayRepo = yield* FridayRepo;
    const enrollmentRepo = yield* EnrollmentRepo;
    const cubeRepo = yield* CubeRepo;
    const podRepo = yield* PodRepo;
    const roundRepo = yield* RoundRepo;
    const userRepo = yield* UserRepo;

    const fid = unsafeFridayId(fridayId);
    const friday = yield* fridayRepo.findById(fid);
    if (!friday) {
      return yield* Effect.fail<FridayLifecycleError>({ kind: "friday_not_found" });
    }

    const now = yield* clock.now();
    let event: FridayEvent;
    let updated: Friday;

    switch (friday.state.kind) {
      case "scheduled": {
        event = { kind: "open_friday" };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday opened", { fridayId });
        yield* eventBus.publish({ kind: "friday.opened", fridayId: fid });
        return updated;
      }

      case "open": {
        // Close enrollments + pick the single least-recently-played cube +
        // form pods, all as one transition. No vote step; the algorithm is
        // deterministic. Other enrolled hosts are emailed asking them to
        // bring their cube as backup in case we fire a second pod on the
        // night.
        const enrollments = yield* enrollmentRepo.findActiveByFriday(fid);
        if (enrollments.length === 0) {
          const cancelResult = transition(friday.state, { kind: "cancel_no_cubes" });
          if (!isOk(cancelResult)) {
            return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: cancelResult.error.message });
          }
          updated = { ...friday, state: cancelResult.value };
          yield* fridayRepo.update(updated);
          yield* logger.info("Friday cancelled: no cubes", { fridayId });
          yield* eventBus.publish({ kind: "friday.cancelled", fridayId: fid, reason: "no_cubes" });
          return updated;
        }

        const cubes = yield* cubeRepo.findMany(enrollments.map(e => e.cubeId));
        const sorted = sortEnrollmentsByRecency(enrollments, cubes);
        const winner = sorted[0]!;
        const backups = sorted.slice(1);

        // Idempotency: if pods already exist for this Friday, skip creation.
        const existingPods = yield* podRepo.findByFriday(fid);
        if (existingPods.length === 0) {
          const winnerCube = cubes.find(c => c.id === winner.cubeId);
          const format = (winnerCube?.supportedFormats[0] ?? "swiss_draft") as DraftFormat;
          const initialSize: 4 | 6 | 8 =
            format === "team_draft_3v3" ? 6 :
            format === "team_draft_4v4" ? 8 :
            4;
          const template = buildPairingsTemplate(format, initialSize);
          const podId = unsafePodId(yield* rng.uuid());
          yield* podRepo.create({
            id: podId,
            fridayId: fid,
            cubeId: winner.cubeId,
            hostId: winner.hostId,
            format,
            seats: [] as ReadonlyArray<any>,
            state: "drafting",
            pairingsTemplate: template,
          });
          for (let r = 1; r <= template.rounds; r++) {
            const roundId = unsafeRoundId(yield* rng.uuid());
            yield* roundRepo.create({
              id: roundId,
              podId,
              roundNumber: unsafePositiveInt(r),
              state: "pending",
              startedAt: null,
              endedAt: null,
              timeLimit: unsafeDuration(3000),
              extensions: [],
              timer: { kind: "not_started" },
            });
          }
        }

        const lockResult = transition(friday.state, { kind: "close_enrollments" });
        if (!isOk(lockResult)) {
          return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: lockResult.error.message });
        }
        updated = { ...friday, state: lockResult.value, lockedAt: now };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday locked (cube picked + pod formed)", {
          fridayId, winnerCubeId: winner.cubeId, backups: backups.length,
        });
        yield* eventBus.publish({ kind: "friday.locked", fridayId: fid });

        if (backups.length > 0) {
          yield* sendBackupHostEmails(friday.date, winner, backups, cubes, userRepo);
        }
        return updated;
      }

      case "locked": {
        // Manual confirm — coordinator's last chance to shuffle seating.
        event = { kind: "confirm" };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value, confirmedAt: now };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday confirmed", { fridayId });
        yield* eventBus.publish({ kind: "friday.confirmed", fridayId: fid });
        return updated;
      }

      case "confirmed": {
        event = { kind: "begin" };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday begun", { fridayId });
        yield* eventBus.publish({ kind: "friday.begun", fridayId: fid });
        return updated;
      }

      case "in_progress": {
        // Check if all pods are complete. Self-heal pod state from rounds:
        // admin paths (e.g. POST /api/admin/rounds/:id/complete) can mark
        // every round complete without touching the pod row, leaving the pod
        // stuck in "playing" and silently blocking advance. If every round
        // of a non-cancelled pod is complete, promote the pod to "complete"
        // here so the Friday can finish.
        const pods = yield* podRepo.findByFriday(fid);
        const podStates = new Map<string, string>();
        for (const p of pods) {
          if (p.state === "complete" || p.state === "cancelled") {
            podStates.set(p.id as string, p.state);
            continue;
          }
          const rounds = yield* roundRepo.findByPod(p.id);
          if (rounds.length > 0 && rounds.every(r => r.state === "complete")) {
            yield* podRepo.updateState(p.id, "complete");
            yield* logger.info("Pod promoted to complete (all rounds done)", { podId: p.id });
            podStates.set(p.id as string, "complete");
          } else {
            podStates.set(p.id as string, p.state);
          }
        }
        const allComplete = pods.every(p => {
          const s = podStates.get(p.id as string) ?? p.state;
          return s === "complete" || s === "cancelled";
        });
        if (!allComplete) {
          yield* logger.info("Friday still in progress — not all pods complete", { fridayId });
          return friday;
        }
        event = { kind: "complete" };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value, completedAt: now };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday completed", { fridayId });
        yield* eventBus.publish({ kind: "friday.completed", fridayId: fid });
        return updated;
      }

      default:
        yield* logger.info("No auto-advance from state", { fridayId, state: friday.state.kind });
        return friday;
    }
  });

// ---------------------------------------------------------------------------
// Start a round — generates pairings and creates matches
// ---------------------------------------------------------------------------

export const startRound = (podId: string, roundNumber: number) =>
  Effect.gen(function* () {
    const rng = yield* RNG;
    const logger = yield* Logger;
    const podRepo = yield* PodRepo;
    const seatRepo = yield* SeatRepo;
    const roundRepo = yield* RoundRepo;
    const matchRepo = yield* MatchRepo;
    const clock = yield* Clock;

    const pid = unsafePodId(podId);
    const pod = yield* podRepo.findById(pid);
    if (!pod) return null;

    const seats = yield* seatRepo.findByPod(pid);
    const rounds = yield* roundRepo.findByPod(pid);
    const round = rounds.find(r => r.roundNumber === roundNumber);
    if (!round) return null;

    // Get all prior matches for this pod
    const allMatches = yield* matchRepo.findByPod(pid);

    // Generate pairings
    const mutableSeats = [...seats];
    if (!isNonEmpty(mutableSeats)) return null;
    const pairingResult = generatePairings({
      template: pod.pairingsTemplate,
      seats: mutableSeats,
      history: [...allMatches],
      currentRound: unsafePositiveInt(roundNumber),
    });

    if (pairingResult._tag !== "Ok") {
      yield* logger.warn("Pairing generation failed", { podId, error: pairingResult.error });
      return null;
    }

    // Create matches
    const now = yield* clock.now();
    for (const pairing of pairingResult.pairings) {
      const matchId = unsafeMatchId(yield* rng.uuid());
      yield* matchRepo.create({
        id: matchId,
        roundId: round.id,
        player1Id: pairing.player1Id,
        player2Id: pairing.player2Id,
        result: { kind: "pending" },
        submittedAt: null,
        submittedBy: null,
      });
    }

    // Mark round as in_progress with running timer (50 min)
    const deadline = unsafeISO8601(new Date(Date.parse(now) + 50 * 60 * 1000).toISOString());
    const updatedRound = {
      ...round,
      state: "in_progress" as const,
      startedAt: now,
      timer: {
        kind: "running" as const,
        startedAt: now,
        deadline,
        elapsed: unsafeDuration(0),
      },
    };
    yield* roundRepo.updateState(round.id, "in_progress");
    yield* roundRepo.update(updatedRound);

    // Update pod state to playing if it's still drafting/building
    const currentPod = yield* podRepo.findById(pid);
    if (currentPod && (currentPod.state === "drafting" || currentPod.state === "building")) {
      yield* podRepo.updateState(pid, "playing");
    }

    yield* logger.info("Round started with pairings", { podId, roundNumber, matchCount: pairingResult.pairings.length });

    return { round, pairings: pairingResult.pairings };
  });

// ---------------------------------------------------------------------------
// Complete a round — check all matches reported
// ---------------------------------------------------------------------------

export const completeRound = (podId: string, roundNumber: number) =>
  Effect.gen(function* () {
    const logger = yield* Logger;
    const clock = yield* Clock;
    const podRepo = yield* PodRepo;
    const roundRepo = yield* RoundRepo;
    const matchRepo = yield* MatchRepo;

    const pid = unsafePodId(podId);
    const rounds = yield* roundRepo.findByPod(pid);
    const round = rounds.find(r => r.roundNumber === roundNumber);
    if (!round) return null;

    const matches = yield* matchRepo.findByRound(round.id);
    const allReported = matches.every(m => m.result.kind !== "pending");

    if (!allReported) {
      yield* logger.info("Round not complete — pending matches", { podId, roundNumber });
      return null;
    }

    const now = yield* clock.now();
    yield* roundRepo.updateState(round.id, "complete");
    yield* roundRepo.update({ ...round, state: "complete", endedAt: now });
    yield* logger.info("Round completed", { podId, roundNumber });

    // Check if pod is complete (all rounds done)
    const allRounds = yield* roundRepo.findByPod(pid);
    const allRoundsComplete = allRounds.every(r => r.state === "complete");
    if (allRoundsComplete) {
      yield* podRepo.updateState(pid, "complete");
      yield* logger.info("Pod completed", { podId });
    }

    return { round, allRoundsComplete };
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a pairings template for a given format and pod size. Exported for admin tools. */
export function buildPairingsTemplate(format: DraftFormat, size: 4 | 6 | 8): PairingsTemplate {
  return makeTemplate({ format, size: unsafeEvenPodSize(size) } as PlannedPod);
}

function makeTemplate(pod: PlannedPod): PairingsTemplate {
  const format = pod.format;
  let strategy: PairingStrategy;

  let rounds = 3;

  if (format === "team_draft_2v2") {
    strategy = { kind: "round_robin_cross_team", teamSize: unsafePositiveInt(2) };
    // Rounds 1-2 are the round-robin (A0-B0 / A1-B1 then A0-B1 / A1-B0).
    // Round 3 is reserved for the megadeck team tiebreaker — A1+A2 vs B1+B2
    // played as a single 2v2 game. If the score is already 2-2 after round 2,
    // both teams play it for real; otherwise the curator records it as a draw.
    rounds = 3;
  } else if (format === "team_draft_3v3") {
    strategy = { kind: "round_robin_cross_team", teamSize: unsafePositiveInt(3) };
  } else if (format === "team_draft_4v4") {
    strategy = { kind: "swiss_cross_team", teamSize: unsafePositiveInt(4) };
  } else {
    strategy = {
      kind: "swiss",
      tiebreakers: ["match_points", "opponent_match_win_percent", "game_win_percent"],
    };
  }

  return {
    format,
    podSize: pod.size,
    rounds: unsafePositiveInt(rounds),
    strategy,
  };
}

/**
 * Sort enrollments by least-recently-played cube. Cubes that have never been
 * played sort first (oldest). Alphabetical tiebreaker on cube name.
 */
function sortEnrollmentsByRecency(
  enrollments: ReadonlyArray<Enrollment>,
  cubes: ReadonlyArray<Cube>,
): ReadonlyArray<Enrollment> {
  return [...enrollments].sort((a, b) => {
    const cubeA = cubes.find(c => c.id === a.cubeId);
    const cubeB = cubes.find(c => c.id === b.cubeId);
    const lastA = cubeA?.lastRunAt ? Date.parse(cubeA.lastRunAt) : 0;
    const lastB = cubeB?.lastRunAt ? Date.parse(cubeB.lastRunAt) : 0;
    if (lastA !== lastB) return lastA - lastB;
    return (cubeA?.name ?? "").localeCompare(cubeB?.name ?? "");
  });
}

/**
 * Email each backup-cube host asking them to bring their cube along in case
 * a second pod fires. Best-effort: a failed send is logged and swallowed so
 * we don't block the lifecycle transition.
 */
function sendBackupHostEmails(
  fridayDate: string,
  winner: Enrollment,
  backups: ReadonlyArray<Enrollment>,
  cubes: ReadonlyArray<Cube>,
  userRepo: ReturnType<typeof UserRepo extends { Service: infer S } ? () => S : never>,
) {
  return Effect.gen(function* () {
    const logger = yield* Logger;
    const winnerCube = cubes.find(c => c.id === winner.cubeId);
    const winnerCubeName = winnerCube?.name ?? "the picked cube";

    const scheduler = yield* Effect.tryPromise({
      try: () => import("../scheduler.js"),
      catch: (e) => ({ kind: "import_failed" as const, cause: e }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));
    const tmpl = yield* Effect.tryPromise({
      try: () => import("../email-templates.js"),
      catch: (e) => ({ kind: "import_failed" as const, cause: e }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (!scheduler || !tmpl) {
      yield* logger.warn("Backup host emails skipped: helper modules unavailable", {});
      return;
    }

    for (const enr of backups) {
      const host = yield* (userRepo as any).findById(enr.hostId);
      if (!host || !host.email) continue;
      const ownCube = cubes.find(c => c.id === enr.cubeId);
      const rendered = tmpl.renderEmail("backup_cube_host", {
        displayName: host.displayName,
        date: fridayDate,
        cubeNames: winnerCubeName,
        appUrl: scheduler.appUrl(),
        ownCubeName: ownCube?.name ?? "your cube",
        winningCubeName: winnerCubeName,
      });
      yield* Effect.tryPromise({
        try: () => scheduler.sendEmail(host.email, rendered.subject, rendered.body),
        catch: (e) => ({ kind: "email_failed" as const, cause: e }),
      }).pipe(Effect.catchAll((err) =>
        logger.warn("Backup host email failed", { hostId: enr.hostId, err }),
      ));
    }
  });
}
