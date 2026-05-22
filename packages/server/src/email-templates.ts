/**
 * Email templates — single source of truth for every transactional email body.
 *
 * Both the live cron/lifecycle code paths and the /admin/email-test preview tool
 * render through these functions, so the preview the coordinator sees in their
 * inbox matches exactly what real players receive.
 */

export type EmailKind =
  | "lock"
  | "cube_announcement"
  | "wednesday"
  | "morning_locked"
  | "morning_pending"
  | "afternoon"
  | "uncancel"
  | "covered_coordinator"
  | "backup_cube_host";

export type EmailContext = {
  readonly displayName: string;
  readonly date: string;          // e.g. "2026-05-15"
  readonly cubeNames: string;     // comma-separated cube names, e.g. "Powered Vintage, Sealed pool"
  readonly appUrl: string;
  readonly rsvpTime?: string;     // for "lock" — friendly RSVP timestamp
  readonly coveredCount?: number; // for "covered_coordinator"
  readonly ownCubeName?: string;  // for "backup_cube_host" — the host's own cube
  readonly winningCubeName?: string; // for "backup_cube_host" — the cube chosen as primary
};

export type RenderedEmail = {
  readonly subject: string;
  readonly body: string;
};

export function renderEmail(kind: EmailKind, ctx: EmailContext): RenderedEmail {
  switch (kind) {
    case "lock":
      return {
        subject: `You're locked in for ${ctx.date}`,
        body: `Hi ${ctx.displayName},\n\nYou're locked in for Friday ${ctx.date} at Owl & Hitchhiker.\n\nRSVP'd at: ${ctx.rsvpTime ?? "earlier"}\nDoors: 18:30\nP1P1: 18:45\n\nThis is a commitment to attend. See you there!\n\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "cube_announcement":
      return {
        subject: `Cubes for ${ctx.date}`,
        body: `Hi ${ctx.displayName},\n\nThe cubes for Friday ${ctx.date} have been decided:\n\n${ctx.cubeNames}\n\nDoors: 18:30 | P1P1: 18:45\n\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "wednesday":
      return {
        subject: `Friday ${ctx.date} — midweek reminder`,
        body: `Hi ${ctx.displayName},\n\nQuick midweek heads-up: you're locked in for Friday ${ctx.date} at Owl & Hitchhiker.\n\nCubes: ${ctx.cubeNames}\nDoors: 18:30 | P1P1: 18:45\n\nIf something's changed and you can't make it, please withdraw via the app so someone else can take your spot:\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "morning_locked":
      return {
        subject: `Tonight: ${ctx.cubeNames}`,
        body: `Hi ${ctx.displayName},\n\nReminder: you're playing tonight!\n\nCubes: ${ctx.cubeNames}\nDoors: 18:30 | P1P1: 18:45\nOWL & Hitchhiker\n\nSee you there!\n\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "morning_pending":
      return {
        subject: `Cube tonight — come along!`,
        body: `Hi ${ctx.displayName},\n\nYou're in for tonight's cube draft at Owl & Hitchhiker — doors 18:30, P1P1 18:45.\n\nYou're currently unpaired. If you can rope a friend into joining, even better (pairs lock in faster) — share this link with them: ${ctx.appUrl}/register\n\nEither way, please come along. We'll sort pods on the night.\n\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "afternoon":
      return {
        subject: `Get out of the office!`,
        body: `Hi ${ctx.displayName},\n\nLeave by 17:00 to catch the game tonight!\n\nP1P1 is at 18:45 — doors open 18:30 at Owl & Hitchhiker.\n\nSee you soon!\n\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "uncancel":
      return {
        subject: `Friday ${ctx.date} is back on`,
        body: `Hi ${ctx.displayName},\n\nGood news — Friday ${ctx.date} at Owl & Hitchhiker has been un-cancelled and is going ahead.\n\nYour RSVP is still in place. Doors 18:30, P1P1 18:45.\n\nIf you can no longer make it, please withdraw via the app so someone else can take your spot:\n${ctx.appUrl}\n\n— Cubehall`,
      };

    case "covered_coordinator": {
      const n = ctx.coveredCount ?? 0;
      const plural = n !== 1 ? "s" : "";
      return {
        subject: `${n} covered RSVP${plural} for ${ctx.date}`,
        body: `${n} attendee${plural} for ${ctx.date} need${n === 1 ? "s" : ""} entry covered.\n\nDefault: split evenly among other attendees.\nNo names shown — anonymous.`,
      };
    }

    case "backup_cube_host":
      return {
        subject: `Bring "${ctx.ownCubeName ?? "your cube"}" as backup for ${ctx.date}`,
        body: `Hi ${ctx.displayName},\n\nThanks for enrolling ${ctx.ownCubeName ?? "your cube"} for Friday ${ctx.date}.\n\nThe primary cube this week is "${ctx.winningCubeName ?? "TBD"}" — least recently played, so it gets the first pod.\n\nIf we get enough players for a second pod, we'd love to fire ${ctx.ownCubeName ?? "your cube"} too. Please bring it along just in case — no commitment to fire, just having it ready makes the call easy on the night.\n\nDoors: 18:30 | P1P1: 18:45\n\n${ctx.appUrl}\n\n— Cubehall`,
      };
  }
}

export const ALL_EMAIL_KINDS: ReadonlyArray<EmailKind> = [
  "lock",
  "cube_announcement",
  "wednesday",
  "morning_locked",
  "morning_pending",
  "afternoon",
  "uncancel",
  "covered_coordinator",
  "backup_cube_host",
];

/**
 * Short human-friendly description of when each email fires in the real flow.
 * Used by the admin test page to show context next to each option.
 */
export function describeEmail(kind: EmailKind): string {
  switch (kind) {
    case "lock":              return "When an RSVP transitions from confirmed to locked (30-min grace expires).";
    case "cube_announcement": return "When a Friday first enters locked/confirmed state — sent to every locked player.";
    case "wednesday":         return "Wednesday 09:00 London — midweek heads-up to locked players for the upcoming Friday.";
    case "morning_locked":    return "Friday 09:00 London — day-of reminder to locked players with the cube list.";
    case "morning_pending":   return "Friday 09:00 London — day-of nudge to unpaired (pending) RSVPs to come anyway / bring a +1.";
    case "afternoon":         return "Friday 16:30 London — \"get out of the office\" nudge to locked players.";
    case "uncancel":          return "When admin uncancels a Friday — sent to every player with a live RSVP.";
    case "covered_coordinator": return "When a player marks their RSVP as covered — sent to all coordinators.";
    case "backup_cube_host":  return "When enrollments close — sent to each host whose cube wasn't picked, asking them to bring it as backup.";
  }
}
