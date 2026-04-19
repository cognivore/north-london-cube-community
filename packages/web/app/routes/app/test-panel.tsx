import { Form, useLoaderData, useActionData, Link } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

const API_BASE = SERVER_API_BASE;

export async function loader({ request }: { request: Request }) {
  const ch = cookieHeader(request);

  // Check if TEST_MODE is enabled
  const testCheck = await fetch(`${API_BASE}/api/test/users`, {
    headers: { ...ch },
  });
  if (!testCheck.ok) {
    throw new Response("TEST_MODE not enabled", { status: 404 });
  }

  const { users } = await testCheck.json();

  // Also get fridays and their RSVP counts
  const fridaysRes = await api.listFridays({ headers: ch });
  const fridays = fridaysRes.ok ? fridaysRes.data.fridays : [];

  // Get me
  const meRes = await api.me({ headers: ch });

  return { users, fridays, currentUser: meRes.ok ? meRes.data.user : null };
}

export async function action({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-phony") {
    const count = parseInt(formData.get("count") as string, 10) || 4;
    const fridayId = formData.get("fridayId") as string || undefined;
    const res = await fetch(`${API_BASE}/api/test/phony-users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ count, fridayId: fridayId || undefined }),
    });
    const data = await res.json();
    return { success: `Created ${data.users?.length ?? 0} phony users` };
  }

  if (intent === "sign-in-as") {
    const userId = formData.get("userId") as string;
    const res = await fetch(`${API_BASE}/api/test/sign-in-as`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return { error: "Failed to sign in as user" };
    const setCookie = res.headers.get("set-cookie");
    // We need to forward this cookie to the browser
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/app",
        ...(setCookie ? { "Set-Cookie": setCookie } : {}),
      },
    });
  }

  if (intent === "advance") {
    const fridayId = formData.get("fridayId") as string;
    const res = await fetch(`${API_BASE}/api/test/advance-friday/${fridayId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return { success: `Friday advanced to: ${data.friday?.state?.kind ?? "?"}` };
  }

  if (intent === "start-round") {
    const podId = formData.get("podId") as string;
    const roundNumber = formData.get("roundNumber") as string;
    const res = await fetch(`${API_BASE}/api/test/start-round/${podId}/${roundNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return { error: "Failed to start round" };
    return { success: `Round ${roundNumber} started` };
  }

  if (intent === "report-as") {
    const matchId = formData.get("matchId") as string;
    const userId = formData.get("userId") as string;
    const p1Wins = parseInt(formData.get("p1Wins") as string, 10);
    const p2Wins = parseInt(formData.get("p2Wins") as string, 10);
    const draws = parseInt(formData.get("draws") as string, 10) || 0;
    const res = await fetch(`${API_BASE}/api/test/report-as`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ matchId, userId, p1Wins, p2Wins, draws }),
    });
    if (!res.ok) return { error: "Failed to report" };
    return { success: "Result reported" };
  }

  return null;
}

function advanceLabel(state: string): string {
  switch (state) {
    case "scheduled": return "Open RSVPs";
    case "open": return "Close enrollment →";
    case "enrollment_closed": return "Evaluate cubes →";
    case "vote_open": return "Close vote →";
    case "vote_closed": return "Lock pods →";
    case "locked": return "Confirm →";
    case "confirmed": return "Start event →";
    case "in_progress": return "Complete →";
    default: return "Advance →";
  }
}

export default function TestPanel() {
  const { users, fridays, currentUser } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="space-y-6">
      <div className="rounded-sm border-2 border-amber bg-amber-soft p-4">
        <h1 className="text-xl font-bold text-amber">TEST MODE</h1>
        <p className="text-sm text-ink-soft">
          Staging environment. You are {currentUser?.displayName ?? "unknown"} ({currentUser?.role}).
        </p>
      </div>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      {/* Create phony users */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">Create phony users</h2>
        <Form method="post" className="mt-3 flex flex-wrap gap-2 items-end">
          <input type="hidden" name="intent" value="create-phony" />
          <div>
            <label className="block text-xs text-ink-faint">Count</label>
            <input name="count" type="number" defaultValue="4" min="1" max="16"
              className="w-16 rounded-sm border border-rule-heavy bg-paper px-2 py-2 text-sm text-ink min-h-[44px]" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-ink-faint">RSVP to Friday</label>
            <select name="fridayId"
              className="w-full rounded-sm border border-rule-heavy bg-paper px-2 py-2 text-sm text-ink min-h-[44px]">
              <option value="">None</option>
              {fridays.slice(0, 8).map((f: any) => (
                <option key={f.id} value={f.id}>{f.date} ({f.state.kind})</option>
              ))}
            </select>
          </div>
          <button type="submit"
            className="rounded-sm bg-amber-soft border border-amber px-4 py-2 text-sm font-medium text-ink hover:bg-amber-soft min-h-[44px]">
            Create
          </button>
        </Form>
      </section>

      {/* Advance Friday */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">Advance Friday</h2>
        <p className="text-xs text-ink-faint mt-1">Simulates the weekly cron. Make sure cubes are enrolled before closing enrollment!</p>
        <div className="mt-3 space-y-2">
          {fridays.slice(0, 5).map((f: any) => {
            const state = f.state.kind;
            const terminal = state === "cancelled" || state === "complete";
            const label = advanceLabel(state);
            return (
              <div key={f.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink-soft">{f.date}</span>
                <span className={`text-xs ${terminal ? "text-warn" : "text-ink-faint"}`}>{state === "scheduled" ? "planned" : state.replace(/_/g, " ")}</span>
                {!terminal ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="advance" />
                    <input type="hidden" name="fridayId" value={f.id} />
                    <button type="submit"
                      className="rounded-sm bg-paper border border-dci-teal px-3 py-1 text-xs text-dci-teal hover:bg-paper-alt min-h-[44px]">
                      {label}
                    </button>
                  </Form>
                ) : (
                  <span className="text-xs text-ink-faint">—</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* User directory — sign in as anyone */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">User directory ({users.length})</h2>
        <p className="text-xs text-ink-faint mt-1">Click to sign in as that user</p>
        <div className="mt-3 space-y-1 max-h-96 overflow-y-auto">
          {users.map((u: any) => (
            <Form method="post" key={u.id} className="flex items-center justify-between rounded-sm bg-paper-sunken px-3 py-2 hover:bg-paper-alt">
              <input type="hidden" name="intent" value="sign-in-as" />
              <input type="hidden" name="userId" value={u.id} />
              <div>
                <span className="text-sm font-medium text-ink">{u.display_name}</span>
                <span className="ml-2 text-xs text-ink-faint">{u.email}</span>
                {u.role === "coordinator" && (
                  <span className="ml-2 text-xs text-amber">coordinator</span>
                )}
              </div>
              <button type="submit"
                className="rounded-sm bg-amber-soft px-2 py-1 text-xs text-amber hover:bg-amber-soft min-h-[44px]">
                Sign in as
              </button>
            </Form>
          ))}
        </div>
      </section>
    </div>
  );
}
