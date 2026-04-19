/**
 * Logger capability — structured JSON logging.
 */

import { Context, Effect, Layer } from "effect";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface LoggerService {
  readonly info: (msg: string, ctx?: Record<string, unknown>) => Effect.Effect<void>;
  readonly warn: (msg: string, ctx?: Record<string, unknown>) => Effect.Effect<void>;
  readonly error: (msg: string, err: unknown, ctx?: Record<string, unknown>) => Effect.Effect<void>;
}

export class Logger extends Context.Tag("Logger")<Logger, LoggerService>() {}

// ---------------------------------------------------------------------------
// Live implementation (pino)
// ---------------------------------------------------------------------------

export const makeLoggerLive = (pinoInstance: {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}) =>
  Layer.succeed(Logger, {
    info: (msg, ctx) =>
      Effect.sync(() => pinoInstance.info(ctx ?? {}, msg)),
    warn: (msg, ctx) =>
      Effect.sync(() => pinoInstance.warn(ctx ?? {}, msg)),
    error: (msg, e, ctx) =>
      Effect.sync(() =>
        pinoInstance.error({ ...ctx, error: e instanceof Error ? e.message : String(e) }, msg),
      ),
  });

// ---------------------------------------------------------------------------
// Test implementation — capturing
// ---------------------------------------------------------------------------

export type CapturedLog = {
  readonly level: "info" | "warn" | "error";
  readonly msg: string;
  readonly ctx: Record<string, unknown>;
};

export const makeTestLogger = () => {
  const logs: CapturedLog[] = [];

  const layer = Layer.succeed(Logger, {
    info: (msg, ctx) =>
      Effect.sync(() => { logs.push({ level: "info", msg, ctx: ctx ?? {} }); }),
    warn: (msg, ctx) =>
      Effect.sync(() => { logs.push({ level: "warn", msg, ctx: ctx ?? {} }); }),
    error: (msg, e, ctx) =>
      Effect.sync(() => {
        logs.push({
          level: "error",
          msg,
          ctx: { ...ctx, error: e instanceof Error ? e.message : String(e) },
        });
      }),
  });

  return { layer, logs };
};
