/**
 * auth-guard — abuse protection for the open (un-gated) auth endpoints.
 *
 * Design goals (per product decision: NO invite gating):
 *   - Frictionless for real humans, expensive for bots.
 *   - Hard cap on outbound email so a flood can never torch SendGrid
 *     reputation/quota (which is shared with the GEOSURGE sender).
 *
 * Layers (all in-process, no external services, no new deps):
 *   1. Email send limits   — per-email cooldown + daily cap + a GLOBAL hourly
 *                            send budget (circuit breaker).
 *   2. Per-IP backoff      — exponential backoff per client IP on auth POSTs.
 *   3. Proof-of-work        — a free, keyless hashcash CAPTCHA required to
 *                            register / request a login link. Difficulty rises
 *                            for VPN/datacenter/Tor IPs and after failures.
 *   4. VPN/proxy detection  — soft: classify the client IP against free,
 *                            cron-refreshed range lists; never a hard block,
 *                            just a harder PoW + a "turn off your VPN" hint.
 *
 * State is in-memory: it resets on restart, which is fine — these are
 * rate/abuse heuristics, not correctness-critical. Cheap, dependency-free.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Tunables (env-overridable)
// ---------------------------------------------------------------------------
const EMAIL_COOLDOWN_MS = Number(process.env.AUTH_EMAIL_COOLDOWN_MS ?? 60_000);      // 1 link / email / min
const EMAIL_DAILY_CAP = Number(process.env.AUTH_EMAIL_DAILY_CAP ?? 5);              // links / email / day
const GLOBAL_HOURLY_BUDGET = Number(process.env.AUTH_GLOBAL_HOURLY_BUDGET ?? 80);   // total auth emails / hour
const IP_WINDOW_MS = Number(process.env.AUTH_IP_WINDOW_MS ?? 10 * 60_000);          // backoff window
const POW_TTL_MS = Number(process.env.AUTH_POW_TTL_MS ?? 10 * 60_000);             // challenge validity
const POW_BITS_BASE = Number(process.env.AUTH_POW_BITS ?? 16);                      // ~tens of ms on a laptop
const POW_BITS_SUSPECT = Number(process.env.AUTH_POW_BITS_SUSPECT ?? 20);          // VPN/dc/tor or repeat offender
// Writable, NOT under the deploy tree (rsync --delete) nor the immutable
// data/ dir. Refreshed by scripts/refresh-vpn-ranges.sh via cron. If absent,
// VPN detection is simply dormant (everyone gets the base PoW difficulty).
const VPN_RANGES_FILE = process.env.AUTH_VPN_RANGES_FILE ?? "/var/lib/cubehall/vpn-ranges.txt";

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------
/** Real client IP from nginx's X-Real-IP / first X-Forwarded-For hop. */
export function clientIp(headers: { get(name: string): string | null | undefined }): string {
  const xri = headers.get("x-real-ip");
  if (xri && xri.trim()) return xri.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0]!.trim();
  return "0.0.0.0";
}

// ---------------------------------------------------------------------------
// VPN / datacenter / Tor classification (soft)
// ---------------------------------------------------------------------------
// File format: one CIDR per line (IPv4), e.g. "1.2.3.0/24". Comments with '#'.
// Refreshed out-of-band by a cron job (see scripts/refresh-vpn-ranges.sh).
let vpnRanges: Array<{ base: number; mask: number }> = [];
let vpnLoadedAt = 0;
function loadVpnRanges(): void {
  try {
    if (!existsSync(VPN_RANGES_FILE)) { vpnRanges = []; return; }
    const txt = readFileSync(VPN_RANGES_FILE, "utf8");
    const out: Array<{ base: number; mask: number }> = [];
    for (const raw of txt.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [cidr, bitsStr] = line.split("/");
      const ip = ipv4ToInt(cidr!);
      if (ip === null) continue;
      const bits = bitsStr ? Number(bitsStr) : 32;
      if (!(bits >= 0 && bits <= 32)) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      out.push({ base: (ip & mask) >>> 0, mask });
    }
    vpnRanges = out;
  } catch { vpnRanges = []; }
}
function ipv4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const o = Number(part);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}
/** True if IP is in a known VPN/datacenter/Tor range. IPv6 → treated clean. */
export function isSuspectIp(ip: string): boolean {
  const now = Date.now();
  if (now - vpnLoadedAt > 5 * 60_000) { loadVpnRanges(); vpnLoadedAt = now; }
  if (vpnRanges.length === 0) return false;
  const n = ipv4ToInt(ip);
  if (n === null) return false; // IPv6 / unknown
  for (const r of vpnRanges) if (((n & r.mask) >>> 0) === r.base) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Proof of work (hashcash): find nonce s.t. sha256(salt:nonce) has >= bits
// leading zero bits. O(1) to verify, O(2^bits) expected to solve.
// ---------------------------------------------------------------------------
interface PowChallenge { salt: string; bits: number; expires: number; used: boolean }
const powStore = new Map<string, PowChallenge>();

function leadingZeroBits(buf: Buffer): number {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    for (let m = 7; m >= 0; m--) { if ((byte >> m) & 1) return bits; bits++; }
    break;
  }
  return bits;
}

export function issuePow(suspect: boolean): { id: string; salt: string; bits: number; expires: number } {
  sweep();
  const id = randomBytes(12).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const bits = suspect ? POW_BITS_SUSPECT : POW_BITS_BASE;
  const expires = Date.now() + POW_TTL_MS;
  powStore.set(id, { salt, bits, expires, used: false });
  return { id, salt, bits, expires };
}

/** Verify and consume a PoW solution. Single-use. */
export function verifyPow(id: string | undefined, nonce: string | undefined): boolean {
  if (!id || !nonce) return false;
  const ch = powStore.get(id);
  if (!ch) return false;
  if (ch.used || Date.now() > ch.expires) { powStore.delete(id); return false; }
  ch.used = true; // consume regardless of outcome (single attempt per challenge)
  const h = createHash("sha256").update(`${ch.salt}:${nonce}`).digest();
  const ok = leadingZeroBits(h) >= ch.bits;
  powStore.delete(id);
  return ok;
}

// ---------------------------------------------------------------------------
// Per-IP exponential backoff for auth POSTs
// ---------------------------------------------------------------------------
interface IpState { strikes: number; nextAllowed: number; windowStart: number }
const ipStore = new Map<string, IpState>();

/** Returns retryAfterMs > 0 if the IP must wait, else 0 (and records a hit). */
export function ipBackoff(ip: string): number {
  const now = Date.now();
  let s = ipStore.get(ip);
  if (!s || now - s.windowStart > IP_WINDOW_MS) {
    s = { strikes: 0, nextAllowed: 0, windowStart: now };
    ipStore.set(ip, s);
  }
  if (now < s.nextAllowed) return s.nextAllowed - now;
  // allow this hit; schedule escalating cooldown for the next one.
  s.strikes++;
  // free: first 3 hits/window, then exp backoff: 2s,8s,32s,... capped 5min.
  const over = Math.max(0, s.strikes - 3);
  const cooldown = over === 0 ? 0 : Math.min(2_000 * 4 ** (over - 1), 5 * 60_000);
  s.nextAllowed = now + cooldown;
  return 0;
}

// ---------------------------------------------------------------------------
// Email send limits: per-email cooldown + daily cap + global hourly budget
// ---------------------------------------------------------------------------
interface EmailState { last: number; dayCount: number; dayStart: number }
const emailStore = new Map<string, EmailState>();
let globalHour = { count: 0, start: Date.now() };

export type SendDecision =
  | { allow: true }
  | { allow: false; reason: "cooldown" | "daily_cap" | "global_budget"; retryAfterMs: number };

/**
 * Decide whether an auth email may be sent to `email` right now, and record
 * the send if so. Call this immediately before sendMagicLinkEmail.
 */
export function allowEmailSend(email: string): SendDecision {
  const now = Date.now();
  // global hourly circuit breaker
  if (now - globalHour.start > 60 * 60_000) globalHour = { count: 0, start: now };
  if (globalHour.count >= GLOBAL_HOURLY_BUDGET) {
    return { allow: false, reason: "global_budget", retryAfterMs: globalHour.start + 60 * 60_000 - now };
  }
  const key = email.trim().toLowerCase();
  let e = emailStore.get(key);
  if (!e || now - e.dayStart > 24 * 60 * 60_000) { e = { last: 0, dayCount: 0, dayStart: now }; emailStore.set(key, e); }
  if (now - e.last < EMAIL_COOLDOWN_MS) {
    return { allow: false, reason: "cooldown", retryAfterMs: EMAIL_COOLDOWN_MS - (now - e.last) };
  }
  if (e.dayCount >= EMAIL_DAILY_CAP) {
    return { allow: false, reason: "daily_cap", retryAfterMs: e.dayStart + 24 * 60 * 60_000 - now };
  }
  e.last = now; e.dayCount++; globalHour.count++;
  return { allow: true };
}

// ---------------------------------------------------------------------------
// housekeeping
// ---------------------------------------------------------------------------
function sweep(): void {
  const now = Date.now();
  if (powStore.size > 5000) {
    for (const [k, v] of powStore) if (v.used || now > v.expires) powStore.delete(k);
  }
  if (ipStore.size > 20000) {
    for (const [k, v] of ipStore) if (now - v.windowStart > IP_WINDOW_MS) ipStore.delete(k);
  }
}
