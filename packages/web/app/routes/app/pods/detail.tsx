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
        <h1 className="text-2xl font-bold text-white">
          Pod — {pod.format.replace(/_/g, " ")}
        </h1>
        <p className="text-sm text-gray-400">
          {seats.length} players | {pod.state}
        </p>
      </div>

      {/* Seats */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-lg font-semibold text-white">Seats</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {seats.map((s: any) => (
            <div key={s.seatIndex} className="rounded-lg bg-gray-800 px-3 py-2 text-sm">
              <span className="font-mono text-gray-400">#{s.seatIndex}</span>{" "}
              <span className="text-white">{s.userId}</span>
              {s.team && (
                <span className={`ml-1 text-xs font-bold ${s.team === "A" ? "text-blue-400" : "text-red-400"}`}>
                  Team {s.team}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Rounds */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Rounds</h2>
        {rounds.map((r: any) => (
          <Link
            key={r.id}
            to={`/app/pods/${pod.id}/round/${r.roundNumber}`}
            className="block rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-gray-700"
          >
            <div className="flex justify-between">
              <span className="font-medium text-white">
                Round {r.roundNumber}
              </span>
              <span className="text-sm text-gray-400">{r.state}</span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
