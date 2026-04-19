/**
 * Domain enumerations — the extension axis for formats.
 */

export const DRAFT_FORMATS = [
  "swiss_draft",
  "team_draft_2v2",
  "team_draft_3v3",
  "team_draft_4v4",
  "rochester",
  "winston",
  "winchester",
  "grid",
  "glimpse",
  "sealed",
] as const;

export type DraftFormat = (typeof DRAFT_FORMATS)[number];

export const SYSTEM_ROLES = ["member", "admin"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const RSVP_STATES = [
  "in",
  "out",
  "waitlisted",
  "seated",
  "no_show",
  "attended",
  "cancelled_by_user",
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
