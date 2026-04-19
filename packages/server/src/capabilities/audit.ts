/**
 * Audit capability — records state-change audit events.
 */

import { Context, Effect, Layer } from "effect";
import type { AuditEventInput } from "@cubehall/core";

export interface AuditService {
  readonly record: (event: AuditEventInput) => Effect.Effect<void>;
}

export class Audit extends Context.Tag("Audit")<Audit, AuditService>() {}

// ---------------------------------------------------------------------------
// Test implementation — capturing
// ---------------------------------------------------------------------------

export const makeTestAudit = () => {
  const events: AuditEventInput[] = [];

  const layer = Layer.succeed(Audit, {
    record: (event) =>
      Effect.sync(() => { events.push(event); }),
  });

  return { layer, events };
};
