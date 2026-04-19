/**
 * SQLite database layer — sql.js (WASM, zero native deps).
 * Inspired by zensurance's storage/db.ts pattern.
 */

// @ts-ignore sql.js has no declaration file
import initSqlJs from "sql.js";
type Database = any;
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "cubehall.db");

let _db: Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    dci_number INTEGER,
    created_at TEXT NOT NULL,
    auth_state TEXT NOT NULL DEFAULT '{"kind":"verified"}',
    profile TEXT NOT NULL DEFAULT '{}',
    role TEXT NOT NULL DEFAULT 'member'
  );

  CREATE TABLE IF NOT EXISTS venues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 16,
    max_pods INTEGER NOT NULL DEFAULT 2,
    house_credit_per_player INTEGER NOT NULL DEFAULT 700,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS cubes (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    cubecobra_url TEXT NOT NULL,
    cubecobra_id TEXT NOT NULL DEFAULT '',
    card_count INTEGER NOT NULL DEFAULT 360,
    supported_formats TEXT NOT NULL DEFAULT '["swiss_draft"]',
    preferred_pod_size INTEGER NOT NULL DEFAULT 8,
    min_pod_size INTEGER NOT NULL DEFAULT 4,
    max_pod_size INTEGER NOT NULL DEFAULT 8,
    tags TEXT NOT NULL DEFAULT '[]',
    last_run_at TEXT,
    retired INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS fridays (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    venue_id TEXT NOT NULL REFERENCES venues(id),
    state TEXT NOT NULL DEFAULT '{"kind":"scheduled"}',
    created_at TEXT NOT NULL,
    locked_at TEXT,
    confirmed_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    friday_id TEXT NOT NULL REFERENCES fridays(id),
    cube_id TEXT NOT NULL REFERENCES cubes(id),
    host_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    withdrawn INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rsvps (
    id TEXT PRIMARY KEY,
    friday_id TEXT NOT NULL REFERENCES fridays(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    state TEXT NOT NULL DEFAULT 'in',
    covered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_transition_at TEXT NOT NULL,
    UNIQUE(friday_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    friday_id TEXT NOT NULL REFERENCES fridays(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    ranking TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    UNIQUE(friday_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS pods (
    id TEXT PRIMARY KEY,
    friday_id TEXT NOT NULL REFERENCES fridays(id),
    cube_id TEXT NOT NULL REFERENCES cubes(id),
    host_id TEXT NOT NULL REFERENCES users(id),
    format TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'drafting',
    pairings_template TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS seats (
    pod_id TEXT NOT NULL REFERENCES pods(id),
    seat_index INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    team TEXT,
    PRIMARY KEY(pod_id, seat_index)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    pod_id TEXT NOT NULL REFERENCES pods(id),
    round_number INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    ended_at TEXT,
    time_limit INTEGER NOT NULL DEFAULT 3000,
    extensions TEXT NOT NULL DEFAULT '[]',
    timer TEXT NOT NULL DEFAULT '{"kind":"not_started"}',
    UNIQUE(pod_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id),
    player1_id TEXT NOT NULL REFERENCES users(id),
    player2_id TEXT NOT NULL REFERENCES users(id),
    result TEXT NOT NULL DEFAULT '{"kind":"pending"}',
    submitted_at TEXT,
    submitted_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_val TEXT,
    after_val TEXT
  );

  CREATE TABLE IF NOT EXISTS event_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rsvps_friday ON rsvps(friday_id);
  CREATE INDEX IF NOT EXISTS idx_enrollments_friday ON enrollments(friday_id);
  CREATE INDEX IF NOT EXISTS idx_pods_friday ON pods(friday_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_pod ON rounds(pod_id);
  CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_cubes_owner ON cubes(owner_id);
`;

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const SQL = await initSqlJs();

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }

  _db.run(SCHEMA);
  persist();

  return _db;
}

export function persist(): void {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function query<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as any[]);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function run(db: Database, sql: string, params: unknown[] = []): void {
  db.run(sql, params as any[]);
}

export function close(): void {
  if (_db) {
    persist();
    _db.close();
    _db = null;
  }
}
