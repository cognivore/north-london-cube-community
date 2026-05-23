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
  | { readonly kind: "suspended"; readonly reason: string; readonly until: ISO8601 }
  /**
   * Source side of an admin user-merge. The original auth state is captured
   * in the matching user_merges row so a revert can restore it. While in this
   * state the user is hidden from normal listings, cannot log in, and their
   * historical rows have already been reassigned to mergedInto.
   */
  | { readonly kind: "merged"; readonly mergedInto: UserId; readonly mergedAt: ISO8601 };

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
