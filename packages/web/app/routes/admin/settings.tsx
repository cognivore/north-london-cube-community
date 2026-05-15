import { Form, useActionData, useLoaderData } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

type Settings = {
  noShowEnforcementEnabled: boolean;
  oddEventsAllowed: boolean;
};

export async function loader({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const res = await fetch(`${SERVER_API_BASE}/api/admin/settings`, { headers: ch });
  if (!res.ok) throw new Response("Failed to load settings", { status: res.status });
  const data = await res.json() as { settings: Settings };
  return data;
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const ch = cookieHeader(request);

  const payload: Partial<Settings> = {
    noShowEnforcementEnabled: formData.get("noShowEnforcementEnabled") === "on",
    oddEventsAllowed:         formData.get("oddEventsAllowed") === "on",
  };

  const res = await fetch(`${SERVER_API_BASE}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ch },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: body?.error?.message ?? `Save failed (${res.status})` };
  }
  return { success: "Settings saved.", settings: body.settings as Settings };
}

export default function AdminSettings() {
  const { settings: loaded } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const settings = (actionData && "settings" in actionData ? actionData.settings : loaded) ?? loaded;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Community settings</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Runtime toggles. Defaults reflect a "cold start" community —
          permissive about no-shows and happy to run with odd headcounts.
          Tighten as the community matures.
        </p>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">
          {actionData.error}
        </div>
      )}
      {actionData && "success" in actionData && actionData.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">
          {actionData.success}
        </div>
      )}

      <Form method="post" className="space-y-5 rounded-sm border border-rule-heavy bg-paper-alt p-4">
        <Toggle
          name="noShowEnforcementEnabled"
          defaultChecked={settings.noShowEnforcementEnabled}
          title="Enforce no-show ban"
          desc={
            <>
              When <strong>on</strong>: any player with 2+ no-shows in the last
              60 days can't RSVP for 90 days. When <strong>off</strong> (cold
              start default): no-shows are still <em>tracked</em> on the user's
              profile and replaced with BYE in pods, but the ban check is
              skipped — disorganised players are still welcome.
            </>
          }
        />

        <hr className="border-rule" />

        <Toggle
          name="oddEventsAllowed"
          defaultChecked={settings.oddEventsAllowed}
          title="Allow odd-headcount Fridays"
          desc={
            <>
              When <strong>on</strong> (cold start default): every "I'm in" RSVP
              goes straight to <code>confirmed</code> regardless of total parity,
              and pending RSVPs from before this toggle was flipped get swept up
              into <code>confirmed</code> automatically. When <strong>off</strong>:
              odd headcount keeps the newest RSVP in <code>pending</code> until a
              partner pairs up.
            </>
          }
        />

        <button
          type="submit"
          className="rounded-sm border border-dci-teal bg-paper px-4 py-2.5 font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
        >
          Save settings
        </button>
      </Form>
    </div>
  );
}

function Toggle({
  name, defaultChecked, title, desc,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  desc: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 h-5 w-5 shrink-0 accent-dci-teal"
      />
      <span className="flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-faint mt-1">{desc}</span>
      </span>
    </label>
  );
}
