/**
 * Public user routes — view anyone's profile + history. Auth required (logged-in
 * users only) but no coordinator/role gate. Sensitive fields (email, no-show
 * count) are omitted unless the requester is the user themselves or a coordinator.
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware.js";
import { apiError, authMiddleware } from "../middleware.js";

const users = new Hono<AppEnv>();

// GET /api/users/:id — public profile (display name, bio, role, dci, preferred formats)
users.get("/:id", authMiddleware(), async (c) => {
  const requester = c.get("user");
  const targetId = c.req.param("id")!;
  try {
    const { getDb, query } = await import("../../db/sqlite.js");
    const db = await getDb();
    const rows = query<{
      id: string; email: string; display_name: string;
      dci_number: number | null; created_at: string;
      profile: string; role: string;
    }>(db, "SELECT id, email, display_name, dci_number, created_at, profile, role FROM users WHERE id = ?", [targetId]);
    if (rows.length === 0) return apiError(c, 404, "NOT_FOUND", "User not found");
    const row = rows[0]!;
    const profile = JSON.parse(row.profile);
    const isSelfOrCoord = requester.id === row.id || requester.role === "coordinator";

    return c.json({
      user: {
        id: row.id,
        displayName: row.display_name,
        dciNumber: row.dci_number,
        createdAt: row.created_at,
        role: row.role,
        bio: profile.bio ?? "",
        preferredFormats: profile.preferredFormats ?? [],
        hostCapable: !!profile.hostCapable,
        // Sensitive fields gated to self / coordinator
        email: isSelfOrCoord ? row.email : null,
        noShowCount: isSelfOrCoord ? (profile.noShowCount ?? 0) : null,
      },
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to load user: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/users/:id/history — same shape as /api/me/history but for any user.
users.get("/:id/history", authMiddleware(), async (c) => {
  const targetId = c.req.param("id")!;
  try {
    const { getDb, query } = await import("../../db/sqlite.js");
    const db = await getDb();

    const exists = query<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [targetId]);
    if (exists.length === 0) return apiError(c, 404, "NOT_FOUND", "User not found");

    const rows = query<{
      match_id: string;
      p1_id: string;
      p2_id: string;
      result: string;
      submitted_at: string | null;
      round_id: string;
      round_number: number;
      pod_id: string;
      pod_format: string;
      cube_id: string;
      friday_id: string;
      friday_date: string;
      friday_state: string;
      p1_name: string;
      p2_name: string;
    }>(db, `
      SELECT
        m.id AS match_id,
        m.player1_id AS p1_id, m.player2_id AS p2_id,
        m.result, m.submitted_at,
        r.id AS round_id, r.round_number,
        p.id AS pod_id, p.format AS pod_format, p.cube_id,
        f.id AS friday_id, f.date AS friday_date, f.state AS friday_state,
        u1.display_name AS p1_name, u2.display_name AS p2_name
      FROM matches m
      JOIN rounds r ON r.id = m.round_id
      JOIN pods p ON p.id = r.pod_id
      JOIN fridays f ON f.id = p.friday_id
      JOIN users u1 ON u1.id = m.player1_id
      JOIN users u2 ON u2.id = m.player2_id
      WHERE m.player1_id = ? OR m.player2_id = ?
      ORDER BY f.date DESC, r.round_number ASC
    `, [targetId, targetId]);

    type Outcome = "win" | "loss" | "draw" | "pending";
    let wins = 0, losses = 0, draws = 0, pending = 0;

    const uniqueCubeIds = Array.from(new Set(rows.map(r => r.cube_id)));
    const cubeNameById: Record<string, string> = {};
    if (uniqueCubeIds.length > 0) {
      const placeholders = uniqueCubeIds.map(() => "?").join(",");
      const cubes = query<{ id: string; name: string }>(db,
        `SELECT id, name FROM cubes WHERE id IN (${placeholders})`, uniqueCubeIds);
      for (const c of cubes) cubeNameById[c.id] = c.name;
    }

    const matches: Array<{
      matchId: string; fridayId: string; fridayDate: string; fridayState: string;
      podId: string; podFormat: string; cubeName: string;
      roundNumber: number; opponentId: string; opponentName: string;
      outcome: Outcome; yourWins: number; opponentWins: number; gameDraws: number;
    }> = [];

    for (const r of rows) {
      const result = JSON.parse(r.result) as
        | { kind: "reported"; p1Wins: number; p2Wins: number; draws: number }
        | { kind: string };
      const isP1 = r.p1_id === targetId;
      const opponentId = isP1 ? r.p2_id : r.p1_id;
      const opponentName = isP1 ? r.p2_name : r.p1_name;
      let outcome: Outcome = "pending";
      let yourWins = 0, opponentWins = 0, gameDraws = 0;
      if (result.kind === "reported") {
        const rep = result as { p1Wins: number; p2Wins: number; draws: number };
        gameDraws = rep.draws ?? 0;
        yourWins = isP1 ? rep.p1Wins : rep.p2Wins;
        opponentWins = isP1 ? rep.p2Wins : rep.p1Wins;
        if (yourWins > opponentWins) { outcome = "win"; wins++; }
        else if (yourWins < opponentWins) { outcome = "loss"; losses++; }
        else { outcome = "draw"; draws++; }
      } else {
        pending++;
      }
      matches.push({
        matchId: r.match_id,
        fridayId: r.friday_id,
        fridayDate: r.friday_date,
        fridayState: JSON.parse(r.friday_state).kind,
        podId: r.pod_id,
        podFormat: r.pod_format,
        cubeName: cubeNameById[r.cube_id] ?? "",
        roundNumber: r.round_number,
        opponentId,
        opponentName,
        outcome,
        yourWins,
        opponentWins,
        gameDraws,
      });
    }

    const decided = wins + losses + draws;
    const winPercent = decided > 0 ? wins / decided : 0;

    type Event = {
      fridayId: string; date: string; state: string;
      podId: string; podFormat: string; cubeName: string;
      wins: number; losses: number; draws: number;
    };
    const byFriday = new Map<string, Event>();
    for (const m of matches) {
      let evt = byFriday.get(m.fridayId);
      if (!evt) {
        evt = {
          fridayId: m.fridayId,
          date: m.fridayDate,
          state: m.fridayState,
          podId: m.podId,
          podFormat: m.podFormat,
          cubeName: m.cubeName,
          wins: 0, losses: 0, draws: 0,
        };
        byFriday.set(m.fridayId, evt);
      }
      if (m.outcome === "win") evt.wins++;
      if (m.outcome === "loss") evt.losses++;
      if (m.outcome === "draw") evt.draws++;
    }

    return c.json({
      summary: {
        matches: matches.length,
        wins, losses, draws, pending,
        winPercent,
      },
      events: Array.from(byFriday.values()),
      matches,
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to load history: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// GET /api/users — searchable directory (auth-required, basic info only)
users.get("/", authMiddleware(), async (c) => {
  const q = c.req.query("q") ?? "";
  try {
    const { getDb, query } = await import("../../db/sqlite.js");
    const db = await getDb();
    const BYE_USER_ID = "00000000-0000-0000-0000-000000000bee";
    let rows: Array<{ id: string; display_name: string; dci_number: number | null }>;
    if (q.length > 0) {
      const pattern = `%${q}%`;
      rows = query(db,
        `SELECT id, display_name, dci_number FROM users
         WHERE id != ? AND display_name LIKE ?
         ORDER BY display_name LIMIT 50`, [BYE_USER_ID, pattern]);
    } else {
      rows = query(db,
        `SELECT id, display_name, dci_number FROM users
         WHERE id != ? ORDER BY display_name LIMIT 200`, [BYE_USER_ID]);
    }
    return c.json({
      users: rows.map(r => ({ id: r.id, displayName: r.display_name, dciNumber: r.dci_number })),
    });
  } catch (e) {
    return apiError(c, 500, "INTERNAL", `Failed to list users: ${e instanceof Error ? e.message : String(e)}`);
  }
});

export { users };
