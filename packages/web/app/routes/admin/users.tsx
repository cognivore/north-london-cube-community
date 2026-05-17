import { useLoaderData } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

type AdminUser = {
  id: string;
  displayName: string;
  createdAt: string;
  role: string;
};

export async function loader({ request }: { request: Request }) {
  const res = await fetch(`${SERVER_API_BASE}/api/admin/users`, {
    headers: cookieHeader(request),
  });
  if (!res.ok) return { users: [] as AdminUser[] };
  const body = (await res.json()) as {
    users: Array<{ id: string; displayName: string; createdAt: string; role: string }>;
  };
  const users: AdminUser[] = body.users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    createdAt: u.createdAt,
    role: u.role,
  }));
  users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { users };
}

export default function AdminUsers() {
  const { users } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink">Users</h1>
      <p className="text-sm text-ink-faint">
        {users.length} registered {users.length === 1 ? "user" : "users"}.
      </p>

      {users.length === 0 ? (
        <p className="text-ink-faint">No users yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm bg-paper-alt">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-faint/20 text-left text-ink-soft">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Registered</th>
                <th className="px-3 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-ink-faint/10 last:border-0">
                  <td className="px-3 py-2 text-ink">{u.displayName}</td>
                  <td className="px-3 py-2 text-ink-soft" data-mono>
                    {u.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-ink-faint">{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
