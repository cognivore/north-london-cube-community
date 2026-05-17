import { Link, useLoaderData } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../../lib/api";

type PublicUser = {
  id: string;
  displayName: string;
  dciNumber: number | null;
  createdAt: string;
  role: string;
  bio: string;
  preferredFormats: string[];
  hostCapable: boolean;
  email: string | null;
  noShowCount: number | null;
};

type HistorySummary = { matches: number; wins: number; losses: number; draws: number; pending: number; winPercent: number };
type HistoryEvent = { fridayId: string; date: string; state: string; podId: string; podFormat: string; cubeName: string; wins: number; losses: number; draws: number };
type HistoryMatch = {
  matchId: string; fridayId: string; fridayDate: string; fridayState: string;
  podId: string; podFormat: string; cubeName: string;
  roundNumber: number; opponentId: string; opponentName: string;
  outcome: "win" | "loss" | "draw" | "pending";
  yourWins: number; opponentWins: number; gameDraws: number;
};

export async function loader({ request, params }: { request: Request; params: { userId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const [userRes, historyRes, meRes] = await Promise.all([
    fetch(`${SERVER_API_BASE}/api/users/${params.userId}`, ch),
    fetch(`${SERVER_API_BASE}/api/users/${params.userId}/history`, ch),
    api.me(ch),
  ]);
  if (!userRes.ok) throw new Response("Not found", { status: 404 });
  const { user } = (await userRes.json()) as { user: PublicUser };
  const history = historyRes.ok
    ? ((await historyRes.json()) as { summary: HistorySummary; events: HistoryEvent[]; matches: HistoryMatch[] })
    : null;
  const viewerIsCoord = meRes.ok && meRes.data.user?.role === "coordinator";
  return { user, history, viewerIsCoord };
}

export default function UserDetail() {
  const { user, history, viewerIsCoord } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{user.displayName}</h1>
        <p className="text-sm text-ink-faint">
          {user.role}
          {user.email && (
            <>
              {" · "}
              <span className="mono" data-mono>{user.email}</span>
              {viewerIsCoord && (
                <span className="ml-2 text-xs text-amber italic">
                  [You see email because you are coordinator]
                </span>
              )}
            </>
          )}
          {user.noShowCount != null && user.noShowCount > 0 && (
            <span className="ml-2 text-warn">no-shows: {user.noShowCount}</span>
          )}
        </p>
      </div>

      {user.bio && (
        <p className="text-sm text-ink whitespace-pre-wrap rounded-sm bg-paper-alt p-3 border border-rule">
          {user.bio}
        </p>
      )}

      {user.dciNumber != null && (
        <div className="border border-rule-heavy bg-paper-alt p-4 flex items-center gap-3">
          <img src="/icons/dci-128.png" width={64} height={64} alt="DCI" />
          <div>
            <p className="text-xs text-ink-faint uppercase tracking-wider" style={{ fontVariant: "small-caps" }}>DCI</p>
            <p className="mono text-2xl font-bold text-ink" data-mono>
              {String(user.dciNumber).padStart(5, "0")}
            </p>
          </div>
        </div>
      )}

      {history && history.summary.matches > 0 ? (
        <section className="rounded-sm border border-rule bg-paper-alt p-4">
          <div className="flex items-baseline gap-4">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wider" style={{ fontVariant: "small-caps" }}>
                match win %
              </p>
              <p className="mono text-3xl font-bold text-ink" data-mono>
                {(history.summary.winPercent * 100).toFixed(1)}%
              </p>
            </div>
            <div className="text-sm text-ink-faint">
              <span className="mono text-ok" data-mono>{history.summary.wins}W</span>
              {" – "}
              <span className="mono text-warn" data-mono>{history.summary.losses}L</span>
              {" – "}
              <span className="mono" data-mono>{history.summary.draws}D</span>
              {history.summary.pending > 0 && (
                <span className="mono ml-2 text-ink-faint" data-mono>· {history.summary.pending} pending</span>
              )}
            </div>
          </div>
        </section>
      ) : (
        <p className="text-sm text-ink-faint">No reported matches yet.</p>
      )}

      {user.preferredFormats.length > 0 && (
        <section className="text-sm">
          <p className="text-xs text-ink-faint uppercase tracking-wider mb-1" style={{ fontVariant: "small-caps" }}>
            preferred formats
          </p>
          <p className="text-ink">{user.preferredFormats.map(f => f.replace(/_/g, " ")).join(", ")}</p>
        </section>
      )}

      {history && history.events.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Events</h2>
          <ul className="space-y-2">
            {history.events.map((e) => (
              <li key={e.fridayId} className="rounded-sm border border-rule bg-paper-alt p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <Link to={`/app/fridays/${e.fridayId}`} className="font-medium text-ink hover:underline">
                    {e.date}
                  </Link>
                  <span className="mono text-xs text-ink-faint" data-mono>{e.state}</span>
                </div>
                <p className="text-xs text-ink-faint">
                  {e.cubeName || "—"}
                  <span className="mono ml-2" data-mono>{e.podFormat.replace(/_/g, " ")}</span>
                </p>
                <p className="mt-1 text-xs">
                  <span className="mono text-ok" data-mono>{e.wins}W</span>
                  {" – "}
                  <span className="mono text-warn" data-mono>{e.losses}L</span>
                  {" – "}
                  <span className="mono" data-mono>{e.draws}D</span>
                  <Link to={`/app/pods/${e.podId}`} className="ml-2 text-dci-teal hover:underline">
                    pod →
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history && history.matches.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Matches</h2>
          <ul className="space-y-1">
            {history.matches.map((m) => {
              const outcomeColor =
                m.outcome === "win" ? "text-ok" :
                m.outcome === "loss" ? "text-warn" :
                m.outcome === "draw" ? "text-ink" :
                "text-ink-faint";
              const outcomeLabel =
                m.outcome === "win" ? "W" :
                m.outcome === "loss" ? "L" :
                m.outcome === "draw" ? "D" :
                "·";
              return (
                <li key={m.matchId} className="rounded-sm border border-rule bg-paper-alt p-2 text-sm flex items-center gap-3">
                  <span className={`mono w-6 text-center font-bold ${outcomeColor}`} data-mono>{outcomeLabel}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink truncate">
                      vs <Link to={`/app/users/${m.opponentId}`} className="font-medium hover:underline">{m.opponentName}</Link>
                      {m.outcome !== "pending" && (
                        <span className="mono ml-2 text-ink-faint" data-mono>
                          {m.yourWins}–{m.opponentWins}{m.gameDraws > 0 ? `–${m.gameDraws}` : ""}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {m.fridayDate} · R{m.roundNumber}
                      {m.cubeName && <span> · {m.cubeName}</span>}
                    </p>
                  </div>
                  <Link
                    to={`/app/pods/${m.podId}/round/${m.roundNumber}`}
                    className="text-xs text-dci-teal hover:underline"
                  >
                    →
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
