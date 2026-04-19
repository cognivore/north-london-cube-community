/**
 * Pod-packing algorithm — pure function, no IO.
 *
 * Brute-force enumeration over a tiny search space (<=16 players, <=2 pods)
 * to find the optimal seating arrangement given RSVP preferences, cube
 * constraints, and venue capacity.
 */

import type { NonEmptyArray, Result } from "../brand.js";
import { err, isNonEmpty, ok } from "../brand.js";
import type {
  CubeId,
  EvenPodSize,
  ISO8601,
  NonNegativeInt,
  UserId,
} from "../ids.js";
import type { Cube } from "../model/cube.js";
import type { DraftFormat } from "../model/enums.js";
import type { UserProfile } from "../model/user.js";
import type { Venue } from "../model/venue.js";
import type { ExclusionReason, PlannedPod, PodConfiguration } from "../model/pod.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PackPodsInput = {
  readonly rsvps: ReadonlyArray<{
    readonly userId: UserId;
    readonly rsvpTimestamp: ISO8601;
    readonly profile: UserProfile;
  }>;
  readonly cubes: NonEmptyArray<{
    readonly cube: Cube;
    readonly hostId: UserId;
    readonly format: DraftFormat;
  }>;
  readonly venue: Venue;
  readonly rngSeed?: string;
};

export type PackPodsError =
  | { readonly kind: "no_rsvps" }
  | { readonly kind: "no_valid_config"; readonly reason: string }
  | { readonly kind: "exceeds_max_pods"; readonly maxPods: number; readonly cubes: number };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_POD_SIZES: ReadonlyArray<4 | 6 | 8> = [4, 6, 8];

type RsvpEntry = {
  readonly userId: UserId;
  readonly rsvpTimestamp: ISO8601;
  readonly profile: UserProfile;
};

type Exclusion = { readonly userId: UserId; readonly reason: ExclusionReason };

type CubeEntry = {
  readonly cube: Cube;
  readonly hostId: UserId;
  readonly format: DraftFormat;
};

/** Compute allowed pod sizes for a cube: intersection of [min..max] and {4,6,8}. */
function allowedSizes(cube: Cube): ReadonlyArray<4 | 6 | 8> {
  const minVal = cube.minPodSize as number;
  const maxVal = cube.maxPodSize as number;
  return VALID_POD_SIZES.filter((s) => s >= minVal && s <= maxVal);
}

/** Check whether a user accepts a given format (preferred or fallback). */
function acceptsFormat(profile: UserProfile, format: DraftFormat): boolean {
  return (
    profile.preferredFormats.includes(format) ||
    profile.fallbackFormats.includes(format)
  );
}

/** Check whether a user prefers a given format. */
function prefersFormat(profile: UserProfile, format: DraftFormat): boolean {
  return profile.preferredFormats.includes(format);
}

/**
 * Deterministic hash for tie-breaking. We use a simple string comparison
 * of the serialized config to ensure a total order across candidates.
 */
function configFingerprint(pods: CandidatePod[]): string {
  return pods
    .map(
      (p) =>
        `${p.cubeId as string}:${p.format}:${p.size}:${p.assignedUserIds.map((id) => id as string).join(",")}`,
    )
    .join("|");
}

// ---------------------------------------------------------------------------
// Candidate types for scoring
// ---------------------------------------------------------------------------

type CandidatePod = {
  readonly cubeId: CubeId;
  readonly hostId: UserId;
  readonly format: DraftFormat;
  readonly size: 4 | 6 | 8;
  readonly assignedUserIds: UserId[];
};

type ScoredCandidate = {
  readonly pods: CandidatePod[];
  readonly excludedCount: number;
  readonly hostScore: number;
  readonly formatMatchScore: number;
  readonly totalSeated: number;
  readonly fingerprint: string;
};

function scoreCandidate(
  pods: CandidatePod[],
  rsvpMap: ReadonlyMap<string, RsvpEntry>,
  excluded: ReadonlyArray<Exclusion>,
): ScoredCandidate {
  let hostScore = 0;
  let formatMatchScore = 0;
  let totalSeated = 0;

  for (const pod of pods) {
    // Host-in-own-pod bonus
    if (pod.assignedUserIds.some((id) => (id as string) === (pod.hostId as string))) {
      hostScore += 10;
    }

    for (const uid of pod.assignedUserIds) {
      totalSeated++;
      const entry = rsvpMap.get(uid as string);
      if (entry) {
        if (prefersFormat(entry.profile, pod.format)) {
          formatMatchScore += 2;
        } else if (acceptsFormat(entry.profile, pod.format)) {
          formatMatchScore += 1;
        }
      }
    }
  }

  return {
    pods,
    excludedCount: excluded.length,
    hostScore,
    formatMatchScore,
    totalSeated,
    fingerprint: configFingerprint(pods),
  };
}

/**
 * Compare two scored candidates. Returns negative if `a` is better.
 * Priority: fewer excluded > higher hostScore > higher formatMatchScore > more totalSeated > fingerprint.
 */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  // Fewer exclusions is better (negate: lower excludedCount wins)
  if (a.excludedCount !== b.excludedCount) return a.excludedCount - b.excludedCount;
  // Higher host score is better
  if (a.hostScore !== b.hostScore) return b.hostScore - a.hostScore;
  // Higher format match score is better
  if (a.formatMatchScore !== b.formatMatchScore) return b.formatMatchScore - a.formatMatchScore;
  // More seated is better
  if (a.totalSeated !== b.totalSeated) return b.totalSeated - a.totalSeated;
  // Deterministic tie-break by fingerprint
  return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Seat assignment
// ---------------------------------------------------------------------------

/**
 * Assign seats within a pod. Host gets seat 0, then preferred-format
 * users by RSVP timestamp, then fallback users by RSVP timestamp.
 */
function assignSeats(
  pod: CandidatePod,
  rsvpMap: ReadonlyMap<string, RsvpEntry>,
): Array<{ seatIndex: NonNegativeInt; userId: UserId }> {
  const hostIdStr = pod.hostId as string;
  const others = pod.assignedUserIds.filter((id) => (id as string) !== hostIdStr);

  // Partition into preferred and fallback
  const preferred: UserId[] = [];
  const fallback: UserId[] = [];
  for (const uid of others) {
    const entry = rsvpMap.get(uid as string);
    if (entry && prefersFormat(entry.profile, pod.format)) {
      preferred.push(uid);
    } else {
      fallback.push(uid);
    }
  }

  // Sort each group by RSVP timestamp (ascending = earlier first)
  const byTimestamp = (a: UserId, b: UserId): number => {
    const tA = rsvpMap.get(a as string)?.rsvpTimestamp as string ?? "";
    const tB = rsvpMap.get(b as string)?.rsvpTimestamp as string ?? "";
    if (tA < tB) return -1;
    if (tA > tB) return 1;
    // Deterministic tie-break by userId
    return (a as string) < (b as string) ? -1 : 1;
  };
  preferred.sort(byTimestamp);
  fallback.sort(byTimestamp);

  // Host first if present among assigned users, then preferred, then fallback
  const ordered: UserId[] = [];
  const hostInPod = pod.assignedUserIds.some((id) => (id as string) === hostIdStr);
  if (hostInPod) {
    ordered.push(pod.hostId);
  }
  ordered.push(...preferred, ...fallback);

  return ordered.map((uid, idx) => ({
    seatIndex: idx as NonNegativeInt,
    userId: uid,
  }));
}

/**
 * For team drafts, assign teams ABAB by seat index.
 * This function is used externally when building the full Pod from a PlannedPod.
 */
export function assignTeams(
  seatCount: number,
): Array<"A" | "B"> {
  return Array.from({ length: seatCount }, (_, i) => (i % 2 === 0 ? "A" as const : "B" as const));
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/**
 * Build all possible candidate configurations for a single-pod setup.
 */
function* enumerateSinglePod(
  cubeEntry: CubeEntry,
  eligible: RsvpEntry[],
): Generator<{ pods: CandidatePod[]; excluded: Exclusion[] }> {
  const sizes = allowedSizes(cubeEntry.cube);
  const hostIdStr = cubeEntry.hostId as string;

  for (const size of sizes) {
    if (eligible.length < size) continue;

    // Select users: host first (if eligible), then by preference then timestamp
    const hostEntry = eligible.find((e) => (e.userId as string) === hostIdStr);
    const nonHost = eligible.filter((e) => (e.userId as string) !== hostIdStr);

    // Sort non-host: preferred format first, then by timestamp
    const sorted = [...nonHost].sort((a, b) => {
      const aPref = prefersFormat(a.profile, cubeEntry.format) ? 0 : acceptsFormat(a.profile, cubeEntry.format) ? 1 : 2;
      const bPref = prefersFormat(b.profile, cubeEntry.format) ? 0 : acceptsFormat(b.profile, cubeEntry.format) ? 1 : 2;
      if (aPref !== bPref) return aPref - bPref;
      if ((a.rsvpTimestamp as string) < (b.rsvpTimestamp as string)) return -1;
      if ((a.rsvpTimestamp as string) > (b.rsvpTimestamp as string)) return 1;
      return (a.userId as string) < (b.userId as string) ? -1 : 1;
    });

    // Build the list with host at front if present
    const ordered: RsvpEntry[] = hostEntry ? [hostEntry, ...sorted] : sorted;
    const assigned = ordered.slice(0, size);
    const unseated = ordered.slice(size);

    const assignedIds = assigned.map((e) => e.userId);
    const excluded = unseated.map((e) => ({
      userId: e.userId,
      reason: "over_capacity" as ExclusionReason,
    }));

    yield {
      pods: [
        {
          cubeId: cubeEntry.cube.id,
          hostId: cubeEntry.hostId,
          format: cubeEntry.format,
          size,
          assignedUserIds: assignedIds,
        },
      ],
      excluded,
    };
  }
}

/**
 * Build all possible candidate configurations for a two-pod setup.
 * Enumerates size combinations for each cube and assignment of players.
 */
function* enumerateTwoPods(
  cube1: CubeEntry,
  cube2: CubeEntry,
  eligible: RsvpEntry[],
): Generator<{ pods: CandidatePod[]; excluded: Exclusion[] }> {
  const sizes1 = allowedSizes(cube1.cube);
  const sizes2 = allowedSizes(cube2.cube);

  for (const s1 of sizes1) {
    for (const s2 of sizes2) {
      const totalNeeded = s1 + s2;
      if (eligible.length < totalNeeded) continue;

      // Score each player for each pod and assign greedily
      const host1Str = cube1.hostId as string;
      const host2Str = cube2.hostId as string;

      // Sort all eligible by preference affinity then timestamp
      const scored = eligible.map((e) => {
        const pref1 = prefersFormat(e.profile, cube1.format) ? 2 : acceptsFormat(e.profile, cube1.format) ? 1 : 0;
        const pref2 = prefersFormat(e.profile, cube2.format) ? 2 : acceptsFormat(e.profile, cube2.format) ? 1 : 0;
        return { entry: e, pref1, pref2 };
      });

      // Greedy assignment: hosts go to their own pod, then distribute by preference
      const pod1Users: UserId[] = [];
      const pod2Users: UserId[] = [];
      const remaining: typeof scored = [];

      // Assign hosts first
      for (const s of scored) {
        const idStr = s.entry.userId as string;
        if (idStr === host1Str && pod1Users.length < s1) {
          pod1Users.push(s.entry.userId);
        } else if (idStr === host2Str && pod2Users.length < s2) {
          pod2Users.push(s.entry.userId);
        } else {
          remaining.push(s);
        }
      }

      // Sort remaining by how strongly they prefer one pod over the other
      remaining.sort((a, b) => {
        const aDiff = Math.abs(a.pref1 - a.pref2);
        const bDiff = Math.abs(b.pref1 - b.pref2);
        // Higher diff means stronger preference for one pod - assign them first
        if (aDiff !== bDiff) return bDiff - aDiff;
        // Tie: earlier RSVP first
        if ((a.entry.rsvpTimestamp as string) < (b.entry.rsvpTimestamp as string)) return -1;
        if ((a.entry.rsvpTimestamp as string) > (b.entry.rsvpTimestamp as string)) return 1;
        return (a.entry.userId as string) < (b.entry.userId as string) ? -1 : 1;
      });

      const unseated: RsvpEntry[] = [];

      for (const s of remaining) {
        const canFit1 = pod1Users.length < s1;
        const canFit2 = pod2Users.length < s2;

        if (canFit1 && canFit2) {
          // Place in the pod they prefer more
          if (s.pref1 >= s.pref2) {
            pod1Users.push(s.entry.userId);
          } else {
            pod2Users.push(s.entry.userId);
          }
        } else if (canFit1) {
          pod1Users.push(s.entry.userId);
        } else if (canFit2) {
          pod2Users.push(s.entry.userId);
        } else {
          unseated.push(s.entry);
        }
      }

      // Only yield if both pods are fully filled
      if (pod1Users.length !== s1 || pod2Users.length !== s2) continue;

      const excluded = unseated.map((e) => ({
        userId: e.userId,
        reason: "over_capacity" as ExclusionReason,
      }));

      yield {
        pods: [
          {
            cubeId: cube1.cube.id,
            hostId: cube1.hostId,
            format: cube1.format,
            size: s1,
            assignedUserIds: pod1Users,
          },
          {
            cubeId: cube2.cube.id,
            hostId: cube2.hostId,
            format: cube2.format,
            size: s2,
            assignedUserIds: pod2Users,
          },
        ],
        excluded,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

export function packPods(
  input: PackPodsInput,
): Result<PodConfiguration, PackPodsError> {
  const { rsvps, cubes, venue } = input;

  // Validate: must have RSVPs
  if (rsvps.length === 0) {
    return err({ kind: "no_rsvps" as const });
  }

  // Validate: cubes <= maxPods
  if (cubes.length > (venue.maxPods as number)) {
    return err({
      kind: "exceeds_max_pods" as const,
      maxPods: venue.maxPods as number,
      cubes: cubes.length,
    });
  }

  // Build lookup map
  const rsvpMap = new Map<string, RsvpEntry>();
  for (const r of rsvps) {
    rsvpMap.set(r.userId as string, r);
  }

  // Phase 1: Separate banned users and those who cannot play any selected format
  const excluded: Exclusion[] = [];
  const eligible: RsvpEntry[] = [];

  for (const r of rsvps) {
    if (r.profile.banned.kind === "banned") {
      excluded.push({ userId: r.userId, reason: "banned" });
      continue;
    }

    // Check if user accepts at least one selected cube's format
    const acceptsAny = cubes.some(
      (c) => acceptsFormat(r.profile, c.format),
    );
    if (!acceptsAny) {
      excluded.push({ userId: r.userId, reason: "format_mismatch" });
      continue;
    }

    eligible.push(r);
  }

  // Apply venue capacity: if eligible exceeds capacity, cap and mark over_capacity
  const capacity = venue.capacity as number;
  const sortedEligible = [...eligible].sort((a, b) => {
    if ((a.rsvpTimestamp as string) < (b.rsvpTimestamp as string)) return -1;
    if ((a.rsvpTimestamp as string) > (b.rsvpTimestamp as string)) return 1;
    return (a.userId as string) < (b.userId as string) ? -1 : 1;
  });

  const withinCapacity = sortedEligible.slice(0, capacity);
  const overCapacity = sortedEligible.slice(capacity);
  for (const oc of overCapacity) {
    excluded.push({ userId: oc.userId, reason: "over_capacity" });
  }

  // Phase 2: Enumerate configurations
  const candidates: ScoredCandidate[] = [];

  if (cubes.length === 1) {
    // Single cube: try single pod
    for (const candidate of enumerateSinglePod(cubes[0], withinCapacity)) {
      const allExcluded = [...excluded, ...candidate.excluded];
      candidates.push(scoreCandidate(candidate.pods, rsvpMap, allExcluded));
    }
  } else if (cubes.length === 2) {
    // Two cubes: try two pods
    for (const candidate of enumerateTwoPods(cubes[0], cubes[1]!, withinCapacity)) {
      const allExcluded = [...excluded, ...candidate.excluded];
      candidates.push(scoreCandidate(candidate.pods, rsvpMap, allExcluded));
    }

    // Also try single pod with each cube individually (might be better if not enough players)
    for (const cubeEntry of cubes) {
      for (const candidate of enumerateSinglePod(cubeEntry, withinCapacity)) {
        const allExcluded = [...excluded, ...candidate.excluded];
        candidates.push(scoreCandidate(candidate.pods, rsvpMap, allExcluded));
      }
    }
  }

  // Phase 3: Pick the best candidate
  if (candidates.length === 0) {
    return err({
      kind: "no_valid_config" as const,
      reason: `Cannot form any valid pod from ${withinCapacity.length} eligible player(s) and the selected cube(s)`,
    });
  }

  candidates.sort(compareCandidates);
  const best = candidates[0]!;

  // Phase 4: Build the PlannedPods with seat assignments
  const plannedPods: PlannedPod[] = best.pods.map((pod) => {
    const seats = assignSeats(pod, rsvpMap);
    return {
      cubeId: pod.cubeId,
      hostId: pod.hostId,
      format: pod.format,
      size: pod.size as EvenPodSize,
      seats: seats as NonEmptyArray<{ seatIndex: NonNegativeInt; userId: UserId }>,
    };
  });

  if (!isNonEmpty(plannedPods)) {
    return err({
      kind: "no_valid_config" as const,
      reason: "Internal error: no pods produced",
    });
  }

  // Compute waitlisted: eligible users who weren't seated in the best config
  const seatedIds = new Set<string>();
  for (const pod of plannedPods) {
    for (const seat of pod.seats) {
      seatedIds.add(seat.userId as string);
    }
  }
  const waitlisted = withinCapacity
    .filter((e) => !seatedIds.has(e.userId as string))
    .map((e) => e.userId);

  // Merge over-capacity excluded with format/banned excluded
  // Waitlisted users (within capacity but not seated) go to waitlisted, not excluded
  const finalExcluded = excluded.filter(
    (e) => !waitlisted.some((w) => (w as string) === (e.userId as string)),
  );

  const totalSeated = plannedPods.reduce((sum, p) => sum + p.seats.length, 0);

  const config: PodConfiguration = {
    pods: plannedPods,
    waitlisted,
    excluded: finalExcluded,
    summary: {
      seated: totalSeated as NonNegativeInt,
      rsvpd: rsvps.length as NonNegativeInt,
      capacity: venue.capacity,
    },
  };

  return ok(config);
}
