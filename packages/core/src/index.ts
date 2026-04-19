// Brand utilities
export type { Brand, Result, Ok, Err, NonEmptyArray, ValidationError } from "./brand.js";
export { ok, err, isOk, isErr, mapResult, flatMapResult, unwrapOr, isNonEmpty } from "./brand.js";

// Branded IDs and semantic primitives — both types and smart constructors
// (Each name is simultaneously a type alias and a constructor function in ids.ts)
export {
  UserId, FridayId, CubeId, PodId, RoundId, MatchId,
  EnrollmentId, RsvpId, VoteId, VenueId, TeamId,
  SessionId, InviteCodeId, AuditEventId, ChallengeToken,
  ISO8601, LocalDate, Email, Url, NonEmptyString,
  Duration, Pence, EvenPodSize, PositiveInt, NonNegativeInt,
} from "./ids.js";

// Re-export the branded types explicitly for consumers who only need the type
export type {
  UserId as UserIdT, FridayId as FridayIdT, CubeId as CubeIdT,
  PodId as PodIdT, RoundId as RoundIdT, MatchId as MatchIdT,
  EnrollmentId as EnrollmentIdT, RsvpId as RsvpIdT, VoteId as VoteIdT,
  VenueId as VenueIdT, TeamId as TeamIdT,
  SessionId as SessionIdT, InviteCodeId as InviteCodeIdT,
  AuditEventId as AuditEventIdT, ChallengeToken as ChallengeTokenT,
  ISO8601 as ISO8601T, LocalDate as LocalDateT,
  Email as EmailT, Url as UrlT, NonEmptyString as NonEmptyStringT,
  Duration as DurationT, Pence as PenceT,
  EvenPodSize as EvenPodSizeT, PositiveInt as PositiveIntT,
  NonNegativeInt as NonNegativeIntT,
} from "./ids.js";

// Unsafe constructors (for tests / seeds)
export {
  unsafeUserId, unsafeFridayId, unsafeCubeId, unsafePodId,
  unsafeRoundId, unsafeMatchId, unsafeEnrollmentId, unsafeRsvpId,
  unsafeVoteId, unsafeVenueId, unsafeSessionId, unsafeInviteCodeId,
  unsafeAuditEventId, unsafeChallengeToken, unsafeTeamId,
  unsafeISO8601, unsafeLocalDate, unsafeEmail, unsafeUrl,
  unsafeNonEmptyString, unsafeDuration, unsafePence,
  unsafeEvenPodSize, unsafePositiveInt, unsafeNonNegativeInt,
} from "./ids.js";

// Model types
export * from "./model/index.js";

// State machines
export * from "./state/index.js";

// Domain events
export type { DomainEvent } from "./events.js";

// Pairings engine types
export type {
  Tiebreaker, PairingStrategy, PairingsTemplate,
  PairingInput, PairingOutput, PairingError, Standing,
} from "./engine/pairings-types.js";
export { TIEBREAKERS } from "./engine/pairings-types.js";

// Pure engines
export { generatePairings } from "./engine/pairings.js";
export { packPods } from "./engine/pod-packer.js";
export type { PackPodsInput, PackPodsError } from "./engine/pod-packer.js";
export { computeStandings, computeTeamScore } from "./engine/scoring.js";
export { runIRV } from "./engine/vote.js";
export type { VoteInput, VoteResult, IRVRound, VoteError } from "./engine/vote.js";
