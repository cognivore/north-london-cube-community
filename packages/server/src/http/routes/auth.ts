/**
 * Auth routes — registration, verify, login, logout.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../middleware.js";
import { apiError } from "../middleware.js";
import { register, verify, login, logout } from "../../programs/auth.js";
import {
  clientIp, isSuspectIp, issuePow, verifyPow, ipBackoff,
} from "../auth-guard.js";

// Adapt Hono's header accessor to the guard's { get } shape.
const hdr = (c: Context) => ({ get: (n: string) => c.req.header(n) });

// Shared gate for the two abuse-prone POSTs (register, login): per-IP
// exponential backoff + a required proof-of-work solution. Returns a Response
// to short-circuit on rejection, or null to proceed.
function authGate(c: Context, pow: { id?: string; nonce?: string } | undefined): Response | null {
  const ip = clientIp(hdr(c));
  const waitMs = ipBackoff(ip);
  if (waitMs > 0) {
    c.header("Retry-After", String(Math.ceil(waitMs / 1000)));
    return apiError(c, 429, "RATE_LIMITED", "Too many attempts — please wait a moment and try again.");
  }
  if (!verifyPow(pow?.id, pow?.nonce)) {
    return apiError(c, 400, "POW_REQUIRED", "Verification challenge missing or invalid — please retry.");
  }
  return null;
}

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

// GET /api/auth/challenge — issue a free proof-of-work CAPTCHA. The browser
// must solve it before register/login. Difficulty is higher for VPN /
// datacenter / Tor IPs, and `vpnHint` lets the UI suggest disabling the VPN.
auth.get("/challenge", (c) => {
  const suspect = isSuspectIp(clientIp(hdr(c)));
  const ch = issuePow(suspect);
  return c.json({ id: ch.id, salt: ch.salt, bits: ch.bits, expires: ch.expires, vpnHint: suspect });
});

// POST /api/auth/register
auth.post("/register", async (c) => {
  const body = await c.req.json();
  const gate = authGate(c, body.pow);
  if (gate) return gate;
  const run = c.get("effectRuntime");

  try {
    const result = await run(
      register({
        email: body.email,
        displayName: body.displayName,
      }),
    );
    // The challenge token MUST NOT leave the server outside of the magic-link
    // email — otherwise a scripted register+verify loop bypasses the email
    // step entirely. Only echo it back in TEST_MODE so e2e tests can drive
    // the flow without an inbox.
    const body_ = process.env.TEST_MODE === "true"
      ? { userId: result.user.id, challengeToken: result.challengeToken }
      : { userId: result.user.id };
    return c.json(body_, 201);
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "registration_closed") {
      return apiError(c, 403, "REGISTRATION_CLOSED", "Registration is not open on this environment");
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
  const gate = authGate(c, body.pow);
  if (gate) return gate;
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
