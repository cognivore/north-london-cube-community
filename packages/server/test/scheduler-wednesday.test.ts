/**
 * Smoke test: Wednesday 09:00 London reminder fires for locked RSVPs of an
 * upcoming Friday two days out, populates sent_emails dedupe, and is idempotent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ORIGINAL_ENV = { ...process.env };

let tmpDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubehall-sched-"));
  process.env.DATA_DIR = tmpDir;
  process.env.SENDGRID_API_KEY = "SG.test.fake";
  process.env.FROM_EMAIL = "noreply@test.local";
  process.env.APP_URL = "https://test.local";
  delete process.env.TEST_MODE;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Reset the singleton db before next test
  const sqlite = await import("../src/db/sqlite.js");
  sqlite.close();
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 09:00 London on Wed 2026-05-06 (BST = UTC+1) → 08:00 UTC
const WED_0900_LONDON_UTC = new Date("2026-05-06T08:00:00.000Z");
const NEXT_FRIDAY = "2026-05-08";

async function seed(opts: { withCubeEnrollment?: boolean } = {}) {
  const sqlite = await import("../src/db/sqlite.js");
  const db = await sqlite.getDb();
  const now = "2026-04-21T12:00:00.000Z";

  sqlite.run(db,
    `INSERT INTO venues (id, name, address, capacity, max_pods, house_credit_per_player, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["v1", "Owl", "123 St", 16, 2, 700, 1]);

  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-alice", "alice@test.local", "Alice", now, "member"]);
  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-bob", "bob@test.local", "Bob", now, "member"]);

  sqlite.run(db,
    `INSERT INTO fridays (id, date, venue_id, state, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["f1", NEXT_FRIDAY, "v1", '{"kind":"open"}', now]);

  sqlite.run(db,
    `INSERT INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["r1", "f1", "u-alice", "locked", now, now]);
  sqlite.run(db,
    `INSERT INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["r2", "f1", "u-bob", "locked", now, now]);

  if (opts.withCubeEnrollment) {
    sqlite.run(db,
      `INSERT INTO cubes (id, owner_id, name, cubecobra_url)
       VALUES (?, ?, ?, ?)`,
      ["c1", "u-alice", "Ye Olde Cube", "https://cubecobra.com/cube/overview/abc"]);
    sqlite.run(db,
      `INSERT INTO enrollments (id, friday_id, cube_id, host_id, created_at, withdrawn)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["e1", "f1", "c1", "u-alice", now, 0]);
  }

  sqlite.persist();
}

describe("Wednesday reminder", () => {
  it("sends to all locked RSVPs and dedupes on second invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED_0900_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seed({ withCubeEnrollment: true });

    const { checkWednesdayReminder } = await import("../src/scheduler.js");
    await checkWednesdayReminder();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const recipients = fetchMock.mock.calls.map((c) => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return body.personalizations[0].to[0].email as string;
    }).sort();
    expect(recipients).toEqual(["alice@test.local", "bob@test.local"]);

    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(firstBody.subject).toBe(`Friday ${NEXT_FRIDAY} — midweek reminder`);
    expect(firstBody.content[0].value).toContain("Ye Olde Cube");
    expect(firstBody.content[0].value).toContain(NEXT_FRIDAY);

    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();
    const rows = sqlite.query<{ id: string; email_type: string }>(db,
      "SELECT id, email_type FROM sent_emails WHERE friday_id = ?", ["f1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email_type).toBe("wednesday");
    expect(rows[0].id).toBe("wednesday:f1");

    fetchMock.mockClear();
    await checkWednesdayReminder();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing outside the 09:00–09:05 window", async () => {
    vi.useFakeTimers();
    // 11:00 London on Wednesday — outside window
    vi.setSystemTime(new Date("2026-05-06T10:00:00.000Z"));

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seed();

    const { checkWednesdayReminder } = await import("../src/scheduler.js");
    await checkWednesdayReminder();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("targets fridays exactly 2 days out, not other dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED_0900_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();
    const now = "2026-04-21T12:00:00.000Z";
    sqlite.run(db, "INSERT INTO venues (id, name) VALUES ('v1', 'Owl')");
    sqlite.run(db, "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      ["u-x", "x@test.local", "X", now]);
    // Friday 1 day out — should NOT match
    sqlite.run(db,
      `INSERT INTO fridays (id, date, venue_id, state, created_at)
       VALUES ('f-thu', '2026-05-07', 'v1', '{"kind":"open"}', ?)`, [now]);
    sqlite.run(db,
      `INSERT INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at)
       VALUES ('rx', 'f-thu', 'u-x', 'locked', ?, ?)`, [now, now]);
    sqlite.persist();

    const { checkWednesdayReminder } = await import("../src/scheduler.js");
    await checkWednesdayReminder();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to enrollment cube name when no pods exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED_0900_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seed({ withCubeEnrollment: true });

    const { checkWednesdayReminder } = await import("../src/scheduler.js");
    await checkWednesdayReminder();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.content[0].value).toContain("Ye Olde Cube");
    expect(body.content[0].value).not.toContain("TBD");
  });

  it("shows TBD when no enrollments and no pods", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED_0900_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seed({ withCubeEnrollment: false });

    const { checkWednesdayReminder } = await import("../src/scheduler.js");
    await checkWednesdayReminder();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.content[0].value).toContain("Cubes: TBD");
  });
});
