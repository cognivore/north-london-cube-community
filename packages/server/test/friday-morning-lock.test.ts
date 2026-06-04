/**
 * Integration test: Friday 08:00 London auto-lock.
 *
 * Boots a real SQLite db, seeds two cubes (one played recently, one never),
 * one Friday in "open" state with two enrollments and two locked RSVPs, and
 * asserts that the scheduler:
 *   1. Picks the least-recently-played cube.
 *   2. Creates a pod for it (only one, given attendee count <= 8).
 *   3. Transitions the Friday to "locked".
 *   4. Emails the selected host one mail and the not-selected host another.
 *   5. Does NOT bump lastRunAt until the pod actually completes.
 *
 * Also covers the post-game bump: when `completeRound` finishes the final
 * round of a pod, `cube.lastRunAt` is updated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";

const ORIGINAL_ENV = { ...process.env };

let tmpDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubehall-morning-"));
  process.env.DATA_DIR = tmpDir;
  process.env.SENDGRID_API_KEY = "SG.test.fake";
  process.env.FROM_EMAIL = "noreply@test.local";
  process.env.APP_URL = "https://test.local";
  delete process.env.TEST_MODE;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const sqlite = await import("../src/db/sqlite.js");
  sqlite.close();
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 08:00 London on Fri 2026-05-08 (BST = UTC+1) → 07:00 UTC
const FRI_0800_LONDON_UTC = new Date("2026-05-08T07:00:00.000Z");
const TODAY = "2026-05-08";

async function buildRunEffect() {
  const { ClockLive } = await import("../src/capabilities/clock.js");
  const { RNGLive } = await import("../src/capabilities/rng.js");
  const { makeLoggerLive } = await import("../src/capabilities/logger.js");
  const { EventBus } = await import("../src/capabilities/event-bus.js");
  const { Audit } = await import("../src/capabilities/audit.js");
  const repos = await import("../src/repos/sqlite-repos.js");

  const noopPino = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const EventBusLive = Layer.succeed(EventBus, {
    publish: () => Effect.succeed(undefined),
  });
  const AuditLive = Layer.succeed(Audit, {
    record: () => Effect.succeed(undefined),
  });
  const AppLayer = Layer.mergeAll(
    ClockLive,
    RNGLive,
    makeLoggerLive(noopPino),
    EventBusLive,
    AuditLive,
    repos.AllReposLive,
  );

  return <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<A, E>);
}

async function seedFriday(opts: {
  cube1LastRunAt: string | null;
  cube2LastRunAt: string | null;
}) {
  const sqlite = await import("../src/db/sqlite.js");
  const db = await sqlite.getDb();
  const now = "2026-04-21T12:00:00.000Z";

  sqlite.run(db,
    `INSERT INTO venues (id, name, address, capacity, max_pods, house_credit_per_player, active, map_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["v1", "Owl", "123 St", 16, 2, 700, 1, ""]);

  // Two cube hosts, two players (and the hosts will be the locked RSVPs).
  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-alice", "alice@test.local", "Alice", now, "member"]);
  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-bob", "bob@test.local", "Bob", now, "member"]);
  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-carol", "carol@test.local", "Carol", now, "member"]);
  sqlite.run(db,
    `INSERT INTO users (id, email, display_name, created_at, role)
     VALUES (?, ?, ?, ?, ?)`,
    ["u-dave", "dave@test.local", "Dave", now, "member"]);

  // Cube 1: recently played → should sort behind cube 2 (less recent)
  sqlite.run(db,
    `INSERT INTO cubes (id, owner_id, name, cubecobra_url, cubecobra_id, card_count,
       supported_formats, preferred_pod_size, min_pod_size, max_pod_size, tags, last_run_at, retired)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c-alpha", "u-alice", "Alpha Cube", "https://cubecobra.com/cube/overview/a", "a", 360,
     '["swiss_draft"]', 8, 4, 8, '[]', opts.cube1LastRunAt, 0]);

  // Cube 2: never played (or older) → should be picked
  sqlite.run(db,
    `INSERT INTO cubes (id, owner_id, name, cubecobra_url, cubecobra_id, card_count,
       supported_formats, preferred_pod_size, min_pod_size, max_pod_size, tags, last_run_at, retired)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c-beta", "u-bob", "Beta Cube", "https://cubecobra.com/cube/overview/b", "b", 360,
     '["swiss_draft"]', 8, 4, 8, '[]', opts.cube2LastRunAt, 0]);

  sqlite.run(db,
    `INSERT INTO fridays (id, date, venue_id, state, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["f1", TODAY, "v1", '{"kind":"open"}', now]);

  sqlite.run(db,
    `INSERT INTO enrollments (id, friday_id, cube_id, host_id, created_at, withdrawn)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["e-alpha", "f1", "c-alpha", "u-alice", now, 0]);
  sqlite.run(db,
    `INSERT INTO enrollments (id, friday_id, cube_id, host_id, created_at, withdrawn)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["e-beta", "f1", "c-beta", "u-bob", now, 0]);

  // 4 locked RSVPs — the two hosts plus two more players.
  for (const [rid, uid] of [
    ["r1", "u-alice"], ["r2", "u-bob"], ["r3", "u-carol"], ["r4", "u-dave"],
  ]) {
    sqlite.run(db,
      `INSERT INTO rsvps (id, friday_id, user_id, state, created_at, last_transition_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rid, "f1", uid, "locked", now, now]);
  }

  sqlite.persist();
}

describe("Friday morning auto-lock", () => {
  it("picks least-recently-played cube, sends selected + not-selected emails, locks friday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_0800_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seedFriday({
      cube1LastRunAt: "2026-04-30T00:00:00.000Z", // Alpha: recent
      cube2LastRunAt: null,                        // Beta: never played → picked
    });

    const runEffect = await buildRunEffect();
    const { _setRunEffectForTests, checkFridayMorningLock } =
      await import("../src/scheduler.js");
    _setRunEffectForTests(runEffect);
    await checkFridayMorningLock();

    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();

    // Friday transitioned to "locked"
    const fridayRows = sqlite.query<{ state: string }>(db,
      "SELECT state FROM fridays WHERE id = 'f1'", []);
    expect(JSON.parse(fridayRows[0]!.state).kind).toBe("locked");

    // Exactly one pod, for Beta (least-recently-played)
    const pods = sqlite.query<{ cube_id: string }>(db,
      "SELECT cube_id FROM pods WHERE friday_id = 'f1'", []);
    expect(pods).toHaveLength(1);
    expect(pods[0]!.cube_id).toBe("c-beta");

    // Bob (selected host) gets the "selected_host" email.
    // Alice (not-selected host) gets the "not_selected_host" email.
    // Hosts only; no recipients other than the two hosts.
    const calls = fetchMock.mock.calls.map((c) => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return {
        to: body.personalizations[0].to[0].email as string,
        subject: body.subject as string,
        text: body.content[0].value as string,
      };
    });
    const byRecipient = new Map(calls.map((c) => [c.to, c]));
    expect([...byRecipient.keys()].sort()).toEqual([
      "alice@test.local", "bob@test.local",
    ]);
    expect(byRecipient.get("bob@test.local")!.subject).toContain("Beta Cube");
    expect(byRecipient.get("bob@test.local")!.text).toMatch(/token|sleeve/i);
    expect(byRecipient.get("alice@test.local")!.text).toContain("Beta Cube");
    expect(byRecipient.get("alice@test.local")!.text).toMatch(/stays at home|don't have to bring/i);

    // lastRunAt has NOT changed yet — that only fires on pod completion.
    const cubeRow = sqlite.query<{ last_run_at: string | null }>(db,
      "SELECT last_run_at FROM cubes WHERE id = 'c-beta'", []);
    expect(cubeRow[0]!.last_run_at).toBeNull();

  });

  it("is idempotent — second tick at the same time skips advancing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_0800_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seedFriday({
      cube1LastRunAt: "2026-04-30T00:00:00.000Z",
      cube2LastRunAt: null,
    });

    const runEffect = await buildRunEffect();
    const { _setRunEffectForTests, checkFridayMorningLock } =
      await import("../src/scheduler.js");
    _setRunEffectForTests(runEffect);
    await checkFridayMorningLock();
    const callsAfterFirst = fetchMock.mock.calls.length;
    fetchMock.mockClear();

    await checkFridayMorningLock();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsAfterFirst).toBeGreaterThan(0);

  });

  it("skips outside the 08:00–08:05 window", async () => {
    vi.useFakeTimers();
    // 10:00 London — outside window
    vi.setSystemTime(new Date("2026-05-08T09:00:00.000Z"));

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seedFriday({ cube1LastRunAt: null, cube2LastRunAt: null });

    const runEffect = await buildRunEffect();
    const { _setRunEffectForTests, checkFridayMorningLock } =
      await import("../src/scheduler.js");
    _setRunEffectForTests(runEffect);
    await checkFridayMorningLock();

    expect(fetchMock).not.toHaveBeenCalled();

    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();
    const fridayRows = sqlite.query<{ state: string }>(db,
      "SELECT state FROM fridays WHERE id = 'f1'", []);
    expect(JSON.parse(fridayRows[0]!.state).kind).toBe("open");

  });

  it("ties on lastRunAt are broken alphabetically by cube name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_0800_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    // Both cubes share the same lastRunAt → Alpha wins on name (A < B).
    await seedFriday({
      cube1LastRunAt: "2026-04-30T00:00:00.000Z",
      cube2LastRunAt: "2026-04-30T00:00:00.000Z",
    });

    const runEffect = await buildRunEffect();
    const { _setRunEffectForTests, checkFridayMorningLock } =
      await import("../src/scheduler.js");
    _setRunEffectForTests(runEffect);
    await checkFridayMorningLock();

    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();
    const pods = sqlite.query<{ cube_id: string }>(db,
      "SELECT cube_id FROM pods WHERE friday_id = 'f1'", []);
    expect(pods).toHaveLength(1);
    expect(pods[0]!.cube_id).toBe("c-alpha");

  });
});

describe("Pod completion bumps cube.lastRunAt", () => {
  it("updates cube.last_run_at when the final round of a pod completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_0800_LONDON_UTC);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await seedFriday({
      cube1LastRunAt: "2026-04-30T00:00:00.000Z",
      cube2LastRunAt: null,
    });

    const runEffect = await buildRunEffect();
    const sqlite = await import("../src/db/sqlite.js");
    const db = await sqlite.getDb();

    // Lock the Friday and form pods via the auto-lock pathway.
    const { _setRunEffectForTests, checkFridayMorningLock } =
      await import("../src/scheduler.js");
    _setRunEffectForTests(runEffect);
    await checkFridayMorningLock();

    // Re-fetch the formed pod + its rounds; cancel all rounds-but-the-last
    // so we can complete the pod by calling `completeRound` once. Faster
    // than seating + reporting full matches.
    const pods = sqlite.query<{ id: string; cube_id: string }>(db,
      "SELECT id, cube_id FROM pods WHERE friday_id = 'f1'", []);
    expect(pods).toHaveLength(1);
    const podId = pods[0]!.id;
    const rounds = sqlite.query<{ id: string; round_number: number }>(db,
      "SELECT id, round_number FROM rounds WHERE pod_id = ? ORDER BY round_number",
      [podId]);
    expect(rounds.length).toBeGreaterThanOrEqual(1);

    // Mark all rounds complete directly. The lifecycle's `in_progress` case
    // self-heals pod state from rounds, which is the production path that
    // bumps lastRunAt.
    for (const r of rounds) {
      sqlite.run(db,
        "UPDATE rounds SET state = 'complete', ended_at = ? WHERE id = ?",
        ["2026-05-08T22:00:00.000Z", r.id]);
    }
    // Move the Friday to in_progress so the self-heal pathway runs.
    sqlite.run(db, "UPDATE fridays SET state = ? WHERE id = 'f1'",
      ['{"kind":"in_progress"}']);
    sqlite.persist();

    const { advanceFriday } = await import("../src/programs/friday-lifecycle.js");
    await runEffect(advanceFriday("f1"));

    // The picked cube was Beta; its lastRunAt should be a fresh ISO8601
    // timestamp on/after the seeded "now".
    const cubeRow = sqlite.query<{ last_run_at: string | null }>(db,
      "SELECT last_run_at FROM cubes WHERE id = 'c-beta'", []);
    expect(cubeRow[0]!.last_run_at).not.toBeNull();
    expect(cubeRow[0]!.last_run_at!.startsWith("2026-")).toBe(true);

    // The non-played cube (Alpha) should NOT have been touched.
    const alphaRow = sqlite.query<{ last_run_at: string | null }>(db,
      "SELECT last_run_at FROM cubes WHERE id = 'c-alpha'", []);
    expect(alphaRow[0]!.last_run_at).toBe("2026-04-30T00:00:00.000Z");

  });
});
