/**
 * Auth programs — registration, login, session management.
 */

import { Effect } from "effect";
import type {
  User, Session, AuthState,
} from "@cubehall/core";
import {
  unsafeUserId, unsafeSessionId, unsafeISO8601,
  unsafeChallengeToken, unsafeEmail, unsafeNonEmptyString,
  unsafeNonNegativeInt,
} from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { RNG } from "../capabilities/rng.js";
import { Logger } from "../capabilities/logger.js";
import { UserRepo, SessionRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AuthError =
  | { readonly kind: "registration_closed" }
  | { readonly kind: "email_taken" }
  | { readonly kind: "user_not_found" }
  | { readonly kind: "user_suspended" }
  | { readonly kind: "invalid_challenge" }
  | { readonly kind: "challenge_expired" }
  | { readonly kind: "session_expired" }
  | RepoError;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export const register = (input: {
  email: string;
  displayName: string;
}) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const userRepo = yield* UserRepo;

    // In TEST_MODE, only coordinator email can register
    if (process.env.TEST_MODE === "true" && input.email.trim().toLowerCase() !== "jm@memorici.de") {
      return yield* Effect.fail<AuthError>({ kind: "registration_closed" });
    }

    // Check email uniqueness
    const existing = yield* userRepo.findByEmail(unsafeEmail(input.email.trim().toLowerCase()));
    if (existing) {
      return yield* Effect.fail<AuthError>({ kind: "email_taken" });
    }

    const now = yield* clock.now();
    const userId = unsafeUserId(yield* rng.uuid());
    const challengeToken = unsafeChallengeToken(yield* rng.uuid());

    const expiresAt = unsafeISO8601(
      new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
    );

    const user: User = {
      id: userId,
      email: unsafeEmail(input.email.trim().toLowerCase()),
      displayName: unsafeNonEmptyString(input.displayName.trim()),
      createdAt: now,
      authState: {
        kind: "pending_verification",
        challenge: challengeToken,
        expires: expiresAt,
      },
      profile: {
        preferredFormats: ["swiss_draft"],
        fallbackFormats: [],
        hostCapable: false,
        bio: "",
        noShowCount: unsafeNonNegativeInt(0),
        banned: { kind: "not_banned" },
      },
      role: input.email.trim().toLowerCase() === "jm@memorici.de" ? "coordinator" : "member",
    };

    yield* userRepo.create(user);

    // Assign DCI number
    yield* Effect.tryPromise({
      try: async () => {
        const { getDb, query: dbQuery, run: dbRun, persist: dbPersist } = await import("../db/sqlite.js");
        const db = await getDb();
        // Count existing users with DCI numbers
        const countResult = dbQuery<{ cnt: number }>(db, "SELECT count(*) as cnt FROM users WHERE dci_number IS NOT NULL");
        const assigned = countResult[0]?.cnt ?? 0;
        // First 8 get sequential 1-8, then jump to 100+
        const dciNumber = assigned < 8 ? assigned + 1 : 100 + (assigned - 8);
        dbRun(db, "UPDATE users SET dci_number = ? WHERE id = ?", [dciNumber, userId]);
        dbPersist();
      },
      catch: (e) => {
        console.error("Failed to assign DCI number:", e);
        return undefined as never;
      },
    });

    yield* logger.info("User registered", { userId, email: input.email });

    // Send magic link email
    yield* Effect.tryPromise({
      try: async () => {
        const { sendMagicLinkEmail } = await import("../email/sendgrid.js");
        await sendMagicLinkEmail(input.email.trim().toLowerCase(), challengeToken as string, userId as string, true);
      },
      catch: (e) => {
        // Log but don't fail registration — user can request a new link
        console.error("Failed to send magic link email:", e);
        return undefined as never;
      },
    });

    return { user, challengeToken };
  });

// ---------------------------------------------------------------------------
// Verify (phase 1: trust-on-first-use)
// ---------------------------------------------------------------------------

export const verify = (input: { userId: string; challenge: string }) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const userRepo = yield* UserRepo;
    const sessionRepo = yield* SessionRepo;

    const user = yield* userRepo.findById(unsafeUserId(input.userId));
    if (!user) {
      return yield* Effect.fail<AuthError>({ kind: "user_not_found" });
    }

    if (user.authState.kind !== "pending_verification") {
      return yield* Effect.fail<AuthError>({ kind: "invalid_challenge" });
    }

    if (user.authState.challenge !== input.challenge) {
      return yield* Effect.fail<AuthError>({ kind: "invalid_challenge" });
    }

    const now = yield* clock.now();
    if (now > user.authState.expires) {
      return yield* Effect.fail<AuthError>({ kind: "challenge_expired" });
    }

    // Transition to verified
    const verified: User = {
      ...user,
      authState: { kind: "verified" } as AuthState,
    };
    yield* userRepo.update(verified);

    // Create session
    const session = yield* createSession(user.id, now, rng, sessionRepo);

    return { user: verified, session };
  });

// ---------------------------------------------------------------------------
// Login — sends magic link email
// ---------------------------------------------------------------------------

export const login = (input: { email: string }) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const rng = yield* RNG;
    const logger = yield* Logger;
    const userRepo = yield* UserRepo;

    const user = yield* userRepo.findByEmail(unsafeEmail(input.email.trim().toLowerCase()));
    if (!user) {
      return yield* Effect.fail<AuthError>({ kind: "user_not_found" });
    }

    if (user.authState.kind === "suspended") {
      return yield* Effect.fail<AuthError>({ kind: "user_suspended" });
    }

    // Generate a new challenge token for magic link
    const now = yield* clock.now();
    const challengeToken = unsafeChallengeToken(yield* rng.uuid());
    const expiresAt = unsafeISO8601(
      new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
    );

    // Update user with new challenge
    const updated: User = {
      ...user,
      authState: {
        kind: "pending_verification" as const,
        challenge: challengeToken,
        expires: expiresAt,
      },
    };
    yield* userRepo.update(updated);

    // Send magic link email
    yield* Effect.tryPromise({
      try: async () => {
        const { sendMagicLinkEmail } = await import("../email/sendgrid.js");
        await sendMagicLinkEmail(input.email.trim().toLowerCase(), challengeToken as string, user.id as string);
      },
      catch: (e) => {
        console.error("Failed to send magic link email:", e);
        return undefined as never;
      },
    });

    yield* logger.info("Magic link sent", { userId: user.id, email: input.email });

    return { user, emailSent: true };
  });

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export const logout = (sessionId: string) =>
  Effect.gen(function* () {
    const sessionRepo = yield* SessionRepo;
    yield* sessionRepo.delete(unsafeSessionId(sessionId));
  });

// ---------------------------------------------------------------------------
// Validate session
// ---------------------------------------------------------------------------

export const validateSession = (sessionId: string) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const sessionRepo = yield* SessionRepo;
    const userRepo = yield* UserRepo;

    const session = yield* sessionRepo.findById(unsafeSessionId(sessionId));
    if (!session) {
      return yield* Effect.fail<AuthError>({ kind: "session_expired" });
    }

    const now = yield* clock.now();
    if (now > session.expiresAt) {
      yield* sessionRepo.delete(session.id);
      return yield* Effect.fail<AuthError>({ kind: "session_expired" });
    }

    // Sliding window: touch if >1 hour since last activity
    const lastActivity = Date.parse(session.lastActivityAt);
    const oneHour = 60 * 60 * 1000;
    if (Date.parse(now) - lastActivity > oneHour) {
      yield* sessionRepo.touch(session.id, now);
    }

    const user = yield* userRepo.findById(session.userId);
    if (!user) {
      return yield* Effect.fail<AuthError>({ kind: "user_not_found" });
    }

    return { session, user };
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSession(
  userId: ReturnType<typeof unsafeUserId>,
  now: ReturnType<typeof unsafeISO8601>,
  rng: { uuid: () => Effect.Effect<string> },
  sessionRepo: { create: (s: Session) => Effect.Effect<Session, RepoError> },
) {
  return Effect.gen(function* () {
    const sessionId = unsafeSessionId(yield* rng.uuid());
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    const session: Session = {
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt: unsafeISO8601(new Date(Date.parse(now) + fourteenDays).toISOString()),
      lastActivityAt: now,
    };

    return yield* sessionRepo.create(session);
  });
}
