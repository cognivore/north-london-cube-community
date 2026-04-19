import { Link, Outlet, useLoaderData, redirect } from "react-router";
import { Icon } from "../../components/Icon";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

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
  const API_BASE = SERVER_API_BASE;
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

      {/* Venue + next Friday strip */}
      <div className="border-b border-rule bg-paper-alt">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center justify-between gap-3 text-xs text-ink-faint">
          <span>
            Hitchhiker & Owl &middot; Doors <span className="mono" data-mono>18:30</span> &middot; P1P1 <span className="mono" data-mono>18:45</span> &middot; <span className="mono" data-mono>£7</span>
          </span>
          {nextFriday && (
            <Link
              to={`/app/fridays/${nextFriday.id}`}
              className="shrink-0 flex items-center gap-1.5 text-ink-soft hover:text-ink"
            >
              <Icon name="calendar" size={16} alt="Date" />
              <span className="mono" data-mono>{nextDate}</span>
              <span className="bg-amber-soft px-1.5 py-0.5 text-xs font-bold text-amber mono" data-mono>
                {rsvpCount}
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
