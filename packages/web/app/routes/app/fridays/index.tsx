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
      <h1 className="text-2xl font-bold text-ink">Fridays</h1>

      {fridays.length === 0 ? (
        <p className="text-ink-faint">No Fridays scheduled yet.</p>
      ) : (
        <div className="space-y-3">
          {fridays.map((f: any) => (
            <Link
              key={f.id}
              to={`/app/fridays/${f.id}`}
              className="block rounded-sm border border-rule bg-paper-alt p-4 hover:border-rule-heavy transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-ink">{f.date}</p>
                  <p className="text-sm text-ink-faint">
                    {f.state.kind.replace(/_/g, " ")}
                  </p>
                </div>
                <span className="text-ink-faint">&rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
