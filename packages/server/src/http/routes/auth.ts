/**
 * Auth routes — registration, verify, login, logout.
 */

import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../middleware.js";
import { apiError } from "../middleware.js";
import { register, verify, login, logout } from "../../programs/auth.js";

// Extract error kind from Effect's FiberFailure-wrapped errors
function extractErrorKind(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const obj = e as Record<string, unknown>;
  // Direct { kind: "..." }
  if (typeof obj.kind === "string") return obj.kind;
  // FiberFailure wraps: { _tag: "Fail", error: { kind: "..." } } — but it's on the prototype
  // Access via property traversal
  try {
    const str = String(e);
    const match = str.match(/"kind"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {}
  // Traverse known Effect error shapes
  if ("error" in obj) return extractErrorKind(obj.error);
  if ("cause" in obj) return extractErrorKind(obj.cause);
  return undefined;
}

const auth = new Hono<AppEnv>();

// POST /api/auth/register
auth.post("/register", async (c) => {
  const body = await c.req.json();
  const run = c.get("effectRuntime");

  try {
    const result = await run(
      register({
        email: body.email,
        displayName: body.displayName,
        inviteCode: body.inviteCode,
      }),
    );
    return c.json({
      userId: result.user.id,
      challengeToken: result.challengeToken,
    }, 201);
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "invalid_invite_code") {
      return apiError(c, 400, "INVALID_INVITE", "Invalid or expired invite code");
    }
    if (kind === "email_taken") {
      return apiError(c, 409, "EMAIL_TAKEN", "Email already registered");
    }
    return apiError(c, 500, "INTERNAL", "Registration failed");
  }
});

// POST /api/auth/verify
auth.post("/verify", async (c) => {
  const body = await c.req.json();
  const run = c.get("effectRuntime");

  try {
    const result = await run(
      verify({ userId: body.userId, challenge: body.challenge }),
    );

    setCookie(c, "session", result.session.id, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 14 * 24 * 60 * 60,
      path: "/",
    });

    return c.json({ user: result.user });
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "invalid_challenge" || kind === "challenge_expired") {
      return apiError(c, 400, "INVALID_CHALLENGE", "Invalid or expired verification");
    }
    return apiError(c, 500, "INTERNAL", "Verification failed");
  }
});

// POST /api/auth/session (login)
auth.post("/session", async (c) => {
  const body = await c.req.json();
  const run = c.get("effectRuntime");

  try {
    const result = await run(login({ email: body.email }));
    return c.json({ emailSent: true });
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "user_not_found") {
      return apiError(c, 404, "USER_NOT_FOUND", "No account with that email");
    }
    if (kind === "user_suspended") {
      return apiError(c, 403, "SUSPENDED", "Account suspended");
    }
    return apiError(c, 500, "INTERNAL", "Login failed");
  }
});

// DELETE /api/auth/session (logout)
auth.delete("/session", async (c) => {
  const run = c.get("effectRuntime");
  const sessionCookie = c.req.header("cookie");
  const sessionId = sessionCookie?.match(/session=([^;]+)/)?.[1];

  if (sessionId) {
    await run(logout(sessionId)).catch(() => {});
  }

  deleteCookie(c, "session");
  return c.json({ ok: true });
});

export { auth };
