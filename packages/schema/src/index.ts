/**
 * @cubehall/schema — Zod schemas for all domain entities and API shapes.
 */

// Branded primitives
export {
  // Semantic primitives
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
  // Entity IDs
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
  InviteCodeIdSchema,
  AuditEventIdSchema,
  ChallengeTokenSchema,
  TeamIdSchema,
} from "./primitives.js";

// Domain entity schemas
export {
  // Enums
  DraftFormatSchema,
  SystemRoleSchema,
  RsvpStateSchema,
  PodStateSchema,
  RoundStateSchema,
  // User
  AuthStateSchema,
  BanStateSchema,
  UserProfileSchema,
  UserSchema,
  // Venue
  VenueSchema,
  // Cube
  CubeSchema,
  // Friday
  VoteContextSchema,
  CancelReasonSchema,
  FridayStateSchema,
  FridaySchema,
  // Enrollment
  EnrollmentSchema,
  // Rsvp
  RsvpSchema,
  // Vote
  VoteSchema,
  // Pod
  SeatSchema,
  PodSchema,
  ExclusionReasonSchema,
  PlannedPodSchema,
  PodConfigurationSchema,
  // Round
  ExtensionSchema,
  TimerStateSchema,
  RoundSchema,
  // Match
  MatchResultSchema,
  MatchSchema,
  // Pairings
  TiebreakerSchema,
  PairingStrategySchema,
  PairingsTemplateSchema,
  // Audit
  AuditSubjectKindSchema,
  AuditSubjectSchema,
  JsonValueSchema,
  AuditEventSchema,
  // Session
  SessionSchema,
  InviteCodeSchema,
} from "./entities.js";

// API request/response schemas
export {
  RegisterInputSchema,
  LoginInputSchema,
  RsvpInputSchema,
  EnrollCubeInputSchema,
  VoteInputSchema,
  CreateCubeInputSchema,
  UpdateCubeInputSchema,
  ReportMatchInputSchema,
  UpdateProfileInputSchema,
  ForceStateInputSchema,
  BanUserInputSchema,
  ApiErrorSchema,
} from "./api.js";

// API input/output types (inferred from schemas)
export type {
  RegisterInput,
  LoginInput,
  RsvpInput,
  EnrollCubeInput,
  VoteInput,
  CreateCubeInput,
  UpdateCubeInput,
  ReportMatchInput,
  UpdateProfileInput,
  ForceStateInput,
  BanUserInput,
  ApiError,
} from "./api.js";
