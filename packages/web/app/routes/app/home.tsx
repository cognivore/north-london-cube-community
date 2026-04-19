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
      <h1 className="text-2xl font-bold text-ink">This Friday</h1>

      {nextFriday ? (
        <FridayCard friday={nextFriday} />
      ) : (
        <div className="rounded-sm border border-rule bg-paper-alt p-8 text-center">
          <p className="text-ink-faint">No upcoming Fridays scheduled.</p>
        </div>
      )}

      {fridays.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-ink-soft">Upcoming</h2>
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
      className={`block rounded-sm border border-rule bg-paper-alt hover:border-rule-heavy transition-colors ${
        compact ? "p-4" : "p-6"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className={`font-semibold text-ink ${compact ? "text-base" : "text-xl"}`}>
            {formatted}
          </p>
          <p className="mt-0.5 text-sm text-ink-faint">
            State: <StateChip state={friday.state.kind} />
          </p>
        </div>
        <span className="text-ink-faint">&rarr;</span>
      </div>
    </Link>
  );
}

function StateChip({ state }: { state: string }) {
  const colors: Record<string, string> = {
    scheduled: "text-ink-faint",
    open: "text-ok",
    enrollment_closed: "text-amber",
    vote_open: "text-dci-teal",
    vote_closed: "text-dci-teal",
    locked: "text-dci-teal",
    confirmed: "text-dci-teal",
    in_progress: "text-amber",
    complete: "text-ink-faint",
    cancelled: "text-warn",
  };

  return (
    <span className={`font-medium ${colors[state] ?? "text-ink-faint"}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}
