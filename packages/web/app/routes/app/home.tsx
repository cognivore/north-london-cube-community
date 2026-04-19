import { Link, useLoaderData } from "react-router";
import { Icon } from "../../components/Icon";
import { api, cookieHeader } from "../../lib/api";

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const result = await api.listFridays(ch);
  const fridays = result.ok ? result.data.fridays : [];

  // Fetch detail (RSVP + enrollment counts) for the first 8 fridays
  const details = await Promise.all(
    fridays.slice(0, 8).map(async (f: any) => {
      const detail = await api.getFriday(f.id, ch);
      if (!detail.ok) return { ...f, rsvpCount: 0, cubeCount: 0 };
      const rsvpCount = detail.data.rsvps.filter((r: any) => r.state === "in").length;
      const cubeCount = detail.data.enrollments.filter((e: any) => !e.withdrawn).length;
      return { ...f, rsvpCount, cubeCount };
    }),
  );

  // Remaining fridays without detail
  const rest = fridays.slice(8).map((f: any) => ({ ...f, rsvpCount: null, cubeCount: null }));

  return { fridays: [...details, ...rest] };
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
      className={`block rounded-sm border border-rule bg-paper-alt hover:border-rule-heavy ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-semibold text-ink ${compact ? "text-base" : "text-xl"}`}>
            {formatted}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <StateChip state={friday.state.kind} />
            {friday.rsvpCount != null && (
              <span className="flex items-center gap-1 text-ink-faint">
                <Icon name="user" size={16} />
                <span className="mono font-bold text-ink" data-mono>{friday.rsvpCount}</span>
              </span>
            )}
            {friday.cubeCount != null && (
              <span className="flex items-center gap-1 text-ink-faint">
                <Icon name="bricks" size={16} />
                <span className="mono font-bold text-ink" data-mono>{friday.cubeCount}</span>
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-ink-faint">&rarr;</span>
      </div>
    </Link>
  );
}

function StateChip({ state }: { state: string }) {
  const colors: Record<string, string> = {
    scheduled: "text-ink-faint bg-paper-sunken",
    open: "text-ok bg-paper-sunken",
    enrollment_closed: "text-amber bg-amber-soft",
    vote_open: "text-dci-teal bg-dci-teal-soft",
    vote_closed: "text-dci-teal bg-dci-teal-soft",
    locked: "text-dci-teal bg-dci-teal-soft",
    confirmed: "text-dci-teal bg-dci-teal-soft",
    in_progress: "text-amber bg-amber-soft",
    complete: "text-ink-faint bg-paper-sunken",
    cancelled: "text-warn bg-warn-soft",
  };

  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${colors[state] ?? "text-ink-faint bg-paper-sunken"}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}
