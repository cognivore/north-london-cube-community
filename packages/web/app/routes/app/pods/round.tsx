import { Form, useLoaderData, useActionData } from "react-router";
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

  return {
    ...podResult.data,
    pairings: roundMatches,
    players,
    points,
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
    const resultValue = formData.get("result") as string;

    // Parse radio value: "2-0", "2-1", "1-2", "0-2", "1-1-1"
    let p1Wins = 0, p2Wins = 0, draws = 0;
    if (resultValue === "2-0") { p1Wins = 2; p2Wins = 0; }
    else if (resultValue === "2-1") { p1Wins = 2; p2Wins = 1; }
    else if (resultValue === "1-2") { p1Wins = 1; p2Wins = 2; }
    else if (resultValue === "0-2") { p1Wins = 0; p2Wins = 2; }
    else if (resultValue === "1-1-1") { p1Wins = 1; p2Wins = 1; draws = 1; }

    const result = await api.reportMatch(matchId, { p1Wins, p2Wins, draws }, { headers: ch });
    if (!result.ok) return { error: result.error.message };
    return { success: "Result reported!" };
  }

  return null;
}

export default function RoundView() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { pairings, currentRound, roundNumber } = data;

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

      {/* Pairings */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Matches</h2>
        {pairings.map((m: any) => {
          const p1 = (data as any).players?.[m.player1Id];
          const p2 = (data as any).players?.[m.player2Id];
          const p1Name = p1?.displayName ?? m.player1Id.slice(0, 8);
          const p2Name = p2?.displayName ?? m.player2Id.slice(0, 8);
          const p1Pts = (data as any).points?.[m.player1Id];
          const p2Pts = (data as any).points?.[m.player2Id];

          return (
            <div key={m.id} className="rounded-sm border border-rule bg-paper-alt p-4">
              {m.result.kind === "reported" ? (
                /* Reported result */
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className={`font-medium ${m.result.p1Wins > m.result.p2Wins ? "text-ink" : "text-ink-faint"}`}>{p1Name}</span>
                    {p1Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p1Pts})</span>}
                    <span className="mx-2 text-ink-faint">vs</span>
                    <span className={`font-medium ${m.result.p2Wins > m.result.p1Wins ? "text-ink" : "text-ink-faint"}`}>{p2Name}</span>
                    {p2Pts != null && <span className="mono text-xs text-ink-faint ml-1" data-mono>({p2Pts})</span>}
                  </div>
                  <span className="mono font-bold text-amber" data-mono>
                    {m.result.p1Wins}–{m.result.p2Wins}
                    {m.result.draws > 0 ? `–${m.result.draws}` : ""}
                  </span>
                </div>
              ) : (
                /* Pending — radio-style result entry */
                <Form method="post">
                  <input type="hidden" name="intent" value="report" />
                  <input type="hidden" name="matchId" value={m.id} />

                  <div className="space-y-3">
                    {/* Common results as radio buttons */}
                    <fieldset className="space-y-2">
                      <legend className="text-xs text-ink-faint uppercase tracking-wider" style={{ fontVariant: "small-caps" }}>
                        Result
                      </legend>

                      <label className="flex items-center gap-3 rounded-sm bg-paper-sunken px-3 py-2.5 min-h-[44px] cursor-pointer">
                        <input type="radio" name="result" value="2-0" defaultChecked className="accent-amber" />
                        <span className="font-medium text-ink">{p1Name}</span>
                        <span className="mono text-ink-faint ml-auto" data-mono>2–0</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-sm bg-paper-sunken px-3 py-2.5 min-h-[44px] cursor-pointer">
                        <input type="radio" name="result" value="2-1" className="accent-amber" />
                        <span className="font-medium text-ink">{p1Name}</span>
                        <span className="mono text-ink-faint ml-auto" data-mono>2–1</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-sm bg-paper-sunken px-3 py-2.5 min-h-[44px] cursor-pointer">
                        <input type="radio" name="result" value="1-2" className="accent-amber" />
                        <span className="font-medium text-ink">{p2Name}</span>
                        <span className="mono text-ink-faint ml-auto" data-mono>1–2</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-sm bg-paper-sunken px-3 py-2.5 min-h-[44px] cursor-pointer">
                        <input type="radio" name="result" value="0-2" className="accent-amber" />
                        <span className="font-medium text-ink">{p2Name}</span>
                        <span className="mono text-ink-faint ml-auto" data-mono>0–2</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-sm bg-paper-sunken px-3 py-2.5 min-h-[44px] cursor-pointer">
                        <input type="radio" name="result" value="1-1-1" className="accent-amber" />
                        <span className="text-ink-faint">Draw</span>
                        <span className="mono text-ink-faint ml-auto" data-mono>1–1–1</span>
                      </label>
                    </fieldset>

                    <button type="submit"
                      className="w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink min-h-[44px]">
                      Report result
                    </button>
                  </div>
                </Form>
              )}
            </div>
          );
        })}
      </section>
    </div>
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
