/**
 * Scheduler — grace-period lock timers + periodic cron emails.
 *
 * Grace flow:
 *   RSVP pairs up → both "confirmed" → 30-min timer per person.
 *   During grace: can withdraw.  After grace: runMatching() locks them, sends email.
 *
 * Cron emails (London time):
 *   - Cube announcement: when Friday reaches "locked"/"confirmed" state
 *   - Wednesday 09:00: midweek heads-up to locked-in players for the upcoming Friday
 *   - Wednesday 09:00–09:30: auto-promote Friday open → locked so cube announcement can fire
 *   - Friday 09:00: morning reminder (locked = cube info, pending = find a +1)
 *   - Friday 16:30: "get out of the office" reminder to locked-in players
 */

import type { Effect } from "effect";
import { getDb, query, run as dbRun, persist } from "./db/sqlite.js";
import { advanceFriday } from "./programs/friday-lifecycle.js";
import { renderEmail } from "./email-templates.js";

export type RunEffect = <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>;
let _runEffect: RunEffect | null = null;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function lockDelay(): number {
  return process.env.TEST_MODE === "true" ? 60 * 1000 : 30 * 60 * 1000;
}

function sendgridKey(): string { return process.env.SENDGRID_API_KEY ?? ""; }
function fromEmail(): string { return process.env.FROM_EMAIL ?? "noreply@cube.london"; }
export function appUrl(): string { return process.env.APP_URL ?? "https://north.cube.london"; }
function testMode(): boolean { return process.env.TEST_MODE === "true"; }
function toAddr(email: string): string { return testMode() ? "jm@memorici.de" : email; }
function subjectPrefix(): string { return testMode() ? "[TEST] " : ""; }

// ---------------------------------------------------------------------------
// Grace period timers
// ---------------------------------------------------------------------------

const graceTimers = new Map<string, NodeJS.Timeout>();

/** Schedule a lock check for one RSVP, 30 min from now. */
export function scheduleGraceLock(rsvpId: string, fridayId: string, delayMs?: number) {
  cancelGraceLock(rsvpId);
  const delay = delayMs ?? lockDelay();
  const timer = setTimeout(() => {
    graceTimers.delete(rsvpId);
    runMatching(fridayId).catch(e => console.error("Grace-lock matching failed:", e));
  }, delay);
  timer.unref();
  graceTimers.set(rsvpId, timer);
}

/** Cancel a pending grace timer (on withdrawal or demotion). */
export function cancelGraceLock(rsvpId: string) {
  const t = graceTimers.get(rsvpId);
  if (t) { clearTimeout(t); graceTimers.delete(rsvpId); }
}

// ---------------------------------------------------------------------------
// Matching algorithm — lock past-grace confirmed RSVPs in even batches
// ---------------------------------------------------------------------------

export async function runMatching(fridayId: string) {
  const db = await getDb();
  const delay = lockDelay();
  const cutoff = new Date(Date.now() - delay).toISOString();

  const lockable = query<{ id: string; user_id: string }>(db,
    `SELECT id, user_id FROM rsvps
     WHERE friday_id = ? AND state = 'confirmed' AND last_transition_at <= ?
     ORDER BY last_transition_at ASC`,
    [fridayId, cutoff]);

  if (lockable.length === 0) return;

  // Lock everyone past grace — even/odd is an RSVP-in concern, not a locking concern.
  // The pod packer handles whatever player count it gets at advance time.
  const now = new Date().toISOString();
  for (const r of lockable) {
    dbRun(db,
      "UPDATE rsvps SET state = 'locked', last_transition_at = ? WHERE id = ? AND state = 'confirmed'",
      [now, r.id]);
  }
  persist();

  for (const r of lockable) {
    await sendLockEmail(r.user_id, fridayId).catch(e =>
      console.error("Lock email failed:", e));
  }
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export async function sendEmail(to: string, subject: string, body: string) {
  const key = sendgridKey();
  if (!key) return;
  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toAddr(to) }] }],
      from: { email: fromEmail(), name: "North London Cube Community" },
      subject: `${subjectPrefix()}${subject}`,
      content: [{ type: "text/plain", value: body }],
    }),
  });
}

/** Deduplicate: returns true if this key was already sent. */
async function alreadySent(sentKey: string, fridayId: string, emailType: string): Promise<boolean> {
  const db = await getDb();
  const rows = query<{ id: string }>(db, "SELECT id FROM sent_emails WHERE id = ?", [sentKey]);
  if (rows.length > 0) return true;
  dbRun(db,
    "INSERT OR IGNORE INTO sent_emails (id, friday_id, email_type, sent_at) VALUES (?, ?, ?, ?)",
    [sentKey, fridayId, emailType, new Date().toISOString()]);
  persist();
  return false;
}

async function sendLockEmail(userId: string, fridayId: string) {
  const sentKey = `lock:${userId}:${fridayId}`;
  if (await alreadySent(sentKey, fridayId, "lock")) return;

  const db = await getDb();
  const user = query<{ email: string; display_name: string }>(db,
    "SELECT email, display_name FROM users WHERE id = ?", [userId]);
  const fri = query<{ date: string }>(db,
    "SELECT date FROM fridays WHERE id = ?", [fridayId]);
  const rsvpRow = query<{ created_at: string }>(db,
    "SELECT created_at FROM rsvps WHERE friday_id = ? AND user_id = ?", [fridayId, userId]);
  if (!user[0] || !fri[0]) return;

  const rsvpTime = rsvpRow[0]?.created_at
    ? new Date(rsvpRow[0].created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })
    : "earlier";

  const e = renderEmail("lock", {
    displayName: user[0].display_name,
    date: fri[0].date,
    cubeNames: "",
    appUrl: appUrl(),
    rsvpTime,
  });
  await sendEmail(user[0].email, e.subject, e.body);
}

// ---------------------------------------------------------------------------
// Cron emails
// ---------------------------------------------------------------------------

/** Cube announcement — sent once when Friday reaches locked/confirmed state. */
async function checkCubeAnnouncements() {
  const db = await getDb();
  // Fridays in locked or confirmed state (pods formed, cubes decided)
  const fridays = query<{ id: string; date: string; state: string }>(db,
    `SELECT id, date, json_extract(state, '$.kind') as state FROM fridays
     WHERE json_extract(state, '$.kind') IN ('locked', 'confirmed', 'in_progress')`);

  for (const fri of fridays) {
    const sentKey = `cube_announcement:${fri.id}`;
    if (await alreadySent(sentKey, fri.id, "cube_announcement")) continue;

    // Get cubes from pods
    const pods = query<{ cube_id: string }>(db,
      "SELECT cube_id FROM pods WHERE friday_id = ?", [fri.id]);
    const cubeIds = pods.map(p => p.cube_id);
    if (cubeIds.length === 0) continue;

    const cubes = query<{ name: string; supported_formats: string; card_count: number }>(db,
      `SELECT name, supported_formats, card_count FROM cubes WHERE id IN (${cubeIds.map(() => "?").join(",")})`,
      cubeIds);

    const cubeList = cubes.map(c => {
      const fmts = JSON.parse(c.supported_formats || "[]").join(", ");
      return `  - ${c.name} (${fmts}, ${c.card_count} cards)`;
    }).join("\n");

    // Send to all locked-in attendees
    const attendees = query<{ email: string; display_name: string }>(db,
      `SELECT u.email, u.display_name FROM rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.friday_id = ? AND r.state IN ('locked', 'seated')`,
      [fri.id]);

    for (const a of attendees) {
      const e = renderEmail("cube_announcement", {
        displayName: a.display_name,
        date: fri.date,
        cubeNames: cubeList,
        appUrl: appUrl(),
      });
      await sendEmail(a.email, e.subject, e.body);
    }
  }
}

/**
 * Wednesday 09:00–09:30 London — auto-promote open Friday to locked so the
 * cube announcement email can fire. The simplified state machine collapses
 * vote/enrollment_closed into the open → locked transition, so we only need
 * to advance from `open`. Stops on no-progress. Capped iterations.
 */
async function checkFridayAutoPromote() {
  if (!_runEffect) return;
  const londonHour = getLondonHour();
  const londonMinute = getLondonMinute();
  if (londonHour !== 9 || londonMinute > 30) return;

  const db = await getDb();
  const fridayDate = addDays(getLondonDate(), 2);
  const fridays = query<{ id: string; kind: string }>(db,
    `SELECT id, json_extract(state, '$.kind') AS kind FROM fridays WHERE date = ?`,
    [fridayDate]);

  const advancing: ReadonlySet<string> = new Set(["open"]);

  for (const fri of fridays) {
    let kind = fri.kind;
    for (let safety = 0; safety < 5; safety++) {
      if (!advancing.has(kind)) break;
      try {
        await _runEffect(advanceFriday(fri.id));
      } catch (e) {
        console.error("Friday auto-promote failed:", { fridayId: fri.id, kind, e });
        break;
      }
      const re = query<{ kind: string }>(db,
        `SELECT json_extract(state, '$.kind') AS kind FROM fridays WHERE id = ?`,
        [fri.id]);
      const newKind = re[0]?.kind ?? kind;
      if (newKind === kind) break;
      kind = newKind;
    }
  }
}

/** Wednesday 09:00 London — midweek heads-up to locked-in players for the upcoming Friday. */
export async function checkWednesdayReminder() {
  const londonHour = getLondonHour();
  const londonMinute = getLondonMinute();
  if (londonHour !== 9 || londonMinute > 5) return;

  const db = await getDb();
  const fridayDate = addDays(getLondonDate(), 2);

  const fridays = query<{ id: string; date: string }>(db,
    "SELECT id, date FROM fridays WHERE date = ?", [fridayDate]);

  for (const fri of fridays) {
    const sentKey = `wednesday:${fri.id}`;
    if (await alreadySent(sentKey, fri.id, "wednesday")) continue;

    const pods = query<{ cube_id: string }>(db,
      "SELECT cube_id FROM pods WHERE friday_id = ?", [fri.id]);
    const cubeIds = pods.map(p => p.cube_id);
    let cubeNames = "TBD";
    if (cubeIds.length > 0) {
      const cubes = query<{ name: string }>(db,
        `SELECT name FROM cubes WHERE id IN (${cubeIds.map(() => "?").join(",")})`, cubeIds);
      cubeNames = cubes.map(c => c.name).join(", ");
    } else {
      const enrolls = query<{ name: string }>(db,
        `SELECT c.name FROM enrollments e JOIN cubes c ON c.id = e.cube_id
         WHERE e.friday_id = ? AND e.withdrawn = 0`, [fri.id]);
      if (enrolls.length > 0) cubeNames = enrolls.map(e => e.name).join(", ");
    }

    const locked = query<{ email: string; display_name: string }>(db,
      `SELECT u.email, u.display_name FROM rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.friday_id = ? AND r.state IN ('locked', 'seated')`,
      [fri.id]);

    for (const a of locked) {
      const e = renderEmail("wednesday", {
        displayName: a.display_name,
        date: fri.date,
        cubeNames,
        appUrl: appUrl(),
      });
      await sendEmail(a.email, e.subject, e.body);
    }
  }
}

/** Friday morning reminder (09:00 London). */
async function checkMorningReminder() {
  const londonHour = getLondonHour();
  const londonMinute = getLondonMinute();
  if (londonHour !== 9 || londonMinute > 5) return; // Only fire 09:00–09:05

  const db = await getDb();
  const today = getLondonDate();

  const fridays = query<{ id: string; date: string }>(db,
    "SELECT id, date FROM fridays WHERE date = ?", [today]);

  for (const fri of fridays) {
    // Locked-in attendees: remind about cubes
    const lockedKey = `morning_locked:${fri.id}`;
    if (!(await alreadySent(lockedKey, fri.id, "morning_locked"))) {
      const pods = query<{ cube_id: string }>(db,
        "SELECT cube_id FROM pods WHERE friday_id = ?", [fri.id]);
      const cubeIds = pods.map(p => p.cube_id);
      const cubes = cubeIds.length > 0
        ? query<{ name: string }>(db,
            `SELECT name FROM cubes WHERE id IN (${cubeIds.map(() => "?").join(",")})`, cubeIds)
        : [];
      const cubeNames = cubes.map(c => c.name).join(", ") || "TBD";

      const locked = query<{ email: string; display_name: string }>(db,
        `SELECT u.email, u.display_name FROM rsvps r
         JOIN users u ON u.id = r.user_id
         WHERE r.friday_id = ? AND r.state IN ('locked', 'seated')`,
        [fri.id]);

      for (const a of locked) {
        const e = renderEmail("morning_locked", {
          displayName: a.display_name,
          date: fri.date,
          cubeNames,
          appUrl: appUrl(),
        });
        await sendEmail(a.email, e.subject, e.body);
      }
    }

    // Pending attendees: encourage to find a +1
    const pendingKey = `morning_pending:${fri.id}`;
    if (!(await alreadySent(pendingKey, fri.id, "morning_pending"))) {
      const pending = query<{ email: string; display_name: string }>(db,
        `SELECT u.email, u.display_name FROM rsvps r
         JOIN users u ON u.id = r.user_id
         WHERE r.friday_id = ? AND r.state = 'pending'`,
        [fri.id]);

      for (const a of pending) {
        const e = renderEmail("morning_pending", {
          displayName: a.display_name,
          date: fri.date,
          cubeNames: "",
          appUrl: appUrl(),
        });
        await sendEmail(a.email, e.subject, e.body);
      }
    }
  }
}

/** Friday 16:30 reminder (London). */
async function checkAfternoonReminder() {
  const londonHour = getLondonHour();
  const londonMinute = getLondonMinute();
  if (londonHour !== 16 || londonMinute < 25 || londonMinute > 35) return; // 16:25–16:35

  const db = await getDb();
  const today = getLondonDate();

  const fridays = query<{ id: string; date: string }>(db,
    "SELECT id, date FROM fridays WHERE date = ?", [today]);

  for (const fri of fridays) {
    const sentKey = `afternoon:${fri.id}`;
    if (await alreadySent(sentKey, fri.id, "afternoon")) continue;

    const locked = query<{ email: string; display_name: string }>(db,
      `SELECT u.email, u.display_name FROM rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.friday_id = ? AND r.state IN ('locked', 'seated')`,
      [fri.id]);

    for (const a of locked) {
      const e = renderEmail("afternoon", {
        displayName: a.display_name,
        date: fri.date,
        cubeNames: "",
        appUrl: appUrl(),
      });
      await sendEmail(a.email, e.subject, e.body);
    }
  }
}

// ---------------------------------------------------------------------------
// London time helpers
// ---------------------------------------------------------------------------

function getLondonHour(): number {
  return parseInt(new Date().toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }), 10);
}
function getLondonMinute(): number {
  return parseInt(new Date().toLocaleString("en-GB", { timeZone: "Europe/London", minute: "2-digit" }), 10);
}
function getLondonDate(): string {
  // Returns YYYY-MM-DD in London timezone
  const parts = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return parts; // en-CA gives YYYY-MM-DD format
}
function getLondonDayOfWeek(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" })).getDay();
}
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Periodic tick + recovery
// ---------------------------------------------------------------------------

let cronInterval: NodeJS.Timeout | null = null;

/**
 * Hard-delete user rows in pending_verification state that were created more
 * than PENDING_TTL_MS ago. Keeps the directory and DCI sequence clean when
 * scripted registration attempts pile up. Pending users have not verified an
 * email so they cannot own cubes / RSVPs / sessions — the row is safe to drop.
 */
const PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour

async function gcPendingUsers() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const stale = query<{ id: string; email: string }>(
    db,
    `SELECT id, email FROM users
     WHERE json_extract(auth_state, '$.kind') = 'pending_verification'
       AND created_at < ?`,
    [cutoff],
  );
  if (stale.length === 0) return;
  for (const u of stale) {
    dbRun(db, "DELETE FROM users WHERE id = ?", [u.id]);
  }
  persist();
  console.log(`gcPendingUsers: removed ${stale.length} stale pending registrations`);
}

async function tick() {
  // 0. If odd-events are allowed, sweep up any orphaned pending RSVPs and
  //    promote them to confirmed so they enter the normal grace flow.
  //    Catches RSVPs created before the toggle was flipped on.
  try {
    const { getBoolSetting, SETTING_ODD_EVENTS_ALLOWED } = await import("./settings.js");
    if (await getBoolSetting(SETTING_ODD_EVENTS_ALLOWED)) {
      const db = await getDb();
      const now = new Date().toISOString();
      const pending = query<{ id: string; friday_id: string }>(db,
        "SELECT id, friday_id FROM rsvps WHERE state = 'pending'");
      for (const r of pending) {
        dbRun(db,
          "UPDATE rsvps SET state = 'confirmed', last_transition_at = ? WHERE id = ? AND state = 'pending'",
          [now, r.id]);
        scheduleGraceLock(r.id, r.friday_id);
      }
      if (pending.length > 0) persist();
    }
  } catch (e) { console.error("Pending-sweep failed:", e); }

  // 1. Check for confirmed RSVPs past grace → run matching per friday
  try {
    const db = await getDb();
    const delay = lockDelay();
    const cutoff = new Date(Date.now() - delay).toISOString();
    const fridays = query<{ friday_id: string }>(db,
      `SELECT DISTINCT friday_id FROM rsvps
       WHERE state = 'confirmed' AND last_transition_at <= ?`,
      [cutoff]);
    for (const f of fridays) {
      await runMatching(f.friday_id);
    }
  } catch (e) { console.error("Grace period check failed:", e); }

  // 2. Cron emails
  try { await checkCubeAnnouncements(); } catch (e) { console.error("Cube announcement check failed:", e); }

  // 3. Garbage-collect unverified registrations older than the TTL.
  try { await gcPendingUsers(); } catch (e) { console.error("Pending-user GC failed:", e); }

  // Day-of-week-gated reminders
  const dow = getLondonDayOfWeek();
  if (dow === 3) {
    try { await checkWednesdayReminder(); } catch (e) { console.error("Wednesday reminder failed:", e); }
    try { await checkFridayAutoPromote(); } catch (e) { console.error("Friday auto-promote check failed:", e); }
  }
  if (dow === 5) {
    try { await checkMorningReminder(); } catch (e) { console.error("Morning reminder failed:", e); }
    try { await checkAfternoonReminder(); } catch (e) { console.error("Afternoon reminder failed:", e); }
  }
}

/** Recover grace timers for confirmed RSVPs on startup. */
async function recoverGraceTimers() {
  const db = await getDb();
  const confirmed = query<{ id: string; friday_id: string; last_transition_at: string }>(db,
    "SELECT id, friday_id, last_transition_at FROM rsvps WHERE state = 'confirmed'");

  const delay = lockDelay();
  const now = Date.now();

  for (const r of confirmed) {
    const confirmedAt = new Date(r.last_transition_at).getTime();
    const remaining = (confirmedAt + delay) - now;
    if (remaining <= 0) {
      // Past grace — will be caught by the immediate tick
    } else {
      scheduleGraceLock(r.id, r.friday_id, remaining);
    }
  }
}

export async function startScheduler(runEffect?: RunEffect) {
  if (runEffect) _runEffect = runEffect;
  await recoverGraceTimers();

  // Run immediately, then every 60s
  tick().catch(e => console.error("Initial scheduler tick failed:", e));
  cronInterval = setInterval(() => {
    tick().catch(e => console.error("Scheduler tick failed:", e));
  }, 60_000);
  cronInterval.unref();

  console.log("Scheduler started (grace timers + cron emails)");
}

export function stopScheduler() {
  if (cronInterval) { clearInterval(cronInterval); cronInterval = null; }
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear();
}
