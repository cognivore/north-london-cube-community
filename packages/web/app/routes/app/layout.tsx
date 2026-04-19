import { Link, Outlet, useLoaderData, redirect } from "react-router";
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
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/app" className="text-lg font-bold text-amber-400">
            Cubehall
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/app/fridays" className="text-gray-300 hover:text-white">
              Fridays
            </Link>
            <Link to="/app/cubes" className="text-gray-300 hover:text-white">
              Cubes
            </Link>
            {testMode && (
              <Link to="/app/test" className="text-yellow-400 hover:text-yellow-300">
                Test
              </Link>
            )}
            <Link to="/app/profile" className="text-gray-300 hover:text-white">
              {user.displayName}
            </Link>
          </div>
        </div>
      </nav>

      {/* Venue + next Friday banner — visible on every page */}
      <div className="border-b border-gray-800 bg-gray-900/50">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              <p className="font-medium text-white">
                Hitchhiker & Owl
              </p>
              <p className="text-xs text-gray-400">
                Palmers Green, N13 &middot; Doors 18:30 &middot; P1P1 18:45
              </p>
            </div>
            {nextFriday && (
              <Link
                to={`/app/fridays/${nextFriday.id}`}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm hover:bg-gray-700"
              >
                <span className="text-gray-300">{nextDate}</span>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400">
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
