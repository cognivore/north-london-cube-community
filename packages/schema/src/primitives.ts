/**
 * Zod schemas for all branded primitives from @cubehall/core.
 *
 * Each schema validates input and transforms the output to the
 * corresponding branded type using the unsafe constructors.
 */

import { z } from "zod";
import type {
  UserId,
  FridayId,
  CubeId,
  PodId,
  RoundId,
  MatchId,
  EnrollmentId,
  RsvpId,
  VoteId,
  VenueId,
  TeamId,
  SessionId,
  InviteCodeId,
  AuditEventId,
  ChallengeToken,
  ISO8601,
  LocalDate,
  Email,
  Url,
  NonEmptyString,
  Duration,
  Pence,
  EvenPodSize,
  PositiveInt,
  NonNegativeInt,
} from "@cubehall/core";
import {
  unsafeUserId,
  unsafeFridayId,
  unsafeCubeId,
  unsafePodId,
  unsafeRoundId,
  unsafeMatchId,
  unsafeEnrollmentId,
  unsafeRsvpId,
  unsafeVoteId,
  unsafeVenueId,
  unsafeTeamId,
  unsafeSessionId,
  unsafeInviteCodeId,
  unsafeAuditEventId,
  unsafeChallengeToken,
  unsafeISO8601,
  unsafeLocalDate,
  unsafeEmail,
  unsafeUrl,
  unsafeNonEmptyString,
  unsafeDuration,
  unsafePence,
  unsafeEvenPodSize,
  unsafePositiveInt,
  unsafeNonNegativeInt,
} from "@cubehall/core";

// ---------------------------------------------------------------------------
// Regex patterns (mirrored from @cubehall/core/ids)
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].\S*$/i;

// ---------------------------------------------------------------------------
// Base reusable schemas (pre-transform)
// ---------------------------------------------------------------------------

const uuidBase = z.string().regex(UUID_RE, "Invalid UUID");

// ---------------------------------------------------------------------------
// Semantic primitive schemas
// ---------------------------------------------------------------------------

export const ISO8601Schema: z.ZodType<ISO8601, z.ZodTypeDef, string> = z
  .string()
  .regex(ISO_RE, "Invalid ISO8601 UTC timestamp")
  .refine((s) => !isNaN(Date.parse(s)), "Unparseable date")
  .transform((s) => unsafeISO8601(s));

export const LocalDateSchema: z.ZodType<LocalDate, z.ZodTypeDef, string> = z
  .string()
  .regex(LOCAL_DATE_RE, "Expected YYYY-MM-DD")
  .transform((s) => unsafeLocalDate(s));

export const EmailSchema: z.ZodType<Email, z.ZodTypeDef, string> = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(EMAIL_RE, "Invalid email"))
  .transform((s) => unsafeEmail(s));

export const UrlSchema: z.ZodType<Url, z.ZodTypeDef, string> = z
  .string()
  .regex(URL_RE, "Invalid URL")
  .transform((s) => unsafeUrl(s));

export const NonEmptyStringSchema: z.ZodType<
  NonEmptyString,
  z.ZodTypeDef,
  string
> = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Must be non-empty"))
  .transform((s) => unsafeNonEmptyString(s));

export const DurationSchema: z.ZodType<Duration, z.ZodTypeDef, number> = z
  .number()
  .int("Must be an integer")
  .nonnegative("Must be non-negative")
  .transform((n) => unsafeDuration(n));

export const PenceSchema: z.ZodType<Pence, z.ZodTypeDef, number> = z
  .number()
  .int("Must be an integer")
  .nonnegative("Must be non-negative")
  .transform((n) => unsafePence(n));

export const EvenPodSizeSchema: z.ZodType<EvenPodSize, z.ZodTypeDef, number> =
  z
    .union([z.literal(4), z.literal(6), z.literal(8)])
    .transform((n) => unsafeEvenPodSize(n));

export const PositiveIntSchema: z.ZodType<PositiveInt, z.ZodTypeDef, number> = z
  .number()
  .int("Must be an integer")
  .positive("Must be positive")
  .transform((n) => unsafePositiveInt(n));

export const NonNegativeIntSchema: z.ZodType<
  NonNegativeInt,
  z.ZodTypeDef,
  number
> = z
  .number()
  .int("Must be an integer")
  .nonnegative("Must be non-negative")
  .transform((n) => unsafeNonNegativeInt(n));

// ---------------------------------------------------------------------------
// Entity ID schemas
// ---------------------------------------------------------------------------

export const UserIdSchema: z.ZodType<UserId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeUserId(s));

export const FridayIdSchema: z.ZodType<FridayId, z.ZodTypeDef, string> =
  uuidBase.transform((s) => unsafeFridayId(s));

export const CubeIdSchema: z.ZodType<CubeId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeCubeId(s));

export const PodIdSchema: z.ZodType<PodId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafePodId(s));

export const RoundIdSchema: z.ZodType<RoundId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeRoundId(s));

export const MatchIdSchema: z.ZodType<MatchId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeMatchId(s));

export const EnrollmentIdSchema: z.ZodType<
  EnrollmentId,
  z.ZodTypeDef,
  string
> = uuidBase.transform((s) => unsafeEnrollmentId(s));

export const RsvpIdSchema: z.ZodType<RsvpId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeRsvpId(s));

export const VoteIdSchema: z.ZodType<VoteId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeVoteId(s));

export const VenueIdSchema: z.ZodType<VenueId, z.ZodTypeDef, string> = uuidBase
  .transform((s) => unsafeVenueId(s));

export const SessionIdSchema: z.ZodType<SessionId, z.ZodTypeDef, string> =
  uuidBase.transform((s) => unsafeSessionId(s));

export const InviteCodeIdSchema: z.ZodType<
  InviteCodeId,
  z.ZodTypeDef,
  string
> = uuidBase.transform((s) => unsafeInviteCodeId(s));

export const AuditEventIdSchema: z.ZodType<
  AuditEventId,
  z.ZodTypeDef,
  string
> = uuidBase.transform((s) => unsafeAuditEventId(s));

export const ChallengeTokenSchema: z.ZodType<
  ChallengeToken,
  z.ZodTypeDef,
  string
> = uuidBase.transform((s) => unsafeChallengeToken(s));

export const TeamIdSchema: z.ZodType<TeamId, z.ZodTypeDef, string> = z
  .enum(["A", "B"])
  .transform((s) => unsafeTeamId(s));
