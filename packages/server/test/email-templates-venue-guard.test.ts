/**
 * Guardrail: every email template body must use the venue from `ctx`, never
 * a hardcoded value. We render every EmailKind with a clearly-fake venue
 * name and assert no body contains any historical hardcoded venue string
 * (Owl, Hitchhiker, Holloway, Archway). This is the test that would have
 * caught the 2026-06-05 "Get out of the office" email leaking
 * "Owl & Hitchhiker" while the active venue was Arcadia Games.
 *
 * If you add a new EmailKind, no extra wiring is needed — the iteration
 * over `ALL_EMAIL_KINDS` picks it up automatically.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_EMAIL_KINDS,
  renderEmail,
  type EmailContext,
} from "../src/email-templates.js";

const SENTINELS = ["Owl", "Hitchhiker", "Holloway", "Archway", "OWL"] as const;

function ctx(venueName: string): EmailContext {
  return {
    displayName: "Friend",
    date: "2026-12-25",
    cubeNames: "Test Cube",
    appUrl: "https://example.test",
    venueName,
    venueAddress: "1 Test Lane, London",
    venueMapUrl: "https://maps.example/abc",
    rsvpTime: "yesterday at 10:00",
    coveredCount: 1,
    ownCubeName: "Friend's Cube",
    winningCubeName: "Other Cube",
  };
}

describe("email templates — venue must come from context", () => {
  for (const kind of ALL_EMAIL_KINDS) {
    it(`${kind}: body contains the venueName and no legacy hardcoded venue`, () => {
      const venueName = "Arcadia Games";
      const out = renderEmail(kind, ctx(venueName));

      // covered_coordinator is the only kind that doesn't reference a venue
      // — it's an internal heads-up about covered RSVPs, no venue context.
      if (kind !== "covered_coordinator") {
        expect(out.body).toContain(venueName);
      }

      for (const sentinel of SENTINELS) {
        expect(
          out.body,
          `${kind}.body must not contain hardcoded "${sentinel}"`,
        ).not.toContain(sentinel);
        expect(
          out.subject,
          `${kind}.subject must not contain hardcoded "${sentinel}"`,
        ).not.toContain(sentinel);
      }
    });

    it(`${kind}: changing venue changes the body output`, () => {
      const a = renderEmail(kind, ctx("Venue Alpha"));
      const b = renderEmail(kind, ctx("Venue Bravo"));
      if (kind === "covered_coordinator") return; // skip — no venue ref
      expect(a.body).not.toEqual(b.body);
    });
  }
});
