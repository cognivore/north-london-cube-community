/**
 * Domain enumerations — the extension axis for formats.
 */

export const DRAFT_FORMATS = [
  "swiss_draft",
  "team_draft_2v2",
  "team_draft_3v3",
  "team_draft_4v4",
  "rochester",
  "housman",
  "grid",
  "glimpse",
  "sealed",
] as const;

export type DraftFormat = (typeof DRAFT_FORMATS)[number];

export const SYSTEM_ROLES = ["member", "coordinator"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const RSVP_STATES = [
  "pending",           // said "I'm in" but total is odd — can still withdraw
  "confirmed",         // total became even — 30-min lock timer started, email sent
  "locked",            // 30 min passed — cannot withdraw
  "seated",            // assigned to a pod at lock time
  "attended",          // post-event: showed up
  "no_show",           // post-event: didn't show up
  "cancelled_by_user", // withdrew before lock
] as const;
export type RsvpState = (typeof RSVP_STATES)[number];

export const POD_STATES = [
  "drafting",
  "building",
  "playing",
  "complete",
  "cancelled",
] as const;
export type PodState = (typeof POD_STATES)[number];

export const ROUND_STATES = ["pending", "in_progress", "complete"] as const;
export type RoundState = (typeof ROUND_STATES)[number];
