import { Link, useLoaderData } from "react-router";
import { api, cookieHeader } from "../../../lib/api";

export async function loader({ request, params }: { request: Request; params: { podId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const result = await api.getPod(params.podId, ch);
  if (!result.ok) throw new Response("Not found", { status: 404 });
  return result.data;
}

export default function PodDetail() {
  const { pod, seats, rounds, players } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          Pod — {pod.format.replace(/_/g, " ")}
        </h1>
        <p className="text-sm text-ink-faint">
          {seats.length} players | {pod.state}
        </p>
      </div>

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
            className="block rounded-sm border border-rule bg-paper-alt p-4 hover:border-rule-heavy"
          >
            <div className="flex justify-between">
              <span className="font-medium text-ink">
                Round {r.roundNumber}
              </span>
              <span className="text-sm text-ink-faint">{r.state}</span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
