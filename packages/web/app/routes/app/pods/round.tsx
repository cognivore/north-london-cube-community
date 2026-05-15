import { Form, Link, useLoaderData, useActionData } from "react-router";
import { useEffect, useState } from "react";
import { api, cookieHeader, SERVER_API_BASE } from "../../../lib/api";

export async function loader({ request, params }: { request: Request; params: { podId: string; roundNumber: string } }) {
  const ch = { headers: cookieHeader(request) };
  const podResult = await api.getPod(params.podId, ch);
  if (!podResult.ok) throw new Response("Not found", { status: 404 });

  const rn = parseInt(params.roundNumber, 10);

  // Find the specific round and its matches
  const round = podResult.data.rounds.find((r: any) => r.roundNumber === rn);
  const roundMatches = round
    ? podResult.data.matches.filter((m: any) => m.roundId === round.id)
    : [];

  // Get player names + points
  const pairingsResult = await api.getPairings(params.podId, ch);
  const players = pairingsResult.ok ? (pairingsResult.data as any).players ?? {} : {};
  const points = pairingsResult.ok ? (pairingsResult.data as any).points ?? {} : {};

  const meResult = await api.me(ch);
  const currentUserId = meResult.ok ? meResult.data.user.id : null;
  const currentUserRole = meResult.ok ? meResult.data.user.role : null;

  return {
    ...podResult.data,
    pairings: roundMatches,
    players,
    points,
    currentUserId,
    currentUserRole,
    currentRound: round,
    roundNumber: rn,
  };
}

export async function action({ request, params }: { request: Request; params: { podId: string } }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "report") {
    const matchId = formData.get("matchId") as string;
    const p1Wins = parseInt(formData.get("p1wins") as string ?? "0", 10);
    const p2Wins = parseInt(formData.get("p2wins") as string ?? "0", 10);
    const draws = parseInt(formData.get("draws") as string ?? "0", 10);

    const result = await api.reportMatch(matchId, { p1Wins, p2Wins, draws }, { headers: ch });
    if (!result.ok) return { error: result.error.message };
    return { success: "Result reported!" };
  }

  if (intent === "admin-result") {
    const matchId = formData.get("matchId") as string;
    const p1Wins = parseInt(formData.get("p1wins") as string ?? "0", 10);
    const p2Wins = parseInt(formData.get("p2wins") as string ?? "0", 10);
    const draws = parseInt(formData.get("draws") as string ?? "0", 10);
    const res = await fetch(`${SERVER_API_BASE}/api/admin/matches/${matchId}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ p1Wins, p2Wins, draws }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Save failed (${res.status})` };
    }
    return { success: "Result saved" };
  }

  if (intent === "admin-complete-round") {
    const roundId = formData.get("roundId") as string;
    const res = await fetch(`${SERVER_API_BASE}/api/admin/rounds/${roundId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Complete failed (${res.status})` };
    }
    return { success: "Round marked complete" };
  }

  if (intent === "admin-delete-round") {
    const roundId = formData.get("roundId") as string;
    const res = await fetch(`${SERVER_API_BASE}/api/admin/rounds/${roundId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Delete failed (${res.status})` };
    }
    return { success: "Round deleted" };
  }

  if (intent === "save-pairings") {
    const roundId = formData.get("roundId") as string;
    const matchesRaw = formData.get("matches") as string;
    let matches: Array<{ player1Id: string; player2Id: string }>;
    try {
      matches = JSON.parse(matchesRaw);
    } catch {
      return { error: "Invalid pairings payload" };
    }
    const res = await fetch(`${SERVER_API_BASE}/api/admin/rounds/${roundId}/matches`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ matches }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Save failed (${res.status})` };
    }
    return { success: "Pairings updated" };
  }

  return null;
}

export default function RoundView() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { pairings, currentRound, roundNumber } = data;
  const isCoordinator = (data as any).currentUserRole === "coordinator";
  const seats: Array<{ userId: string; seatIndex: number; team: "A" | "B" | null }> = (data as any).seats ?? [];
  const playersDir = (data as any).players ?? {};
  const anyReported = pairings.some((m: any) => m.result?.kind === "reported");
  const canEditPairings = isCoordinator && currentRound && currentRound.state !== "complete" && !anyReported;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Round {roundNumber}</h1>

      {/* Timer */}
      <TimerDisplay podId={data.pod.id} />

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

      {/* Coordinator pairings editor */}
      {canEditPairings && (
        <PairingsEditor
          roundId={currentRound.id}
          pairings={pairings}
          seats={seats}
          players={playersDir}
        />
      )}
      {isCoordinator && anyReported && (
        <p className="text-xs text-ink-faint">
          Pairings are frozen — at least one result has been reported.
        </p>
      )}

      {/* Pairings */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Matches</h2>
        {isCoordinator && currentRound && (
          <div className="flex items-center gap-2">
            <Form method="post" className="inline-block">
              <input type="hidden" name="intent" value="admin-complete-round" />
              <input type="hidden" name="roundId" value={currentRound.id} />
              <button
                type="submit"
                className="rounded-sm border border-rule-heavy bg-paper px-3 py-1 text-xs text-ink-faint hover:text-ink"
              >
                mark round complete
              </button>
            </Form>
            <Form
              method="post"
              className="inline-block"
              onSubmit={(e) => {
                if (!confirm("Delete this round and all its matches?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="admin-delete-round" />
              <input type="hidden" name="roundId" value={currentRound.id} />
              <button
                type="submit"
                className="rounded-sm border border-warn bg-paper px-3 py-1 text-xs text-warn hover:bg-warn-soft"
              >
                delete round
              </button>
            </Form>
          </div>
        )}
        {pairings.map((m: any) => {
          const p1 = (data as any).players?.[m.player1Id];
          const p2 = (data as any).players?.[m.player2Id];
          const p1Name = p1?.displayName ?? m.player1Id.slice(0, 8);
          const p2Name = p2?.displayName ?? m.player2Id.slice(0, 8);
          const p1Pts = (data as any).points?.[m.player1Id];
          const p2Pts = (data as any).points?.[m.player2Id];
          const isMyMatch = m.player1Id === (data as any).currentUserId || m.player2Id === (data as any).currentUserId;

          return (
            <div key={m.id} className={`rounded-sm border p-4 ${isMyMatch && m.result.kind === "pending" ? "border-amber bg-amber-soft" : "border-rule bg-paper-alt"}`}>
              {m.result.kind === "reported" ? (
                /* Reported result */
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <Link to={`/app/users/${m.player1Id}`} className={`font-medium hover:underline ${m.result.p1Wins > m.result.p2Wins ? "text-ink" : "text-ink-faint"}`}>{p1Name}</Link>
                    {p1Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p1Pts})</span>}
                    <span className="mx-2 text-ink-faint">vs</span>
                    <Link to={`/app/users/${m.player2Id}`} className={`font-medium hover:underline ${m.result.p2Wins > m.result.p1Wins ? "text-ink" : "text-ink-faint"}`}>{p2Name}</Link>
                    {p2Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p2Pts})</span>}
                  </div>
                  <span className="mono font-bold text-amber" data-mono>
                    {m.result.p1Wins}–{m.result.p2Wins}
                    {m.result.draws > 0 ? `–${m.result.draws}` : ""}
                  </span>
                </div>
              ) : isMyMatch ? (
                /* My pending match — game wins tally */
                <Form method="post">
                  <input type="hidden" name="intent" value="report" />
                  <input type="hidden" name="matchId" value={m.id} />

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {/* P1 column */}
                    <div>
                      <p className="font-medium text-ink text-sm">{p1Name}</p>
                      {p1Pts != null && <p className="mono text-xs text-ink-faint" data-mono>{p1Pts} pts</p>}
                      <div className="mt-2 flex justify-center gap-3">
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p1wins" value="0" defaultChecked className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>0</span>
                        </label>
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p1wins" value="1" className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>1</span>
                        </label>
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p1wins" value="2" className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>2</span>
                        </label>
                      </div>
                    </div>

                    {/* Draw column */}
                    <div>
                      <p className="font-medium text-ink-faint text-sm">Draws</p>
                      <p className="text-xs text-ink-faint">&nbsp;</p>
                      <div className="mt-2 flex justify-center gap-3">
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="draws" value="0" defaultChecked className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>0</span>
                        </label>
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="draws" value="1" className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>1</span>
                        </label>
                      </div>
                    </div>

                    {/* P2 column */}
                    <div>
                      <p className="font-medium text-ink text-sm">{p2Name}</p>
                      {p2Pts != null && <p className="mono text-xs text-ink-faint" data-mono>{p2Pts} pts</p>}
                      <div className="mt-2 flex justify-center gap-3">
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p2wins" value="0" defaultChecked className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>0</span>
                        </label>
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p2wins" value="1" className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>1</span>
                        </label>
                        <label className="flex flex-col items-center cursor-pointer">
                          <input type="radio" name="p2wins" value="2" className="accent-amber" />
                          <span className="mono text-xs text-ink-faint" data-mono>2</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <button type="submit"
                    className="mt-3 w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink min-h-[44px]">
                    Report result
                  </button>
                </Form>
              ) : (
                /* Someone else's pending match — just show names */
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <Link to={`/app/users/${m.player1Id}`} className="font-medium text-ink hover:underline">{p1Name}</Link>
                    {p1Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p1Pts})</span>}
                    <span className="mx-2 text-ink-faint">vs</span>
                    <Link to={`/app/users/${m.player2Id}`} className="font-medium text-ink hover:underline">{p2Name}</Link>
                    {p2Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p2Pts})</span>}
                  </div>
                  <span className="mono text-xs text-ink-faint" data-mono>pending</span>
                </div>
              )}

              {/* Coordinator inline override — record/correct any match. */}
              {isCoordinator && (
                <Form method="post" className="mt-3 flex items-center gap-2 border-t border-rule pt-2">
                  <input type="hidden" name="intent" value="admin-result" />
                  <input type="hidden" name="matchId" value={m.id} />
                  <span className="text-xs text-ink-faint">admin:</span>
                  <input
                    name="p1wins"
                    type="number"
                    min={0}
                    max={3}
                    defaultValue={m.result?.kind === "reported" ? m.result.p1Wins : 0}
                    className="w-12 rounded-sm border border-rule-heavy bg-paper px-2 py-1 text-sm text-ink mono"
                    data-mono
                  />
                  <span className="text-xs text-ink-faint">–</span>
                  <input
                    name="p2wins"
                    type="number"
                    min={0}
                    max={3}
                    defaultValue={m.result?.kind === "reported" ? m.result.p2Wins : 0}
                    className="w-12 rounded-sm border border-rule-heavy bg-paper px-2 py-1 text-sm text-ink mono"
                    data-mono
                  />
                  <span className="text-xs text-ink-faint">d</span>
                  <input
                    name="draws"
                    type="number"
                    min={0}
                    max={3}
                    defaultValue={m.result?.kind === "reported" ? m.result.draws : 0}
                    className="w-12 rounded-sm border border-rule-heavy bg-paper px-2 py-1 text-sm text-ink mono"
                    data-mono
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-rule-heavy bg-paper px-3 py-1 text-xs font-semibold text-ink hover:bg-paper-alt"
                  >
                    save
                  </button>
                </Form>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function PairingsEditor({
  roundId,
  pairings,
  seats,
  players,
}: {
  roundId: string;
  pairings: Array<{ id: string; player1Id: string; player2Id: string }>;
  seats: Array<{ userId: string; seatIndex: number }>;
  players: Record<string, { displayName?: string }>;
}) {
  const playerName = (id: string) => players?.[id]?.displayName ?? id.slice(0, 8);
  const allUsers = seats.map(s => s.userId);

  return (
    <section className="rounded-sm border border-amber bg-amber-soft p-4">
      <h2 className="text-lg font-semibold text-amber mb-2">Edit pairings</h2>
      <p className="text-xs text-ink-faint mb-3">
        Override the auto-generated pairings. Save replaces all matches for this round.
        A player can appear at most once. Editing is disabled once any result is reported.
      </p>
      <Form
        method="post"
        onSubmit={(e) => {
          const form = e.currentTarget as HTMLFormElement;
          const rows = form.querySelectorAll<HTMLDivElement>("[data-pair-row]");
          const matches: Array<{ player1Id: string; player2Id: string }> = [];
          const seen = new Set<string>();
          let dup = false;
          for (const row of Array.from(rows)) {
            const p1 = row.querySelector<HTMLSelectElement>("[data-p1]")?.value ?? "";
            const p2 = row.querySelector<HTMLSelectElement>("[data-p2]")?.value ?? "";
            if (!p1 || !p2 || p1 === p2) continue;
            if (seen.has(p1) || seen.has(p2)) { dup = true; break; }
            seen.add(p1); seen.add(p2);
            matches.push({ player1Id: p1, player2Id: p2 });
          }
          if (dup) {
            e.preventDefault();
            alert("A player appears in more than one match — fix and try again.");
            return;
          }
          if (matches.length === 0) {
            e.preventDefault();
            alert("At least one valid match required.");
            return;
          }
          (form.querySelector('input[name="matches"]') as HTMLInputElement).value = JSON.stringify(matches);
        }}
      >
        <input type="hidden" name="intent" value="save-pairings" />
        <input type="hidden" name="roundId" value={roundId} />
        <input type="hidden" name="matches" value="" />
        <ol className="space-y-2">
          {pairings.map((m, i) => (
            <li key={m.id} data-pair-row className="flex items-center gap-2">
              <span className="mono text-xs text-ink-faint w-6" data-mono>#{i + 1}</span>
              <select
                data-p1
                defaultValue={m.player1Id}
                className="flex-1 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
              >
                {allUsers.map(u => (
                  <option key={u} value={u}>{playerName(u)}</option>
                ))}
              </select>
              <span className="text-xs text-ink-faint">vs</span>
              <select
                data-p2
                defaultValue={m.player2Id}
                className="flex-1 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
              >
                {allUsers.map(u => (
                  <option key={u} value={u}>{playerName(u)}</option>
                ))}
              </select>
            </li>
          ))}
        </ol>
        <button
          type="submit"
          className="mt-3 rounded-sm border border-amber bg-paper px-4 py-2 text-sm font-semibold text-amber hover:bg-paper-alt min-h-[44px]"
        >
          Save pairings
        </button>
      </Form>
    </section>
  );
}

function ScoreInput({ label, name, defaultValue = "0" }: { label: string; name: string; defaultValue?: string }) {
  return (
    <div className="w-14">
      <label className="block text-xs text-ink-faint">{label}</label>
      <input
        name={name}
        type="number"
        min="0"
        max="3"
        defaultValue={defaultValue}
        className="w-full rounded-sm border border-rule-heavy bg-paper px-2 py-2 text-center text-sm text-ink min-h-[44px]"
      />
    </div>
  );
}

function TimerDisplay({ podId }: { podId: string }) {
  const [timer, setTimer] = useState<any>({ kind: "not_started" });

  useEffect(() => {
    const eventSource = new EventSource(`/api/pods/${podId}/timer`);
    eventSource.addEventListener("timer", (e) => {
      try {
        setTimer(JSON.parse(e.data));
      } catch {}
    });
    return () => eventSource.close();
  }, [podId]);

  if (timer.kind === "not_started") {
    return (
      <div className="rounded-sm bg-paper-alt p-4 text-center text-ink-faint">
        Timer not started
      </div>
    );
  }

  if (timer.kind === "running") {
    const deadline = new Date(timer.deadline).getTime();
    const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;

    return (
      <div className="rounded-sm bg-paper-alt p-4 text-center">
        <p className="text-3xl font-mono font-bold text-ink">
          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
        </p>
        <p className="mt-1 text-sm text-ink-faint">Round in progress</p>
      </div>
    );
  }

  if (timer.kind === "paused") {
    const remaining = timer.remaining;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;

    return (
      <div className="rounded-sm bg-amber-soft p-4 text-center">
        <p className="text-3xl font-mono font-bold text-amber">
          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
        </p>
        <p className="mt-1 text-sm text-amber">Paused</p>
      </div>
    );
  }

  if (timer.kind === "additional_turns") {
    return (
      <div className="rounded-sm bg-warn-soft p-4 text-center">
        <p className="text-xl font-bold text-warn">
          Time! {timer.turnsRemaining} additional turns
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-sm bg-paper-alt p-4 text-center text-ink-faint">
      Round complete
    </div>
  );
}

function PlayerName({ player, fallback, pts }: { player: any; fallback: string; pts?: number }) {
  const name = player?.displayName ?? fallback.slice(0, 8);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-ink">{name}</span>
      {pts != null && (
        <span className="mono text-xs text-ink-faint" data-mono>
          ({pts} pts)
        </span>
      )}
    </span>
  );
}
