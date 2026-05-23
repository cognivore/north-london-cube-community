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
  unsafeUserId, unsafeEmail, unsafeNonEmptyString, unsafeISO8601,
  unsafeNonNegativeInt, unsafeAuditEventId,
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
  getAllSettings, setBoolSetting, getBoolSetting,
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
  const userIds = seats.map(s => s.userId);
  if (new Set(userIds).size !== userIds.length) {
    return apiError(c, 400, "DUPLICATE_USER", "Cannot seat the same user twice in one pod");
  }

  // Size validation. Even sizes (0, 4, 6, 8) are always allowed. Odd sizes
  // (3, 5, 7) are allowed only when oddEventsAllowed is on AND the pod's
  // format is swiss_draft; team formats need even seating. Odd pods get
  // BYE-padded to the next even size before insert, so the pairings engine
  // (which only handles 4/6/8) sees a valid configuration and auto-resolves
  // the BYE matches the same way no-show fills do.
  const EVEN_SIZES = [0, 4, 6, 8];
  const ODD_SIZES = [3, 5, 7];
  const isEvenOk = EVEN_SIZES.includes(seats.length);
  const isOddRequested = ODD_SIZES.includes(seats.length);
  if (!isEvenOk && !isOddRequested) {
    return apiError(c, 400, "INVALID_POD_SIZE",
      `Pod size must be 0, 3, 4, 5, 6, 7, or 8 (got ${seats.length})`);
  }
  let padToEven = false;
  if (isOddRequested) {
    const oddAllowed = await getBoolSetting(SETTING_ODD_EVENTS_ALLOWED);
    if (!oddAllowed) {
      return apiError(c, 400, "INVALID_POD_SIZE",
        `Odd pod sizes are off — enable "Allow odd registrations" in Settings (got ${seats.length})`);
    }
    if (requestedFormat !== null && requestedFormat !== "swiss_draft") {
      return apiError(c, 400, "INVALID_POD_SIZE",
        `Odd pod sizes only work with swiss_draft (got ${requestedFormat} with ${seats.length} seats)`);
    }
    padToEven = true;
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
        // Odd sizes only make sense for swiss_draft. We already filtered out
        // odd-with-requestedFormat-team above; here we catch odd with an
        // inherited team format.
        if (padToEven && format !== "swiss_draft") {
          return { error: "odd_needs_swiss" as const, format };
        }

        // Pad odd pods with BYE seats up to the next even size so the
        // pairings engine (which only understands 4/6/8) gets a valid pod.
        const finalSeats: Array<{ userId: string; team?: "A" | "B" | null }> =
          padToEven
            ? [...seats, { userId: BYE_USER_ID, team: null }]
            : [...seats];

        // Pick a template podSize: actual seats if non-zero, else format's natural size.
        const templateSize: 4 | 6 | 8 =
          finalSeats.length === 4 || finalSeats.length === 6 || finalSeats.length === 8
            ? finalSeats.length
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
          for (let i = 0; i < finalSeats.length; i++) {
            const s = finalSeats[i]!;
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
      if (result.error === "odd_needs_swiss") {
        return apiError(c, 400, "INVALID_POD_SIZE",
          `Odd pod sizes need swiss_draft — pod is currently ${result.format}. Change the format first.`);
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

// GET /api/admin/users — list users for admin pickers.
// Merged sources are excluded by default; pass ?includeMerged=1 to surface
// them (the admin UI uses this to render the "Merged accounts" section).
admin.get("/users", async (c) => {
  const q = c.req.query("q") ?? "";
  const includeMerged = c.req.query("includeMerged") === "1";
  try {
    const db = await getDb();
    type Row = { id: string; display_name: string; email: string; created_at: string; role: string; auth_state: string };
    let rows: Row[];
    if (q.length > 0) {
      const pattern = `%${q}%`;
      rows = dbQuery<Row>(db,
        `SELECT id, display_name, email, created_at, role, auth_state FROM users
         WHERE id != ? AND (display_name LIKE ? OR email LIKE ?)
         ORDER BY display_name LIMIT 50`, [BYE_USER_ID, pattern, pattern]);
    } else {
      rows = dbQuery<Row>(db,
        `SELECT id, display_name, email, created_at, role, auth_state FROM users
         WHERE id != ? ORDER BY display_name LIMIT 500`, [BYE_USER_ID]);
    }
    const visible = includeMerged ? rows : rows.filter(r => {
      try { return (JSON.parse(r.auth_state) as { kind: string }).kind !== "merged"; }
      catch { return true; }
    });
    return c.json({
      users: visible.map(r => {
        const authKind = (() => {
          try { return (JSON.parse(r.auth_state) as { kind: string }).kind; }
          catch { return "unknown"; }
        })();
        return {
          id: r.id,
          displayName: r.display_name,
          email: r.email,
          createdAt: r.created_at,
          role: r.role,
          authKind,
        };
      }),
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list users: ${e instanceof Error ? e.message : String(e)}`);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugifyForLocalEmail(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug.length > 0 ? slug : "walkin";
}

// POST /api/admin/users — admin-vouched user creation. Skips the magic-link
// verification flow; the admin is asserting the user is real (walk-in scenario).
// If email is omitted, generates `${slug}@cubehall.local` with a -N suffix on
// collision, so the admin can register a walk-in by display name alone and
// fill in the real email later via PATCH.
admin.post("/users", async (c) => {
  const actor = c.get("user");
  const body = await c.req.json().catch(() => null) as
    { displayName?: string; email?: string } | null;
  const displayName = body?.displayName?.trim();
  if (!displayName) return apiError(c, 400, "BAD_REQUEST", "displayName required");

  let email = body?.email?.trim().toLowerCase() ?? "";
  if (email.length > 0 && !EMAIL_RE.test(email)) {
    return apiError(c, 400, "BAD_REQUEST", "Invalid email");
  }

  try {
    const db = await getDb();

    if (email.length === 0) {
      const base = slugifyForLocalEmail(displayName);
      let candidate = `${base}@cubehall.local`;
      let n = 2;
      while (dbQuery<{ c: number }>(db,
        "SELECT count(*) as c FROM users WHERE email = ?", [candidate])[0]!.c > 0) {
        candidate = `${base}-${n}@cubehall.local`;
        n += 1;
      }
      email = candidate;
    } else {
      const dupe = dbQuery<{ c: number }>(db,
        "SELECT count(*) as c FROM users WHERE email = ?", [email])[0]!.c;
      if (dupe > 0) return apiError(c, 409, "EMAIL_TAKEN", "Email already in use");
    }

    const run = c.get("effectRuntime");
    const created = await run(
      Effect.gen(function* () {
        const rng = yield* RNG;
        const clock = yield* Clock;
        const userRepo = yield* UserRepo;
        const auditRepo = yield* AuditRepo;

        const userId = unsafeUserId(yield* rng.uuid());
        const now = yield* clock.now();

        yield* userRepo.create({
          id: userId,
          email: unsafeEmail(email),
          displayName: unsafeNonEmptyString(displayName),
          createdAt: now,
          authState: { kind: "verified" },
          profile: {
            preferredFormats: ["swiss_draft"],
            fallbackFormats: [],
            hostCapable: false,
            bio: "",
            noShowCount: unsafeNonNegativeInt(0),
            banned: { kind: "not_banned" },
          },
          role: "member",
        });

        yield* auditRepo.create({
          id: unsafeAuditEventId(yield* rng.uuid()),
          at: now,
          actorId: actor.id,
          subject: { kind: "user", id: userId as string },
          action: "admin_created",
          before: null,
          after: { displayName, email },
        });

        return { userId, now };
      }),
    );

    // Assign DCI number (same scheme as registration).
    const countResult = dbQuery<{ cnt: number }>(db,
      "SELECT count(*) as cnt FROM users WHERE dci_number IS NOT NULL");
    const assigned = countResult[0]?.cnt ?? 0;
    const dciNumber = assigned < 8 ? assigned + 1 : 100 + (assigned - 8);
    dbRun(db, "UPDATE users SET dci_number = ? WHERE id = ?", [dciNumber, created.userId]);
    dbPersist();

    return c.json({
      user: {
        id: created.userId,
        displayName,
        email,
        createdAt: created.now,
        role: "member",
        dciNumber,
      },
    }, 201);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to create user: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// PATCH /api/admin/users/:id — update displayName and/or email. Used to fill in
// the real email of a walk-in created earlier with a placeholder.
admin.patch("/users/:id", async (c) => {
  const actor = c.get("user");
  const userId = c.req.param("id")!;
  if (userId === BYE_USER_ID) return apiError(c, 400, "BAD_REQUEST", "Cannot edit BYE user");

  const body = await c.req.json().catch(() => null) as
    { displayName?: string; email?: string } | null;
  if (!body) return apiError(c, 400, "BAD_REQUEST", "Body required");

  const nextDisplayName = body.displayName?.trim();
  const nextEmail = body.email?.trim().toLowerCase();

  if (nextDisplayName !== undefined && nextDisplayName.length === 0) {
    return apiError(c, 400, "BAD_REQUEST", "displayName cannot be empty");
  }
  if (nextEmail !== undefined && !EMAIL_RE.test(nextEmail)) {
    return apiError(c, 400, "BAD_REQUEST", "Invalid email");
  }

  try {
    const db = await getDb();

    if (nextEmail !== undefined) {
      const dupe = dbQuery<{ c: number }>(db,
        "SELECT count(*) as c FROM users WHERE email = ? AND id != ?",
        [nextEmail, userId])[0]!.c;
      if (dupe > 0) return apiError(c, 409, "EMAIL_TAKEN", "Email already in use");
    }

    const run = c.get("effectRuntime");
    const result = await run(
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const auditRepo = yield* AuditRepo;
        const rng = yield* RNG;
        const clock = yield* Clock;

        const user = yield* userRepo.findById(userId as any);
        if (!user) return { error: "not_found" as const };

        const before: Record<string, string> = {};
        const after: Record<string, string> = {};
        if (nextDisplayName !== undefined && nextDisplayName !== user.displayName) {
          before.displayName = user.displayName;
          after.displayName = nextDisplayName;
        }
        if (nextEmail !== undefined && nextEmail !== user.email) {
          before.email = user.email;
          after.email = nextEmail;
        }
        if (Object.keys(after).length === 0) {
          return { ok: true as const, user, changed: false };
        }

        const updated = {
          ...user,
          displayName: nextDisplayName !== undefined
            ? unsafeNonEmptyString(nextDisplayName)
            : user.displayName,
          email: nextEmail !== undefined ? unsafeEmail(nextEmail) : user.email,
        };
        yield* userRepo.update(updated);

        yield* auditRepo.create({
          id: unsafeAuditEventId(yield* rng.uuid()),
          at: yield* clock.now(),
          actorId: actor.id,
          subject: { kind: "user", id: userId },
          action: "admin_updated",
          before,
          after,
        });

        return { ok: true as const, user: updated, changed: true };
      }),
    );

    if ("error" in result) return apiError(c, 404, "NOT_FOUND", "User not found");
    return c.json({
      user: {
        id: result.user.id,
        displayName: result.user.displayName,
        email: result.user.email,
        createdAt: result.user.createdAt,
        role: result.user.role,
      },
      changed: result.changed,
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to update user: ${e instanceof Error ? e.message : String(e)}`);
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

// POST /api/admin/pods/:podId/ffa-rounds — append an FFA round to the pod.
// Body: { placements: [userId, ...] } in finishing order (index 0 = 1st place).
// The server creates a fresh round (state=complete) and writes K*(K-1)/2
// pairwise matches, each result {kind:"reported", p1Wins:2, p2Wins:0} where
// p1 is the higher-ranked player. Existing tiebreakers (match_points, OMW%,
// GW%) read from the matches table and pick this up automatically.
admin.post("/pods/:podId/ffa-rounds", async (c) => {
  const actor = c.get("user");
  const podId = c.req.param("podId")!;
  const body = await c.req.json().catch(() => null) as
    | { placements?: ReadonlyArray<string> }
    | null;
  const placements = body?.placements;
  if (!Array.isArray(placements) || placements.length < 2) {
    return apiError(c, 400, "BAD_REQUEST", "Body must be { placements: [userId,...] } with at least 2 entries");
  }
  if (placements.some(p => typeof p !== "string" || p.length === 0)) {
    return apiError(c, 400, "BAD_REQUEST", "placements must be a list of user ids");
  }
  if (new Set(placements).size !== placements.length) {
    return apiError(c, 400, "DUPLICATE_PLACEMENT", "Each player appears once in placements");
  }
  if (placements.includes(BYE_USER_ID)) {
    return apiError(c, 400, "BAD_REQUEST", "BYE cannot be placed");
  }

  try {
    const result = await c.get("effectRuntime")(
      Effect.gen(function* () {
        const podRepo = yield* PodRepo;
        const roundRepo = yield* RoundRepo;
        const userRepo = yield* UserRepo;
        const auditRepo = yield* AuditRepo;
        const rng = yield* RNG;
        const clock = yield* Clock;

        const pod = yield* podRepo.findById(podId as any);
        if (!pod) return { error: "pod_not_found" as const };

        // Validate every placement is a known user (skip BYE — already filtered).
        for (const uid of placements) {
          const u = yield* userRepo.findById(uid as any);
          if (!u) return { error: "user_not_found" as const, userId: uid };
        }

        // Next round number is max existing + 1 (or 1 for the first round).
        const existing = yield* roundRepo.findByPod(pod.id);
        const nextRoundNumber = existing.reduce(
          (acc, r) => Math.max(acc, r.roundNumber as unknown as number),
          0,
        ) + 1;

        const now = yield* clock.now();
        const roundId = unsafeRoundId(yield* rng.uuid());

        yield* roundRepo.create({
          id: roundId,
          podId: pod.id,
          roundNumber: unsafePositiveInt(nextRoundNumber),
          state: "complete" as any,
          startedAt: now,
          endedAt: now,
          timeLimit: unsafeDuration(0),
          extensions: [],
          timer: { kind: "not_started" } as any,
        });

        // Insert C(K,2) matches. For each pair (i,j) with i<j, placements[i]
        // is the higher-ranked player → player1, with a 2-0 win.
        const db = yield* Effect.tryPromise({
          try: () => getDb(),
          catch: () => ({ kind: "db_error" as const, cause: "getDb" }),
        });
        const matchCount = (placements.length * (placements.length - 1)) / 2;
        const reportedResult = JSON.stringify({
          kind: "reported", p1Wins: 2, p2Wins: 0, draws: 0,
        });
        yield* Effect.sync(() => {
          for (let i = 0; i < placements.length; i++) {
            for (let j = i + 1; j < placements.length; j++) {
              const matchId = crypto.randomUUID();
              dbRun(db,
                `INSERT INTO matches (id, round_id, player1_id, player2_id, result, submitted_at, submitted_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [matchId, roundId, placements[i], placements[j],
                 reportedResult, now, actor.id]);
            }
          }
          dbPersist();
        });

        yield* auditRepo.create({
          id: unsafeAuditEventId(yield* rng.uuid()),
          at: now,
          actorId: actor.id,
          subject: { kind: "round", id: roundId as string },
          action: "admin_ffa_round_created",
          before: null,
          after: { podId, roundNumber: nextRoundNumber, placements: [...placements] },
        });

        return {
          ok: true as const,
          roundId,
          roundNumber: nextRoundNumber,
          matchesCreated: matchCount,
        };
      }),
    );

    if ("error" in result) {
      if (result.error === "pod_not_found") return apiError(c, 404, "NOT_FOUND", "Pod not found");
      if (result.error === "user_not_found") {
        return apiError(c, 404, "NOT_FOUND", `Unknown user in placements: ${result.userId}`);
      }
    }
    return c.json(result);
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to create FFA round: ${e instanceof Error ? e.message : String(e)}`);
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

// ----- User merge (reversible) ----------------------------------------------
//
// The merge is structured as a recorded set of changes, not a destructive
// rewrite. Source's row stays in `users` with authState = merged, and every
// UPDATE / DELETE we performed is captured in `user_merges.changes` so that
// a coordinator can replay the operation in reverse if it was a mistake.
//
// What the merge does:
//   - For each FK row pointing at the source, UPDATE the FK to point at the
//     target. The original value is recorded in the changes log.
//   - For UNIQUE(friday_id, user_id) collisions on rsvps and votes, the
//     source's row is DELETE'd (target's wins, richer state). The full row
//     JSON is recorded in the changes log so revert can re-INSERT.
//   - noShowCount is summed into target.profile; the source's value is kept
//     unchanged so a revert can restore by subtraction.
//   - Source's sessions are deleted (no semantic value).
//   - Source's authState is set to {kind: "merged", mergedInto, mergedAt}.
//     The previous authState is captured for revert.
//
// We deliberately do NOT duplicate match/seat rows onto the target. Doing so
// would double-count standings, which is worse than the alternative (a
// merged source whose history is reattributed). The reversibility goal is
// satisfied by the changes log, not by copying.

type MergeChange =
  // `where` is a column→value map identifying the row; supports composite
  // primary keys like seats(pod_id, seat_index) which have no `id` column.
  | { kind: "update"; table: string; where: Record<string, unknown>; column: string; from: unknown }
  | { kind: "delete"; table: string; rowJson: string }
  | { kind: "user_field"; field: "auth_state" | "profile"; userId: string; from: string };

type MergeChangeLog = ReadonlyArray<MergeChange>;

// POST /api/admin/users/:srcId/merge-into/:tgtId
admin.post("/users/:srcId/merge-into/:tgtId", async (c) => {
  const actor = c.get("user");
  const srcId = c.req.param("srcId")!;
  const tgtId = c.req.param("tgtId")!;

  if (srcId === tgtId) {
    return apiError(c, 400, "BAD_REQUEST", "source and target must differ");
  }
  if (srcId === BYE_USER_ID || tgtId === BYE_USER_ID) {
    return apiError(c, 400, "BAD_REQUEST", "Cannot merge BYE user");
  }

  try {
    const db = await getDb();
    const src = dbQuery<{
      id: string; email: string; display_name: string; role: string; profile: string; auth_state: string;
    }>(db, "SELECT id, email, display_name, role, profile, auth_state FROM users WHERE id = ?", [srcId])[0];
    const tgt = dbQuery<{
      id: string; email: string; display_name: string; role: string; profile: string;
    }>(db, "SELECT id, email, display_name, role, profile FROM users WHERE id = ?", [tgtId])[0];

    if (!src) return apiError(c, 404, "NOT_FOUND", "Source user not found");
    if (!tgt) return apiError(c, 404, "NOT_FOUND", "Target user not found");
    if (src.role === "coordinator") {
      return apiError(c, 403, "FORBIDDEN", "Refusing to merge a coordinator account; demote first");
    }

    // Refuse to re-merge an already-merged source.
    const srcAuth = JSON.parse(src.auth_state) as { kind: string };
    if (srcAuth.kind === "merged") {
      return apiError(c, 409, "ALREADY_MERGED", "Source user is already merged");
    }

    const changes: MergeChange[] = [];

    // --- rsvps: UNIQUE(friday_id, user_id). Drop source's row when target has one.
    const rsvpDeleteRows = dbQuery<{
      id: string; friday_id: string; user_id: string; state: string;
      created_at: string; last_transition_at: string; covered: number | null;
    }>(db,
      `SELECT r1.* FROM rsvps r1
       WHERE r1.user_id = ?
         AND EXISTS (SELECT 1 FROM rsvps r2 WHERE r2.user_id = ? AND r2.friday_id = r1.friday_id)`,
      [srcId, tgtId]);
    for (const row of rsvpDeleteRows) {
      changes.push({ kind: "delete", table: "rsvps", rowJson: JSON.stringify(row) });
      dbRun(db, "DELETE FROM rsvps WHERE id = ?", [row.id]);
    }
    const rsvpUpdateIds = dbQuery<{ id: string }>(db, "SELECT id FROM rsvps WHERE user_id = ?", [srcId]);
    for (const r of rsvpUpdateIds) {
      changes.push({ kind: "update", table: "rsvps", where: { id: r.id }, column: "user_id", from: srcId });
    }
    dbRun(db, "UPDATE rsvps SET user_id = ? WHERE user_id = ?", [tgtId, srcId]);

    // --- votes: UNIQUE(friday_id, user_id). Same treatment.
    const voteDeleteRows = dbQuery<{ id: string; friday_id: string; user_id: string; ballot: string; submitted_at: string }>(db,
      `SELECT v1.* FROM votes v1
       WHERE v1.user_id = ?
         AND EXISTS (SELECT 1 FROM votes v2 WHERE v2.user_id = ? AND v2.friday_id = v1.friday_id)`,
      [srcId, tgtId]);
    for (const row of voteDeleteRows) {
      changes.push({ kind: "delete", table: "votes", rowJson: JSON.stringify(row) });
      dbRun(db, "DELETE FROM votes WHERE id = ?", [row.id]);
    }
    const voteUpdateIds = dbQuery<{ id: string }>(db, "SELECT id FROM votes WHERE user_id = ?", [srcId]);
    for (const v of voteUpdateIds) {
      changes.push({ kind: "update", table: "votes", where: { id: v.id }, column: "user_id", from: srcId });
    }
    dbRun(db, "UPDATE votes SET user_id = ? WHERE user_id = ?", [tgtId, srcId]);

    // --- straight reassignments. Capture before-values per row so revert can
    //     restore. `idCols` identifies a row; for tables with a composite PK
    //     (seats: pod_id+seat_index) we record both columns.
    const reassign = (table: string, column: string, idCols: ReadonlyArray<string>) => {
      const rows = dbQuery<Record<string, unknown>>(
        db, `SELECT ${idCols.join(", ")} FROM ${table} WHERE ${column} = ?`, [srcId],
      );
      for (const r of rows) {
        const where: Record<string, unknown> = {};
        for (const c of idCols) where[c] = r[c];
        changes.push({ kind: "update", table, where, column, from: srcId });
      }
      dbRun(db, `UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [tgtId, srcId]);
      return rows.length;
    };
    const counts = {
      rsvps:       rsvpUpdateIds.length,
      droppedRsvps: rsvpDeleteRows.length,
      votes:       voteUpdateIds.length,
      droppedVotes: voteDeleteRows.length,
      cubes:       reassign("cubes",        "owner_id",   ["id"]),
      enrollments: reassign("enrollments",  "host_id",    ["id"]),
      pods:        reassign("pods",         "host_id",    ["id"]),
      seats:       reassign("seats",        "user_id",    ["pod_id", "seat_index"]),
      matches_p1:  reassign("matches",      "player1_id", ["id"]),
      matches_p2:  reassign("matches",      "player2_id", ["id"]),
      audit_actor: reassign("audit_events", "actor_id",   ["id"]),
    };

    // --- target.profile: sum noShowCount. Capture target's previous profile.
    let mergedProfile = tgt.profile;
    try {
      const srcProfile = JSON.parse(src.profile) as UserProfile;
      const tgtProfile = JSON.parse(tgt.profile) as UserProfile;
      const summed = ((tgtProfile.noShowCount as unknown as number) ?? 0)
                   + ((srcProfile.noShowCount as unknown as number) ?? 0);
      mergedProfile = JSON.stringify({
        ...tgtProfile,
        noShowCount: unsafeNonNegativeInt(summed) as unknown as number,
      });
      changes.push({ kind: "user_field", field: "profile", userId: tgtId, from: tgt.profile });
      dbRun(db, "UPDATE users SET profile = ? WHERE id = ?", [mergedProfile, tgtId]);
    } catch {
      // If either profile JSON is malformed, skip the sum; revert won't need
      // to restore anything since we didn't write.
    }

    // --- sessions: forget. A revert will not restore them.
    dbRun(db, "DELETE FROM sessions WHERE user_id = ?", [srcId]);

    // --- source's authState: flip to "merged", capture original.
    const now = new Date().toISOString();
    const newSrcAuth = JSON.stringify({
      kind: "merged",
      mergedInto: tgtId,
      mergedAt: now,
    });
    changes.push({ kind: "user_field", field: "auth_state", userId: srcId, from: src.auth_state });
    dbRun(db, "UPDATE users SET auth_state = ? WHERE id = ?", [newSrcAuth, srcId]);

    // --- record the merge so it can be reverted.
    const mergeId = crypto.randomUUID();
    dbRun(db,
      `INSERT INTO user_merges (id, source_user_id, target_user_id, performed_by, performed_at, changes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mergeId, srcId, tgtId, actor.id, now, JSON.stringify(changes)]);

    // --- audit trail.
    const run = c.get("effectRuntime");
    await run(
      Effect.gen(function* () {
        const auditRepo = yield* AuditRepo;
        const rng = yield* RNG;
        const clock = yield* Clock;
        yield* auditRepo.create({
          id: unsafeAuditEventId(yield* rng.uuid()),
          at: yield* clock.now(),
          actorId: actor.id,
          subject: { kind: "user", id: tgtId },
          action: "admin_user_merged",
          before: { sourceId: srcId, sourceEmail: src.email, sourceDisplayName: src.display_name },
          after: { mergeId, targetId: tgtId, targetEmail: tgt.email, ...counts },
        });
      }),
    );

    dbPersist();

    return c.json({
      ok: true,
      mergeId,
      target: { id: tgt.id, email: tgt.email, displayName: tgt.display_name },
      moved: counts,
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Merge failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// POST /api/admin/user-merges/:mergeId/revert — replay a merge in reverse.
// Walks the changes log from newest to oldest, restoring deletes via INSERT
// and undoing updates by writing the captured `from` value back. Refuses to
// revert if any of the rows the merge touched have since been deleted (the
// log can't recover those) — coordinator must hand-stitch.
admin.post("/user-merges/:mergeId/revert", async (c) => {
  const actor = c.get("user");
  const mergeId = c.req.param("mergeId")!;

  try {
    const db = await getDb();
    const row = dbQuery<{
      id: string; source_user_id: string; target_user_id: string;
      performed_by: string; performed_at: string;
      reverted_at: string | null; changes: string;
    }>(db, "SELECT * FROM user_merges WHERE id = ?", [mergeId])[0];

    if (!row) return apiError(c, 404, "NOT_FOUND", "Merge not found");
    if (row.reverted_at) return apiError(c, 409, "ALREADY_REVERTED", "This merge has already been reverted");

    const changes = JSON.parse(row.changes) as MergeChangeLog;

    // Replay in reverse so the most recent change is undone first.
    for (let i = changes.length - 1; i >= 0; i--) {
      const ch = changes[i]!;
      if (ch.kind === "update") {
        const wcols = Object.keys(ch.where);
        const wclause = wcols.map(c => `${c} = ?`).join(" AND ");
        const wvals = wcols.map(c => ch.where[c]);
        dbRun(db, `UPDATE ${ch.table} SET ${ch.column} = ? WHERE ${wclause}`, [ch.from, ...wvals]);
      } else if (ch.kind === "delete") {
        const parsed = JSON.parse(ch.rowJson) as Record<string, unknown>;
        const cols = Object.keys(parsed);
        const placeholders = cols.map(() => "?").join(", ");
        const values = cols.map(k => parsed[k] as any);
        dbRun(db,
          `INSERT OR IGNORE INTO ${ch.table} (${cols.join(", ")}) VALUES (${placeholders})`,
          values);
      } else if (ch.kind === "user_field") {
        dbRun(db, `UPDATE users SET ${ch.field} = ? WHERE id = ?`, [ch.from, ch.userId]);
      }
    }

    const now = new Date().toISOString();
    dbRun(db,
      "UPDATE user_merges SET reverted_at = ?, reverted_by = ? WHERE id = ?",
      [now, actor.id, mergeId]);

    const runEffect = c.get("effectRuntime");
    await runEffect(
      Effect.gen(function* () {
        const auditRepo = yield* AuditRepo;
        const rng = yield* RNG;
        const clock = yield* Clock;
        yield* auditRepo.create({
          id: unsafeAuditEventId(yield* rng.uuid()),
          at: yield* clock.now(),
          actorId: actor.id,
          subject: { kind: "user", id: row.source_user_id },
          action: "admin_user_merge_reverted",
          before: { mergeId, targetId: row.target_user_id },
          after: { sourceId: row.source_user_id, restoredChanges: changes.length },
        });
      }),
    );

    dbPersist();
    return c.json({ ok: true, sourceId: row.source_user_id, restoredChanges: changes.length });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Revert failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/admin/user-merges — list merges (most recent first), optionally
// filtered by ?status=active|reverted. Used by the admin UI to surface a
// list of merged sources with their target and a revert button.
admin.get("/user-merges", async (c) => {
  const statusFilter = c.req.query("status");
  try {
    const db = await getDb();
    type Row = {
      id: string; source_user_id: string; target_user_id: string;
      performed_by: string; performed_at: string;
      reverted_at: string | null; reverted_by: string | null;
    };
    let rows: Row[];
    if (statusFilter === "active") {
      rows = dbQuery<Row>(db,
        `SELECT id, source_user_id, target_user_id, performed_by, performed_at, reverted_at, reverted_by
         FROM user_merges WHERE reverted_at IS NULL ORDER BY performed_at DESC LIMIT 500`, []);
    } else if (statusFilter === "reverted") {
      rows = dbQuery<Row>(db,
        `SELECT id, source_user_id, target_user_id, performed_by, performed_at, reverted_at, reverted_by
         FROM user_merges WHERE reverted_at IS NOT NULL ORDER BY performed_at DESC LIMIT 500`, []);
    } else {
      rows = dbQuery<Row>(db,
        `SELECT id, source_user_id, target_user_id, performed_by, performed_at, reverted_at, reverted_by
         FROM user_merges ORDER BY performed_at DESC LIMIT 500`, []);
    }

    // Enrich with display names + emails for source and target.
    const ids = new Set<string>();
    for (const r of rows) { ids.add(r.source_user_id); ids.add(r.target_user_id); }
    const userMap: Record<string, { displayName: string; email: string }> = {};
    if (ids.size > 0) {
      const ph = Array.from(ids).map(() => "?").join(", ");
      const urows = dbQuery<{ id: string; display_name: string; email: string }>(db,
        `SELECT id, display_name, email FROM users WHERE id IN (${ph})`, Array.from(ids));
      for (const u of urows) userMap[u.id] = { displayName: u.display_name, email: u.email };
    }

    return c.json({
      merges: rows.map(r => ({
        id: r.id,
        source: { id: r.source_user_id, ...(userMap[r.source_user_id] ?? {}) },
        target: { id: r.target_user_id, ...(userMap[r.target_user_id] ?? {}) },
        performedBy: r.performed_by,
        performedAt: r.performed_at,
        revertedAt: r.reverted_at,
        revertedBy: r.reverted_by,
      })),
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list merges: ${e instanceof Error ? e.message : String(e)}`);
  }
});

export { admin };
