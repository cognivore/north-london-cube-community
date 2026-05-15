import { Link, useLoaderData } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../../lib/api";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const res = await fetch(
    `${SERVER_API_BASE}/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    { headers: cookieHeader(request) },
  );
  const users: Array<{ id: string; displayName: string; dciNumber: number | null }> =
    res.ok ? ((await res.json()) as { users: any[] }).users : [];
  return { users, q };
}

export default function UsersIndex() {
  const { users, q } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink">Players</h1>

      <form method="get" className="flex items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="search by name"
          className="flex-1 rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          className="rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink hover:bg-paper-alt"
        >
          search
        </button>
      </form>

      <ul className="space-y-1">
        {users.map((u) => (
          <li key={u.id} className="rounded-sm border border-rule bg-paper-alt p-2 text-sm">
            <Link to={`/app/users/${u.id}`} className="flex items-center justify-between hover:underline">
              <span className="text-ink">{u.displayName}</span>
              {u.dciNumber != null && (
                <span className="mono text-xs text-ink-faint" data-mono>
                  DCI {String(u.dciNumber).padStart(5, "0")}
                </span>
              )}
            </Link>
          </li>
        ))}
        {users.length === 0 && <p className="text-sm text-ink-faint">No players found.</p>}
      </ul>
    </div>
  );
}
