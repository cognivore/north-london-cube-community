/**
 * Settings — admin-tunable runtime flags backed by the `settings` table.
 *
 * Defaults reflect a "cold start" community: permissive about no-shows and
 * happy to run with odd headcounts. Toggle on enforcement as the community
 * matures and can absorb the experience cost of stricter rules.
 */

import { getDb, query, run as dbRun, persist } from "./db/sqlite.js";

export const SETTING_NO_SHOW_ENFORCEMENT = "noShowEnforcementEnabled";
export const SETTING_ODD_EVENTS_ALLOWED  = "oddEventsAllowed";

export type SettingKey =
  | typeof SETTING_NO_SHOW_ENFORCEMENT
  | typeof SETTING_ODD_EVENTS_ALLOWED;

const DEFAULTS: Record<SettingKey, boolean> = {
  [SETTING_NO_SHOW_ENFORCEMENT]: false, // cold start: do NOT ban no-shows
  [SETTING_ODD_EVENTS_ALLOWED]:  true,  // cold start: odd headcounts welcome
};

export async function getBoolSetting(key: SettingKey): Promise<boolean> {
  const db = await getDb();
  const rows = query<{ value: string }>(db,
    "SELECT value FROM settings WHERE key = ?", [key]);
  if (rows.length === 0) return DEFAULTS[key];
  try {
    const parsed = JSON.parse(rows[0]!.value);
    return typeof parsed === "boolean" ? parsed : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}

export async function setBoolSetting(key: SettingKey, value: boolean): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  dbRun(db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), now]);
  persist();
}

export async function getAllSettings(): Promise<Record<SettingKey, boolean>> {
  return {
    [SETTING_NO_SHOW_ENFORCEMENT]: await getBoolSetting(SETTING_NO_SHOW_ENFORCEMENT),
    [SETTING_ODD_EVENTS_ALLOWED]:  await getBoolSetting(SETTING_ODD_EVENTS_ALLOWED),
  };
}
