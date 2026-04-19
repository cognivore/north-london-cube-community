/**
 * Branded identifier types and smart constructors.
 * Every domain ID is a branded string (UUIDv7 preferred).
 * Every semantically-constrained primitive has a smart constructor.
 */

import type { Brand, Result, ValidationError } from "./brand.js";
import { err, ok } from "./brand.js";

// ---------------------------------------------------------------------------
// Entity identifiers
// ---------------------------------------------------------------------------

export type UserId = Brand<string, "UserId">;
export type FridayId = Brand<string, "FridayId">;
export type CubeId = Brand<string, "CubeId">;
export type PodId = Brand<string, "PodId">;
export type RoundId = Brand<string, "RoundId">;
export type MatchId = Brand<string, "MatchId">;
export type EnrollmentId = Brand<string, "EnrollmentId">;
export type RsvpId = Brand<string, "RsvpId">;
export type VoteId = Brand<string, "VoteId">;
export type VenueId = Brand<string, "VenueId">;
export type TeamId = Brand<"A" | "B", "TeamId">;
export type SessionId = Brand<string, "SessionId">;
export type InviteCodeId = Brand<string, "InviteCodeId">;
export type AuditEventId = Brand<string, "AuditEventId">;
export type ChallengeToken = Brand<string, "ChallengeToken">;

// ---------------------------------------------------------------------------
// Semantic primitives
// ---------------------------------------------------------------------------

export type ISO8601 = Brand<string, "ISO8601">;
export type LocalDate = Brand<string, "LocalDate">;
export type Email = Brand<string, "Email">;
export type Url = Brand<string, "Url">;
export type NonEmptyString = Brand<string, "NonEmptyString">;
export type Duration = Brand<number, "DurationSeconds">;
export type Pence = Brand<number, "Pence">;
export type EvenPodSize = Brand<4 | 6 | 8, "EvenPodSize">;
export type PositiveInt = Brand<number, "PositiveInt">;
export type NonNegativeInt = Brand<number, "NonNegativeInt">;

// ---------------------------------------------------------------------------
// Smart constructors — pure, total, returning Result
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const makeId =
  <T extends string>(field: string) =>
  (raw: string): Result<Brand<string, T>, ValidationError> => {
    if (!UUID_RE.test(raw))
      return err({ field, message: `Invalid UUID: ${raw}` });
    return ok(raw as unknown as Brand<string, T>);
  };

export const UserId = makeId<"UserId">("userId");
export const FridayId = makeId<"FridayId">("fridayId");
export const CubeId = makeId<"CubeId">("cubeId");
export const PodId = makeId<"PodId">("podId");
export const RoundId = makeId<"RoundId">("roundId");
export const MatchId = makeId<"MatchId">("matchId");
export const EnrollmentId = makeId<"EnrollmentId">("enrollmentId");
export const RsvpId = makeId<"RsvpId">("rsvpId");
export const VoteId = makeId<"VoteId">("voteId");
export const VenueId = makeId<"VenueId">("venueId");
export const SessionId = makeId<"SessionId">("sessionId");
export const InviteCodeId = makeId<"InviteCodeId">("inviteCodeId");
export const AuditEventId = makeId<"AuditEventId">("auditEventId");
export const ChallengeToken = makeId<"ChallengeToken">("challengeToken");

export const TeamId = (raw: string): Result<TeamId, ValidationError> => {
  if (raw !== "A" && raw !== "B")
    return err({ field: "teamId", message: `Must be "A" or "B", got: ${raw}` });
  return ok(raw as TeamId);
};

// ---------------------------------------------------------------------------
// ISO8601
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const ISO8601 = (raw: string): Result<ISO8601, ValidationError> => {
  if (!ISO_RE.test(raw))
    return err({ field: "iso8601", message: `Invalid ISO8601 UTC: ${raw}` });
  if (isNaN(Date.parse(raw)))
    return err({ field: "iso8601", message: `Unparseable date: ${raw}` });
  return ok(raw as ISO8601);
};

// ---------------------------------------------------------------------------
// LocalDate (YYYY-MM-DD)
// ---------------------------------------------------------------------------

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const LocalDate = (raw: string): Result<LocalDate, ValidationError> => {
  if (!LOCAL_DATE_RE.test(raw))
    return err({ field: "localDate", message: `Expected YYYY-MM-DD: ${raw}` });
  return ok(raw as LocalDate);
};

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Email = (raw: string): Result<Email, ValidationError> => {
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed))
    return err({ field: "email", message: `Invalid email: ${raw}` });
  return ok(trimmed as Email);
};

// ---------------------------------------------------------------------------
// Url
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\/[^\s/$.?#].\S*$/i;

export const Url = (raw: string): Result<Url, ValidationError> => {
  if (!URL_RE.test(raw))
    return err({ field: "url", message: `Invalid URL: ${raw}` });
  return ok(raw as Url);
};

// ---------------------------------------------------------------------------
// NonEmptyString
// ---------------------------------------------------------------------------

export const NonEmptyString = (
  raw: string,
): Result<NonEmptyString, ValidationError> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return err({ field: "string", message: "Must be non-empty" });
  return ok(trimmed as NonEmptyString);
};

// ---------------------------------------------------------------------------
// Duration (non-negative seconds)
// ---------------------------------------------------------------------------

export const Duration = (raw: number): Result<Duration, ValidationError> => {
  if (!Number.isInteger(raw) || raw < 0)
    return err({
      field: "duration",
      message: `Must be non-negative integer seconds: ${raw}`,
    });
  return ok(raw as Duration);
};

// ---------------------------------------------------------------------------
// Pence
// ---------------------------------------------------------------------------

export const Pence = (raw: number): Result<Pence, ValidationError> => {
  if (!Number.isInteger(raw) || raw < 0)
    return err({
      field: "pence",
      message: `Must be non-negative integer pence: ${raw}`,
    });
  return ok(raw as Pence);
};

// ---------------------------------------------------------------------------
// EvenPodSize (4 | 6 | 8)
// ---------------------------------------------------------------------------

export const EvenPodSize = (
  raw: number,
): Result<EvenPodSize, ValidationError> => {
  if (raw !== 4 && raw !== 6 && raw !== 8)
    return err({
      field: "evenPodSize",
      message: `Must be 4, 6, or 8, got: ${raw}`,
    });
  return ok(raw as EvenPodSize);
};

// ---------------------------------------------------------------------------
// PositiveInt
// ---------------------------------------------------------------------------

export const PositiveInt = (
  raw: number,
): Result<PositiveInt, ValidationError> => {
  if (!Number.isInteger(raw) || raw < 1)
    return err({
      field: "positiveInt",
      message: `Must be a positive integer: ${raw}`,
    });
  return ok(raw as PositiveInt);
};

// ---------------------------------------------------------------------------
// NonNegativeInt
// ---------------------------------------------------------------------------

export const NonNegativeInt = (
  raw: number,
): Result<NonNegativeInt, ValidationError> => {
  if (!Number.isInteger(raw) || raw < 0)
    return err({
      field: "nonNegativeInt",
      message: `Must be a non-negative integer: ${raw}`,
    });
  return ok(raw as NonNegativeInt);
};

// ---------------------------------------------------------------------------
// Unsafe constructors — for trusted data (seeds, tests, migrations)
// ---------------------------------------------------------------------------

export const unsafeUserId = (raw: string) => raw as UserId;
export const unsafeFridayId = (raw: string) => raw as FridayId;
export const unsafeCubeId = (raw: string) => raw as CubeId;
export const unsafePodId = (raw: string) => raw as PodId;
export const unsafeRoundId = (raw: string) => raw as RoundId;
export const unsafeMatchId = (raw: string) => raw as MatchId;
export const unsafeEnrollmentId = (raw: string) => raw as EnrollmentId;
export const unsafeRsvpId = (raw: string) => raw as RsvpId;
export const unsafeVoteId = (raw: string) => raw as VoteId;
export const unsafeVenueId = (raw: string) => raw as VenueId;
export const unsafeSessionId = (raw: string) => raw as SessionId;
export const unsafeInviteCodeId = (raw: string) => raw as InviteCodeId;
export const unsafeAuditEventId = (raw: string) => raw as AuditEventId;
export const unsafeChallengeToken = (raw: string) => raw as ChallengeToken;
export const unsafeTeamId = (raw: "A" | "B") => raw as TeamId;
export const unsafeISO8601 = (raw: string) => raw as ISO8601;
export const unsafeLocalDate = (raw: string) => raw as LocalDate;
export const unsafeEmail = (raw: string) => raw as Email;
export const unsafeUrl = (raw: string) => raw as Url;
export const unsafeNonEmptyString = (raw: string) => raw as NonEmptyString;
export const unsafeDuration = (raw: number) => raw as Duration;
export const unsafePence = (raw: number) => raw as Pence;
export const unsafeEvenPodSize = (raw: 4 | 6 | 8) => raw as EvenPodSize;
export const unsafePositiveInt = (raw: number) => raw as PositiveInt;
export const unsafeNonNegativeInt = (raw: number) => raw as NonNegativeInt;
