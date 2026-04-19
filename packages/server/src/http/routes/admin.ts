/**
 * Admin routes — force state, ban users, audit log.
 */

import { Hono } from "hono";
import { Effect } from "effect";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware, coordinatorMiddleware } from "../middleware.js";
import {
  FridayRepo, UserRepo, AuditRepo,
} from "../../repos/types.js";
import { transition } from "@cubehall/core";
import type { FridayEvent } from "@cubehall/core";
import { isOk } from "@cubehall/core";

const admin = new Hono<AppEnv>();

admin.use("*", authMiddleware());
admin.use("*", coordinatorMiddleware());

// POST /api/admin/fridays/:id/force-state
admin.post("/fridays/:id/force-state", async (c) => {
  const run = c.get("effectRuntime");
  const fridayId = c.req.param("id");
  const body = await c.req.json();

  try {
    const result = await run(
      Effect.gen(function* () {
        const fridayRepo = yield* FridayRepo;
        const friday = yield* fridayRepo.findById(fridayId! as any);
        if (!friday) return { error: "not_found" };

        const event: FridayEvent = { kind: "admin_cancel", reason: body.reason ?? "Admin override" };
        const next = transition(friday.state, event);
        if (!isOk(next)) return { error: next.error.message };

        yield* fridayRepo.updateState(friday.id, next.value);
        return { friday: { ...friday, state: next.value } };
      }),
    );

    if ("error" in result && typeof result.error === "string") {
      return apiError(c, 400, "TRANSITION_ERROR", result.error);
    }
    return c.json(result);
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to force state");
  }
});

// POST /api/admin/users/:id/ban
admin.post("/users/:id/ban", async (c) => {
  const run = c.get("effectRuntime");
  const userId = c.req.param("id");
  const body = await c.req.json();

  try {
    await run(
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const user = yield* userRepo.findById(userId as any);
        if (!user) return;

        yield* userRepo.updateProfile(user.id, {
          ...user.profile,
          banned: { kind: "banned", until: body.until, reason: body.reason },
        });
      }),
    );
    return c.json({ ok: true });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to ban user");
  }
});

// GET /api/admin/audit
admin.get("/audit", async (c) => {
  const run = c.get("effectRuntime");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  try {
    const events = await run(
      Effect.gen(function* () {
        const auditRepo = yield* AuditRepo;
        return yield* auditRepo.findRecent(limit);
      }),
    );
    return c.json({ events });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to load audit log");
  }
});

export { admin };
