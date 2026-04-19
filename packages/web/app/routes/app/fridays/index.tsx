import { Link, useLoaderData } from "react-router";
import { api } from "../../../lib/api";

export async function loader() {
  const result = await api.listFridays();
  return { fridays: result.ok ? result.data.fridays : [] };
}

export default function FridaysList() {
  const { fridays } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Fridays</h1>

      {fridays.length === 0 ? (
        <p className="text-gray-400">No Fridays scheduled yet.</p>
      ) : (
        <div className="space-y-3">
          {fridays.map((f: any) => (
            <Link
              key={f.id}
              to={`/app/fridays/${f.id}`}
              className="block rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{f.date}</p>
                  <p className="text-sm text-gray-400">
                    {f.state.kind.replace(/_/g, " ")}
                  </p>
                </div>
                <span className="text-gray-500">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
