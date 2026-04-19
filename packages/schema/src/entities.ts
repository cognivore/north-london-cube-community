/**
 * Zod schemas for all domain entities from @cubehall/core.
 */

import { z } from "zod";
import type { JsonValue } from "@cubehall/core";
import { DRAFT_FORMATS, SYSTEM_ROLES, RSVP_STATES, POD_STATES, ROUND_STATES, TIEBREAKERS } from "@cubehall/core";
import {
  UserIdSchema,
  FridayIdSchema,
  CubeIdSchema,
  PodIdSchema,
  RoundIdSchema,
  MatchIdSchema,
  EnrollmentIdSchema,
  RsvpIdSchema,
  VoteIdSchema,
  VenueIdSchema,
  SessionIdSchema,
  AuditEventIdSchema,
  ChallengeTokenSchema,
  TeamIdSchema,
  ISO8601Schema,
  LocalDateSchema,
  EmailSchema,
  UrlSchema,
  NonEmptyStringSchema,
  DurationSchema,
  PenceSchema,
  EvenPodSizeSchema,
  PositiveIntSchema,
  NonNegativeIntSchema,
} from "./primitives.js";

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

export const DraftFormatSchema = z.enum(DRAFT_FORMATS);

export const SystemRoleSchema = z.enum(SYSTEM_ROLES);

export const RsvpStateSchema = z.enum(RSVP_STATES);

export const PodStateSchema = z.enum(POD_STATES);

export const RoundStateSchema = z.enum(ROUND_STATES);

// ---------------------------------------------------------------------------
// Helper: NonEmptyArray (at least one element)
// ---------------------------------------------------------------------------

function nonEmptyArray<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).min(1);
}

// ---------------------------------------------------------------------------
// AuthState — discriminated union
// ---------------------------------------------------------------------------

export const AuthStateSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("pending_verification"),
      challenge: ChallengeTokenSchema,
      expires: ISO8601Schema,
    }),
    z.object({
      kind: z.literal("verified"),
    }),
    z.object({
      kind: z.literal("suspended"),
      reason: z.string(),
      until: ISO8601Schema,
    }),
  ],
);

// ---------------------------------------------------------------------------
// BanState — discriminated union
// ---------------------------------------------------------------------------

export const BanStateSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("not_banned") }),
    z.object({
      kind: z.literal("banned"),
      until: ISO8601Schema,
      reason: z.string(),
    }),
  ],
);

// ---------------------------------------------------------------------------
// UserProfile
// ---------------------------------------------------------------------------

export const UserProfileSchema = z.object({
  preferredFormats: nonEmptyArray(DraftFormatSchema),
  fallbackFormats: z.array(DraftFormatSchema),
  hostCapable: z.boolean(),
  bio: z.string(),
  noShowCount: NonNegativeIntSchema,
  banned: BanStateSchema,
});

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const UserSchema = z.object({
  id: UserIdSchema,
  email: EmailSchema,
  displayName: NonEmptyStringSchema,
  createdAt: ISO8601Schema,
  authState: AuthStateSchema,
  profile: UserProfileSchema,
  role: SystemRoleSchema,
});

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

export const VenueSchema = z.object({
  id: VenueIdSchema,
  name: NonEmptyStringSchema,
  address: z.string(),
  capacity: PositiveIntSchema,
  maxPods: PositiveIntSchema,
  houseCreditPerPlayer: PenceSchema,
  active: z.boolean(),
});

// ---------------------------------------------------------------------------
// Cube
// ---------------------------------------------------------------------------

export const CubeSchema = z.object({
  id: CubeIdSchema,
  ownerId: UserIdSchema,
  name: NonEmptyStringSchema,
  cubecobraUrl: UrlSchema,
  cubecobraId: z.string(),
  cardCount: PositiveIntSchema,
  supportedFormats: nonEmptyArray(DraftFormatSchema),
  preferredPodSize: EvenPodSizeSchema,
  minPodSize: EvenPodSizeSchema,
  maxPodSize: EvenPodSizeSchema,
  tags: z.array(z.string()),
  lastRunAt: ISO8601Schema.nullable(),
  retired: z.boolean(),
});

// ---------------------------------------------------------------------------
// VoteContext
// ---------------------------------------------------------------------------

export const VoteContextSchema = z.object({
  candidates: nonEmptyArray(EnrollmentIdSchema),
  opensAt: ISO8601Schema,
  closesAt: ISO8601Schema,
});

// ---------------------------------------------------------------------------
// CancelReason
// ---------------------------------------------------------------------------

export const CancelReasonSchema = z.enum([
  "no_cubes",
  "insufficient_rsvps",
  "admin",
]);

// ---------------------------------------------------------------------------
// Tiebreaker
// ---------------------------------------------------------------------------

export const TiebreakerSchema = z.enum(TIEBREAKERS);

// ---------------------------------------------------------------------------
// PairingStrategy — discriminated union
// ---------------------------------------------------------------------------

export const PairingStrategySchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("swiss"),
      tiebreakers: z.array(TiebreakerSchema),
    }),
    z.object({
      kind: z.literal("round_robin_cross_team"),
      teamSize: PositiveIntSchema,
    }),
    z.object({
      kind: z.literal("swiss_cross_team"),
      teamSize: PositiveIntSchema,
    }),
    z.object({
      kind: z.literal("single_elimination"),
    }),
  ]);

// ---------------------------------------------------------------------------
// PairingsTemplate
// ---------------------------------------------------------------------------

export const PairingsTemplateSchema = z.object({
  format: DraftFormatSchema,
  podSize: EvenPodSizeSchema,
  rounds: PositiveIntSchema,
  strategy: PairingStrategySchema,
});

// ---------------------------------------------------------------------------
// ExclusionReason
// ---------------------------------------------------------------------------

export const ExclusionReasonSchema = z.enum([
  "over_capacity",
  "format_mismatch",
  "banned",
]);

// ---------------------------------------------------------------------------
// PlannedPod
// ---------------------------------------------------------------------------

export const PlannedPodSchema = z.object({
  cubeId: CubeIdSchema,
  hostId: UserIdSchema,
  format: DraftFormatSchema,
  size: EvenPodSizeSchema,
  seats: nonEmptyArray(
    z.object({
      seatIndex: NonNegativeIntSchema,
      userId: UserIdSchema,
    }),
  ),
});

// ---------------------------------------------------------------------------
// PodConfiguration
// ---------------------------------------------------------------------------

export const PodConfigurationSchema = z.object({
  pods: nonEmptyArray(PlannedPodSchema),
  waitlisted: z.array(UserIdSchema),
  excluded: z.array(
    z.object({
      userId: UserIdSchema,
      reason: ExclusionReasonSchema,
    }),
  ),
  summary: z.object({
    seated: NonNegativeIntSchema,
    rsvpd: NonNegativeIntSchema,
    capacity: PositiveIntSchema,
  }),
});

// ---------------------------------------------------------------------------
// FridayState — discriminated union (central state machine)
// ---------------------------------------------------------------------------

export const FridayStateSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scheduled") }),
    z.object({ kind: z.literal("open") }),
    z.object({ kind: z.literal("enrollment_closed") }),
    z.object({
      kind: z.literal("vote_open"),
      vote: VoteContextSchema,
    }),
    z.object({
      kind: z.literal("vote_closed"),
      winners: nonEmptyArray(EnrollmentIdSchema),
    }),
    z.object({
      kind: z.literal("locked"),
      config: PodConfigurationSchema,
    }),
    z.object({ kind: z.literal("confirmed") }),
    z.object({
      kind: z.literal("cancelled"),
      reason: CancelReasonSchema,
    }),
    z.object({ kind: z.literal("in_progress") }),
    z.object({ kind: z.literal("complete") }),
  ]);

// ---------------------------------------------------------------------------
// Friday
// ---------------------------------------------------------------------------

export const FridaySchema = z.object({
  id: FridayIdSchema,
  date: LocalDateSchema,
  venueId: VenueIdSchema,
  state: FridayStateSchema,
  createdAt: ISO8601Schema,
  lockedAt: ISO8601Schema.nullable(),
  confirmedAt: ISO8601Schema.nullable(),
  completedAt: ISO8601Schema.nullable(),
});

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export const EnrollmentSchema = z.object({
  id: EnrollmentIdSchema,
  fridayId: FridayIdSchema,
  cubeId: CubeIdSchema,
  hostId: UserIdSchema,
  createdAt: ISO8601Schema,
  withdrawn: z.boolean(),
});

// ---------------------------------------------------------------------------
// Rsvp
// ---------------------------------------------------------------------------

export const RsvpSchema = z.object({
  id: RsvpIdSchema,
  fridayId: FridayIdSchema,
  userId: UserIdSchema,
  state: RsvpStateSchema,
  createdAt: ISO8601Schema,
  lastTransitionAt: ISO8601Schema,
});

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export const VoteSchema = z.object({
  id: VoteIdSchema,
  fridayId: FridayIdSchema,
  userId: UserIdSchema,
  ranking: nonEmptyArray(EnrollmentIdSchema),
  createdAt: ISO8601Schema,
});

// ---------------------------------------------------------------------------
// Seat
// ---------------------------------------------------------------------------

export const SeatSchema = z.object({
  podId: PodIdSchema,
  seatIndex: NonNegativeIntSchema,
  userId: UserIdSchema,
  team: TeamIdSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

export const PodSchema = z.object({
  id: PodIdSchema,
  fridayId: FridayIdSchema,
  cubeId: CubeIdSchema,
  hostId: UserIdSchema,
  format: DraftFormatSchema,
  seats: z.array(SeatSchema),
  state: PodStateSchema,
  pairingsTemplate: PairingsTemplateSchema,
});

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const ExtensionSchema = z.object({
  addedAt: ISO8601Schema,
  addedSeconds: DurationSchema,
});

// ---------------------------------------------------------------------------
// TimerState — discriminated union
// ---------------------------------------------------------------------------

export const TimerStateSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("not_started") }),
    z.object({
      kind: z.literal("running"),
      startedAt: ISO8601Schema,
      deadline: ISO8601Schema,
      elapsed: DurationSchema,
    }),
    z.object({
      kind: z.literal("paused"),
      pausedAt: ISO8601Schema,
      remaining: DurationSchema,
    }),
    z.object({
      kind: z.literal("additional_turns"),
      turnsRemaining: NonNegativeIntSchema,
    }),
    z.object({
      kind: z.literal("finished"),
      finishedAt: ISO8601Schema,
    }),
  ],
);

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------

export const RoundSchema = z.object({
  id: RoundIdSchema,
  podId: PodIdSchema,
  roundNumber: PositiveIntSchema,
  state: RoundStateSchema,
  startedAt: ISO8601Schema.nullable(),
  endedAt: ISO8601Schema.nullable(),
  timeLimit: DurationSchema,
  extensions: z.array(ExtensionSchema),
  timer: TimerStateSchema,
});

// ---------------------------------------------------------------------------
// MatchResult — discriminated union
// ---------------------------------------------------------------------------

export const MatchResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("pending") }),
    z.object({
      kind: z.literal("reported"),
      p1Wins: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      p2Wins: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      draws: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
      ]),
    }),
    z.object({ kind: z.literal("double_loss") }),
    z.object({
      kind: z.literal("unfinished"),
      p1Wins: z.union([z.literal(0), z.literal(1)]),
      p2Wins: z.union([z.literal(0), z.literal(1)]),
      draws: z.number(),
    }),
  ],
);

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export const MatchSchema = z.object({
  id: MatchIdSchema,
  roundId: RoundIdSchema,
  player1Id: UserIdSchema,
  player2Id: UserIdSchema,
  result: MatchResultSchema,
  submittedAt: ISO8601Schema.nullable(),
  submittedBy: UserIdSchema.nullable(),
});

// ---------------------------------------------------------------------------
// AuditSubjectKind / AuditSubject
// ---------------------------------------------------------------------------

export const AuditSubjectKindSchema = z.enum([
  "friday",
  "pod",
  "user",
  "cube",
  "enrollment",
  "rsvp",
  "vote",
  "round",
  "match",
]);

export const AuditSubjectSchema = z.object({
  kind: AuditSubjectKindSchema,
  id: z.string(),
});

// ---------------------------------------------------------------------------
// JsonValue (recursive)
// ---------------------------------------------------------------------------

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// AuditEvent
// ---------------------------------------------------------------------------

export const AuditEventSchema = z.object({
  id: AuditEventIdSchema,
  at: ISO8601Schema,
  actorId: z.union([UserIdSchema, z.literal("system")]),
  subject: AuditSubjectSchema,
  action: z.string(),
  before: JsonValueSchema.nullable(),
  after: JsonValueSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const SessionSchema = z.object({
  id: SessionIdSchema,
  userId: UserIdSchema,
  createdAt: ISO8601Schema,
  expiresAt: ISO8601Schema,
  lastActivityAt: ISO8601Schema,
});

// ---------------------------------------------------------------------------
// InviteCode
// ---------------------------------------------------------------------------

export const InviteCodeSchema = z.object({
  code: z.string(),
  createdBy: UserIdSchema,
  createdAt: ISO8601Schema,
  expiresAt: ISO8601Schema.nullable(),
  maxUses: z.number().nullable(),
  usedCount: z.number(),
});
