/**
 * Repository interfaces — one per aggregate root.
 * Implementations are Kysely-backed; these interfaces are the contract.
 */

import { Context, Effect } from "effect";
import type {
  User, Venue, Cube, Friday, Enrollment, Rsvp, Vote,
  Pod, Seat, Round, Match, Session, InviteCode,
  AuditEvent, AuditEventInput,
  FridayState, RsvpState, PodState, RoundState, MatchResult,
  UserProfile, PodConfiguration,
} from "@cubehall/core";
import type {
  UserId, FridayId, CubeId, PodId, RoundId, MatchId,
  EnrollmentId, RsvpId, VoteId, VenueId, SessionId,
  ISO8601, LocalDate, Email, NonEmptyString,
} from "@cubehall/core";
import type { PairingsTemplate } from "@cubehall/core";
import type { DomainEvent } from "@cubehall/core";

// ---------------------------------------------------------------------------
// Repo error
// ---------------------------------------------------------------------------

export type RepoError =
  | { readonly kind: "not_found"; readonly entity: string; readonly id: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "db_error"; readonly cause: unknown };

// ---------------------------------------------------------------------------
// UserRepo
// ---------------------------------------------------------------------------

export interface UserRepoService {
  readonly findById: (id: UserId) => Effect.Effect<User | null, RepoError>;
  readonly findByEmail: (email: Email) => Effect.Effect<User | null, RepoError>;
  readonly create: (user: User) => Effect.Effect<User, RepoError>;
  readonly update: (user: User) => Effect.Effect<User, RepoError>;
  readonly updateProfile: (id: UserId, profile: UserProfile) => Effect.Effect<void, RepoError>;
  readonly updateRole: (id: UserId, role: "member" | "admin") => Effect.Effect<void, RepoError>;
}

export class UserRepo extends Context.Tag("UserRepo")<UserRepo, UserRepoService>() {}

// ---------------------------------------------------------------------------
// VenueRepo
// ---------------------------------------------------------------------------

export interface VenueRepoService {
  readonly findById: (id: VenueId) => Effect.Effect<Venue | null, RepoError>;
  readonly findAll: () => Effect.Effect<ReadonlyArray<Venue>, RepoError>;
  readonly create: (venue: Venue) => Effect.Effect<Venue, RepoError>;
  readonly update: (venue: Venue) => Effect.Effect<Venue, RepoError>;
}

export class VenueRepo extends Context.Tag("VenueRepo")<VenueRepo, VenueRepoService>() {}

// ---------------------------------------------------------------------------
// CubeRepo
// ---------------------------------------------------------------------------

export interface CubeRepoService {
  readonly findById: (id: CubeId) => Effect.Effect<Cube | null, RepoError>;
  readonly findByOwner: (ownerId: UserId) => Effect.Effect<ReadonlyArray<Cube>, RepoError>;
  readonly findMany: (ids: ReadonlyArray<CubeId>) => Effect.Effect<ReadonlyArray<Cube>, RepoError>;
  readonly findAll: () => Effect.Effect<ReadonlyArray<Cube>, RepoError>;
  readonly create: (cube: Cube) => Effect.Effect<Cube, RepoError>;
  readonly update: (cube: Cube) => Effect.Effect<Cube, RepoError>;
}

export class CubeRepo extends Context.Tag("CubeRepo")<CubeRepo, CubeRepoService>() {}

// ---------------------------------------------------------------------------
// FridayRepo
// ---------------------------------------------------------------------------

export interface FridayRepoService {
  readonly findById: (id: FridayId) => Effect.Effect<Friday | null, RepoError>;
  readonly findByDate: (date: LocalDate) => Effect.Effect<Friday | null, RepoError>;
  readonly findUpcoming: () => Effect.Effect<ReadonlyArray<Friday>, RepoError>;
  readonly findPast: (limit: number) => Effect.Effect<ReadonlyArray<Friday>, RepoError>;
  readonly create: (friday: Friday) => Effect.Effect<Friday, RepoError>;
  readonly update: (friday: Friday) => Effect.Effect<Friday, RepoError>;
  readonly updateState: (id: FridayId, state: FridayState) => Effect.Effect<void, RepoError>;
}

export class FridayRepo extends Context.Tag("FridayRepo")<FridayRepo, FridayRepoService>() {}

// ---------------------------------------------------------------------------
// EnrollmentRepo
// ---------------------------------------------------------------------------

export interface EnrollmentRepoService {
  readonly findById: (id: EnrollmentId) => Effect.Effect<Enrollment | null, RepoError>;
  readonly findByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Enrollment>, RepoError>;
  readonly findActiveByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Enrollment>, RepoError>;
  readonly create: (enrollment: Enrollment) => Effect.Effect<Enrollment, RepoError>;
  readonly withdraw: (id: EnrollmentId) => Effect.Effect<void, RepoError>;
}

export class EnrollmentRepo extends Context.Tag("EnrollmentRepo")<EnrollmentRepo, EnrollmentRepoService>() {}

// ---------------------------------------------------------------------------
// RsvpRepo
// ---------------------------------------------------------------------------

export interface RsvpRepoService {
  readonly findById: (id: RsvpId) => Effect.Effect<Rsvp | null, RepoError>;
  readonly findByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Rsvp>, RepoError>;
  readonly findByFridayAndUser: (fridayId: FridayId, userId: UserId) => Effect.Effect<Rsvp | null, RepoError>;
  readonly findActiveByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Rsvp>, RepoError>;
  readonly create: (rsvp: Rsvp) => Effect.Effect<Rsvp, RepoError>;
  readonly updateState: (id: RsvpId, state: RsvpState, at: ISO8601) => Effect.Effect<void, RepoError>;
  readonly countActiveByFriday: (fridayId: FridayId) => Effect.Effect<number, RepoError>;
}

export class RsvpRepo extends Context.Tag("RsvpRepo")<RsvpRepo, RsvpRepoService>() {}

// ---------------------------------------------------------------------------
// VoteRepo
// ---------------------------------------------------------------------------

export interface VoteRepoService {
  readonly findByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Vote>, RepoError>;
  readonly findByFridayAndUser: (fridayId: FridayId, userId: UserId) => Effect.Effect<Vote | null, RepoError>;
  readonly upsert: (vote: Vote) => Effect.Effect<Vote, RepoError>;
}

export class VoteRepo extends Context.Tag("VoteRepo")<VoteRepo, VoteRepoService>() {}

// ---------------------------------------------------------------------------
// PodRepo
// ---------------------------------------------------------------------------

export interface PodRepoService {
  readonly findById: (id: PodId) => Effect.Effect<Pod | null, RepoError>;
  readonly findByFriday: (fridayId: FridayId) => Effect.Effect<ReadonlyArray<Pod>, RepoError>;
  readonly create: (pod: Pod) => Effect.Effect<Pod, RepoError>;
  readonly updateState: (id: PodId, state: PodState) => Effect.Effect<void, RepoError>;
  readonly materialiseFromConfig: (fridayId: FridayId, config: PodConfiguration, templates: ReadonlyArray<PairingsTemplate>) => Effect.Effect<ReadonlyArray<Pod>, RepoError>;
}

export class PodRepo extends Context.Tag("PodRepo")<PodRepo, PodRepoService>() {}

// ---------------------------------------------------------------------------
// SeatRepo
// ---------------------------------------------------------------------------

export interface SeatRepoService {
  readonly findByPod: (podId: PodId) => Effect.Effect<ReadonlyArray<Seat>, RepoError>;
  readonly createMany: (seats: ReadonlyArray<Seat>) => Effect.Effect<void, RepoError>;
}

export class SeatRepo extends Context.Tag("SeatRepo")<SeatRepo, SeatRepoService>() {}

// ---------------------------------------------------------------------------
// RoundRepo
// ---------------------------------------------------------------------------

export interface RoundRepoService {
  readonly findById: (id: RoundId) => Effect.Effect<Round | null, RepoError>;
  readonly findByPod: (podId: PodId) => Effect.Effect<ReadonlyArray<Round>, RepoError>;
  readonly create: (round: Round) => Effect.Effect<Round, RepoError>;
  readonly updateState: (id: RoundId, state: RoundState) => Effect.Effect<void, RepoError>;
  readonly update: (round: Round) => Effect.Effect<Round, RepoError>;
}

export class RoundRepo extends Context.Tag("RoundRepo")<RoundRepo, RoundRepoService>() {}

// ---------------------------------------------------------------------------
// MatchRepo
// ---------------------------------------------------------------------------

export interface MatchRepoService {
  readonly findById: (id: MatchId) => Effect.Effect<Match | null, RepoError>;
  readonly findByRound: (roundId: RoundId) => Effect.Effect<ReadonlyArray<Match>, RepoError>;
  readonly findByPod: (podId: PodId) => Effect.Effect<ReadonlyArray<Match>, RepoError>;
  readonly create: (match: Match) => Effect.Effect<Match, RepoError>;
  readonly createMany: (matches: ReadonlyArray<Match>) => Effect.Effect<void, RepoError>;
  readonly updateResult: (id: MatchId, result: MatchResult, submittedBy: UserId, at: ISO8601) => Effect.Effect<void, RepoError>;
}

export class MatchRepo extends Context.Tag("MatchRepo")<MatchRepo, MatchRepoService>() {}

// ---------------------------------------------------------------------------
// SessionRepo
// ---------------------------------------------------------------------------

export interface SessionRepoService {
  readonly findById: (id: SessionId) => Effect.Effect<Session | null, RepoError>;
  readonly create: (session: Session) => Effect.Effect<Session, RepoError>;
  readonly delete: (id: SessionId) => Effect.Effect<void, RepoError>;
  readonly deleteByUser: (userId: UserId) => Effect.Effect<void, RepoError>;
  readonly touch: (id: SessionId, at: ISO8601) => Effect.Effect<void, RepoError>;
}

export class SessionRepo extends Context.Tag("SessionRepo")<SessionRepo, SessionRepoService>() {}

// ---------------------------------------------------------------------------
// InviteCodeRepo
// ---------------------------------------------------------------------------

export interface InviteCodeRepoService {
  readonly findByCode: (code: string) => Effect.Effect<InviteCode | null, RepoError>;
  readonly create: (invite: InviteCode) => Effect.Effect<InviteCode, RepoError>;
  readonly incrementUsage: (code: string) => Effect.Effect<void, RepoError>;
}

export class InviteCodeRepo extends Context.Tag("InviteCodeRepo")<InviteCodeRepo, InviteCodeRepoService>() {}

// ---------------------------------------------------------------------------
// AuditRepo
// ---------------------------------------------------------------------------

export interface AuditRepoService {
  readonly create: (event: AuditEvent) => Effect.Effect<void, RepoError>;
  readonly findBySubject: (kind: string, id: string, limit: number) => Effect.Effect<ReadonlyArray<AuditEvent>, RepoError>;
  readonly findRecent: (limit: number) => Effect.Effect<ReadonlyArray<AuditEvent>, RepoError>;
}

export class AuditRepo extends Context.Tag("AuditRepo")<AuditRepo, AuditRepoService>() {}

// ---------------------------------------------------------------------------
// EventOutboxRepo
// ---------------------------------------------------------------------------

export interface EventOutboxRepoService {
  readonly enqueue: (event: DomainEvent) => Effect.Effect<void, RepoError>;
  readonly dequeue: (batchSize: number) => Effect.Effect<ReadonlyArray<{ id: string; event: DomainEvent }>, RepoError>;
  readonly ack: (id: string) => Effect.Effect<void, RepoError>;
  readonly nack: (id: string, error: string) => Effect.Effect<void, RepoError>;
}

export class EventOutboxRepo extends Context.Tag("EventOutboxRepo")<EventOutboxRepo, EventOutboxRepoService>() {}
