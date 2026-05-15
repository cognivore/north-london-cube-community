import { Form, Link, useLoaderData, useActionData } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

type HistorySummary = { matches: number; wins: number; losses: number; draws: number; pending: number; winPercent: number };
type HistoryEvent = { fridayId: string; date: string; state: string; podId: string; podFormat: string; cubeName: string; wins: number; losses: number; draws: number };
type HistoryMatch = {
  matchId: string; fridayId: string; fridayDate: string; podId: string; podFormat: string;
  cubeName: string; roundNumber: number; opponentId: string; opponentName: string;
  outcome: "win" | "loss" | "draw" | "pending";
  yourWins: number; opponentWins: number; gameDraws: number;
};

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const result = await api.me(ch);
  if (!result.ok) throw new Response("Auth failed", { status: 401 });

  let history: { summary: HistorySummary; events: HistoryEvent[]; matches: HistoryMatch[] } | null = null;
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/me/history`, { headers: cookieHeader(request) });
    if (res.ok) history = await res.json();
  } catch {}

  return { user: result.data.user, history };
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const data: Record<string, any> = {};

  const displayName = formData.get("displayName") as string;
  if (displayName) data.displayName = displayName;

  const bio = formData.get("bio") as string;
  if (bio !== null) data.bio = bio;

  const hostCapable = formData.get("hostCapable");
  data.hostCapable = hostCapable === "on";

  const preferred = formData.getAll("preferredFormats") as string[];
  if (preferred.length > 0) data.preferredFormats = preferred;

  const fallback = formData.getAll("fallbackFormats") as string[];
  data.fallbackFormats = fallback;

  const result = await api.updateProfile(data, { headers: cookieHeader(request) });
  if (!result.ok) return { error: result.error.message };
  return { success: "Profile updated!" };
}

export default function Profile() {
  const { user, history } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const formats = [
    "swiss_draft", "team_draft_2v2", "team_draft_3v3", "team_draft_4v4",
    "rochester", "housman", "grid", "glimpse", "sealed",
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Profile</h1>

      {history && history.summary.matches > 0 && (
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
      )}

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">
          {actionData.success}
        </div>
      )}

      <Form method="post" className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-ink-soft">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={user.displayName}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium text-ink-soft">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            defaultValue={user.profile.bio}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="hostCapable"
            defaultChecked={user.profile.hostCapable}
            className="rounded border-rule-heavy bg-paper"
          />
          I can host (bring a cube)
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">Preferred formats</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {formats.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  name="preferredFormats"
                  value={f}
                  defaultChecked={user.profile.preferredFormats.includes(f)}
                  className="rounded border-rule-heavy bg-paper"
                />
                {f.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink hover:bg-amber-soft min-h-[44px]"
        >
          Save profile
        </button>
      </Form>

      {/* DCI card */}
      {user.dciNumber != null && (
        <div className="border border-rule-heavy bg-paper-alt p-5 flex items-center gap-4">
          <img src="/icons/dci-128.png" width={128} height={128} alt="DCI" />
          <div>
            <p className="text-xs text-ink-faint uppercase tracking-wider" style={{ fontVariant: "small-caps" }}>Duelist Cuber Identifier</p>
            <p className="mono text-3xl font-bold text-ink" data-mono>
              {String(user.dciNumber).padStart(5, "0")}
            </p>
          </div>
        </div>
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
                      vs <span className="font-medium">{m.opponentName}</span>
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

      <div className="border-t border-rule pt-4">
        <p className="mono text-xs text-ink-faint" data-mono style={{ fontSize: "11px" }}>
          {user.email} &middot; {user.role} &middot; no-shows: {user.profile.noShowCount}
        </p>
      </div>
    </div>
  );
}
