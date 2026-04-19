/**
 * Hono middleware — session auth, CSRF, error handling.
 */

import { Effect } from "effect";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context as HonoContext, Next } from "hono";
import { validateSession } from "../programs/auth.js";
import type { User, Session } from "@cubehall/core";

// ---------------------------------------------------------------------------
// Env type — what middleware attaches to the context
// ---------------------------------------------------------------------------

export type AppEnv = {
  Variables: {
    user: User;
    session: Session;
    effectRuntime: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>;
  };
};

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

export function apiError(c: HonoContext, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as any);
}

// ---------------------------------------------------------------------------
// Session auth middleware
// ---------------------------------------------------------------------------

export function authMiddleware() {
  return async (c: HonoContext<AppEnv>, next: Next) => {
    const sessionId = getCookie(c, "session");
    if (!sessionId) {
      return apiError(c, 401, "UNAUTHENTICATED", "No session cookie");
    }

    const runEffect = c.get("effectRuntime");
    if (!runEffect) {
      return apiError(c, 500, "INTERNAL", "Effect runtime not configured");
    }

    try {
      const { user, session } = await runEffect(validateSession(sessionId));
      c.set("user", user);
      c.set("session", session);
      await next();
    } catch (e: unknown) {
      const error = e as { kind?: string };
      if (error.kind === "session_expired") {
        return apiError(c, 401, "SESSION_EXPIRED", "Session expired");
      }
      return apiError(c, 401, "UNAUTHENTICATED", "Invalid session");
    }
  };
}

// ---------------------------------------------------------------------------
// Admin middleware
// ---------------------------------------------------------------------------

export function adminMiddleware() {
  return async (c: HonoContext<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user || user.role !== "admin") {
      return apiError(c, 403, "FORBIDDEN", "Admin access required");
    }
    await next();
  };
}

// ---------------------------------------------------------------------------
// CSRF middleware
// ---------------------------------------------------------------------------

export function csrfMiddleware() {
  return async (c: HonoContext, next: Next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const csrfHeader = c.req.header("x-csrf-token");
      const csrfCookie = getCookie(c, "csrf");
      if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
        return apiError(c, 403, "CSRF_FAILED", "CSRF token mismatch");
      }
    }
    await next();
  };
}
