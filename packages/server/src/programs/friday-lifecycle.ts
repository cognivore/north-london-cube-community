/**
 * Friday lifecycle programs — the full state machine driver.
 * Creates fridays, drives transitions, packs pods, generates pairings.
 */

import { Effect } from "effect";
import {
  transition, canAcceptVote,
  unsafeFridayId, unsafeLocalDate, unsafeISO8601,
  unsafeNonNegativeInt, unsafePositiveInt, unsafePodId,
  unsafeRoundId, unsafeMatchId, unsafeNonEmptyString,
  unsafeEvenPodSize, unsafeDuration,
  isOk, isNonEmpty,
  packPods, generatePairings, runIRV, computeStandings,
} from "@cubehall/core";
import type {
  Friday, FridayState, Enrollment, Rsvp, Cube, Venue,
  PodConfiguration, PlannedPod, DraftFormat, NonEmptyArray,
  PairingsTemplate, PairingStrategy,
} from "@cubehall/core";
import type { FridayEvent } from "@cubehall/core";
import type { PackPodsInput } from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { EventBus } from "../capabilities/event-bus.js";
import { Audit } from "../capabilities/audit.js";
import {
  FridayRepo, EnrollmentRepo, RsvpRepo, VoteRepo,
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
    const audit = yield* Audit;
    const eventBus = yield* EventBus;
    const fridayRepo = yield* FridayRepo;
    const enrollmentRepo = yield* EnrollmentRepo;
    const rsvpRepo = yield* RsvpRepo;
    const voteRepo = yield* VoteRepo;
    const cubeRepo = yield* CubeRepo;
    const venueRepo = yield* VenueRepo;
    const podRepo = yield* PodRepo;
    const seatRepo = yield* SeatRepo;
    const roundRepo = yield* RoundRepo;
    const matchRepo = yield* MatchRepo;
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
        event = { kind: "close_enrollments" };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value };
        yield* fridayRepo.update(updated);
        yield* logger.info("Enrollments closed", { fridayId });

        // Immediately evaluate vote requirement
        const enrollments = yield* enrollmentRepo.findActiveByFriday(fid);
        if (enrollments.length === 0) {
          const cancelResult = transition(updated.state, { kind: "cancel_no_cubes" });
          if (isOk(cancelResult)) {
            updated = { ...updated, state: cancelResult.value };
            yield* fridayRepo.update(updated);
            yield* logger.info("Friday cancelled: no cubes", { fridayId });
          }
          return updated;
        }

        if (enrollments.length >= 3) {
          const voteEvent: FridayEvent = {
            kind: "open_vote",
            vote: {
              candidates: enrollments.map(e => e.id) as NonEmptyArray<any>,
              opensAt: now,
              closesAt: now, // immediate for testing
            },
          };
          const voteResult = transition(updated.state, voteEvent);
          if (isOk(voteResult)) {
            updated = { ...updated, state: voteResult.value };
            yield* fridayRepo.update(updated);
            yield* logger.info("Vote opened", { fridayId, candidates: enrollments.length });
          }
        } else {
          // ≤2 enrollments: skip vote, all are winners
          const skipEvent: FridayEvent = {
            kind: "skip_vote",
            winners: enrollments.map(e => e.id) as NonEmptyArray<any>,
          };
          const skipResult = transition(updated.state, skipEvent);
          if (isOk(skipResult)) {
            updated = { ...updated, state: skipResult.value };
            yield* fridayRepo.update(updated);
            yield* logger.info("Vote skipped (≤2 cubes)", { fridayId });
          }
        }
        return updated;
      }

      case "vote_open": {
        // Close vote — if votes exist, run IRV. Otherwise, pick least recently played.
        const enrollments = yield* enrollmentRepo.findActiveByFriday(fid);
        const votes = yield* voteRepo.findByFriday(fid);
        const cubeIds = enrollments.map(e => e.cubeId);
        const cubes = yield* cubeRepo.findMany(cubeIds);

        let winners: NonEmptyArray<any>;

        if (votes.length > 0) {
          // People voted — use IRV
          const irvResult = runIRV({ votes, enrollments, cubes });
          winners = isOk(irvResult)
            ? irvResult.value.winners
            : selectByRecency(enrollments, cubes);
          yield* logger.info("Vote resolved by IRV", { fridayId, voteCount: votes.length });
        } else {
          // No votes — select by least recently played
          winners = selectByRecency(enrollments, cubes);
          yield* logger.info("No votes — selected by recency", { fridayId });
        }

        event = { kind: "close_vote", winners };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value };
        yield* fridayRepo.update(updated);
        yield* logger.info("Vote closed", { fridayId, winners });
        return updated;
      }

      case "vote_closed": {
        // Lock friday — pack pods
        const winners = friday.state.winners;
        const enrollments = yield* enrollmentRepo.findActiveByFriday(fid);
        const winnerEnrollments = enrollments.filter(e => winners.includes(e.id));
        const rsvps = yield* rsvpRepo.findActiveByFriday(fid);
        const venue = yield* venueRepo.findById(friday.venueId);
        if (!venue) return yield* Effect.fail<FridayLifecycleError>({ kind: "venue_not_found" });

        // Build pack input
        const cubeIds = winnerEnrollments.map(e => e.cubeId);
        const cubes = yield* cubeRepo.findMany(cubeIds);

        // Gather user profiles for RSVPs
        const rsvpEntries = [];
        for (const r of rsvps) {
          const user = yield* userRepo.findById(r.userId);
          rsvpEntries.push({
            userId: r.userId,
            rsvpTimestamp: r.createdAt,
            profile: user?.profile ?? {
              preferredFormats: ["swiss_draft" as DraftFormat] as NonEmptyArray<DraftFormat>,
              fallbackFormats: [],
              hostCapable: false,
              bio: "",
              noShowCount: unsafeNonNegativeInt(0),
              banned: { kind: "not_banned" as const },
            },
          });
        }

        const packInput: PackPodsInput = {
          rsvps: rsvpEntries,
          cubes: winnerEnrollments.map(we => {
            const cube = cubes.find(c => c.id === we.cubeId);
            return {
              cube: cube!,
              hostId: we.hostId,
              format: cube?.supportedFormats[0] ?? ("swiss_draft" as DraftFormat),
            };
          }) as NonEmptyArray<any>,
          venue,
        };

        const packResult = packPods(packInput);
        if (!isOk(packResult)) {
          return yield* Effect.fail<FridayLifecycleError>({
            kind: "pack_failed",
            message: packResult.error.kind,
          });
        }
        const config = packResult.value;

        event = {
          kind: "lock_friday",
          config,
          seated: config.summary.seated,
        };
        const result = transition(friday.state, event);
        if (!isOk(result)) return yield* Effect.fail<FridayLifecycleError>({ kind: "transition_failed", message: result.error.message });
        updated = { ...friday, state: result.value, lockedAt: now };
        yield* fridayRepo.update(updated);
        yield* logger.info("Friday locked", { fridayId, seated: config.summary.seated });

        // Materialise pods
        for (const plannedPod of config.pods) {
          const podId = unsafePodId(yield* rng.uuid());
          const template = makeTemplate(plannedPod);

          yield* podRepo.create({
            id: podId,
            fridayId: fid,
            cubeId: plannedPod.cubeId,
            hostId: plannedPod.hostId,
            format: plannedPod.format,
            seats: plannedPod.seats.map(s => ({
              podId,
              seatIndex: s.seatIndex,
              userId: s.userId,
              team: assignTeam(s.seatIndex, plannedPod.format),
            })),
            state: "drafting",
            pairingsTemplate: template,
          });

          // Create rounds
          const roundCount = template.rounds;
          for (let r = 1; r <= roundCount; r++) {
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

        // Auto-confirm if enough players
        if (config.summary.seated >= 4) {
          const confirmResult = transition(updated.state, { kind: "confirm" });
          if (isOk(confirmResult)) {
            updated = { ...updated, state: confirmResult.value, confirmedAt: now };
            yield* fridayRepo.update(updated);
            yield* logger.info("Friday confirmed", { fridayId });
          }
        }

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
        // Check if all pods are complete
        const pods = yield* podRepo.findByFriday(fid);
        const allComplete = pods.every(p => p.state === "complete" || p.state === "cancelled");
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

    // Mark round as in_progress
    yield* roundRepo.updateState(round.id, "in_progress");
    yield* roundRepo.update({ ...round, state: "in_progress", startedAt: now });
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

function makeTemplate(pod: PlannedPod): PairingsTemplate {
  const format = pod.format;
  let strategy: PairingStrategy;

  let rounds = 3;

  if (format === "team_draft_2v2") {
    strategy = { kind: "round_robin_cross_team", teamSize: unsafePositiveInt(2) };
    rounds = 2; // each A plays each B exactly once, then megadeck tiebreaker if tied
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
 * Select up to 2 winners by least recently played.
 * Cubes that have never been played sort first (oldest).
 * Alphabetical tiebreaker on cube name.
 */
function selectByRecency(
  enrollments: ReadonlyArray<Enrollment>,
  cubes: ReadonlyArray<Cube>,
): NonEmptyArray<any> {
  const sorted = [...enrollments].sort((a, b) => {
    const cubeA = cubes.find(c => c.id === a.cubeId);
    const cubeB = cubes.find(c => c.id === b.cubeId);
    // Never played = epoch 0 (sorts first = least recent)
    const lastA = cubeA?.lastRunAt ? Date.parse(cubeA.lastRunAt) : 0;
    const lastB = cubeB?.lastRunAt ? Date.parse(cubeB.lastRunAt) : 0;
    if (lastA !== lastB) return lastA - lastB; // least recent first
    // Alphabetical tiebreaker
    return (cubeA?.name ?? "").localeCompare(cubeB?.name ?? "");
  });
  return sorted.slice(0, 2).map(e => e.id) as NonEmptyArray<any>;
}

function assignTeam(seatIndex: number, format: DraftFormat) {
  if (format === "team_draft_2v2" || format === "team_draft_3v3" || format === "team_draft_4v4") {
    return seatIndex % 2 === 0
      ? ("A" as any)
      : ("B" as any);
  }
  return null;
}
