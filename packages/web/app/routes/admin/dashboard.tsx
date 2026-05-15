import { Link, useLoaderData } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

export async function loader({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const [fridaysRes, venuesResult] = await Promise.all([
    fetch(`${SERVER_API_BASE}/api/admin/fridays`, { headers: ch }),
    api.listVenues(),
  ]);

  const fridays: any[] = fridaysRes.ok
    ? ((await fridaysRes.json()) as { fridays: any[] }).fridays
    : [];

  return {
    fridays,
    venues: venuesResult.ok ? venuesResult.data.venues : [],
  };
}

export default function AdminDashboard() {
  const { fridays, venues } = useLoaderData<typeof loader>();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = fridays.filter((f: any) => f.date >= today);
  const past = fridays.filter((f: any) => f.date < today);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Admin Dashboard</h1>

      <section>
        <h2 className="text-lg font-semibold text-ink-soft">Upcoming fridays</h2>
        <div className="mt-2 space-y-2">
          {upcoming.length === 0 && (
            <p className="text-sm text-ink-faint">None scheduled.</p>
          )}
          {upcoming.map((f: any) => (
            <FridayLink key={f.id} friday={f} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink-soft">Past fridays</h2>
        <p className="text-xs text-ink-faint mb-2">
          Open any of these to record results after-the-fact, mark no-shows, or fix pairings.
        </p>
        <div className="mt-2 space-y-2">
          {past.length === 0 && (
            <p className="text-sm text-ink-faint">No past Fridays in the database.</p>
          )}
          {past.map((f: any) => (
            <FridayLink key={f.id} friday={f} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink-soft">Venues</h2>
        <div className="mt-2 space-y-2">
          {venues.map((v: any) => (
            <div key={v.id} className="rounded-sm bg-paper-alt p-3 text-sm">
              <span className="text-ink">{v.name}</span>
              <span className="ml-2 text-ink-faint">cap: {v.capacity}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FridayLink({ friday: f }: { friday: any }) {
  const stateKind = f.state?.kind ?? "?";
  return (
    <div className="rounded-sm bg-paper-alt p-3 text-sm flex items-center justify-between gap-3">
      <Link to={`/admin/fridays/${f.id}`} className="text-ink hover:underline">
        {f.date}
        <span className="ml-2 text-ink-faint mono" data-mono>{stateKind}</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          to={`/admin/fridays/${f.id}/pods`}
          className="text-xs text-dci-teal hover:underline"
        >
          pods
        </Link>
        <Link
          to={`/app/fridays/${f.id}`}
          className="text-xs text-ink-faint hover:underline"
        >
          public
        </Link>
      </div>
    </div>
  );
}
