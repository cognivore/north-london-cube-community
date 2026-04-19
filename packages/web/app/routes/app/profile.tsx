import { Form, useLoaderData, useActionData } from "react-router";
import { api, cookieHeader } from "../../lib/api";

export async function loader({ request }: { request: Request }) {
  const result = await api.me({ headers: cookieHeader(request) });
  if (!result.ok) throw new Response("Auth failed", { status: 401 });
  return { user: result.data.user };
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const data: Record<string, any> = {};

  const displayName = formData.get("displayName") as string;
  if (displayName) data.displayName = displayName;

  const bio = formData.get("bio") as string;
  if (bio !== null) data.bio = bio;

  const hostCapable = formData.get("hostCapable");
  data.hostCapable = hostCapable === "on";

  const preferred = formData.getAll("preferredFormats") as string[];
  if (preferred.length > 0) data.preferredFormats = preferred;

  const fallback = formData.getAll("fallbackFormats") as string[];
  data.fallbackFormats = fallback;

  const result = await api.updateProfile(data, { headers: cookieHeader(request) });
  if (!result.ok) return { error: result.error.message };
  return { success: "Profile updated!" };
}

export default function Profile() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const formats = [
    "swiss_draft", "team_draft_2v2", "team_draft_3v3", "team_draft_4v4",
    "rochester", "housman", "grid", "glimpse", "sealed",
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Profile</h1>

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

      <Form method="post" className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-ink-soft">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={user.displayName}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium text-ink-soft">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            defaultValue={user.profile.bio}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="hostCapable"
            defaultChecked={user.profile.hostCapable}
            className="rounded border-rule-heavy bg-paper"
          />
          I can host (bring a cube)
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">Preferred formats</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {formats.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  name="preferredFormats"
                  value={f}
                  defaultChecked={user.profile.preferredFormats.includes(f)}
                  className="rounded border-rule-heavy bg-paper"
                />
                {f.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink hover:bg-amber-soft min-h-[44px]"
        >
          Save profile
        </button>
      </Form>

      {/* DCI card */}
      {user.dciNumber != null && (
        <div className="border border-rule-heavy bg-paper-alt p-5 flex items-center gap-4">
          <img src="/icons/dci-128.png" width={128} height={128} alt="DCI" />
          <div>
            <p className="text-xs text-ink-faint uppercase tracking-wider" style={{ fontVariant: "small-caps" }}>Duelist Cuber Identifier</p>
            <p className="mono text-3xl font-bold text-ink" data-mono>
              {String(user.dciNumber).padStart(5, "0")}
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-rule pt-4">
        <p className="mono text-xs text-ink-faint" data-mono style={{ fontSize: "11px" }}>
          {user.email} &middot; {user.role} &middot; no-shows: {user.profile.noShowCount}
        </p>
      </div>
    </div>
  );
}
