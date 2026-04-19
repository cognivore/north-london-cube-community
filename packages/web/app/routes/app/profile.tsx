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

  const result = await api.updateProfile(data);
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
      <h1 className="text-2xl font-bold text-white">Profile</h1>

      {actionData?.error && (
        <div className="rounded-lg bg-red-900/50 p-3 text-sm text-red-300">
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div className="rounded-lg bg-green-900/50 p-3 text-sm text-green-300">
          {actionData.success}
        </div>
      )}

      <Form method="post" className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-300">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={user.displayName}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium text-gray-300">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            defaultValue={user.profile.bio}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white focus:border-amber-500 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            name="hostCapable"
            defaultChecked={user.profile.hostCapable}
            className="rounded border-gray-600 bg-gray-800 text-amber-500"
          />
          I can host (bring a cube)
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-gray-300">Preferred formats</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {formats.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  name="preferredFormats"
                  value={f}
                  defaultChecked={user.profile.preferredFormats.includes(f)}
                  className="rounded border-gray-600 bg-gray-800 text-amber-500"
                />
                {f.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-lg bg-amber-500 py-2.5 font-semibold text-gray-950 hover:bg-amber-400 min-h-[44px]"
        >
          Save profile
        </button>
      </Form>

      <div className="border-t border-gray-800 pt-4">
        <p className="text-xs text-gray-500">
          Email: {user.email} | Role: {user.role} | No-shows: {user.profile.noShowCount}
        </p>
      </div>
    </div>
  );
}
