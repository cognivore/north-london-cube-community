import { Form, useLoaderData, useActionData, useSearchParams } from "react-router";
import { cookieHeader, SERVER_API_BASE } from "../../lib/api";

const CANONICAL_VENUE_ID = "d0000000-0000-0000-0000-000000000001";

type AdminVenue = {
  id: string;
  name: string;
  address: string;
  capacity: number;
  maxPods: number;
  houseCreditPerPlayer: number;
  active: boolean;
  mapUrl: string;
};

export async function loader({ request }: { request: Request }) {
  const ch = { headers: cookieHeader(request) };
  const res = await fetch(`${SERVER_API_BASE}/api/venues`, ch);
  const venues: AdminVenue[] = res.ok
    ? ((await res.json()) as { venues: AdminVenue[] }).venues
    : [];
  venues.sort((a, b) => a.name.localeCompare(b.name));
  return { venues };
}

function parseInt10(s: FormDataEntryValue | null): number | null {
  const v = (s as string | null)?.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function action({ request }: { request: Request }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "archive" || intent === "restore") {
    const venueId = formData.get("venueId") as string;
    if (!venueId) return { error: "Missing venueId" };
    const res = await fetch(`${SERVER_API_BASE}/api/admin/venues/${venueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ active: intent === "restore" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Failed (${res.status})` };
    }
    return { success: intent === "archive" ? "Venue archived." : "Venue restored." };
  }

  if (intent === "create" || intent === "update") {
    const name = (formData.get("name") as string | null)?.trim();
    const address = (formData.get("address") as string | null)?.trim() ?? "";
    const mapUrl = (formData.get("mapUrl") as string | null)?.trim() ?? "";
    const capacity = parseInt10(formData.get("capacity"));
    const maxPods = parseInt10(formData.get("maxPods"));
    const houseCreditPerPlayer = parseInt10(formData.get("houseCreditPerPlayer"));
    const active = formData.get("active") === "on";

    const payload: Record<string, unknown> = {};
    if (name) payload.name = name;
    if (address !== undefined) payload.address = address;
    payload.mapUrl = mapUrl;
    if (capacity !== null) payload.capacity = capacity;
    if (maxPods !== null) payload.maxPods = maxPods;
    if (houseCreditPerPlayer !== null) payload.houseCreditPerPlayer = houseCreditPerPlayer;
    payload.active = active;

    if (intent === "create") {
      if (!name) return { error: "Name is required" };
      if (capacity === null) return { error: "Capacity is required" };
      if (maxPods === null) return { error: "Max pods is required" };
      if (houseCreditPerPlayer === null) return { error: "House credit (pence) is required" };
      const res = await fetch(`${SERVER_API_BASE}/api/admin/venues`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ch },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: body?.error?.message ?? `Create failed (${res.status})` };
      }
      return { success: `Created ${name}` };
    }

    const venueId = formData.get("venueId") as string;
    if (!venueId) return { error: "Missing venueId" };
    const res = await fetch(`${SERVER_API_BASE}/api/admin/venues/${venueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Update failed (${res.status})` };
    }
    return { success: `Updated ${name ?? "venue"}` };
  }

  return null;
}

function poundsLabel(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function AdminVenues() {
  const { venues } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const editingId = params.get("edit");
  const creating = params.get("new") === "1";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Venues</h1>
        {!creating && (
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("new", "1");
              next.delete("edit");
              setParams(next, { replace: true });
            }}
            className="rounded-sm border border-ok bg-paper px-3 py-1.5 text-xs font-semibold text-ok hover:bg-paper-alt"
          >
            + new venue
          </button>
        )}
      </div>
      <p className="text-sm text-ink-faint">
        Public list at <code data-mono>/api/venues</code>. House credit is per
        player, in pence. Map URL is whatever you paste — OSM, Google, w3w, etc.
        — and is rendered as a plain link. Archive instead of delete; Fridays
        pinned to an archived venue still work.
      </p>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      {creating && (
        <section className="rounded-sm border border-ok bg-paper-alt p-4">
          <h2 className="mb-2 text-lg font-semibold text-ink">New venue</h2>
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="create" />
            <VenueFields />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                className="rounded-sm border border-ok bg-paper px-3 py-1.5 text-xs font-semibold text-ok hover:bg-paper-alt"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("new");
                  setParams(next, { replace: true });
                }}
                className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-alt"
              >
                Cancel
              </button>
            </div>
          </Form>
        </section>
      )}

      {venues.length === 0 ? (
        <p className="text-ink-faint">No venues yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm bg-paper-alt">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-faint/20 text-left text-ink-soft">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Capacity</th>
                <th className="px-3 py-2 font-medium">Pods</th>
                <th className="px-3 py-2 font-medium">House credit</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => {
                const isEditing = editingId === v.id;
                const isCanonical = v.id === CANONICAL_VENUE_ID;
                if (isEditing) {
                  return (
                    <tr key={v.id} className="border-b border-ink-faint/10 bg-paper">
                      <td colSpan={6} className="px-3 py-3">
                        <Form method="post" className="space-y-2">
                          <input type="hidden" name="intent" value="update" />
                          <input type="hidden" name="venueId" value={v.id} />
                          <VenueFields defaults={v} />
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
                            <span className="text-xs text-ink-faint" data-mono>
                              id: {v.id.slice(0, 8)}
                            </span>
                          </div>
                        </Form>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={v.id} className={`border-b border-ink-faint/10 last:border-0 ${v.active ? "" : "opacity-60"}`}>
                    <td className="px-3 py-2 text-ink">
                      {v.name}
                      {isCanonical && (
                        <span className="ml-2 inline-block rounded-sm bg-amber-soft px-1.5 py-0.5 text-xs text-amber">canonical</span>
                      )}
                      <div className="text-xs text-ink-faint">{v.address}</div>
                      {v.mapUrl && (
                        <a
                          href={v.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-dci-teal underline"
                        >
                          map
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{v.capacity}</td>
                    <td className="px-3 py-2 text-ink-soft">{v.maxPods}</td>
                    <td className="px-3 py-2 text-ink-soft">{poundsLabel(v.houseCreditPerPlayer)}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {v.active ? <span className="text-ok">yes</span> : <span className="text-ink-faint">archived</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!isCanonical && (
                          v.active ? (
                            <Form method="post" className="inline">
                              <input type="hidden" name="intent" value="archive" />
                              <input type="hidden" name="venueId" value={v.id} />
                              <button
                                type="submit"
                                className="text-xs text-amber hover:underline"
                              >
                                archive
                              </button>
                            </Form>
                          ) : (
                            <Form method="post" className="inline">
                              <input type="hidden" name="intent" value="restore" />
                              <input type="hidden" name="venueId" value={v.id} />
                              <button
                                type="submit"
                                className="text-xs text-ok hover:underline"
                              >
                                restore
                              </button>
                            </Form>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set("edit", v.id);
                            next.delete("new");
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

function VenueFields({ defaults }: { defaults?: AdminVenue }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Name</label>
        <input
          name="name"
          defaultValue={defaults?.name ?? ""}
          required
          className="flex-1 min-w-[240px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Address</label>
        <input
          name="address"
          defaultValue={defaults?.address ?? ""}
          className="flex-1 min-w-[240px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Map URL</label>
        <input
          name="mapUrl"
          type="url"
          defaultValue={defaults?.mapUrl ?? ""}
          placeholder="OpenStreetMap, Google Maps, anything"
          className="flex-1 min-w-[240px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Capacity</label>
        <input
          name="capacity"
          type="number"
          min={1}
          defaultValue={defaults?.capacity ?? 16}
          required
          className="w-32 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Max pods</label>
        <input
          name="maxPods"
          type="number"
          min={1}
          defaultValue={defaults?.maxPods ?? 2}
          required
          className="w-32 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">House credit (p)</label>
        <input
          name="houseCreditPerPlayer"
          type="number"
          min={0}
          defaultValue={defaults?.houseCreditPerPlayer ?? 700}
          required
          className="w-32 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        />
        <span className="text-xs text-ink-faint">pence per player</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft w-32">Active</label>
        <input
          type="checkbox"
          name="active"
          defaultChecked={defaults?.active ?? true}
        />
      </div>
    </>
  );
}
