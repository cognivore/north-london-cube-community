import { Form, useLoaderData, useActionData, useSearchParams } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

type AdminUser = {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
  role: string;
  authKind?: string;
};

type AdminMerge = {
  id: string;
  source: { id: string; displayName?: string; email?: string };
  target: { id: string; displayName?: string; email?: string };
  performedBy: string;
  performedAt: string;
  revertedAt: string | null;
  revertedBy: string | null;
};

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const [usersRes, mergesRes] = await Promise.all([
    fetch(`${SERVER_API_BASE}/api/admin/users`, ch),
    fetch(`${SERVER_API_BASE}/api/admin/user-merges?status=active`, ch),
  ]);
  const users: AdminUser[] = usersRes.ok
    ? ((await usersRes.json()) as { users: AdminUser[] }).users
    : [];
  users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const merges: AdminMerge[] = mergesRes.ok
    ? ((await mergesRes.json()) as { merges: AdminMerge[] }).merges
    : [];
  return { users, merges };
}

export async function action({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const userId = formData.get("userId") as string;
    const displayName = (formData.get("displayName") as string | null)?.trim();
    const email = (formData.get("email") as string | null)?.trim();
    const role = (formData.get("role") as string | null)?.trim();
    const payload: Record<string, string> = {};
    if (displayName) payload.displayName = displayName;
    if (email) payload.email = email;
    if (role) payload.role = role;
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
    return { success: summary ? `Merged. Moved ${summary}. Revertible from the Merged accounts panel.` : "Merged. (no attached rows)" };
  }

  if (intent === "revert-merge") {
    const mergeId = formData.get("mergeId") as string;
    if (!mergeId) return { error: "Missing mergeId" };
    const res = await fetch(
      `${SERVER_API_BASE}/api/admin/user-merges/${mergeId}/revert`,
      { method: "POST", headers: { "Content-Type": "application/json", ...ch } },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Revert failed (${res.status})` };
    }
    return { success: "Merge reverted. Source account restored." };
  }

  return null;
}

export default function AdminUsers() {
  const { users, merges } = useLoaderData<typeof loader>();
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
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-ink-soft w-20">Role</label>
                          <select
                            name="role"
                            defaultValue={u.role}
                            className="flex-1 min-w-[200px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
                          >
                            <option value="member">member</option>
                            <option value="coordinator">coordinator</option>
                          </select>
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
                          if (!confirm(`Merge ${u.displayName} (${u.email}) → ${targetLabel}?\n\nReassigns all of this account's data to the target and marks this account as merged (hidden from listings, blocked from login). Revertible from the Merged accounts panel.`)) {
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
                          on the source to the target, then marks the source as
                          merged (hidden, login blocked). Revertible from the
                          Merged accounts panel below. Same-Friday conflicts on
                          RSVPs/votes are resolved in the target's favour.
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

      {merges.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Merged accounts</h2>
          <p className="text-xs text-ink-faint">
            Merges are recorded so they can be reverted. The source's history
            has been reattributed to the target; revert restores it.
          </p>
          <div className="overflow-x-auto rounded-sm bg-paper-alt">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-faint/20 text-left text-ink-soft">
                  <th className="px-3 py-2 font-medium">Source (merged)</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {merges.map((m) => (
                  <tr key={m.id} className="border-b border-ink-faint/10 last:border-0">
                    <td className="px-3 py-2 text-ink">
                      {m.source.displayName ?? m.source.id.slice(0, 8)}
                      <div className="text-xs text-ink-faint">{m.source.email}</div>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {m.target.displayName ?? m.target.id.slice(0, 8)}
                      <div className="text-xs text-ink-faint">{m.target.email}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-soft" data-mono>
                      {m.performedAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Form
                        method="post"
                        className="inline-block"
                        onSubmit={(e) => {
                          if (!confirm(`Revert this merge?\n\n${m.source.displayName ?? m.source.id} will be restored as a separate account; rows reassigned during the merge will move back.`)) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="intent" value="revert-merge" />
                        <input type="hidden" name="mergeId" value={m.id} />
                        <button
                          type="submit"
                          className="rounded-sm border border-warn bg-paper px-3 py-1 text-xs text-warn hover:bg-warn-soft"
                        >
                          revert
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
