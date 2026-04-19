import { Link, useLoaderData } from "react-router";
import { api } from "../../lib/api";

export async function loader() {
  const [fridaysResult, venuesResult] = await Promise.all([
    api.listFridays(),
    api.listVenues(),
  ]);

  return {
    fridays: fridaysResult.ok ? fridaysResult.data.fridays : [],
    venues: venuesResult.ok ? venuesResult.data.venues : [],
  };
}

export default function AdminDashboard() {
  const { fridays, venues } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>

      <section>
        <h2 className="text-lg font-semibold text-gray-300">Fridays</h2>
        <div className="mt-2 space-y-2">
          {fridays.map((f: any) => (
            <Link
              key={f.id}
              to={`/admin/fridays/${f.id}`}
              className="block rounded-lg bg-gray-900 p-3 text-sm hover:bg-gray-800"
            >
              <span className="text-white">{f.date}</span>
              <span className="ml-2 text-gray-400">{f.state.kind}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-300">Venues</h2>
        <div className="mt-2 space-y-2">
          {venues.map((v: any) => (
            <div key={v.id} className="rounded-lg bg-gray-900 p-3 text-sm">
              <span className="text-white">{v.name}</span>
              <span className="ml-2 text-gray-400">cap: {v.capacity}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
