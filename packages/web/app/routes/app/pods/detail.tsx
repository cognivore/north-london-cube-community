import { Link, useLoaderData } from "react-router";
import { api } from "../../../lib/api";

export async function loader({ params }: { params: { podId: string } }) {
  const result = await api.getPod(params.podId);
  if (!result.ok) throw new Response("Not found", { status: 404 });
  return result.data;
}

export default function PodDetail() {
  const { pod, seats, rounds, matches } = useLoaderData<typeof loader>();

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
          {seats.map((s: any) => (
            <div key={s.seatIndex} className="rounded-sm bg-paper-sunken px-3 py-2 text-sm">
              <span className="font-mono text-ink-faint">#{s.seatIndex}</span>{" "}
              <span className="text-ink">{s.userId}</span>
              {s.team && (
                <span className={`ml-1 text-xs font-bold ${s.team === "A" ? "text-dci-teal" : "text-warn"}`}>
                  Team {s.team}
                </span>
              )}
            </div>
          ))}
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
