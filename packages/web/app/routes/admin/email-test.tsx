import { Form, useActionData } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

type EmailKind =
  | "lock"
  | "cube_announcement"
  | "wednesday"
  | "morning_locked"
  | "morning_pending"
  | "afternoon"
  | "uncancel"
  | "covered_coordinator";

const EMAILS: ReadonlyArray<{ kind: EmailKind; label: string; description: string }> = [
  { kind: "lock", label: "Lock confirmation",
    description: "When an RSVP transitions from confirmed to locked (30-min grace expires)." },
  { kind: "cube_announcement", label: "Cube announcement",
    description: "When a Friday first enters locked/confirmed — to every locked player." },
  { kind: "wednesday", label: "Wednesday midweek reminder",
    description: "Wed 09:00 London — heads-up to locked players for the upcoming Friday." },
  { kind: "morning_locked", label: "Friday morning — locked",
    description: "Fri 09:00 London — day-of reminder to locked players with the cube list." },
  { kind: "morning_pending", label: "Friday morning — pending",
    description: "Fri 09:00 London — day-of nudge to unpaired RSVPs to come anyway / bring a +1." },
  { kind: "afternoon", label: "Friday afternoon nudge",
    description: "Fri 16:30 London — \"get out of the office\" to locked players." },
  { kind: "uncancel", label: "Uncancel notification",
    description: "When admin uncancels a Friday — to every player with a live RSVP." },
  { kind: "covered_coordinator", label: "Covered RSVPs digest",
    description: "When a player marks RSVP as covered — to all coordinators." },
];

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const ch = cookieHeader(request);

  const payload = {
    kind: formData.get("kind") as string,
    to: formData.get("to") as string,
    displayName: (formData.get("displayName") as string) || undefined,
    date: (formData.get("date") as string) || undefined,
    cubeNames: (formData.get("cubeNames") as string) || undefined,
  };

  if (!payload.kind) return { error: "Pick an email type." };
  if (!payload.to) return { error: "Enter a recipient address." };

  const res = await fetch(`${SERVER_API_BASE}/api/admin/test-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ch },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: body?.error?.message ?? `Send failed (${res.status})` };
  }
  return {
    success: `Sent "${body.subject}" to ${body.to}.`,
    preview: body.body as string,
  };
}

export default function EmailTest() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Test state machine flow</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Render any transactional email with placeholder context and send it to
          an address you control. Subjects are prefixed with{" "}
          <code>[PREVIEW]</code> so they can't be mistaken for the real thing.
        </p>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">
          {actionData.error}
        </div>
      )}
      {actionData && "success" in actionData && actionData.success && (
        <div className="space-y-3">
          <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">
            {actionData.success}
          </div>
          {actionData.preview && (
            <pre className="overflow-x-auto rounded-sm border border-rule bg-paper p-3 text-xs text-ink-soft whitespace-pre-wrap">
{actionData.preview}
            </pre>
          )}
        </div>
      )}

      <Form method="post" className="space-y-4 rounded-sm border border-rule-heavy bg-paper-alt p-4">
        <div>
          <label htmlFor="to" className="block text-sm font-medium text-ink-soft">
            Recipient email
          </label>
          <input
            id="to"
            name="to"
            type="email"
            required
            placeholder="you@example.com"
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="kind" className="block text-sm font-medium text-ink-soft">
            Email type
          </label>
          <select
            id="kind"
            name="kind"
            required
            defaultValue=""
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          >
            <option value="" disabled>Pick an email…</option>
            {EMAILS.map(e => (
              <option key={e.kind} value={e.kind}>{e.label}</option>
            ))}
          </select>
          <ul className="mt-3 space-y-1 text-xs text-ink-faint">
            {EMAILS.map(e => (
              <li key={e.kind}>
                <code className="text-ink-soft">{e.kind}</code> — {e.description}
              </li>
            ))}
          </ul>
        </div>

        <details className="rounded-sm border border-rule p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-soft">
            Customise context (optional)
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="displayName" className="block text-xs font-medium text-ink-soft">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                placeholder="Friend"
                className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="date" className="block text-xs font-medium text-ink-soft">
                Friday date (YYYY-MM-DD)
              </label>
              <input
                id="date"
                name="date"
                type="text"
                placeholder="2026-05-15"
                className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="cubeNames" className="block text-xs font-medium text-ink-soft">
                Cube names (comma-separated)
              </label>
              <input
                id="cubeNames"
                name="cubeNames"
                type="text"
                placeholder="Powered Vintage, Sealed pool"
                className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>
        </details>

        <button
          type="submit"
          className="rounded-sm border border-dci-teal bg-paper px-4 py-2.5 font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
        >
          Send preview email
        </button>
      </Form>
    </div>
  );
}
