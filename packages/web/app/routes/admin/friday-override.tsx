import { Form, Link, useLoaderData, useActionData } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

export async function loader({ request, params }: { request: Request; params: { fridayId: string } }) {
  const result = await api.getFriday(params.fridayId, { headers: cookieHeader(request) });
  if (!result.ok) throw new Response("Not found", { status: 404 });
  return result.data;
}

export async function action({ request, params }: { request: Request; params: { fridayId: string } }) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const ch = cookieHeader(request);

  if (intent === "force-lock") {
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/force-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Force-lock failed (${res.status})` };
    }
    return { success: "Friday force-locked — empty pods created. Open Edit pods to seat players." };
  }

  if (intent === "force-complete") {
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/force-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Finish failed (${res.status})` };
    }
    return { success: "Friday finished — pending matches ignored in standings." };
  }

  if (intent === "set-state") {
    const target = formData.get("target") as string;
    if (!target) return { error: "Pick a target state first." };
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/set-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ target }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: body?.error?.message ?? `Set state failed (${res.status})` };
    }
    return { success: `State: ${body.from} → ${body.to}. Cron-email dedup cleared.` };
  }

  if (intent === "uncancel") {
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/uncancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: body?.error?.message ?? `Uncancel failed (${res.status})` };
    }
    const failedCount = Array.isArray(body.failed) ? body.failed.length : 0;
    return {
      success: `Friday restored to "${body.restoredState}". Notified ${body.notified} player${body.notified === 1 ? "" : "s"}${failedCount > 0 ? ` (${failedCount} email${failedCount === 1 ? "" : "s"} failed)` : ""}.`,
    };
  }

  // Default: force cancel
  const reason = formData.get("reason") as string;
  const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/force-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ch },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body?.error?.message ?? "Failed" };
  }

  return { success: "State forced" };
}

export default function FridayOverride() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { friday } = data;
  const stateKind = friday.state.kind;

  const canForceLock = ["open", "locked"].includes(stateKind);
  const canForceComplete = !["complete", "cancelled", "scheduled"].includes(stateKind);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">
        Admin: {friday.date}
      </h1>
      <p className="text-sm text-ink-faint">
        Current state: <span className="text-amber">{stateKind}</span>
      </p>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">
          {actionData.success}
        </div>
      )}

      {(stateKind === "locked" || stateKind === "confirmed") && (
        <Link
          to={`/admin/fridays/${friday.id}/pods`}
          className="inline-block rounded-sm border border-dci-teal bg-paper px-4 py-2 text-sm font-semibold text-dci-teal hover:bg-paper-alt"
        >
          Edit pods &rarr;
        </Link>
      )}

      {canForceLock && (
        <Form method="post" className="space-y-3 rounded-sm border border-dci-teal bg-paper-alt p-4">
          <h2 className="text-lg font-semibold text-dci-teal">Force lock</h2>
          <p className="text-sm text-ink-faint">
            Use this when auto-advance fails (e.g. fewer than 4 RSVPs, or pack rejects the configuration).
            Creates an empty pod for each enrolled cube and jumps the Friday to <code>locked</code> so you
            can hand-build the seating.
          </p>
          <input type="hidden" name="intent" value="force-lock" />
          <button
            type="submit"
            className="rounded-sm border border-dci-teal bg-paper px-4 py-2.5 font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
          >
            Force lock (skip pack)
          </button>
        </Form>
      )}

      {canForceComplete && (
        <Form method="post" className="space-y-3 rounded-sm border border-ok bg-paper-alt p-4">
          <h2 className="text-lg font-semibold text-ok">Finish Friday now</h2>
          <p className="text-sm text-ink-faint">
            Marks all non-complete rounds and pods complete and sets the Friday to <code>complete</code>.
            Pending (unplayed) matches are ignored by the standings calculator — no points assigned.
            Use this to wrap up after round 2 if round 3 wasn't played.
          </p>
          <input type="hidden" name="intent" value="force-complete" />
          <button
            type="submit"
            className="rounded-sm border border-ok bg-paper px-4 py-2.5 font-semibold text-ok hover:bg-paper-alt min-h-[44px]"
          >
            Finish Friday now
          </button>
        </Form>
      )}

      <Form method="post" className="space-y-3 rounded-sm border border-rule-heavy bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">Force state (bypass machine)</h2>
        <p className="text-sm text-ink-faint">
          Jump the Friday to any state, forward or backward. Clears cron-email
          dedup so reminders can fire again. Does <em>not</em> create or delete
          pods or RSVPs — use the dedicated buttons for that.
        </p>
        <div>
          <label htmlFor="target" className="block text-sm font-medium text-ink-soft">
            Target state
          </label>
          <select
            id="target"
            name="target"
            defaultValue=""
            required
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          >
            <option value="" disabled>Pick a state…</option>
            <option value="scheduled">scheduled</option>
            <option value="open">open</option>
            <option value="locked">locked (no pods created)</option>
            <option value="confirmed">confirmed</option>
            <option value="in_progress">in_progress</option>
            <option value="complete">complete</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
        <input type="hidden" name="intent" value="set-state" />
        <button
          type="submit"
          className="rounded-sm border border-ink bg-paper px-4 py-2.5 font-semibold text-ink hover:bg-paper-alt min-h-[44px]"
        >
          Force state
        </button>
      </Form>

      {stateKind === "cancelled" && (
        <Form method="post" className="space-y-3 rounded-sm border border-ok bg-paper-alt p-4">
          <h2 className="text-lg font-semibold text-ok">Uncancel Friday</h2>
          <p className="text-sm text-ink-faint">
            Restores the Friday and emails every player with a live RSVP that it&apos;s going ahead.
            Returns to <code>locked</code> if pods already exist, otherwise <code>open</code>.
            Past cron-email dedupe for this Friday is cleared so reminders can fire again.
          </p>
          <input type="hidden" name="intent" value="uncancel" />
          <button
            type="submit"
            className="rounded-sm border border-ok bg-paper px-4 py-2.5 font-semibold text-ok hover:bg-paper-alt min-h-[44px]"
          >
            Uncancel &amp; notify players
          </button>
        </Form>
      )}

      {stateKind !== "cancelled" && stateKind !== "complete" && (
      <Form method="post" className="space-y-4 rounded-sm border border-warn bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-warn">Force cancel</h2>
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-ink-soft">
            Reason
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            required
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
            placeholder="Admin cancellation reason"
          />
        </div>
        <button
          type="submit"
          className="rounded-sm bg-warn-soft border border-warn px-4 py-2.5 font-semibold text-warn hover:bg-warn-soft min-h-[44px]"
        >
          Force cancel Friday
        </button>
      </Form>
      )}
    </div>
  );
}
