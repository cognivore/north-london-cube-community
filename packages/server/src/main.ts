/**
 * Server entry point — wires Effect layers and starts Hono.
 */

import { serve } from "@hono/node-server";
import { Effect, Layer } from "effect";
import pino from "pino";
import { createApp } from "./http/app.js";
import { ClockLive } from "./capabilities/clock.js";
import { RNGLive } from "./capabilities/rng.js";
import { makeLoggerLive } from "./capabilities/logger.js";
import { EventBus } from "./capabilities/event-bus.js";
import { Audit } from "./capabilities/audit.js";
import { getDb, persist, close } from "./db/sqlite.js";

const PORT = parseInt(process.env.PORT ?? "37556", 10);

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty" },
  }),
});

async function main() {
  // Initialize SQLite
  const db = await getDb();
  pinoLogger.info("SQLite database initialized");

  // Build layers and seed
  const repoModule = await import("./repos/sqlite-repos.js");
  await repoModule.seedDefaults();
  const AllReposLive = repoModule.AllReposLive;

  // Simple in-process event bus (outbox pattern deferred)
  const EventBusLive = Layer.succeed(EventBus, {
    publish: (event) =>
      Effect.sync(() => {
        pinoLogger.debug({ event: event.kind }, "Domain event published");
      }),
  });

  // Simple audit that writes to SQLite audit_events table
  const AuditLive = Layer.succeed(Audit, {
    record: (event) =>
      Effect.tryPromise({
        try: async () => {
          const { v7: uuidv7 } = await import("uuid");
          const db = await getDb();
          db.run(
            `INSERT INTO audit_events (id, at, actor_id, subject_kind, subject_id, action, before_val, after_val)
             VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
            [
              uuidv7(),
              typeof event.actorId === "string" ? event.actorId : "system",
              event.subject.kind,
              event.subject.id,
              event.action,
              event.before ? JSON.stringify(event.before) : null,
              event.after ? JSON.stringify(event.after) : null,
            ],
          );
          persist();
        },
        catch: (e) => {
          pinoLogger.error(e, "Audit write failed");
          return undefined as never;
        },
      }),
  });

  const AppLayer = Layer.mergeAll(
    ClockLive,
    RNGLive,
    makeLoggerLive(pinoLogger),
    EventBusLive,
    AuditLive,
    AllReposLive,
  );

  // Create app with effect runtime injected
  const runEffect = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<A, E>,
    ).catch((e) => {
      pinoLogger.error({ err: e, cause: (e as any)?.cause }, "Effect runtime error");
      throw e;
    });

  const app = createApp(runEffect);

  pinoLogger.info({ port: PORT }, "Starting cubehall server");

  serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
      pinoLogger.info({ port: info.port }, "Cubehall server listening");
    },
  );

  // Graceful shutdown
  process.on("SIGINT", () => {
    pinoLogger.info("Shutting down...");
    close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    close();
    process.exit(0);
  });
}

main().catch((e) => {
  pinoLogger.fatal(e, "Fatal startup error");
  process.exit(1);
});
