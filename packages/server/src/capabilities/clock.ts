/**
 * Clock capability — abstracts time access for testability.
 */

import { Context, Effect, Layer } from "effect";
import type { ISO8601, LocalDate } from "@cubehall/core";
import { unsafeISO8601, unsafeLocalDate } from "@cubehall/core";

export interface ClockService {
  readonly now: () => Effect.Effect<ISO8601>;
  readonly today: (zone: string) => Effect.Effect<LocalDate>;
}

export class Clock extends Context.Tag("Clock")<Clock, ClockService>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const ClockLive = Layer.succeed(Clock, {
  now: () =>
    Effect.sync(() => unsafeISO8601(new Date().toISOString())),

  today: (zone: string) =>
    Effect.sync(() => {
      const now = new Date();
      const formatted = now.toLocaleDateString("en-CA", { timeZone: zone });
      return unsafeLocalDate(formatted);
    }),
});

// ---------------------------------------------------------------------------
// Test implementation — frozen clock
// ---------------------------------------------------------------------------

export const makeTestClock = (frozenAt: ISO8601, frozenDate: LocalDate) =>
  Layer.succeed(Clock, {
    now: () => Effect.succeed(frozenAt),
    today: (_zone: string) => Effect.succeed(frozenDate),
  });
