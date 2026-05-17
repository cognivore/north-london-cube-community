import { Form, useLoaderData, useActionData, useSearchParams } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

type AdminUser = {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
  role: string;
};

export async function loader({ request }: { request: Request }) {
  const res = await fetch(`${SERVER_API_BASE}/api/admin/users`, {
    headers: cookieHeader(request),
  });
  if (!res.ok) return { users: [] as AdminUser[] };
  const body = (await res.json()) as {
    users: Array<{ id: string; displayName: string; email: string; createdAt: string; role: string }>;
  };
  const users: AdminUser[] = body.users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    createdAt: u.createdAt,
    role: u.role,
  }));
  users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { users };
}

export async function action({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const userId = formData.get("userId") as string;
    const displayName = (formData.get("displayName") as string | null)?.trim();
    const email = (formData.get("email") as string | null)?.trim();
    const payload: Record<string, string> = {};
    if (displayName) payload.displayName = displayName;
    if (email) payload.email = email;
    if (Object.keys(payload).length === 0) {
      return { error: "Nothing to update" };
    }
    const res = await fetch(`${SERVER_API_BASE}/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Update failed (${res.status})` };
    }
    return { success: `Updated ${displayName ?? "user"}` };
  }

  return null;
}

export default function AdminUsers() {
  const { users } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const editingId = params.get("edit");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink">Users</h1>
      <p className="text-sm text-ink-faint">
        {users.length} registered {users.length === 1 ? "user" : "users"}.
        Emails are revealed only while editing a row.
      </p>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

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
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id;
                return isEditing ? (
                  <tr key={u.id} className="border-b border-ink-faint/10 bg-paper">
                    <td colSpan={4} className="px-3 py-3">
                      <Form method="post" className="space-y-2">
                        <input type="hidden" name="intent" value="update" />
                        <input type="hidden" name="userId" value={u.id} />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-ink-soft w-20">Name</label>
                          <input
                            name="displayName"
                            defaultValue={u.displayName}
                            className="flex-1 min-w-[200px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-ink-soft w-20">Email</label>
                          <input
                            name="email"
                            type="email"
                            defaultValue={u.email}
                            className="flex-1 min-w-[200px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
                          />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="submit"
                            className="rounded-sm border border-ok bg-paper px-3 py-1.5 text-xs font-semibold text-ok hover:bg-paper-alt"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = new URLSearchParams(params);
                              next.delete("edit");
                              setParams(next, { replace: true });
                            }}
                            className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-alt"
                          >
                            Cancel
                          </button>
                          <span className="text-xs text-ink-faint mono" data-mono>
                            id: {u.id.slice(0, 8)}
                          </span>
                        </div>
                      </Form>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className="border-b border-ink-faint/10 last:border-0">
                    <td className="px-3 py-2 text-ink">{u.displayName}</td>
                    <td className="px-3 py-2 text-ink-soft" data-mono>
                      {u.createdAt.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-ink-faint">{u.role}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.set("edit", u.id);
                          setParams(next, { replace: true });
                        }}
                        className="text-xs text-dci-teal hover:underline"
                      >
                        edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
