import type { NonEmptyArray } from "../brand.js";
import type {
  ChallengeToken,
  Email,
  ISO8601,
  NonEmptyString,
  NonNegativeInt,
  UserId,
} from "../ids.js";
import type { DraftFormat, SystemRole } from "./enums.js";

// ---------------------------------------------------------------------------
// AuthState
// ---------------------------------------------------------------------------

export type AuthState =
  | { readonly kind: "pending_verification"; readonly challenge: ChallengeToken; readonly expires: ISO8601 }
  | { readonly kind: "verified" }
  | { readonly kind: "suspended"; readonly reason: string; readonly until: ISO8601 };

// ---------------------------------------------------------------------------
// BanState
// ---------------------------------------------------------------------------

export type BanState =
  | { readonly kind: "not_banned" }
  | { readonly kind: "banned"; readonly until: ISO8601; readonly reason: string };

// ---------------------------------------------------------------------------
// UserProfile
// ---------------------------------------------------------------------------

export type UserProfile = {
  readonly preferredFormats: NonEmptyArray<DraftFormat>;
  readonly fallbackFormats: ReadonlyArray<DraftFormat>;
  readonly hostCapable: boolean;
  readonly bio: string;
  readonly noShowCount: NonNegativeInt;
  readonly banned: BanState;
};

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export type User = {
  readonly id: UserId;
  readonly email: Email;
  readonly displayName: NonEmptyString;
  readonly createdAt: ISO8601;
  readonly authState: AuthState;
  readonly profile: UserProfile;
  readonly role: SystemRole;
};
