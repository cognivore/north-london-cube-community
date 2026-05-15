/**
 * Admin routes — force state, ban users, audit log.
 */

import { Hono } from "hono";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware, coordinatorMiddleware } from "../middleware.js";
import {
  FridayRepo, UserRepo, AuditRepo, PodRepo, SeatRepo, RoundRepo, RsvpRepo,
  EnrollmentRepo, CubeRepo, VenueRepo,
} from "../../repos/types.js";
import {
  transition, unsafePositiveInt, unsafeRoundId, unsafeDuration,
  packPods, isNonEmpty,
} from "@cubehall/core";
import type {
  DraftFormat, FridayEvent, NonEmptyArray, PackPodsInput, UserProfile,
} from "@cubehall/core";
import { isOk } from "@cubehall/core";
import { Clock } from "../../capabilities/clock.js";
import { RNG } from "../../capabilities/rng.js";
import { getDb, query as dbQuery, run as dbRun, persist as dbPersist } from "../../db/sqlite.js";
import { buildPairingsTemplate } from "../../programs/friday-lifecycle.js";
import { BYE_USER_ID } from "../../repos/sqlite-repos.js";
import { sendEmail } from "../../scheduler.js";
import { renderEmail, ALL_EMAIL_KINDS, type EmailKind } from "../../email-templates.js";
import {
  getAllSettings, setBoolSetting,
  SETTING_NO_SHOW_ENFORCEMENT, SETTING_ODD_EVENTS_ALLOWED,
  type SettingKey,
} from "../../settings.js";

const admin = new Hono<AppEnv>();

admin.use("*", authMiddleware());
admin.use("*", coordinatorMiddleware());

// POST /api/admin/fridays/:id/force-state
admin.post("/fridays/:id/force-state", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("id");
  const body = await c.req.json();

  try {
    const result = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const friday = yield* fridayRepo.findById(fridayId! as any);
        if (!friday) return { error: "not_found" };

        const event: FridayEvent = { kind: "admin_cancel", reason: body.reason ?? "Admin override" };
        const next = transition(friday.state, event);
        if (!isOk(next)) return { error: next.error.message };

        yield* fridayRepo.updateState(friday.id, next.value);
        return { friday: { ...friday, state: next.value } };
      }),
    );

    if ("error" in result && typeof result.error === "string") {
      return apiError(c, 400, "TRANSITION_ERROR", result.error);
    }
    return c.json(result);
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to force state");
  }
});

// GET /api/admin/settings — return all admin-tunable runtime flags.
admin.get("/settings", async (c) => {
  try {
    const settings = await getAllSettings();
    return c.json({ settings });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to load settings: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// PUT /api/admin/settings — update one or more boolean flags. Body shape:
// { noShowEnforcementEnabled?: boolean, oddEventsAllowed?: boolean }
admin.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | Partial<Record<SettingKey, boolean>>
    | null;
  if (!body || typeof body !== "object") {
    return apiError(c, 400, "BAD_REQUEST", "Body must be an object of {settingKey: boolean}");
  }

  const writable: ReadonlyArray<SettingKey> = [SETTING_NO_SHOW_ENFORCEMENT, SETTING_ODD_EVENTS_ALLOWED];
  try {
    for (const key of writable) {
      const v = body[key];
      if (typeof v === "boolean") await setBoolSetting(key, v);
    }
    return c.json({ ok: true, settings: await getAllSettings() });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to update settings: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/test-email — send a preview of any transactional email to a
// specified address. Renders the live template with placeholder context so the
// coordinator can sanity-check copy without having to wait for the real cron.
admin.post("/test-email", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { kind?: string; to?: string; date?: string; cubeNames?: string; displayName?: string }
    | null;

  const kind = body?.kind as EmailKind | undefined;
  const to = body?.to;
  if (!kind || !ALL_EMAIL_KINDS.includes(kind)) {
    return apiError(c, 400, "BAD_REQUEST",
      `kind must be one of: ${ALL_EMAIL_KINDS.join(", ")}`);
  }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return apiError(c, 400, "BAD_REQUEST", "to must be a valid email address");
  }

  const appUrlValue = process.env.APP_URL ?? "https://north.cube.london";
  const ctx = {
    displayName: body?.displayName?.trim() || "Friend",
    date: body?.date?.trim() || new Date().toISOString().slice(0, 10),
    cubeNames: body?.cubeNames?.trim() || "Powered Vintage, Sealed pool",
    appUrl: appUrlValue,
    rsvpTime: "yesterday at 21:34",
    coveredCount: 2,
  };

  const rendered = renderEmail(kind, ctx);
  try {
    // Prefix subject with [PREVIEW] so it's unmistakable in the inbox.
    await sendEmail(to, `[PREVIEW] ${rendered.subject}`, rendered.body);
    return c.json({ ok: true, kind, to, subject: rendered.subject, body: rendered.body });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to send test email: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:id/set-state — force the Friday to any state, bypassing
// the state machine. Reconstructs the state shape from current enrollments/winners
// where required. Clears the cron-email dedupe so reminders can fire again after
// stepping backwards. Use this for "reopen vote", "back to enrollment_closed", etc.
admin.post("/fridays/:id/set-state", async (c) => {
  const fridayId = c.req.param("id")!;
  const body = await c.req.json().catch(() => null) as { target?: string } | null;
  const target = body?.target;

  const allowed = new Set([
    "scheduled", "open", "enrollment_closed", "vote_open", "vote_closed",
    "locked", "confirmed", "in_progress", "complete", "cancelled",
  ]);
  if (!target || !allowed.has(target)) {
    return apiError(c, 400, "BAD_REQUEST", `target must be one of: ${Array.from(allowed).join(", ")}`);
  }

  try {
    const db = await getDb();
    const fri = dbQuery<{ id: string; date: string; state: string }>(db,
      "SELECT id, date, state FROM fridays WHERE id = ?", [fridayId]);
    if (fri.length === 0) return apiError(c, 404, "NOT_FOUND", "Friday not found");
    const currentState = JSON.parse(fri[0]!.state) as { kind: string; winners?: string[]; vote?: unknown };

    let newState: Record<string, unknown>;
    switch (target) {
      case "scheduled":
      case "open":
      case "enrollment_closed":
      case "confirmed":
      case "in_progress":
      case "complete":
        newState = { kind: target };
        break;

      case "vote_open": {
        // Rebuild vote context from active enrollments. Preserve existing votes
        // in the votes table — admin can re-close to re-tally.
        const enrollments = dbQuery<{ id: string }>(db,
          "SELECT id FROM enrollments WHERE friday_id = ? AND withdrawn = 0", [fridayId]);
        if (enrollments.length === 0) {
          return apiError(c, 409, "NO_ENROLLMENTS", "Cannot open vote with no active enrollments");
        }
        const now = new Date();
        // Close at end of the Friday date in London — admin can manually close earlier.
        const closesAt = new Date(`${fri[0]!.date}T18:00:00Z`).toISOString();
        newState = {
          kind: "vote_open",
          vote: {
            candidates: enrollments.map(e => e.id),
            opensAt: now.toISOString(),
            closesAt,
          },
        };
        break;
      }

      case "vote_closed": {
        // Preserve existing winners if we already had any; otherwise default to
        // all active enrollments (admin can re-run advance from vote_open to
        // re-tally if they want IRV instead).
        let winners: string[] | null = null;
        if (Array.isArray(currentState.winners) && currentState.winners.length > 0) {
          winners = currentState.winners;
        } else {
          const enrollments = dbQuery<{ id: string }>(db,
            "SELECT id FROM enrollments WHERE friday_id = ? AND withdrawn = 0 LIMIT 1", [fridayId]);
          if (enrollments.length === 0) {
            return apiError(c, 409, "NO_ENROLLMENTS", "Cannot close vote with no enrollments and no existing winners");
          }
          winners = [enrollments[0]!.id];
        }
        newState = { kind: "vote_closed", winners };
        break;
      }

      case "locked":
        // Mirrors force-lock's shape: downstream code never reads state.config.
        // Note: this does NOT create pods. Use force-lock if you also need pods.
        newState = { kind: "locked", config: null };
        break;

      case "cancelled":
        newState = { kind: "cancelled", reason: "admin" };
        break;

      default:
        return apiError(c, 400, "BAD_REQUEST", `Unsupported target: ${target}`);
    }

    dbRun(db, "UPDATE fridays SET state = ? WHERE id = ?",
      [JSON.stringify(newState), fridayId]);
    // Clear cron-email dedup so reminders can fire again when stepping back.
    dbRun(db, "DELETE FROM sent_emails WHERE friday_id = ?", [fridayId]);
    dbPersist();

    return c.json({ ok: true, from: currentState.kind, to: target });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to set state: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:id/uncancel — restore a cancelled Friday and notify
// everyone with a live RSVP. Bypasses the state machine (cancelled is terminal).
// Picks a sensible state based on what data exists:
//   pods exist            → locked
//   enrollments exist     → enrollment_closed
//   otherwise             → open
admin.post("/fridays/:id/uncancel", async (c) => {
  const fridayId = c.req.param("id")!;

  try {
    const db = await getDb();
    const fri = dbQuery<{ id: string; date: string; state: string }>(db,
      "SELECT id, date, state FROM fridays WHERE id = ?", [fridayId]);
    if (fri.length === 0) return apiError(c, 404, "NOT_FOUND", "Friday not found");
    const currentKind = JSON.parse(fri[0]!.state).kind as string;
    if (currentKind !== "cancelled") {
      return apiError(c, 409, "WRONG_STATE", `Friday is ${currentKind}, not cancelled`);
    }

    const podCount = dbQuery<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM pods WHERE friday_id = ?", [fridayId])[0]?.n ?? 0;
    const enrollmentCount = dbQuery<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM enrollments WHERE friday_id = ? AND withdrawn = 0",
      [fridayId])[0]?.n ?? 0;

    const restoredState =
      podCount > 0 ? { kind: "locked", config: null } :
      enrollmentCount > 0 ? { kind: "enrollment_closed" } :
      { kind: "open" };

    dbRun(db, "UPDATE fridays SET state = ? WHERE id = ?",
      [JSON.stringify(restoredState), fridayId]);
    // Wipe sent_emails dedup so cron emails (wednesday/morning/etc.) can fire
    // again after the restoration.
    dbRun(db, "DELETE FROM sent_emails WHERE friday_id = ?", [fridayId]);
    dbPersist();

    // Notify everyone who hadn't withdrawn. Includes pending/confirmed/locked/seated.
    const recipients = dbQuery<{ email: string; display_name: string }>(db,
      `SELECT u.email, u.display_name FROM rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.friday_id = ? AND r.state != 'cancelled_by_user'`, [fridayId]);

    const date = fri[0]!.date;
    const appUrl = process.env.APP_URL ?? "https://north.cube.london";
    const sent: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    for (const r of recipients) {
      try {
        const e = renderEmail("uncancel", {
          displayName: r.display_name,
          date,
          cubeNames: "",
          appUrl,
        });
        await sendEmail(r.email, e.subject, e.body);
        sent.push(r.email);
      } catch (e) {
        failed.push({ email: r.email, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return c.json({
      ok: true,
      restoredState: restoredState.kind,
      notified: sent.length,
      failed,
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to uncancel: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/users/:id/ban
admin.post("/users/:id/ban", async (c) => {
  const run = c.get("effectRuntime");
  const userId = c.req.param("id");
  const body = await c.req.json();

  try {
    await run(
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const user = yield* userRepo.findById(userId as any);
        if (!user) return;

        yield* userRepo.updateProfile(user.id, {
          ...user.profile,
          banned: { kind: "banned", until: body.until, reason: body.reason },
        });
      }),
    );
    return c.json({ ok: true });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to ban user");
  }
});

// POST /api/admin/fridays/:id/shuffle-seating — auto-assign seating using packPods.
// Writes seats into existing pods, matched by cube_id. Uses each pod's current
// `format` (which the admin can edit before shuffling). Returns the pack
// error verbatim when it can't find a configuration so the admin can react.
admin.post("/fridays/:id/shuffle-seating", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("id")!;

  try {
    const result = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const podRepo = yield* PodRepo;
        const roundRepo = yield* RoundRepo;
        const rsvpRepo = yield* RsvpRepo;
        const cubeRepo = yield* CubeRepo;
        const venueRepo = yield* VenueRepo;
        const userRepo = yield* UserRepo;

        const friday = yield* fridayRepo.findById(fridayId as any);
        if (!friday) return { error: "not_found" as const };
        if (friday.state.kind === "complete" || friday.state.kind === "cancelled") {
          return { error: "wrong_state" as const, state: friday.state.kind };
        }

        const pods = yield* podRepo.findByFriday(friday.id);
        if (pods.length === 0) return { error: "no_pods" as const };

        // Reject if any round has started (results may already exist).
        for (const pod of pods) {
          const rounds = yield* roundRepo.findByPod(pod.id);
          if (rounds.some(r => r.state !== "pending")) {
            return { error: "round_started" as const, podId: pod.id as string };
          }
        }

        const venue = yield* venueRepo.findById(friday.venueId);
        if (!venue) return { error: "venue_not_found" as const };

        const rsvps = yield* rsvpRepo.findActiveByFriday(friday.id);
        if (rsvps.length === 0) return { error: "no_rsvps" as const };

        const rsvpEntries: Array<PackPodsInput["rsvps"][number]> = [];
        for (const r of rsvps) {
          const user = yield* userRepo.findById(r.userId);
          const profile: UserProfile = user?.profile ?? {
            preferredFormats: ["swiss_draft" as DraftFormat] as NonEmptyArray<DraftFormat>,
            fallbackFormats: [],
            hostCapable: false,
            bio: "",
            noShowCount: 0 as any,
            banned: { kind: "not_banned" as const },
          };
          rsvpEntries.push({
            userId: r.userId,
            rsvpTimestamp: r.createdAt,
            profile,
          });
        }

        const cubeIds = pods.map(p => p.cubeId);
        const cubes = yield* cubeRepo.findMany(cubeIds);
        const cubeEntries = pods.map(pod => {
          const cube = cubes.find(c => c.id === pod.cubeId);
          return cube ? { cube, hostId: pod.hostId, format: pod.format } : null;
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        if (!isNonEmpty(cubeEntries)) {
          return { error: "no_cubes" as const };
        }

        const packResult = packPods({ rsvps: rsvpEntries, cubes: cubeEntries, venue });
        if (!isOk(packResult)) {
          return { error: "pack_failed" as const, reason: packResult.error.kind, detail: (packResult.error as any).reason };
        }
        const config = packResult.value;

        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });

        const updated: Array<{ podId: string; seated: number }> = [];
        yield* Effect.sync(() => {
          for (const planned of config.pods) {
            const pod = pods.find(p => p.cubeId === planned.cubeId);
            if (!pod) continue;
            dbRun(db, "DELETE FROM seats WHERE pod_id = ?", [pod.id]);
            for (let i = 0; i < planned.seats.length; i++) {
              const seat = planned.seats[i]!;
              const team: "A" | "B" | null =
                planned.format === "team_draft_2v2" ||
                planned.format === "team_draft_3v3" ||
                planned.format === "team_draft_4v4"
                  ? (i % 2 === 0 ? "A" : "B")
                  : null;
              dbRun(db,
                "INSERT INTO seats (pod_id, seat_index, user_id, team) VALUES (?, ?, ?, ?)",
                [pod.id, i, seat.userId, team]);
            }
            // Keep template podSize in sync with the new seat count.
            const newTemplate = buildPairingsTemplate(planned.format, planned.seats.length as 4 | 6 | 8);
            dbRun(db, "UPDATE pods SET pairings_template = ? WHERE id = ?",
              [JSON.stringify(newTemplate), pod.id]);
            updated.push({ podId: pod.id as string, seated: planned.seats.length });
          }
          dbPersist();
        });

        return {
          ok: true as const,
          updated,
          waitlisted: config.waitlisted,
          excluded: config.excluded,
          summary: config.summary,
        };
      }),
    );

    if ("error" in result) {
      if (result.error === "not_found") return apiError(c, 404, "NOT_FOUND", "Friday not found");
      if (result.error === "wrong_state") {
        return apiError(c, 409, "WRONG_STATE",
          `Shuffle not allowed when Friday is ${result.state}`);
      }
      if (result.error === "no_pods") return apiError(c, 409, "NO_PODS", "No pods to shuffle — force-lock the Friday first");
      if (result.error === "round_started") {
        return apiError(c, 409, "ROUND_STARTED", `Round already started for pod ${result.podId} — pods are frozen`);
      }
      if (result.error === "venue_not_found") return apiError(c, 500, "INTERNAL", "Venue not found");
      if (result.error === "no_rsvps") return apiError(c, 409, "NO_RSVPS", "No active RSVPs to seat");
      if (result.error === "no_cubes") return apiError(c, 409, "NO_CUBES", "No cubes resolvable for pods");
      if (result.error === "pack_failed") {
        return apiError(c, 409, "PACK_FAILED", `Pack rejected: ${result.reason}${result.detail ? ` — ${result.detail}` : ""}`);
      }
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Shuffle failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:id/force-lock — create empty pods + jump to "locked"
// Used when packPods fails (too few RSVPs / size mismatch) or when admin wants
// to hand-build the seating from scratch.
admin.post("/fridays/:id/force-lock", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("id")!;

  try {
    const result = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const enrollmentRepo = yield* EnrollmentRepo;
        const cubeRepo = yield* CubeRepo;
        const clock = yield* Clock;
        const rng = yield* RNG;

        const friday = yield* fridayRepo.findById(fridayId as any);
        if (!friday) return { error: "not_found" as const };
        const allowedFrom = ["enrollment_closed", "vote_open", "vote_closed", "locked"];
        if (!allowedFrom.includes(friday.state.kind)) {
          return { error: "wrong_state" as const, state: friday.state.kind };
        }

        // Determine which cubes get pods. If state has winners, use those.
        // Otherwise fall back to all active enrollments for the friday.
        const winnerIds = friday.state.kind === "vote_closed"
          ? (friday.state.winners as ReadonlyArray<string>)
          : null;
        const enrollments = yield* enrollmentRepo.findActiveByFriday(friday.id);
        const winningEnrollments = winnerIds
          ? enrollments.filter(e => winnerIds.includes(e.id as string))
          : enrollments;
        if (winningEnrollments.length === 0) {
          return { error: "no_enrollments" as const };
        }

        const cubeIds = winningEnrollments.map(e => e.cubeId);
        const cubes = yield* cubeRepo.findMany(cubeIds);
        const now = yield* clock.now();

        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });

        const created: Array<{ podId: string; cubeId: string; format: string }> = [];
        for (const enrollment of winningEnrollments) {
          // If a pod for this cube already exists for this friday (e.g. re-runs), skip.
          const existing = dbQuery<{ id: string }>(db,
            "SELECT id FROM pods WHERE friday_id = ? AND cube_id = ?",
            [friday.id, enrollment.cubeId]);
          if (existing.length > 0) {
            created.push({ podId: existing[0]!.id, cubeId: enrollment.cubeId as string, format: "existing" });
            continue;
          }

          const cube = cubes.find(c => c.id === enrollment.cubeId);
          const format = (cube?.supportedFormats[0] ?? "swiss_draft") as DraftFormat;
          const initialSize: 4 | 6 | 8 =
            format === "team_draft_3v3" ? 6 :
            format === "team_draft_4v4" ? 8 :
            4;
          const template = buildPairingsTemplate(format, initialSize);
          const podId = yield* rng.uuid();

          yield* Effect.sync(() => {
            dbRun(db,
              `INSERT INTO pods (id, friday_id, cube_id, host_id, format, state, pairings_template)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [podId, friday.id, enrollment.cubeId, enrollment.hostId,
               format, "drafting", JSON.stringify(template)]);
          });

          // Three pending rounds (matches the default in vote_closed → locked)
          for (let r = 1; r <= template.rounds; r++) {
            const roundId = yield* rng.uuid();
            yield* Effect.sync(() => {
              dbRun(db,
                `INSERT INTO rounds (id, pod_id, round_number, state, started_at, ended_at,
                                     time_limit, extensions, timer)
                 VALUES (?, ?, ?, 'pending', NULL, NULL, ?, '[]', ?)`,
                [roundId, podId, r, 3000,
                 JSON.stringify({ kind: "not_started" })]);
            });
          }

          created.push({ podId, cubeId: enrollment.cubeId as string, format });
        }

        // Bypass the state-machine PodConfiguration requirement and write
        // a minimal locked state directly. Downstream code never reads
        // state.config, so this is safe.
        yield* Effect.sync(() => {
          dbRun(db,
            `UPDATE fridays SET state = ?, locked_at = COALESCE(locked_at, ?) WHERE id = ?`,
            [JSON.stringify({ kind: "locked", config: null }), now, friday.id]);
          dbPersist();
        });

        return { friday: { ...friday, state: { kind: "locked" } }, created };
      }),
    );

    if ("error" in result) {
      if (result.error === "not_found") return apiError(c, 404, "NOT_FOUND", "Friday not found");
      if (result.error === "wrong_state") {
        return apiError(c, 409, "WRONG_STATE",
          `Force-lock only allowed from enrollment_closed/vote_open/vote_closed/locked (got ${result.state})`);
      }
      if (result.error === "no_enrollments") {
        return apiError(c, 409, "NO_ENROLLMENTS", "No active cube enrollments to lock");
      }
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to force-lock: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// PUT /api/admin/pods/:id/seats — replace pod seats (pre-round-1 only).
// Optionally also rewrites the pod's `format` (validated against the cube's
// supportedFormats) so admin can switch e.g. team_draft_3v3 → swiss_draft when
// there aren't enough players for the original format.
admin.put("/pods/:id/seats", async (c) => {
  const run = c.get("effectRuntime");
  const podId = c.req.param("id")!;
  const body = await c.req.json().catch(() => null) as
    | { seats?: ReadonlyArray<{ userId: string; team?: "A" | "B" | null }>; format?: string }
    | null;

  const seats = body?.seats;
  const requestedFormat = typeof body?.format === "string" ? body.format as DraftFormat : null;
  if (!Array.isArray(seats)) {
    return apiError(c, 400, "BAD_REQUEST", "Body must be { seats: [{ userId, team? }], format? }");
  }
  // Allow size 0 (clear seats) so admin can blank a pod without deleting it.
  if (seats.length !== 0 && ![4, 6, 8].includes(seats.length)) {
    return apiError(c, 400, "INVALID_POD_SIZE", `Pod size must be 0, 4, 6, or 8 (got ${seats.length})`);
  }
  const userIds = seats.map(s => s.userId);
  if (new Set(userIds).size !== userIds.length) {
    return apiError(c, 400, "DUPLICATE_USER", "Cannot seat the same user twice in one pod");
  }

  try {
    const result = await run(
      Effect.gen(function* () {
        const podRepo = yield* PodRepo;
        const roundRepo = yield* RoundRepo;
        const rsvpRepo = yield* RsvpRepo;
        const fridayRepo = yield* FridayRepo;
        const cubeRepo = yield* CubeRepo;

        const pod = yield* podRepo.findById(podId as any);
        if (!pod) return { error: "not_found" as const };

        const friday = yield* fridayRepo.findById(pod.fridayId);
        if (!friday) return { error: "friday_not_found" as const };
        if (friday.state.kind === "complete" || friday.state.kind === "cancelled") {
          return { error: "friday_state" as const, state: friday.state.kind };
        }
        if (pod.state === "complete" || pod.state === "cancelled") {
          return { error: "pod_state" as const, state: pod.state };
        }

        const rounds = yield* roundRepo.findByPod(pod.id);
        const anyStarted = rounds.some(r => r.state !== "pending");
        if (anyStarted) return { error: "round_started" as const };

        const activeRsvps = yield* rsvpRepo.findActiveByFriday(pod.fridayId);
        const activeIds = new Set(activeRsvps.map(r => r.userId as string));
        const missing = userIds.filter(u => !activeIds.has(u));
        if (missing.length > 0) {
          return { error: "user_not_active" as const, missing };
        }

        // Resolve format: if admin asked for a change, validate it against the
        // cube's supportedFormats. Otherwise keep what's there.
        let format: DraftFormat = pod.format;
        if (requestedFormat && requestedFormat !== pod.format) {
          const cube = yield* cubeRepo.findById(pod.cubeId);
          if (!cube) return { error: "cube_not_found" as const };
          if (!cube.supportedFormats.includes(requestedFormat)) {
            return { error: "format_unsupported" as const, format: requestedFormat, allowed: cube.supportedFormats };
          }
          format = requestedFormat;
        }

        // Pick a template podSize: actual seats if non-zero, else format's natural size.
        const templateSize: 4 | 6 | 8 =
          seats.length === 4 || seats.length === 6 || seats.length === 8
            ? seats.length
            : format === "team_draft_3v3" ? 6
            : format === "team_draft_4v4" ? 8
            : 4;
        const newTemplate = buildPairingsTemplate(format, templateSize);

        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });
        yield* Effect.sync(() => {
          dbRun(db, "DELETE FROM seats WHERE pod_id = ?", [podId]);
          for (let i = 0; i < seats.length; i++) {
            const s = seats[i]!;
            // For team formats, derive team ABAB unless the caller specified one.
            const isTeamFmt = format === "team_draft_2v2" || format === "team_draft_3v3" || format === "team_draft_4v4";
            const team: "A" | "B" | null =
              s.team === "A" || s.team === "B"
                ? s.team
                : isTeamFmt
                ? (i % 2 === 0 ? "A" : "B")
                : null;
            dbRun(db,
              "INSERT INTO seats (pod_id, seat_index, user_id, team) VALUES (?, ?, ?, ?)",
              [podId, i, s.userId, team]);
          }
          dbRun(db, "UPDATE pods SET format = ?, pairings_template = ? WHERE id = ?",
            [format, JSON.stringify(newTemplate), podId]);
          dbPersist();
        });

        const refreshed = yield* podRepo.findById(podId as any);
        return { pod: refreshed };
      }),
    );

    if ("error" in result) {
      if (result.error === "not_found") return apiError(c, 404, "NOT_FOUND", "Pod not found");
      if (result.error === "friday_not_found") return apiError(c, 404, "NOT_FOUND", "Friday not found");
      if (result.error === "cube_not_found") return apiError(c, 404, "NOT_FOUND", "Cube not found");
      if (result.error === "friday_state") {
        return apiError(c, 409, "FRIDAY_STATE", `Friday is ${result.state} — seats are frozen`);
      }
      if (result.error === "pod_state") {
        return apiError(c, 409, "POD_STATE", `Pod is ${result.state} — seats are frozen`);
      }
      if (result.error === "round_started") {
        return apiError(c, 409, "ROUND_STARTED", "At least one round has started — pods are frozen");
      }
      if (result.error === "user_not_active") {
        return apiError(c, 409, "USER_NOT_ACTIVE", `These users have no active RSVP: ${result.missing.join(", ")}`);
      }
      if (result.error === "format_unsupported") {
        return apiError(c, 409, "FORMAT_UNSUPPORTED", `Cube doesn't support ${result.format} (allowed: ${result.allowed.join(", ")})`);
      }
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to update seats: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:fridayId/users/:userId/no-show
// Records a no-show for the user on this Friday and replaces them with BYE
// in any pod seat or pending match they're in.
admin.post("/fridays/:fridayId/users/:userId/no-show", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("fridayId")!;
  const userId = c.req.param("userId")!;

  if (userId === BYE_USER_ID) {
    return apiError(c, 400, "BAD_REQUEST", "Cannot mark BYE as no-show");
  }

  try {
    const result = await run(
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const rsvpRepo = yield* RsvpRepo;
        const fridayRepo = yield* FridayRepo;

        const friday = yield* fridayRepo.findById(fridayId as any);
        if (!friday) return { error: "friday_not_found" as const };
        const user = yield* userRepo.findById(userId as any);
        if (!user) return { error: "user_not_found" as const };

        const rsvp = yield* rsvpRepo.findByFridayAndUser(friday.id, user.id);
        const now = new Date().toISOString();

        // 1. Mark RSVP no_show (if it exists)
        if (rsvp) {
          yield* rsvpRepo.updateState(rsvp.id, "no_show" as any, now as any);
        }

        // 2. Increment user.profile.noShowCount
        const currentCount = (user.profile.noShowCount as unknown as number) ?? 0;
        yield* userRepo.updateProfile(user.id, {
          ...user.profile,
          noShowCount: (currentCount + 1) as any,
        });

        // 3. Replace seats and pending matches with BYE
        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });
        const replaced: { seats: number; matches: number } = { seats: 0, matches: 0 };
        yield* Effect.sync(() => {
          const seatRows = dbQuery<{ pod_id: string; seat_index: number }>(db,
            `SELECT s.pod_id, s.seat_index
             FROM seats s JOIN pods p ON p.id = s.pod_id
             WHERE p.friday_id = ? AND s.user_id = ?`, [fridayId, userId]);
          for (const r of seatRows) {
            dbRun(db,
              "UPDATE seats SET user_id = ? WHERE pod_id = ? AND seat_index = ?",
              [BYE_USER_ID, r.pod_id, r.seat_index]);
            replaced.seats++;
          }

          // Pending matches in this friday's rounds where user is a player.
          const matchRows = dbQuery<{ id: string; player1_id: string; player2_id: string }>(db,
            `SELECT m.id, m.player1_id, m.player2_id
             FROM matches m
             JOIN rounds r ON r.id = m.round_id
             JOIN pods p ON p.id = r.pod_id
             WHERE p.friday_id = ?
               AND m.result LIKE '%"kind":"pending"%'
               AND (m.player1_id = ? OR m.player2_id = ?)`,
            [fridayId, userId, userId]);
          for (const m of matchRows) {
            const otherIsP1 = m.player2_id === userId;
            // Replace player slot with BYE; auto-report 2-0 win for the other player.
            const newP1 = otherIsP1 ? m.player1_id : BYE_USER_ID;
            const newP2 = otherIsP1 ? BYE_USER_ID : m.player2_id;
            const reportedResult = JSON.stringify({
              kind: "reported",
              p1Wins: otherIsP1 ? 2 : 0,
              p2Wins: otherIsP1 ? 0 : 2,
              draws: 0,
              reason: "no_show_bye",
            });
            dbRun(db,
              `UPDATE matches SET player1_id = ?, player2_id = ?, result = ?,
                                  submitted_at = ?, submitted_by = 'system'
               WHERE id = ?`,
              [newP1, newP2, reportedResult, now, m.id]);
            replaced.matches++;
          }
          dbPersist();
        });

        return { ok: true as const, replaced, noShowCount: currentCount + 1 };
      }),
    );

    if ("error" in result) {
      if (result.error === "friday_not_found") return apiError(c, 404, "NOT_FOUND", "Friday not found");
      if (result.error === "user_not_found") return apiError(c, 404, "NOT_FOUND", "User not found");
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `No-show failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:fridayId/rsvps — admin add RSVP for a user (state=confirmed)
admin.post("/fridays/:fridayId/rsvps", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("fridayId")!;
  const body = await c.req.json().catch(() => null) as { userId?: string } | null;
  const userId = body?.userId;
  if (!userId) return apiError(c, 400, "BAD_REQUEST", "Body must be { userId }");
  if (userId === BYE_USER_ID) return apiError(c, 400, "BAD_REQUEST", "Cannot RSVP BYE");

  try {
    const result = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const userRepo = yield* UserRepo;
        const rsvpRepo = yield* RsvpRepo;
        const rng = yield* RNG;

        const friday = yield* fridayRepo.findById(fridayId as any);
        if (!friday) return { error: "friday_not_found" as const };
        const user = yield* userRepo.findById(userId as any);
        if (!user) return { error: "user_not_found" as const };

        const now = new Date().toISOString();
        const existing = yield* rsvpRepo.findByFridayAndUser(friday.id, user.id);
        if (existing) {
          // Reactivate to "confirmed" — admin override of grace/even-pair flow.
          yield* rsvpRepo.updateState(existing.id, "confirmed" as any, now as any);
          return { ok: true as const, rsvpId: existing.id, reactivated: true };
        }

        const rsvpId = yield* rng.uuid();
        yield* rsvpRepo.create({
          id: rsvpId as any,
          fridayId: friday.id,
          userId: user.id,
          state: "confirmed" as any,
          createdAt: now as any,
          lastTransitionAt: now as any,
        });
        return { ok: true as const, rsvpId, reactivated: false };
      }),
    );

    if ("error" in result) {
      if (result.error === "friday_not_found") return apiError(c, 404, "NOT_FOUND", "Friday not found");
      if (result.error === "user_not_found") return apiError(c, 404, "NOT_FOUND", "User not found");
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to add RSVP: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// DELETE /api/admin/fridays/:fridayId/rsvps/:userId — cancel an RSVP
admin.delete("/fridays/:fridayId/rsvps/:userId", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("fridayId")!;
  const userId = c.req.param("userId")!;

  try {
    const result = await run(
      Effect.gen(function* () {
        const rsvpRepo = yield* RsvpRepo;
        const rsvp = yield* rsvpRepo.findByFridayAndUser(fridayId as any, userId as any);
        if (!rsvp) return { error: "not_found" as const };
        const now = new Date().toISOString();
        yield* rsvpRepo.updateState(rsvp.id, "cancelled_by_user" as any, now as any);
        return { ok: true as const };
      }),
    );
    if ("error" in result) {
      return apiError(c, 404, "NOT_FOUND", "RSVP not found");
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to cancel RSVP: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/admin/fridays — full list (past + upcoming) for the admin dashboard.
// The public /api/fridays only shows upcoming, which hides Fridays the day after
// they happened. Coordinators need to revisit historic Fridays for cleanup.
admin.get("/fridays", async (c) => {
  try {
    const db = await getDb();
    const rows = dbQuery<{
      id: string; date: string; venue_id: string; state: string;
      created_at: string; locked_at: string | null;
      confirmed_at: string | null; completed_at: string | null;
    }>(db,
      "SELECT id, date, venue_id, state, created_at, locked_at, confirmed_at, completed_at FROM fridays ORDER BY date DESC LIMIT 200");
    return c.json({
      fridays: rows.map(r => ({
        id: r.id,
        date: r.date,
        venueId: r.venue_id,
        state: JSON.parse(r.state),
        createdAt: r.created_at,
        lockedAt: r.locked_at,
        confirmedAt: r.confirmed_at,
        completedAt: r.completed_at,
      })),
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list fridays: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/admin/users — list users for admin pickers (returns id, displayName, email)
admin.get("/users", async (c) => {
  const q = c.req.query("q") ?? "";
  try {
    const db = await getDb();
    let rows: Array<{ id: string; display_name: string; email: string }>;
    if (q.length > 0) {
      const pattern = `%${q}%`;
      rows = dbQuery<{ id: string; display_name: string; email: string }>(db,
        `SELECT id, display_name, email FROM users
         WHERE id != ? AND (display_name LIKE ? OR email LIKE ?)
         ORDER BY display_name LIMIT 50`, [BYE_USER_ID, pattern, pattern]);
    } else {
      rows = dbQuery<{ id: string; display_name: string; email: string }>(db,
        `SELECT id, display_name, email FROM users
         WHERE id != ? ORDER BY display_name LIMIT 200`, [BYE_USER_ID]);
    }
    return c.json({
      users: rows.map(r => ({ id: r.id, displayName: r.display_name, email: r.email })),
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list users: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/matches/:id/result — admin records a match result after the
// fact. Bypasses the "must be a player" + "round must be in_progress" guards
// in reportMatch. Used for entering historical drafts.
admin.post("/matches/:id/result", async (c) => {
  const matchId = c.req.param("id")!;
  const body = await c.req.json().catch(() => null) as
    | { p1Wins?: number; p2Wins?: number; draws?: number }
    | null;
  if (!body || typeof body.p1Wins !== "number" || typeof body.p2Wins !== "number") {
    return apiError(c, 400, "BAD_REQUEST", "Body must be { p1Wins, p2Wins, draws? }");
  }
  const p1Wins = body.p1Wins;
  const p2Wins = body.p2Wins;
  const draws = body.draws ?? 0;
  if (p1Wins < 0 || p2Wins < 0 || draws < 0) {
    return apiError(c, 400, "BAD_REQUEST", "Scores must be non-negative");
  }

  try {
    const db = await getDb();
    const rows = dbQuery<{ id: string; round_id: string }>(db,
      "SELECT id, round_id FROM matches WHERE id = ?", [matchId]);
    if (rows.length === 0) return apiError(c, 404, "NOT_FOUND", "Match not found");
    const result = JSON.stringify({ kind: "reported", p1Wins, p2Wins, draws });
    const now = new Date().toISOString();
    dbRun(db,
      `UPDATE matches SET result = ?, submitted_at = ?, submitted_by = 'admin' WHERE id = ?`,
      [result, now, matchId]);
    // Auto-flip round to in_progress so it shows up in the list nicely.
    dbRun(db,
      `UPDATE rounds SET state = 'in_progress', started_at = COALESCE(started_at, ?)
       WHERE id = ? AND state = 'pending'`,
      [now, rows[0]!.round_id]);
    dbPersist();
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to record result: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/fridays/:id/force-complete — finishes a Friday at any point.
// Marks any non-terminal round as complete, marks all pods complete, and
// transitions the Friday to `complete`. Pending matches stay pending and are
// ignored by the standings calculator (no points assigned).
admin.post("/fridays/:id/force-complete", async (c) => {
  const fridayId = c.req.param("id")!;
  try {
    const db = await getDb();
    const fridayRows = dbQuery<{ id: string; state: string }>(db,
      "SELECT id, state FROM fridays WHERE id = ?", [fridayId]);
    if (fridayRows.length === 0) return apiError(c, 404, "NOT_FOUND", "Friday not found");
    const stateKind = JSON.parse(fridayRows[0]!.state).kind as string;
    if (stateKind === "complete" || stateKind === "cancelled") {
      return apiError(c, 409, "ALREADY_DONE", `Friday is already ${stateKind}`);
    }

    const now = new Date().toISOString();
    dbRun(db,
      `UPDATE rounds SET state = 'complete', ended_at = COALESCE(ended_at, ?)
       WHERE pod_id IN (SELECT id FROM pods WHERE friday_id = ?)
         AND state != 'complete'`,
      [now, fridayId]);
    dbRun(db,
      `UPDATE pods SET state = 'complete'
       WHERE friday_id = ? AND state NOT IN ('complete','cancelled')`,
      [fridayId]);
    dbRun(db,
      `UPDATE fridays SET state = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?`,
      [JSON.stringify({ kind: "complete" }), now, fridayId]);
    dbPersist();
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to finish Friday: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// DELETE /api/admin/rounds/:id — drops a round and its matches.
admin.delete("/rounds/:id", async (c) => {
  const roundId = c.req.param("id")!;
  try {
    const db = await getDb();
    const exists = dbQuery<{ id: string }>(db, "SELECT id FROM rounds WHERE id = ?", [roundId]);
    if (exists.length === 0) return apiError(c, 404, "NOT_FOUND", "Round not found");
    dbRun(db, "DELETE FROM matches WHERE round_id = ?", [roundId]);
    dbRun(db, "DELETE FROM rounds WHERE id = ?", [roundId]);
    dbPersist();
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to delete round: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/rounds/:id/complete — admin marks a round complete (after-the-fact)
admin.post("/rounds/:id/complete", async (c) => {
  const roundId = c.req.param("id")!;
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    dbRun(db,
      `UPDATE rounds SET state = 'complete', ended_at = COALESCE(ended_at, ?) WHERE id = ?`,
      [now, roundId]);
    dbPersist();
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to complete round: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// PUT /api/admin/rounds/:id/matches — replace all matches for a round.
// Used by coordinators to override pairings before any result is reported.
admin.put("/rounds/:id/matches", async (c) => {
  const run = c.get("effectRuntime");
  const roundId = c.req.param("id")!;
  const body = await c.req.json().catch(() => null) as
    | { matches?: ReadonlyArray<{ player1Id: string; player2Id: string }> }
    | null;

  const matches = body?.matches;
  if (!Array.isArray(matches) || matches.length === 0) {
    return apiError(c, 400, "BAD_REQUEST", "Body must be { matches: [{ player1Id, player2Id }] }");
  }
  for (const m of matches) {
    if (!m.player1Id || !m.player2Id || m.player1Id === m.player2Id) {
      return apiError(c, 400, "BAD_PAIR", "Each match must have two distinct players");
    }
  }

  try {
    const result = await run(
      Effect.gen(function* () {
        const roundRepo = yield* RoundRepo;
        const round = yield* roundRepo.findById(roundId as any);
        if (!round) return { error: "round_not_found" as const };
        if (round.state === "complete") return { error: "round_complete" as const };

        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });

        const reported = dbQuery<{ cnt: number }>(db,
          `SELECT COUNT(*) AS cnt FROM matches
           WHERE round_id = ? AND result NOT LIKE '%"kind":"pending"%'`, [roundId]);
        if ((reported[0]?.cnt ?? 0) > 0) {
          return { error: "results_present" as const };
        }

        const { v7: uuidv7 } = yield* Effect.tryPromise({
          try: () => import("uuid"),
          catch: () => ({ kind: "db_error" as const, cause: "uuid" }),
        });
        yield* Effect.sync(() => {
          dbRun(db, "DELETE FROM matches WHERE round_id = ?", [roundId]);
          for (const m of matches) {
            dbRun(db,
              `INSERT INTO matches (id, round_id, player1_id, player2_id, result, submitted_at, submitted_by)
               VALUES (?, ?, ?, ?, '{"kind":"pending"}', NULL, NULL)`,
              [uuidv7(), roundId, m.player1Id, m.player2Id]);
          }
          dbPersist();
        });

        return { ok: true as const, count: matches.length };
      }),
    );

    if ("error" in result) {
      if (result.error === "round_not_found") return apiError(c, 404, "NOT_FOUND", "Round not found");
      if (result.error === "round_complete") return apiError(c, 409, "ROUND_COMPLETE", "Round is complete — pairings frozen");
      if (result.error === "results_present") return apiError(c, 409, "RESULTS_PRESENT", "At least one result has been reported — clear results before editing pairings");
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to update pairings: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/admin/audit
admin.get("/audit", async (c) => {
  const run = c.get("effectRuntime");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  try {
    const events = await run(
      Effect.gen(function* () {
        const auditRepo = yield* AuditRepo;
        return yield* auditRepo.findRecent(limit);
      }),
    );
    return c.json({ events });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to load audit log");
  }
});

export { admin };
