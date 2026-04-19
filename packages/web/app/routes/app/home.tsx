import { Form, Link, useLoaderData, useActionData } from "react-router";
import { Icon } from "../../components/Icon";
import { api, cookieHeader } from "../../lib/api";

const API_BASE = `http://localhost:${process.env.API_PORT ?? "37556"}`;

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const [fridaysResult, meResult, venuesResult] = await Promise.all([
    api.listFridays(ch),
    api.me(ch),
    api.listVenues(),
  ]);
  const fridays = fridaysResult.ok ? fridaysResult.data.fridays : [];

  // Fetch counts only for non-planned fridays
  const enriched = await Promise.all(
    fridays.map(async (f: any) => {
      if (f.state.kind === "scheduled") return f;
      const detail = await api.getFriday(f.id, ch);
      if (!detail.ok) return f;
      return {
        ...f,
        rsvpCount: detail.data.rsvps.filter((r: any) => ["pending", "confirmed", "locked", "seated"].includes(r.state)).length,
        cubeCount: detail.data.enrollments.filter((e: any) => !e.withdrawn).length,
      };
    }),
  );

  const user = meResult.ok ? meResult.data.user : null;
  const venues = venuesResult.ok ? venuesResult.data.venues : [];

  return { fridays: enriched, user, venues };
}

export async function action({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-friday") {
    const date = formData.get("date") as string;
    const venueId = formData.get("venueId") as string;
    const res = await fetch(`${API_BASE}/api/lifecycle/fridays`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ date, venueId }),
    });
    if (!res.ok) return { error: "Failed to create Friday" };
    return { success: `Friday ${date} created!` };
  }

  if (intent === "cancel-friday") {
    const fridayId = formData.get("fridayId") as string;
    const res = await fetch(`${API_BASE}/api/admin/fridays/${fridayId}/force-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ reason: "Cancelled by coordinator" }),
    });
    if (!res.ok) return { error: "Failed to cancel Friday" };
    return { success: "Friday cancelled." };
  }

  if (intent === "open-friday") {
    const fridayId = formData.get("fridayId") as string;
    const res = await fetch(`${API_BASE}/api/lifecycle/fridays/${fridayId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) return { error: "Failed to open Friday" };
    return { success: "Friday opened!" };
  }

  return null;
}

export default function AppHome() {
  const { fridays, user, venues } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const isCoordinator = user?.role === "coordinator";
  const nextFriday = fridays[0];

  // Next Friday that falls on an actual Friday
  const getNextFridayDate = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilFriday = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilFriday);
    return d.toISOString().slice(0, 10);
  };

  return (
    <div className="space-y-8">
      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      {/* Coordinator: create Friday */}
      {isCoordinator && (
        <Form method="post" className="rounded-sm border border-rule bg-paper-alt p-4">
          <input type="hidden" name="intent" value="create-friday" />
          <h2 className="text-sm font-semibold text-ink-soft">Add a Friday</h2>
          <div className="mt-2 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs text-ink-faint">Date</label>
              <input
                name="date" type="date" defaultValue={getNextFridayDate()}
                className="w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink min-h-[44px]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-ink-faint">Venue</label>
              <select
                name="venueId"
                className="w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink min-h-[44px]"
              >
                {venues.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="rounded-sm bg-amber-soft border border-amber px-4 py-2 text-sm font-medium text-ink min-h-[44px]">
              Create
            </button>
          </div>
        </Form>
      )}

      <h1 className="text-2xl font-bold text-ink">This Friday</h1>

      {nextFriday ? (
        <FridayCard friday={nextFriday} isCoordinator={isCoordinator} />
      ) : (
        <div className="rounded-sm border border-rule bg-paper-alt p-8 text-center">
          <p className="text-ink-faint">No upcoming Fridays scheduled.</p>
        </div>
      )}

      {fridays.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-ink-soft">Upcoming</h2>
          {fridays.slice(1).map((f: any) => (
            <FridayCard key={f.id} friday={f} compact isCoordinator={isCoordinator} />
          ))}
        </div>
      )}
    </div>
  );
}

function FridayCard({ friday, compact, isCoordinator }: { friday: any; compact?: boolean; isCoordinator?: boolean }) {
  const date = new Date(friday.date + "T00:00:00");
  const formatted = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const isCancelled = friday.state.kind === "cancelled";

  return (
    <div className={`rounded-sm border border-rule bg-paper-alt ${compact ? "p-3" : "p-4"} ${isCancelled ? "opacity-50" : ""}`}>
      <Link to={`/app/fridays/${friday.id}`} className="block">
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

      {/* Coordinator actions */}
      {isCoordinator && !isCancelled && (
        <div className="mt-2 flex gap-2 border-t border-rule pt-2">
          {friday.state.kind === "scheduled" && (
            <Form method="post">
              <input type="hidden" name="intent" value="open-friday" />
              <input type="hidden" name="fridayId" value={friday.id} />
              <button type="submit" className="text-xs text-dci-teal underline">Open for RSVPs</button>
            </Form>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="cancel-friday" />
            <input type="hidden" name="fridayId" value={friday.id} />
            <button type="submit" className="text-xs text-warn underline">Cancel</button>
          </Form>
        </div>
      )}
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const labels: Record<string, string> = { scheduled: "planned" };
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
      {labels[state] ?? state.replace(/_/g, " ")}
    </span>
  );
}
