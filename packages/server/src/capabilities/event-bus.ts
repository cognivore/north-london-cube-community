/**
 * EventBus capability — domain event publishing via outbox pattern.
 */

import { Context, Effect, Layer } from "effect";
import type { DomainEvent } from "@cubehall/core";

export interface EventBusService {
  readonly publish: (event: DomainEvent) => Effect.Effect<void>;
}

export class EventBus extends Context.Tag("EventBus")<EventBus, EventBusService>() {}

// ---------------------------------------------------------------------------
// Test implementation — capturing
// ---------------------------------------------------------------------------

export const makeTestEventBus = () => {
  const events: DomainEvent[] = [];

  const layer = Layer.succeed(EventBus, {
    publish: (event) =>
      Effect.sync(() => { events.push(event); }),
  });

  return { layer, events };
};
