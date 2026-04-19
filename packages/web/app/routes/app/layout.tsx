import { Link, Outlet, useLoaderData, redirect } from "react-router";
import { Icon } from "../../components/Icon";
import { api, cookieHeader } from "../../lib/api";

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const [meResult, fridaysResult] = await Promise.all([
    api.me(ch),
    api.listFridays(ch),
  ]);
  if (!meResult.ok) {
    throw redirect("/login");
  }

  // Find the next open/upcoming friday and its RSVP count
  const fridays = fridaysResult.ok ? fridaysResult.data.fridays : [];
  const nextFriday = fridays[0];
  let rsvpCount = 0;

  if (nextFriday) {
    const detail = await api.getFriday(nextFriday.id, ch);
    if (detail.ok) {
      rsvpCount = detail.data.rsvps.filter((r: any) => r.state === "in").length;
    }
  }

  // Check if TEST_MODE is enabled
  const API_BASE = `http://localhost:${process.env.API_PORT ?? "37556"}`;
  let testMode = false;
  try {
    const testRes = await fetch(`${API_BASE}/api/test/users`);
    testMode = testRes.ok;
  } catch {}

  return {
    user: meResult.data.user,
    nextFriday,
    rsvpCount,
    testMode,
  };
}

export default function AppLayout() {
  const { user, nextFriday, rsvpCount, testMode } = useLoaderData<typeof loader>();

  const nextDate = nextFriday
    ? new Date(nextFriday.date + "T00:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-rule bg-paper">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/app" className="text-lg font-bold text-amber">
            Cubehall
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/app/fridays" className="text-ink-soft underline hover:text-ink">
              Fridays
            </Link>
            <Link to="/app/cubes" className="text-ink-soft underline hover:text-ink">
              Cubes
            </Link>
            {testMode && (
              <Link to="/app/test" className="text-amber underline hover:text-amber">
                Test
              </Link>
            )}
            <Link to="/app/profile" className="text-ink-soft underline hover:text-ink">
              {user.displayName}
            </Link>
          </div>
        </div>
      </nav>

      {/* Venue + next Friday banner — visible on every page */}
      <div className="border-b border-rule bg-paper-alt">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              <p className="font-medium text-ink">
                Hitchhiker & Owl
              </p>
              <p className="text-xs text-ink-faint">
                Palmers Green, N13 &middot; Doors 18:30 &middot; P1P1 18:45 &middot; £7 entry (venue credit)
              </p>
            </div>
            {nextFriday && (
              <Link
                to={`/app/fridays/${nextFriday.id}`}
                className="flex items-center gap-2 rounded-sm border border-rule-heavy bg-paper px-3 py-1.5 text-sm hover:bg-paper-alt"
              >
                <Icon name="calendar" size={16} alt="Date" />
                <span className="text-ink-soft">{nextDate}</span>
                <span className="bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber">
                  {rsvpCount} in
                </span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
