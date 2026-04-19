/**
 * Cube routes — CRUD for personal cubes.
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";
import { createCube, updateCube, listMyCubes, listAllCubes } from "../../programs/cube.js";

// Extract error kind from Effect's FiberFailure-wrapped errors
function extractErrorKind(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.kind === "string") return obj.kind;
  try {
    const str = String(e);
    const match = str.match(/"kind"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {}
  if ("error" in obj) return extractErrorKind(obj.error);
  if ("cause" in obj) return extractErrorKind(obj.cause);
  return undefined;
}

const cubes = new Hono<AppEnv>();

// GET /api/cubes — list all cubes (public)
cubes.get("/", async (c) => {
  const run = c.get("effectRuntime");
  try {
    const list = await run(listAllCubes());
    return c.json({ cubes: list });
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to list cubes");
  }
});

// POST /api/cubes — create cube
cubes.post("/", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();

  try {
    const cube = await run(
      createCube({
        userId: user.id,
        name: body.name,
        cubecobraUrl: body.cubecobraUrl,
        supportedFormats: body.supportedFormats,
        preferredPodSize: body.preferredPodSize,
        minPodSize: body.minPodSize,
        maxPodSize: body.maxPodSize,
      }),
    );
    return c.json({ cube }, 201);
  } catch {
    return apiError(c, 500, "INTERNAL", "Failed to create cube");
  }
});

// PATCH /api/cubes/:id — update cube
cubes.patch("/:id", authMiddleware(), async (c) => {
  const run = c.get("effectRuntime");
  const user = c.get("user");
  const body = await c.req.json();
  const cubeId = c.req.param("id");

  try {
    const cube = await run(
      updateCube({ cubeId, userId: user.id, ...body }),
    );
    return c.json({ cube });
  } catch (e: unknown) {
    const kind = extractErrorKind(e);
    if (kind === "cube_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Cube not found");
    }
    if (kind === "not_owner") {
      return apiError(c, 403, "FORBIDDEN", "Not the cube owner");
    }
    return apiError(c, 500, "INTERNAL", "Failed to update cube");
  }
});

export { cubes };
