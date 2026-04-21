/**
 * Scheduler — grace-period lock timers + periodic cron emails.
 *
 * Grace flow:
 *   RSVP pairs up → both "confirmed" → 30-min timer per person.
 *   During grace: can withdraw.  After grace: runMatching() locks them, sends email.
 *
 * Cron emails (London time):
 *   - Cube announcement: when Friday reaches "locked"/"confirmed" state
 *   - Friday 09:00: morning reminder (locked = cube info, pending = find a +1)
 *   - Friday 16:30: "get out of the office" reminder to locked-in players
 */

import { getDb, query, run as dbRun, persist } from "./db/sqlite.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function lockDelay(): number {
  return process.env.TEST_MODE === "true" ? 60 * 1000 : 30 * 60 * 1000;
}

function sendgridKey(): string { return process.env.SENDGRID_API_KEY ?? ""; }
function fromEmail(): string { return process.env.FROM_EMAIL ?? "noreply@cube.london"; }
function appUrl(): string { return process.env.APP_URL ?? "https://north.cube.london"; }
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

  // Ensure even count — the most-recent waits for a partner
  const batch = [...lockable];
  if (batch.length % 2 !== 0) batch.pop();
  if (batch.length === 0) return;

  const now = new Date().toISOString();
  for (const r of batch) {
    dbRun(db,
      "UPDATE rsvps SET state = 'locked', last_transition_at = ? WHERE id = ? AND state = 'confirmed'",
      [now, r.id]);
  }
  persist();

  for (const r of batch) {
    await sendLockEmail(r.user_id, fridayId).catch(e =>
      console.error("Lock email failed:", e));
  }
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

async function sendEmail(to: string, subject: string, body: string) {
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

  await sendEmail(user[0].email,
    `You're locked in for ${fri[0].date}`,
    `Hi ${user[0].display_name},\n\nYou're locked in for Friday ${fri[0].date} at Owl & Hitchhiker.\n\nRSVP'd at: ${rsvpTime}\nDoors: 18:30\nP1P1: 18:45\n\nThis is a commitment to attend. See you there!\n\n${appUrl()}\n\n— Cubehall`);
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
      await sendEmail(a.email,
        `Cubes for ${fri.date}`,
        `Hi ${a.display_name},\n\nThe cubes for Friday ${fri.date} have been decided:\n\n${cubeList}\n\nDoors: 18:30 | P1P1: 18:45\n\n${appUrl()}\n\n— Cubehall`);
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
        await sendEmail(a.email,
          `Tonight: ${cubeNames}`,
          `Hi ${a.display_name},\n\nReminder: you're playing tonight!\n\nCubes: ${cubeNames}\nDoors: 18:30 | P1P1: 18:45\nOWL & Hitchhiker\n\nSee you there!\n\n${appUrl()}\n\n— Cubehall`);
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
        await sendEmail(a.email,
          `Find a +1 for tonight!`,
          `Hi ${a.display_name},\n\nYou're on the waitlist for tonight's cube draft. RSVPs work in pairs — if you can find a friend to register and RSVP, you'll both be paired up and locked in!\n\nShare this link: ${appUrl()}/register\n\nDoors: 18:30 | P1P1: 18:45\nOWL & Hitchhiker\n\n${appUrl()}\n\n— Cubehall`);
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
      await sendEmail(a.email,
        `Get out of the office!`,
        `Hi ${a.display_name},\n\nLeave by 17:00 to catch the game tonight!\n\nP1P1 is at 18:45 — doors open 18:30 at Owl & Hitchhiker.\n\nSee you soon!\n\n${appUrl()}\n\n— Cubehall`);
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

// ---------------------------------------------------------------------------
// Periodic tick + recovery
// ---------------------------------------------------------------------------

let cronInterval: NodeJS.Timeout | null = null;

async function tick() {
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

  // Only run time-based reminders on Fridays (day 5)
  if (getLondonDayOfWeek() === 5) {
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

export async function startScheduler() {
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
