import { Form, Link, useLoaderData, useActionData } from "react-router";
import { Icon } from "../../../components/Icon";
import { api, cookieHeader, SERVER_API_BASE } from "../../../lib/api";

export async function loader({ request, params }: { request: Request; params: { podId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const [podResult, meResult] = await Promise.all([
    api.getPod(params.podId, ch),
    api.me(ch),
  ]);
  if (!podResult.ok) throw new Response("Not found", { status: 404 });
  return { ...podResult.data, user: meResult.ok ? meResult.data.user : null };
}

export async function action({ request, params }: { request: Request; params: { podId: string } }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const API_BASE = SERVER_API_BASE;

  if (intent === "start-round") {
    const roundNumber = formData.get("roundNumber") as string;
    const res = await fetch(`${API_BASE}/api/lifecycle/pods/${params.podId}/rounds/${roundNumber}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) return { error: "Failed to start round" };
    return { success: `Round ${roundNumber} started — pairings generated!` };
  }

  if (intent === "complete-round") {
    const roundNumber = formData.get("roundNumber") as string;
    const res = await fetch(`${API_BASE}/api/lifecycle/pods/${params.podId}/rounds/${roundNumber}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? "Not all matches reported yet" };
    }
    return { success: `Round ${roundNumber} complete!` };
  }

  if (intent === "advance-pod") {
    // Transition pod state: drafting → building → playing
    const res = await fetch(`${API_BASE}/api/lifecycle/pods/${params.podId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) return { error: "Failed to advance pod" };
    return { success: "Pod advanced!" };
  }

  return null;
}

export default function PodDetail() {
  const { pod, seats, rounds, players, user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const isCoordinator = user?.role === "coordinator";
  const isHost = user?.id === pod.hostId;
  const canControl = isCoordinator || isHost;

  // Determine what action is available
  const currentRound = rounds.find((r: any) => r.state === "in_progress");
  const nextPendingRound = rounds.find((r: any) => r.state === "pending");
  const allRoundsComplete = rounds.every((r: any) => r.state === "complete");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          Pod — {pod.format.replace(/_/g, " ")}
        </h1>
        <p className="text-sm text-ink-faint">
          <span className="mono" data-mono>{seats.length}</span> players · {pod.state}
        </p>
      </div>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      {/* Pod lifecycle actions */}
      {canControl && pod.state !== "complete" && pod.state !== "cancelled" && (
        <div className="rounded-sm border border-dci-teal bg-dci-teal-soft p-4 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Pod controls</h3>

          {!currentRound && nextPendingRound && (
            <Form method="post">
              <input type="hidden" name="intent" value="start-round" />
              <input type="hidden" name="roundNumber" value={nextPendingRound.roundNumber} />
              <button type="submit"
                className="rounded-sm border border-dci-teal bg-paper px-4 py-2 text-sm font-medium text-dci-teal min-h-[44px]">
                <Icon name="time" size={16} /> Start Round {nextPendingRound.roundNumber} (generate pairings)
              </button>
            </Form>
          )}

          {currentRound && (
            <Form method="post">
              <input type="hidden" name="intent" value="complete-round" />
              <input type="hidden" name="roundNumber" value={currentRound.roundNumber} />
              <button type="submit"
                className="rounded-sm border border-amber bg-amber-soft px-4 py-2 text-sm font-medium text-ink min-h-[44px]">
                Complete Round {currentRound.roundNumber} (all results in?)
              </button>
            </Form>
          )}

          {allRoundsComplete && (
            <p className="text-sm text-ok font-medium">All rounds complete! Advance Friday to finish the event.</p>
          )}
        </div>
      )}

      {/* Seats */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">Seats</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {seats.map((s: any) => {
            const player = (players as any)?.[s.userId];
            const name = player?.displayName ?? s.userId.slice(0, 8);
            const dci = player?.dciNumber;
            return (
              <div key={s.seatIndex} className="rounded-sm bg-paper-sunken px-3 py-2 text-sm">
                <div className="flex items-center gap-1">
                  <span className="mono text-ink-faint" data-mono>#{s.seatIndex}</span>
                  {s.team && (
                    <span className={`text-xs font-bold ${s.team === "A" ? "text-dci-teal" : "text-warn"}`}>
                      {s.team}
                    </span>
                  )}
                </div>
                <p className="font-medium text-ink">{name}</p>
                {dci != null && (
                  <div className="mt-0.5 flex items-center gap-1">
                    <img src="/icons/dci-16.png" width={16} height={16} alt="DCI" />
                    <span className="mono text-xs text-ink-faint" data-mono>
                      {String(dci).padStart(5, "0")}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Rounds */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Rounds</h2>
        {rounds.map((r: any) => (
          <Link
            key={r.id}
            to={`/app/pods/${pod.id}/round/${r.roundNumber}`}
            className={`block rounded-sm border p-4 hover:border-rule-heavy ${
              r.state === "in_progress"
                ? "border-amber bg-amber-soft"
                : r.state === "complete"
                ? "border-ok bg-paper-alt"
                : "border-rule bg-paper-alt"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="font-medium text-ink">
                <Icon name={r.state === "complete" ? "tick" : r.state === "in_progress" ? "hourglass" : "time"} size={16} />{" "}
                Round {r.roundNumber}
              </span>
              <span className={`text-sm mono ${
                r.state === "in_progress" ? "text-amber" : r.state === "complete" ? "text-ok" : "text-ink-faint"
              }`} data-mono>
                {r.state.replace(/_/g, " ")}
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
