import { Link, useLoaderData } from "react-router";
import { api } from "../../lib/api";

export async function loader() {
  const result = await api.listFridays();
  return { fridays: result.ok ? result.data.fridays : [] };
}

export default function AppHome() {
  const { fridays } = useLoaderData<typeof loader>();
  const nextFriday = fridays[0];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">This Friday</h1>

      {nextFriday ? (
        <FridayCard friday={nextFriday} />
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-gray-400">No upcoming Fridays scheduled.</p>
        </div>
      )}

      {fridays.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-300">Upcoming</h2>
          {fridays.slice(1).map((f: any) => (
            <FridayCard key={f.id} friday={f} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function FridayCard({ friday, compact }: { friday: any; compact?: boolean }) {
  const date = new Date(friday.date + "T00:00:00");
  const formatted = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Link
      to={`/app/fridays/${friday.id}`}
      className={`block rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-700 transition-colors ${
        compact ? "p-4" : "p-6"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className={`font-semibold text-white ${compact ? "text-base" : "text-xl"}`}>
            {formatted}
          </p>
          <p className="mt-0.5 text-sm text-gray-400">
            State: <StateChip state={friday.state.kind} />
          </p>
        </div>
        <span className="text-gray-500">→</span>
      </div>
    </Link>
  );
}

function StateChip({ state }: { state: string }) {
  const colors: Record<string, string> = {
    scheduled: "text-gray-400",
    open: "text-green-400",
    enrollment_closed: "text-yellow-400",
    vote_open: "text-blue-400",
    vote_closed: "text-blue-300",
    locked: "text-purple-400",
    confirmed: "text-purple-300",
    in_progress: "text-amber-400",
    complete: "text-gray-400",
    cancelled: "text-red-400",
  };

  return (
    <span className={`font-medium ${colors[state] ?? "text-gray-400"}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}
