/**
 * SQLite-backed repository implementations for all 15 repo interfaces.
 * Uses sql.js via the ../db/sqlite.ts helper layer.
 */

import { Effect, Layer } from "effect";
import { getDb, query, run, persist } from "../db/sqlite.js";
import {
  UserRepo, VenueRepo, CubeRepo, FridayRepo, EnrollmentRepo,
  RsvpRepo, VoteRepo, PodRepo, SeatRepo, RoundRepo, MatchRepo,
  SessionRepo, InviteCodeRepo, AuditRepo, EventOutboxRepo,
  type RepoError,
} from "./types.js";
import type {
  User, Venue, Cube, Friday, Enrollment, Rsvp, Vote,
  Pod, Seat, Round, Match, Session, InviteCode,
  AuditEvent, FridayState, RsvpState, PodState, RoundState,
  MatchResult, UserProfile, PodConfiguration, DomainEvent,
  DraftFormat, AuthState,
} from "@cubehall/core";
import type { PairingsTemplate } from "@cubehall/core";
import type { NonEmptyArray } from "@cubehall/core";
import {
  unsafeUserId, unsafeFridayId, unsafeCubeId, unsafePodId,
  unsafeRoundId, unsafeMatchId, unsafeEnrollmentId, unsafeRsvpId,
  unsafeVoteId, unsafeVenueId, unsafeSessionId, unsafeAuditEventId,
  unsafeISO8601, unsafeLocalDate, unsafeEmail, unsafeUrl,
  unsafeNonEmptyString, unsafeDuration, unsafePence,
  unsafeEvenPodSize, unsafePositiveInt, unsafeNonNegativeInt,
  unsafeTeamId,
} from "@cubehall/core";
import type { TeamId as TeamIdT } from "@cubehall/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dbError = (e: unknown): RepoError => ({ kind: "db_error" as const, cause: e });

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type UserRow = {
  id: string; email: string; display_name: string; created_at: string;
  auth_state: string; profile: string; role: string;
};

type VenueRow = {
  id: string; name: string; address: string; capacity: number;
  max_pods: number; house_credit_per_player: number; active: number;
};

type CubeRow = {
  id: string; owner_id: string; name: string; cubecobra_url: string;
  cubecobra_id: string; card_count: number; supported_formats: string;
  preferred_pod_size: number; min_pod_size: number; max_pod_size: number;
  tags: string; last_run_at: string | null; retired: number;
};

type FridayRow = {
  id: string; date: string; venue_id: string; state: string;
  created_at: string; locked_at: string | null; confirmed_at: string | null;
  completed_at: string | null;
};

type EnrollmentRow = {
  id: string; friday_id: string; cube_id: string; host_id: string;
  created_at: string; withdrawn: number;
};

type RsvpRow = {
  id: string; friday_id: string; user_id: string; state: string;
  created_at: string; last_transition_at: string;
};

type VoteRow = {
  id: string; friday_id: string; user_id: string; ranking: string;
  created_at: string;
};

type PodRow = {
  id: string; friday_id: string; cube_id: string; host_id: string;
  format: string; state: string; pairings_template: string;
};

type SeatRow = {
  pod_id: string; seat_index: number; user_id: string; team: string | null;
};

type RoundRow = {
  id: string; pod_id: string; round_number: number; state: string;
  started_at: string | null; ended_at: string | null; time_limit: number;
  extensions: string; timer: string;
};

type MatchRow = {
  id: string; round_id: string; player1_id: string; player2_id: string;
  result: string; submitted_at: string | null; submitted_by: string | null;
};

type SessionRow = {
  id: string; user_id: string; created_at: string;
  expires_at: string; last_activity_at: string;
};

type InviteCodeRow = {
  code: string; created_by: string; created_at: string;
  expires_at: string | null; max_uses: number | null; used_count: number;
};

type AuditEventRow = {
  id: string; at: string; actor_id: string; subject_kind: string;
  subject_id: string; action: string; before_val: string | null;
  after_val: string | null;
};

type EventOutboxRow = {
  id: number; event_kind: string; payload: string; created_at: string;
  processed_at: string | null; attempts: number; last_error: string | null;
};

// ---------------------------------------------------------------------------
// Row -> Domain mappers
// ---------------------------------------------------------------------------

function toUser(r: UserRow): User {
  return {
    id: unsafeUserId(r.id),
    email: unsafeEmail(r.email),
    displayName: unsafeNonEmptyString(r.display_name),
    createdAt: unsafeISO8601(r.created_at),
    authState: JSON.parse(r.auth_state) as AuthState,
    profile: JSON.parse(r.profile) as UserProfile,
    role: r.role as "member" | "coordinator",
  };
}

function toVenue(r: VenueRow): Venue {
  return {
    id: unsafeVenueId(r.id),
    name: unsafeNonEmptyString(r.name),
    address: r.address,
    capacity: unsafePositiveInt(r.capacity),
    maxPods: unsafePositiveInt(r.max_pods),
    houseCreditPerPlayer: unsafePence(r.house_credit_per_player),
    active: r.active === 1,
  };
}

function toCube(r: CubeRow): Cube {
  return {
    id: unsafeCubeId(r.id),
    ownerId: unsafeUserId(r.owner_id),
    name: unsafeNonEmptyString(r.name),
    cubecobraUrl: unsafeUrl(r.cubecobra_url),
    cubecobraId: r.cubecobra_id,
    cardCount: unsafePositiveInt(r.card_count),
    supportedFormats: JSON.parse(r.supported_formats) as NonEmptyArray<DraftFormat>,
    preferredPodSize: unsafeEvenPodSize(r.preferred_pod_size as 4 | 6 | 8),
    minPodSize: unsafeEvenPodSize(r.min_pod_size as 4 | 6 | 8),
    maxPodSize: unsafeEvenPodSize(r.max_pod_size as 4 | 6 | 8),
    tags: JSON.parse(r.tags) as ReadonlyArray<string>,
    lastRunAt: r.last_run_at ? unsafeISO8601(r.last_run_at) : null,
    retired: r.retired === 1,
  };
}

function toFriday(r: FridayRow): Friday {
  return {
    id: unsafeFridayId(r.id),
    date: unsafeLocalDate(r.date),
    venueId: unsafeVenueId(r.venue_id),
    state: JSON.parse(r.state) as FridayState,
    createdAt: unsafeISO8601(r.created_at),
    lockedAt: r.locked_at ? unsafeISO8601(r.locked_at) : null,
    confirmedAt: r.confirmed_at ? unsafeISO8601(r.confirmed_at) : null,
    completedAt: r.completed_at ? unsafeISO8601(r.completed_at) : null,
  };
}

function toEnrollment(r: EnrollmentRow): Enrollment {
  return {
    id: unsafeEnrollmentId(r.id),
    fridayId: unsafeFridayId(r.friday_id),
    cubeId: unsafeCubeId(r.cube_id),
    hostId: unsafeUserId(r.host_id),
    createdAt: unsafeISO8601(r.created_at),
    withdrawn: r.withdrawn === 1,
  };
}

function toRsvp(r: RsvpRow): Rsvp {
  return {
    id: unsafeRsvpId(r.id),
    fridayId: unsafeFridayId(r.friday_id),
    userId: unsafeUserId(r.user_id),
    state: r.state as RsvpState,
    createdAt: unsafeISO8601(r.created_at),
    lastTransitionAt: unsafeISO8601(r.last_transition_at),
  };
}

function toVote(r: VoteRow): Vote {
  return {
    id: unsafeVoteId(r.id),
    fridayId: unsafeFridayId(r.friday_id),
    userId: unsafeUserId(r.user_id),
    ranking: (JSON.parse(r.ranking) as string[]).map(unsafeEnrollmentId) as unknown as NonEmptyArray<Vote["ranking"][number]>,
    createdAt: unsafeISO8601(r.created_at),
  };
}

function toPod(r: PodRow, seats: ReadonlyArray<Seat>): Pod {
  return {
    id: unsafePodId(r.id),
    fridayId: unsafeFridayId(r.friday_id),
    cubeId: unsafeCubeId(r.cube_id),
    hostId: unsafeUserId(r.host_id),
    format: r.format as DraftFormat,
    seats,
    state: r.state as PodState,
    pairingsTemplate: JSON.parse(r.pairings_template) as PairingsTemplate,
  };
}

function toSeat(r: SeatRow): Seat {
  return {
    podId: unsafePodId(r.pod_id),
    seatIndex: unsafeNonNegativeInt(r.seat_index),
    userId: unsafeUserId(r.user_id),
    team: r.team ? unsafeTeamId(r.team as "A" | "B") : null,
  };
}

function toRound(r: RoundRow): Round {
  return {
    id: unsafeRoundId(r.id),
    podId: unsafePodId(r.pod_id),
    roundNumber: unsafePositiveInt(r.round_number),
    state: r.state as RoundState,
    startedAt: r.started_at ? unsafeISO8601(r.started_at) : null,
    endedAt: r.ended_at ? unsafeISO8601(r.ended_at) : null,
    timeLimit: unsafeDuration(r.time_limit),
    extensions: JSON.parse(r.extensions) as ReadonlyArray<never>,
    timer: JSON.parse(r.timer) as Round["timer"],
  };
}

function toMatch(r: MatchRow): Match {
  return {
    id: unsafeMatchId(r.id),
    roundId: unsafeRoundId(r.round_id),
    player1Id: unsafeUserId(r.player1_id),
    player2Id: unsafeUserId(r.player2_id),
    result: JSON.parse(r.result) as MatchResult,
    submittedAt: r.submitted_at ? unsafeISO8601(r.submitted_at) : null,
    submittedBy: r.submitted_by ? unsafeUserId(r.submitted_by) : null,
  };
}

function toSession(r: SessionRow): Session {
  return {
    id: unsafeSessionId(r.id),
    userId: unsafeUserId(r.user_id),
    createdAt: unsafeISO8601(r.created_at),
    expiresAt: unsafeISO8601(r.expires_at),
    lastActivityAt: unsafeISO8601(r.last_activity_at),
  };
}

function toInviteCode(r: InviteCodeRow): InviteCode {
  return {
    code: r.code,
    createdBy: unsafeUserId(r.created_by),
    createdAt: unsafeISO8601(r.created_at),
    expiresAt: r.expires_at ? unsafeISO8601(r.expires_at) : null,
    maxUses: r.max_uses,
    usedCount: r.used_count,
  };
}

function toAuditEvent(r: AuditEventRow): AuditEvent {
  return {
    id: unsafeAuditEventId(r.id),
    at: unsafeISO8601(r.at),
    actorId: r.actor_id === "system" ? "system" as const : unsafeUserId(r.actor_id),
    subject: { kind: r.subject_kind as AuditEvent["subject"]["kind"], id: r.subject_id },
    action: r.action,
    before: r.before_val ? JSON.parse(r.before_val) : null,
    after: r.after_val ? JSON.parse(r.after_val) : null,
  };
}

// ---------------------------------------------------------------------------
// UserRepo
// ---------------------------------------------------------------------------

const UserRepoLive = Layer.succeed(UserRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<UserRow>(db, "SELECT * FROM users WHERE id = ?", [id]);
        return rows[0] ? toUser(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByEmail: (email) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<UserRow>(db, "SELECT * FROM users WHERE email = ?", [email]);
        return rows[0] ? toUser(rows[0]) : null;
      },
      catch: dbError,
    }),

  create: (user) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO users (id, email, display_name, created_at, auth_state, profile, role)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [user.id, user.email, user.displayName, user.createdAt,
           JSON.stringify(user.authState), JSON.stringify(user.profile), user.role],
        );
        persist();
        return user;
      },
      catch: dbError,
    }),

  update: (user) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `UPDATE users SET email = ?, display_name = ?, auth_state = ?, profile = ?, role = ?
           WHERE id = ?`,
          [user.email, user.displayName,
           JSON.stringify(user.authState), JSON.stringify(user.profile), user.role, user.id],
        );
        persist();
        return user;
      },
      catch: dbError,
    }),

  updateProfile: (id, profile) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE users SET profile = ? WHERE id = ?", [JSON.stringify(profile), id]);
        persist();
      },
      catch: dbError,
    }),

  updateRole: (id, role) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE users SET role = ? WHERE id = ?", [role, id]);
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// VenueRepo
// ---------------------------------------------------------------------------

const VenueRepoLive = Layer.succeed(VenueRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<VenueRow>(db, "SELECT * FROM venues WHERE id = ?", [id]);
        return rows[0] ? toVenue(rows[0]) : null;
      },
      catch: dbError,
    }),

  findAll: () =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<VenueRow>(db, "SELECT * FROM venues", []);
        return rows.map(toVenue);
      },
      catch: dbError,
    }),

  create: (venue) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO venues (id, name, address, capacity, max_pods, house_credit_per_player, active)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [venue.id, venue.name, venue.address, venue.capacity,
           venue.maxPods, venue.houseCreditPerPlayer, venue.active ? 1 : 0],
        );
        persist();
        return venue;
      },
      catch: dbError,
    }),

  update: (venue) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `UPDATE venues SET name = ?, address = ?, capacity = ?, max_pods = ?,
           house_credit_per_player = ?, active = ? WHERE id = ?`,
          [venue.name, venue.address, venue.capacity, venue.maxPods,
           venue.houseCreditPerPlayer, venue.active ? 1 : 0, venue.id],
        );
        persist();
        return venue;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// CubeRepo
// ---------------------------------------------------------------------------

const CubeRepoLive = Layer.succeed(CubeRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<CubeRow>(db, "SELECT * FROM cubes WHERE id = ?", [id]);
        return rows[0] ? toCube(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByOwner: (ownerId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<CubeRow>(db, "SELECT * FROM cubes WHERE owner_id = ?", [ownerId]);
        return rows.map(toCube);
      },
      catch: dbError,
    }),

  findMany: (ids) =>
    Effect.tryPromise({
      try: async () => {
        if (ids.length === 0) return [];
        const db = await getDb();
        const placeholders = ids.map(() => "?").join(",");
        const rows = query<CubeRow>(db, `SELECT * FROM cubes WHERE id IN (${placeholders})`, [...ids]);
        return rows.map(toCube);
      },
      catch: dbError,
    }),

  findAll: () =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<CubeRow>(db, "SELECT * FROM cubes", []);
        return rows.map(toCube);
      },
      catch: dbError,
    }),

  create: (cube) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO cubes (id, owner_id, name, cubecobra_url, cubecobra_id, card_count,
           supported_formats, preferred_pod_size, min_pod_size, max_pod_size, tags, last_run_at, retired)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [cube.id, cube.ownerId, cube.name, cube.cubecobraUrl, cube.cubecobraId,
           cube.cardCount, JSON.stringify(cube.supportedFormats), cube.preferredPodSize,
           cube.minPodSize, cube.maxPodSize, JSON.stringify(cube.tags),
           cube.lastRunAt, cube.retired ? 1 : 0],
        );
        persist();
        return cube;
      },
      catch: dbError,
    }),

  update: (cube) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `UPDATE cubes SET owner_id = ?, name = ?, cubecobra_url = ?, cubecobra_id = ?,
           card_count = ?, supported_formats = ?, preferred_pod_size = ?, min_pod_size = ?,
           max_pod_size = ?, tags = ?, last_run_at = ?, retired = ? WHERE id = ?`,
          [cube.ownerId, cube.name, cube.cubecobraUrl, cube.cubecobraId,
           cube.cardCount, JSON.stringify(cube.supportedFormats), cube.preferredPodSize,
           cube.minPodSize, cube.maxPodSize, JSON.stringify(cube.tags),
           cube.lastRunAt, cube.retired ? 1 : 0, cube.id],
        );
        persist();
        return cube;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// FridayRepo
// ---------------------------------------------------------------------------

const FridayRepoLive = Layer.succeed(FridayRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<FridayRow>(db, "SELECT * FROM fridays WHERE id = ?", [id]);
        return rows[0] ? toFriday(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByDate: (date) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<FridayRow>(db, "SELECT * FROM fridays WHERE date = ?", [date]);
        return rows[0] ? toFriday(rows[0]) : null;
      },
      catch: dbError,
    }),

  findUpcoming: () =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const today = new Date().toISOString().slice(0, 10);
        const rows = query<FridayRow>(db,
          "SELECT * FROM fridays WHERE date >= ? ORDER BY date ASC", [today]);
        return rows.map(toFriday);
      },
      catch: dbError,
    }),

  findPast: (limit) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const today = new Date().toISOString().slice(0, 10);
        const rows = query<FridayRow>(db,
          "SELECT * FROM fridays WHERE date < ? ORDER BY date DESC LIMIT ?", [today, limit]);
        return rows.map(toFriday);
      },
      catch: dbError,
    }),

  create: (friday) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO fridays (id, date, venue_id, state, created_at, locked_at, confirmed_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [friday.id, friday.date, friday.venueId, JSON.stringify(friday.state),
           friday.createdAt, friday.lockedAt, friday.confirmedAt, friday.completedAt],
        );
        persist();
        return friday;
      },
      catch: dbError,
    }),

  update: (friday) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `UPDATE fridays SET date = ?, venue_id = ?, state = ?, created_at = ?,
           locked_at = ?, confirmed_at = ?, completed_at = ? WHERE id = ?`,
          [friday.date, friday.venueId, JSON.stringify(friday.state), friday.createdAt,
           friday.lockedAt, friday.confirmedAt, friday.completedAt, friday.id],
        );
        persist();
        return friday;
      },
      catch: dbError,
    }),

  updateState: (id, state) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE fridays SET state = ? WHERE id = ?", [JSON.stringify(state), id]);
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// EnrollmentRepo
// ---------------------------------------------------------------------------

const EnrollmentRepoLive = Layer.succeed(EnrollmentRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<EnrollmentRow>(db, "SELECT * FROM enrollments WHERE id = ?", [id]);
        return rows[0] ? toEnrollment(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<EnrollmentRow>(db, "SELECT * FROM enrollments WHERE friday_id = ?", [fridayId]);
        return rows.map(toEnrollment);
      },
      catch: dbError,
    }),

  findActiveByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<EnrollmentRow>(db,
          "SELECT * FROM enrollments WHERE friday_id = ? AND withdrawn = 0", [fridayId]);
        return rows.map(toEnrollment);
      },
      catch: dbError,
    }),

  create: (enrollment) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO enrollments (id, friday_id, cube_id, host_id, created_at, withdrawn)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [enrollment.id, enrollment.fridayId, enrollment.cubeId, enrollment.hostId,
           enrollment.createdAt, enrollment.withdrawn ? 1 : 0],
        );
        persist();
        return enrollment;
      },
      catch: dbError,
    }),

  withdraw: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE enrollments SET withdrawn = 1 WHERE id = ?", [id]);
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// RsvpRepo
// ---------------------------------------------------------------------------

const RsvpRepoLive = Layer.succeed(RsvpRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RsvpRow>(db, "SELECT * FROM rsvps WHERE id = ?", [id]);
        return rows[0] ? toRsvp(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RsvpRow>(db, "SELECT * FROM rsvps WHERE friday_id = ?", [fridayId]);
        return rows.map(toRsvp);
      },
      catch: dbError,
    }),

  findByFridayAndUser: (fridayId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RsvpRow>(db,
          "SELECT * FROM rsvps WHERE friday_id = ? AND user_id = ?", [fridayId, userId]);
        return rows[0] ? toRsvp(rows[0]) : null;
      },
      catch: dbError,
    }),

  findActiveByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RsvpRow>(db,
          "SELECT * FROM rsvps WHERE friday_id = ? AND state IN ('pending','confirmed','locked','seated')", [fridayId]);
        return rows.map(toRsvp);
      },
      catch: dbError,
    }),

  create: (rsvp) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rsvp.id, rsvp.fridayId, rsvp.userId, rsvp.state,
           rsvp.createdAt, rsvp.lastTransitionAt],
        );
        persist();
        return rsvp;
      },
      catch: dbError,
    }),

  updateState: (id, state, at) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE rsvps SET state = ?, last_transition_at = ? WHERE id = ?", [state, at, id]);
        persist();
      },
      catch: dbError,
    }),

  countActiveByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<{ cnt: number }>(db,
          "SELECT COUNT(*) as cnt FROM rsvps WHERE friday_id = ? AND state IN ('pending','confirmed','locked','seated')", [fridayId]);
        return rows[0]?.cnt ?? 0;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// VoteRepo
// ---------------------------------------------------------------------------

const VoteRepoLive = Layer.succeed(VoteRepo, {
  findByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<VoteRow>(db, "SELECT * FROM votes WHERE friday_id = ?", [fridayId]);
        return rows.map(toVote);
      },
      catch: dbError,
    }),

  findByFridayAndUser: (fridayId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<VoteRow>(db,
          "SELECT * FROM votes WHERE friday_id = ? AND user_id = ?", [fridayId, userId]);
        return rows[0] ? toVote(rows[0]) : null;
      },
      catch: dbError,
    }),

  upsert: (vote) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO votes (id, friday_id, user_id, ranking, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(friday_id, user_id) DO UPDATE SET
             ranking = excluded.ranking, created_at = excluded.created_at`,
          [vote.id, vote.fridayId, vote.userId,
           JSON.stringify(vote.ranking), vote.createdAt],
        );
        persist();
        return vote;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// PodRepo
// ---------------------------------------------------------------------------

const PodRepoLive = Layer.succeed(PodRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<PodRow>(db, "SELECT * FROM pods WHERE id = ?", [id]);
        if (!rows[0]) return null;
        const seatRows = query<SeatRow>(db, "SELECT * FROM seats WHERE pod_id = ? ORDER BY seat_index", [id]);
        return toPod(rows[0], seatRows.map(toSeat));
      },
      catch: dbError,
    }),

  findByFriday: (fridayId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const podRows = query<PodRow>(db, "SELECT * FROM pods WHERE friday_id = ?", [fridayId]);
        return podRows.map((pr) => {
          const seatRows = query<SeatRow>(db, "SELECT * FROM seats WHERE pod_id = ? ORDER BY seat_index", [pr.id]);
          return toPod(pr, seatRows.map(toSeat));
        });
      },
      catch: dbError,
    }),

  create: (pod) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO pods (id, friday_id, cube_id, host_id, format, state, pairings_template)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pod.id, pod.fridayId, pod.cubeId, pod.hostId,
           pod.format, pod.state, JSON.stringify(pod.pairingsTemplate)],
        );
        for (const s of pod.seats) {
          run(db,
            "INSERT INTO seats (pod_id, seat_index, user_id, team) VALUES (?, ?, ?, ?)",
            [pod.id, s.seatIndex, s.userId, s.team],
          );
        }
        persist();
        return pod;
      },
      catch: dbError,
    }),

  updateState: (id, state) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE pods SET state = ? WHERE id = ?", [state, id]);
        persist();
      },
      catch: dbError,
    }),

  materialiseFromConfig: (fridayId, config, templates) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const pods: Pod[] = [];
        for (let i = 0; i < config.pods.length; i++) {
          const planned = config.pods[i]!;
          const template = templates[i] ?? templates[0]!;
          const podId = crypto.randomUUID();
          run(db,
            `INSERT INTO pods (id, friday_id, cube_id, host_id, format, state, pairings_template)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [podId, fridayId, planned.cubeId, planned.hostId,
             planned.format, "drafting", JSON.stringify(template)],
          );
          const seats: Seat[] = [];
          for (const s of planned.seats) {
            run(db,
              "INSERT INTO seats (pod_id, seat_index, user_id, team) VALUES (?, ?, ?, ?)",
              [podId, s.seatIndex, s.userId, null],
            );
            seats.push({
              podId: unsafePodId(podId),
              seatIndex: s.seatIndex,
              userId: s.userId,
              team: null,
            });
          }
          pods.push({
            id: unsafePodId(podId),
            fridayId,
            cubeId: planned.cubeId,
            hostId: planned.hostId,
            format: planned.format,
            seats,
            state: "drafting",
            pairingsTemplate: template,
          });
        }
        persist();
        return pods;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// SeatRepo
// ---------------------------------------------------------------------------

const SeatRepoLive = Layer.succeed(SeatRepo, {
  findByPod: (podId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<SeatRow>(db,
          "SELECT * FROM seats WHERE pod_id = ? ORDER BY seat_index", [podId]);
        return rows.map(toSeat);
      },
      catch: dbError,
    }),

  createMany: (seats) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        for (const s of seats) {
          run(db,
            "INSERT INTO seats (pod_id, seat_index, user_id, team) VALUES (?, ?, ?, ?)",
            [s.podId, s.seatIndex, s.userId, s.team],
          );
        }
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// RoundRepo
// ---------------------------------------------------------------------------

const RoundRepoLive = Layer.succeed(RoundRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RoundRow>(db, "SELECT * FROM rounds WHERE id = ?", [id]);
        return rows[0] ? toRound(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByPod: (podId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<RoundRow>(db,
          "SELECT * FROM rounds WHERE pod_id = ? ORDER BY round_number", [podId]);
        return rows.map(toRound);
      },
      catch: dbError,
    }),

  create: (round) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO rounds (id, pod_id, round_number, state, started_at, ended_at,
           time_limit, extensions, timer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [round.id, round.podId, round.roundNumber, round.state,
           round.startedAt, round.endedAt, round.timeLimit,
           JSON.stringify(round.extensions), JSON.stringify(round.timer)],
        );
        persist();
        return round;
      },
      catch: dbError,
    }),

  updateState: (id, state) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE rounds SET state = ? WHERE id = ?", [state, id]);
        persist();
      },
      catch: dbError,
    }),

  update: (round) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `UPDATE rounds SET pod_id = ?, round_number = ?, state = ?, started_at = ?,
           ended_at = ?, time_limit = ?, extensions = ?, timer = ? WHERE id = ?`,
          [round.podId, round.roundNumber, round.state, round.startedAt,
           round.endedAt, round.timeLimit,
           JSON.stringify(round.extensions), JSON.stringify(round.timer), round.id],
        );
        persist();
        return round;
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// MatchRepo
// ---------------------------------------------------------------------------

const MatchRepoLive = Layer.succeed(MatchRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<MatchRow>(db, "SELECT * FROM matches WHERE id = ?", [id]);
        return rows[0] ? toMatch(rows[0]) : null;
      },
      catch: dbError,
    }),

  findByRound: (roundId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<MatchRow>(db, "SELECT * FROM matches WHERE round_id = ?", [roundId]);
        return rows.map(toMatch);
      },
      catch: dbError,
    }),

  findByPod: (podId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<MatchRow>(db,
          `SELECT m.* FROM matches m
           JOIN rounds r ON m.round_id = r.id
           WHERE r.pod_id = ?`, [podId]);
        return rows.map(toMatch);
      },
      catch: dbError,
    }),

  create: (match) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO matches (id, round_id, player1_id, player2_id, result, submitted_at, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [match.id, match.roundId, match.player1Id, match.player2Id,
           JSON.stringify(match.result), match.submittedAt, match.submittedBy],
        );
        persist();
        return match;
      },
      catch: dbError,
    }),

  createMany: (matches) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        for (const m of matches) {
          run(db,
            `INSERT INTO matches (id, round_id, player1_id, player2_id, result, submitted_at, submitted_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [m.id, m.roundId, m.player1Id, m.player2Id,
             JSON.stringify(m.result), m.submittedAt, m.submittedBy],
          );
        }
        persist();
      },
      catch: dbError,
    }),

  updateResult: (id, result, submittedBy, at) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          "UPDATE matches SET result = ?, submitted_by = ?, submitted_at = ? WHERE id = ?",
          [JSON.stringify(result), submittedBy, at, id],
        );
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// SessionRepo
// ---------------------------------------------------------------------------

const SessionRepoLive = Layer.succeed(SessionRepo, {
  findById: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<SessionRow>(db, "SELECT * FROM sessions WHERE id = ?", [id]);
        return rows[0] ? toSession(rows[0]) : null;
      },
      catch: dbError,
    }),

  create: (session) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at)
           VALUES (?, ?, ?, ?, ?)`,
          [session.id, session.userId, session.createdAt,
           session.expiresAt, session.lastActivityAt],
        );
        persist();
        return session;
      },
      catch: dbError,
    }),

  delete: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "DELETE FROM sessions WHERE id = ?", [id]);
        persist();
      },
      catch: dbError,
    }),

  deleteByUser: (userId) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "DELETE FROM sessions WHERE user_id = ?", [userId]);
        persist();
      },
      catch: dbError,
    }),

  touch: (id, at) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE sessions SET last_activity_at = ? WHERE id = ?", [at, id]);
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// InviteCodeRepo
// ---------------------------------------------------------------------------

const InviteCodeRepoLive = Layer.succeed(InviteCodeRepo, {
  findByCode: (code) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<InviteCodeRow>(db, "SELECT * FROM invite_codes WHERE code = ?", [code]);
        return rows[0] ? toInviteCode(rows[0]) : null;
      },
      catch: dbError,
    }),

  create: (invite) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO invite_codes (code, created_by, created_at, expires_at, max_uses, used_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [invite.code, invite.createdBy, invite.createdAt,
           invite.expiresAt, invite.maxUses, invite.usedCount],
        );
        persist();
        return invite;
      },
      catch: dbError,
    }),

  incrementUsage: (code) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db, "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?", [code]);
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// AuditRepo
// ---------------------------------------------------------------------------

const AuditRepoLive = Layer.succeed(AuditRepo, {
  create: (event) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO audit_events (id, at, actor_id, subject_kind, subject_id, action, before_val, after_val)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [event.id, event.at, event.actorId, event.subject.kind, event.subject.id,
           event.action,
           event.before != null ? JSON.stringify(event.before) : null,
           event.after != null ? JSON.stringify(event.after) : null],
        );
        persist();
      },
      catch: dbError,
    }),

  findBySubject: (kind, id, limit) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<AuditEventRow>(db,
          `SELECT * FROM audit_events WHERE subject_kind = ? AND subject_id = ?
           ORDER BY at DESC LIMIT ?`,
          [kind, id, limit],
        );
        return rows.map(toAuditEvent);
      },
      catch: dbError,
    }),

  findRecent: (limit) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<AuditEventRow>(db,
          "SELECT * FROM audit_events ORDER BY at DESC LIMIT ?", [limit]);
        return rows.map(toAuditEvent);
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// EventOutboxRepo
// ---------------------------------------------------------------------------

const EventOutboxRepoLive = Layer.succeed(EventOutboxRepo, {
  enqueue: (event) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          `INSERT INTO event_outbox (event_kind, payload, created_at)
           VALUES (?, ?, ?)`,
          [event.kind, JSON.stringify(event), new Date().toISOString()],
        );
        persist();
      },
      catch: dbError,
    }),

  dequeue: (batchSize) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = query<EventOutboxRow>(db,
          `SELECT * FROM event_outbox WHERE processed_at IS NULL
           ORDER BY id ASC LIMIT ?`, [batchSize]);
        return rows.map((r) => ({
          id: String(r.id),
          event: JSON.parse(r.payload) as DomainEvent,
        }));
      },
      catch: dbError,
    }),

  ack: (id) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          "UPDATE event_outbox SET processed_at = ? WHERE id = ?",
          [new Date().toISOString(), id],
        );
        persist();
      },
      catch: dbError,
    }),

  nack: (id, error) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        run(db,
          "UPDATE event_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?",
          [error, id],
        );
        persist();
      },
      catch: dbError,
    }),
});

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

/** Seed default venue (Owl & Hitchhiker) if none exist. */
export const seedVenues = Effect.tryPromise({
  try: async () => {
    const db = await getDb();
    const existing = query<VenueRow>(db, "SELECT * FROM venues", []);
    if (existing.length > 0) return;

    run(db,
      `INSERT INTO venues (id, name, address, capacity, max_pods, house_credit_per_player, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["d0000000-0000-0000-0000-000000000001", "Owl & Hitchhiker",
       "471 Holloway Rd, Archway, London N7 6LE", 16, 2, 700, 1],
    );
    persist();
  },
  catch: dbError,
});

/** Seed default invite code "NLCC2026" if it doesn't exist. */
export const seedInviteCode = Effect.tryPromise({
  try: async () => {
    const db = await getDb();
    const existing = query<InviteCodeRow>(db, "SELECT * FROM invite_codes WHERE code = ?", ["NLCC2026"]);
    if (existing.length > 0) return;

    run(db,
      `INSERT INTO invite_codes (code, created_by, created_at, expires_at, max_uses, used_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["NLCC2026", "system", new Date().toISOString(), null, null, 0],
    );
    persist();
  },
  catch: dbError,
});

// ---------------------------------------------------------------------------
// seedDefaults — called from main.ts at startup
// ---------------------------------------------------------------------------

export async function seed(): Promise<void> {
  await Effect.runPromise(seedVenues);
  await Effect.runPromise(seedInviteCode);
  await seedCoordinator();
}

async function seedCoordinator(): Promise<void> {
  const db = await getDb();
  const existing = query<{ id: string }>(db, "SELECT id FROM users WHERE email = ?", ["jm@memorici.de"]);
  if (existing.length > 0) {
    // Ensure coordinator role
    run(db, "UPDATE users SET role = 'coordinator' WHERE email = ?", ["jm@memorici.de"]);
    persist();
  }
  // If user doesn't exist yet, they'll get coordinator role when they register
  // via a check in the register program
}

/** @deprecated Use seed() — kept for backward compat */
export const seedDefaults = seed;

// ---------------------------------------------------------------------------
// Combined layer
// ---------------------------------------------------------------------------

export const AllReposLive = Layer.mergeAll(
  UserRepoLive,
  VenueRepoLive,
  CubeRepoLive,
  FridayRepoLive,
  EnrollmentRepoLive,
  RsvpRepoLive,
  VoteRepoLive,
  PodRepoLive,
  SeatRepoLive,
  RoundRepoLive,
  MatchRepoLive,
  SessionRepoLive,
  InviteCodeRepoLive,
  AuditRepoLive,
  EventOutboxRepoLive,
);
