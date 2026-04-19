import { Form, useLoaderData, useActionData } from "react-router";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export async function loader({ params }: { params: { podId: string; roundNumber: string } }) {
  const podResult = await api.getPod(params.podId);
  if (!podResult.ok) throw new Response("Not found", { status: 404 });

  const pairingsResult = await api.getPairings(params.podId);
  return {
    ...podResult.data,
    pairings: pairingsResult.ok ? pairingsResult.data.pairings : [],
    currentRound: pairingsResult.ok ? pairingsResult.data.round : null,
    roundNumber: parseInt(params.roundNumber, 10),
  };
}

export async function action({ request, params }: { request: Request; params: { podId: string } }) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "report") {
    const matchId = formData.get("matchId") as string;
    const p1Wins = parseInt(formData.get("p1Wins") as string, 10);
    const p2Wins = parseInt(formData.get("p2Wins") as string, 10);
    const draws = parseInt(formData.get("draws") as string, 10);

    const result = await api.reportMatch(matchId, { p1Wins, p2Wins, draws });
    if (!result.ok) return { error: result.error.message };
    return { success: "Result reported!" };
  }

  if (intent === "start-round") {
    const roundNumber = parseInt(formData.get("roundNumber") as string, 10);
    const result = await api.startRound(params.podId, roundNumber);
    if (!result.ok) return { error: result.error.message };
    return { success: "Round started!" };
  }

  return null;
}

export default function RoundView() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { pairings, currentRound, roundNumber } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Round {roundNumber}</h1>

      {/* Timer */}
      <TimerDisplay podId={data.pod.id} />

      {actionData?.error && (
        <div className="rounded-lg bg-red-900/50 p-3 text-sm text-red-300">
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div className="rounded-lg bg-green-900/50 p-3 text-sm text-green-300">
          {actionData.success}
        </div>
      )}

      {/* Pairings */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Matches</h2>
        {pairings.map((m: any) => (
          <div
            key={m.id}
            className="rounded-xl border border-gray-800 bg-gray-900 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium text-white">{m.player1Id}</span>
                <span className="mx-2 text-gray-500">vs</span>
                <span className="font-medium text-white">{m.player2Id}</span>
              </div>
              {m.result.kind === "reported" && (
                <span className="text-sm font-mono text-amber-400">
                  {m.result.p1Wins}-{m.result.p2Wins}
                  {m.result.draws > 0 ? `-${m.result.draws}` : ""}
                </span>
              )}
            </div>

            {m.result.kind === "pending" && (
              <Form method="post" className="mt-3 flex items-end gap-2">
                <input type="hidden" name="intent" value="report" />
                <input type="hidden" name="matchId" value={m.id} />
                <ScoreInput label="P1" name="p1Wins" />
                <ScoreInput label="P2" name="p2Wins" />
                <ScoreInput label="D" name="draws" defaultValue="0" />
                <button
                  type="submit"
                  className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400 min-h-[44px]"
                >
                  Report
                </button>
              </Form>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function ScoreInput({ label, name, defaultValue = "0" }: { label: string; name: string; defaultValue?: string }) {
  return (
    <div className="w-14">
      <label className="block text-xs text-gray-400">{label}</label>
      <input
        name={name}
        type="number"
        min="0"
        max="3"
        defaultValue={defaultValue}
        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-2 text-center text-sm text-white min-h-[44px]"
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
      <div className="rounded-xl bg-gray-800 p-4 text-center text-gray-400">
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
      <div className="rounded-xl bg-gray-800 p-4 text-center">
        <p className="text-3xl font-mono font-bold text-white">
          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
        </p>
        <p className="mt-1 text-sm text-gray-400">Round in progress</p>
      </div>
    );
  }

  if (timer.kind === "paused") {
    const remaining = timer.remaining;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;

    return (
      <div className="rounded-xl bg-yellow-900/30 p-4 text-center">
        <p className="text-3xl font-mono font-bold text-yellow-400">
          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
        </p>
        <p className="mt-1 text-sm text-yellow-300">Paused</p>
      </div>
    );
  }

  if (timer.kind === "additional_turns") {
    return (
      <div className="rounded-xl bg-red-900/30 p-4 text-center">
        <p className="text-xl font-bold text-red-400">
          Time! {timer.turnsRemaining} additional turns
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-gray-800 p-4 text-center text-gray-400">
      Round complete
    </div>
  );
}
