/**
 * Hono app — mounts all route groups.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import type { Effect } from "effect";
import type { AppEnv } from "./middleware.js";
import { auth } from "./routes/auth.js";
import { fridays } from "./routes/fridays.js";
import { cubes } from "./routes/cubes.js";
import { pods } from "./routes/pods.js";
import { me } from "./routes/me.js";
import { venues } from "./routes/venues.js";
import { admin } from "./routes/admin.js";
import { lifecycle } from "./routes/lifecycle.js";
import { testmode } from "./routes/testmode.js";

export function createApp(
  runEffect: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>,
) {
  const app = new Hono<AppEnv>();

  // Global middleware — inject Effect runtime FIRST
  app.use("*", async (c, next) => {
    c.set("effectRuntime", runEffect);
    await next();
  });

  app.use("*", honoLogger());
  app.use(
    "*",
    cors({
      origin: ["http://localhost:17556", "https://north.md110.se"],
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "x-csrf-token"],
    }),
  );

  // Mount routes
  app.route("/api/auth", auth);
  app.route("/api/fridays", fridays);
  app.route("/api/cubes", cubes);
  app.route("/api/pods", pods);
  app.route("/api/me", me);
  app.route("/api/venues", venues);
  app.route("/api/admin", admin);
  app.route("/api/lifecycle", lifecycle);
  app.route("/api/test", testmode);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // Hard logout — always clears cookie, no auth needed
  app.get("/api/logout", (c) => {
    c.header("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
    return c.json({ ok: true });
  });

  return app;
}
