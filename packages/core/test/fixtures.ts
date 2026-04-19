/**
 * Test fixtures — helper functions to build realistic test data.
 */

import type { NonEmptyArray } from "../src/brand.js";
import type { Cube } from "../src/model/cube.js";
import type { Enrollment } from "../src/model/enrollment.js";
import type { DraftFormat } from "../src/model/enums.js";
import type { Friday, FridayState, VoteContext } from "../src/model/friday.js";
import type { Match, MatchResult, PlannedMatch } from "../src/model/match.js";
import type { PlannedPod, PodConfiguration, Seat } from "../src/model/pod.js";
import type { BanState, UserProfile } from "../src/model/user.js";
import type { Venue } from "../src/model/venue.js";
import type { Vote } from "../src/model/vote.js";
import type { PairingsTemplate, PairingStrategy } from "../src/engine/pairings-types.js";
import {
  unsafeUserId,
  unsafeFridayId,
  unsafeCubeId,
  unsafePodId,
  unsafeRoundId,
  unsafeMatchId,
  unsafeEnrollmentId,
  unsafeVoteId,
  unsafeVenueId,
  unsafeTeamId,
  unsafeISO8601,
  unsafeLocalDate,
  unsafeNonEmptyString,
  unsafeUrl,
  unsafeEvenPodSize,
  unsafePositiveInt,
  unsafeNonNegativeInt,
  unsafePence,
  unsafeRsvpId,
} from "../src/ids.js";
import type {
  CubeId,
  EnrollmentId,
  EvenPodSize,
  FridayId,
  ISO8601,
  MatchId,
  NonNegativeInt,
  PodId,
  PositiveInt,
  RoundId,
  UserId,
  VenueId,
} from "../src/ids.js";

// ---------------------------------------------------------------------------
// ID generators (sequential UUIDs for determinism)
// ---------------------------------------------------------------------------

let counter = 0;

function seqUuid(): string {
  counter++;
  const hex = counter.toString(16).padStart(12, "0");
  return `00000000-0000-0000-0000-${hex}`;
}

export function resetIdCounter(): void {
  counter = 0;
}

// ---------------------------------------------------------------------------
// makeUser helpers
// ---------------------------------------------------------------------------

export function makeUserId(n?: number): UserId {
  if (n !== undefined) {
    const hex = n.toString(16).padStart(12, "0");
    return unsafeUserId(`00000000-0000-0000-0000-${hex}`);
  }
  return unsafeUserId(seqUuid());
}

export function makeUserProfile(overrides?: Partial<UserProfile>): UserProfile {
  return {
    preferredFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
    fallbackFormats: ["team_draft_3v3", "team_draft_4v4"],
    hostCapable: false,
    bio: "",
    noShowCount: 0 as NonNegativeInt,
    banned: { kind: "not_banned" } as BanState,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeCube
// ---------------------------------------------------------------------------

export function makeCube(overrides?: Partial<Cube> & { id?: CubeId }): Cube {
  return {
    id: overrides?.id ?? unsafeCubeId(seqUuid()),
    ownerId: makeUserId(999),
    name: unsafeNonEmptyString("Test Cube"),
    cubecobraUrl: unsafeUrl("https://cubecobra.com/cube/overview/test"),
    cubecobraId: "test",
    cardCount: 360 as PositiveInt,
    supportedFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
    preferredPodSize: 8 as EvenPodSize,
    minPodSize: 4 as EvenPodSize,
    maxPodSize: 8 as EvenPodSize,
    tags: [],
    lastRunAt: null,
    retired: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeVenue
// ---------------------------------------------------------------------------

export function makeVenue(overrides?: Partial<{
  id: VenueId;
  capacity: number;
  maxPods: number;
}>): Venue {
  return {
    id: overrides?.id ?? unsafeVenueId(seqUuid()),
    name: unsafeNonEmptyString("Test Venue"),
    address: "123 Test Street",
    capacity: (overrides?.capacity ?? 16) as PositiveInt,
    maxPods: (overrides?.maxPods ?? 2) as PositiveInt,
    houseCreditPerPlayer: unsafePence(500),
    active: true,
  };
}

// ---------------------------------------------------------------------------
// makeEnrollment
// ---------------------------------------------------------------------------

export function makeEnrollment(overrides?: Partial<Enrollment> & {
  id?: EnrollmentId;
  cubeId?: CubeId;
  hostId?: UserId;
  fridayId?: FridayId;
}): Enrollment {
  return {
    id: overrides?.id ?? unsafeEnrollmentId(seqUuid()),
    fridayId: overrides?.fridayId ?? unsafeFridayId(seqUuid()),
    cubeId: overrides?.cubeId ?? unsafeCubeId(seqUuid()),
    hostId: overrides?.hostId ?? makeUserId(999),
    createdAt: unsafeISO8601("2025-01-01T00:00:00Z"),
    withdrawn: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeRsvp data
// ---------------------------------------------------------------------------

export function makeRsvpEntry(
  userId: UserId,
  timestamp: string,
  profileOverrides?: Partial<UserProfile>,
): {
  userId: UserId;
  rsvpTimestamp: ISO8601;
  profile: UserProfile;
} {
  return {
    userId,
    rsvpTimestamp: unsafeISO8601(timestamp),
    profile: makeUserProfile(profileOverrides),
  };
}

// ---------------------------------------------------------------------------
// makeSeat
// ---------------------------------------------------------------------------

export function makeSeat(
  podId: PodId,
  seatIndex: number,
  userId: UserId,
  team: "A" | "B" | null = null,
): Seat {
  return {
    podId,
    seatIndex: seatIndex as NonNegativeInt,
    userId,
    team: team !== null ? unsafeTeamId(team) : null,
  };
}

// ---------------------------------------------------------------------------
// makeMatch
// ---------------------------------------------------------------------------

export function makeMatch(overrides: {
  id?: MatchId;
  roundId?: RoundId;
  player1Id: UserId;
  player2Id: UserId;
  result: MatchResult;
}): Match {
  return {
    id: overrides.id ?? unsafeMatchId(seqUuid()),
    roundId: overrides.roundId ?? unsafeRoundId(seqUuid()),
    player1Id: overrides.player1Id,
    player2Id: overrides.player2Id,
    result: overrides.result,
    submittedAt: overrides.result.kind === "pending" ? null : unsafeISO8601("2025-01-01T12:00:00Z"),
    submittedBy: overrides.result.kind === "pending" ? null : overrides.player1Id,
  };
}

export function reportedResult(p1Wins: 0 | 1 | 2, p2Wins: 0 | 1 | 2, draws: 0 | 1 | 2 | 3 = 0): MatchResult {
  return { kind: "reported", p1Wins, p2Wins, draws };
}

// ---------------------------------------------------------------------------
// makeVote
// ---------------------------------------------------------------------------

export function makeVote(overrides: {
  userId: UserId;
  fridayId?: FridayId;
  ranking: EnrollmentId[];
}): Vote {
  return {
    id: unsafeVoteId(seqUuid()),
    fridayId: overrides.fridayId ?? unsafeFridayId(seqUuid()),
    userId: overrides.userId,
    ranking: overrides.ranking as NonEmptyArray<EnrollmentId>,
    createdAt: unsafeISO8601("2025-01-01T12:00:00Z"),
  };
}

// ---------------------------------------------------------------------------
// makeVoteContext
// ---------------------------------------------------------------------------

export function makeVoteContext(candidateIds: EnrollmentId[]): VoteContext {
  return {
    candidates: candidateIds as NonEmptyArray<EnrollmentId>,
    opensAt: unsafeISO8601("2025-01-01T00:00:00Z"),
    closesAt: unsafeISO8601("2025-01-01T12:00:00Z"),
  };
}

// ---------------------------------------------------------------------------
// makePodConfiguration
// ---------------------------------------------------------------------------

export function makePodConfiguration(overrides?: Partial<PodConfiguration>): PodConfiguration {
  const pod: PlannedPod = {
    cubeId: unsafeCubeId(seqUuid()),
    hostId: makeUserId(1),
    format: "swiss_draft",
    size: 4 as EvenPodSize,
    seats: [
      { seatIndex: 0 as NonNegativeInt, userId: makeUserId(1) },
      { seatIndex: 1 as NonNegativeInt, userId: makeUserId(2) },
      { seatIndex: 2 as NonNegativeInt, userId: makeUserId(3) },
      { seatIndex: 3 as NonNegativeInt, userId: makeUserId(4) },
    ] as NonEmptyArray<{ seatIndex: NonNegativeInt; userId: UserId }>,
  };
  return {
    pods: [pod] as NonEmptyArray<PlannedPod>,
    waitlisted: [],
    excluded: [],
    summary: {
      seated: 4 as NonNegativeInt,
      rsvpd: 4 as NonNegativeInt,
      capacity: 16 as PositiveInt,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makePairingsTemplate
// ---------------------------------------------------------------------------

export function makePairingsTemplate(overrides?: Partial<PairingsTemplate>): PairingsTemplate {
  return {
    format: "swiss_draft",
    podSize: 4 as EvenPodSize,
    rounds: 3 as PositiveInt,
    strategy: { kind: "swiss", tiebreakers: ["match_points", "opponent_match_win_percent", "game_win_percent"] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario: Oversubscribed Friday
// ---------------------------------------------------------------------------

export function scenario_oversubscribed_friday() {
  const fridayId = unsafeFridayId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  const venueId = unsafeVenueId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

  // 4 cube hosts
  const host1 = makeUserId(101);
  const host2 = makeUserId(102);
  const host3 = makeUserId(103);
  const host4 = makeUserId(104);

  // 4 enrolled cubes
  const cube1 = makeCube({
    id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc01"),
    ownerId: host1,
    name: unsafeNonEmptyString("Alpha Cube"),
    supportedFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
    minPodSize: 4 as EvenPodSize,
    maxPodSize: 8 as EvenPodSize,
    lastRunAt: unsafeISO8601("2025-06-01T00:00:00Z"),
  });
  const cube2 = makeCube({
    id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc02"),
    ownerId: host2,
    name: unsafeNonEmptyString("Beta Cube"),
    supportedFormats: ["team_draft_3v3"] as NonEmptyArray<DraftFormat>,
    minPodSize: 6 as EvenPodSize,
    maxPodSize: 6 as EvenPodSize,
    lastRunAt: unsafeISO8601("2025-05-01T00:00:00Z"),
  });
  const cube3 = makeCube({
    id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc03"),
    ownerId: host3,
    name: unsafeNonEmptyString("Gamma Cube"),
    supportedFormats: ["team_draft_4v4"] as NonEmptyArray<DraftFormat>,
    minPodSize: 8 as EvenPodSize,
    maxPodSize: 8 as EvenPodSize,
    lastRunAt: null,
  });
  const cube4 = makeCube({
    id: unsafeCubeId("cccccccc-cccc-cccc-cccc-cccccccccc04"),
    ownerId: host4,
    name: unsafeNonEmptyString("Delta Cube"),
    supportedFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
    minPodSize: 4 as EvenPodSize,
    maxPodSize: 8 as EvenPodSize,
    lastRunAt: unsafeISO8601("2025-07-01T00:00:00Z"),
  });

  const enrollment1 = makeEnrollment({
    id: unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01"),
    fridayId,
    cubeId: cube1.id,
    hostId: host1,
  });
  const enrollment2 = makeEnrollment({
    id: unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02"),
    fridayId,
    cubeId: cube2.id,
    hostId: host2,
  });
  const enrollment3 = makeEnrollment({
    id: unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03"),
    fridayId,
    cubeId: cube3.id,
    hostId: host3,
  });
  const enrollment4 = makeEnrollment({
    id: unsafeEnrollmentId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04"),
    fridayId,
    cubeId: cube4.id,
    hostId: host4,
  });

  // 15 RSVPs (oversubscribed for most configs)
  const rsvps = Array.from({ length: 15 }, (_, i) => {
    const uid = makeUserId(200 + i);
    const hour = (i + 1).toString().padStart(2, "0");
    return makeRsvpEntry(uid, `2025-01-10T${hour}:00:00Z`, {
      preferredFormats: i < 8
        ? ["swiss_draft"] as NonEmptyArray<DraftFormat>
        : ["team_draft_3v3"] as NonEmptyArray<DraftFormat>,
      fallbackFormats: ["team_draft_4v4", "swiss_draft"],
    });
  });

  // Also include the hosts as RSVPs
  const hostRsvps = [
    makeRsvpEntry(host1, "2025-01-10T00:01:00Z", {
      preferredFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
      fallbackFormats: ["team_draft_3v3"],
    }),
    makeRsvpEntry(host2, "2025-01-10T00:02:00Z", {
      preferredFormats: ["team_draft_3v3"] as NonEmptyArray<DraftFormat>,
      fallbackFormats: ["swiss_draft"],
    }),
    makeRsvpEntry(host3, "2025-01-10T00:03:00Z", {
      preferredFormats: ["team_draft_4v4"] as NonEmptyArray<DraftFormat>,
      fallbackFormats: ["swiss_draft"],
    }),
    makeRsvpEntry(host4, "2025-01-10T00:04:00Z", {
      preferredFormats: ["swiss_draft"] as NonEmptyArray<DraftFormat>,
      fallbackFormats: [],
    }),
  ];

  // Votes: each voter ranks the 4 enrollments
  const voters = rsvps.slice(0, 10);
  const votes = voters.map((r) =>
    makeVote({
      userId: r.userId,
      fridayId,
      ranking: [enrollment1.id, enrollment2.id, enrollment3.id, enrollment4.id],
    }),
  );

  const venue = makeVenue({ id: venueId, capacity: 16, maxPods: 2 });

  return {
    fridayId,
    venue,
    cubes: [cube1, cube2, cube3, cube4],
    enrollments: [enrollment1, enrollment2, enrollment3, enrollment4],
    rsvps: [...hostRsvps, ...rsvps],
    votes,
    hosts: [host1, host2, host3, host4],
  };
}
