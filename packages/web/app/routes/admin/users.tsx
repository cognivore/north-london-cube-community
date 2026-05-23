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

  if (intent === "merge") {
    const sourceId = formData.get("sourceId") as string;
    const targetId = formData.get("targetId") as string;
    if (!sourceId || !targetId) return { error: "Pick a target user to merge into" };
    const res = await fetch(
      `${SERVER_API_BASE}/api/admin/users/${sourceId}/merge-into/${targetId}`,
      { method: "POST", headers: { "Content-Type": "application/json", ...ch } },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Merge failed (${res.status})` };
    }
    const body = await res.json().catch(() => ({} as any));
    const moved = body?.moved ?? {};
    const summary = Object.entries(moved)
      .filter(([, n]) => (n as number) > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");
    return { success: summary ? `Merged. Moved ${summary}.` : "Merged. (no attached rows)" };
  }

  return null;
}

export default function AdminUsers() {
  const { users } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const editingId = params.get("edit");
  const mergingId = params.get("merge");

  // *@*.local accounts are admin-created walk-in placeholders. Surfacing
  // "merge into" lets a coordinator fold them into the real account once
  // the player registers properly. Targets are every non-local user.
  const isLocalEmail = (email: string) => /@[^@]+\.local$/i.test(email);
  const mergeTargets = users.filter((u) => !isLocalEmail(u.email));

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
                const isMerging = mergingId === u.id;
                const isLocal = isLocalEmail(u.email);
                if (isEditing) {
                  return (
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
                  );
                }
                if (isMerging) {
                  return (
                  <tr key={u.id} className="border-b border-ink-faint/10 bg-amber-soft">
                    <td colSpan={4} className="px-3 py-3">
                      <Form
                        method="post"
                        className="space-y-2"
                        onSubmit={(e) => {
                          const form = e.currentTarget as HTMLFormElement;
                          const sel = form.querySelector<HTMLSelectElement>('select[name="targetId"]');
                          const targetLabel = sel?.options[sel.selectedIndex]?.text ?? "target";
                          if (!confirm(`Merge ${u.displayName} (${u.email}) → ${targetLabel}?\n\nThis reassigns all of this account's data to the target and deletes this account. Cannot be undone.`)) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="intent" value="merge" />
                        <input type="hidden" name="sourceId" value={u.id} />
                        <p className="text-sm text-amber">
                          Merge <strong>{u.displayName}</strong>{" "}
                          <span className="text-ink-faint">({u.email})</span> into:
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            name="targetId"
                            required
                            defaultValue=""
                            className="flex-1 min-w-[260px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
                          >
                            <option value="" disabled>Pick a target user…</option>
                            {mergeTargets.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.displayName} — {t.email}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="rounded-sm border border-warn bg-paper px-3 py-1.5 text-xs font-semibold text-warn hover:bg-warn-soft"
                          >
                            Merge
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = new URLSearchParams(params);
                              next.delete("merge");
                              setParams(next, { replace: true });
                            }}
                            className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-alt"
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="text-xs text-ink-faint">
                          Reassigns all RSVPs, cubes, enrollments, seats, matches, etc.
                          on the source to the target, then deletes the source.
                          Same-Friday conflicts on RSVPs/votes are resolved in the target's favour.
                        </p>
                      </Form>
                    </td>
                  </tr>
                  );
                }
                return (
                  <tr key={u.id} className="border-b border-ink-faint/10 last:border-0">
                    <td className="px-3 py-2 text-ink">
                      {u.displayName}
                      {isLocal && (
                        <span className="ml-2 inline-block rounded-sm bg-amber-soft px-1.5 py-0.5 text-xs text-amber">walk-in</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft" data-mono>
                      {u.createdAt.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-ink-faint">{u.role}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {isLocal && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = new URLSearchParams(params);
                              next.set("merge", u.id);
                              setParams(next, { replace: true });
                            }}
                            className="text-xs text-amber hover:underline"
                          >
                            merge into…
                          </button>
                        )}
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
                      </div>
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
