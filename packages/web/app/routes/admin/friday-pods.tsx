import { Form, Link, useLoaderData, useActionData } from "react-router";
import { api, cookieHeader, SERVER_API_BASE } from "../../lib/api";

type Seat = { podId: string; seatIndex: number; userId: string; team: "A" | "B" | null };
type Pod = { id: string; cubeId: string; format: string; state: string; seats: Seat[] };
type Rsvp = { id: string; userId: string; state: string };
type Player = { displayName: string; dciNumber: number | null };
type Cube = { id: string; name: string; supportedFormats: string[] };

export async function loader({ request, params }: { request: Request; params: { fridayId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const usersRes = await fetch(`${SERVER_API_BASE}/api/admin/users`, { headers: cookieHeader(request) });
  const allUsers = usersRes.ok
    ? ((await usersRes.json()) as { users: Array<{ id: string; displayName: string; email: string }> }).users
    : [];

  const [fridayResult, cubesResult] = await Promise.all([
    api.getFriday(params.fridayId, ch),
    api.listCubes(ch),
  ]);
  if (!fridayResult.ok) throw new Response("Not found", { status: 404 });
  return {
    ...fridayResult.data,
    allCubes: cubesResult.ok ? cubesResult.data.cubes : [],
    allUsers,
  };
}

export async function action({ request, params }: { request: Request; params: { fridayId: string } }) {
  const ch = cookieHeader(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-pod") {
    const podId = formData.get("podId") as string;
    const seatsRaw = formData.get("seats") as string;
    const format = (formData.get("format") as string) || undefined;
    let seats: Array<{ userId: string; team?: "A" | "B" | null }>;
    try {
      seats = JSON.parse(seatsRaw);
    } catch {
      return { error: "Invalid seats payload" };
    }
    const res = await fetch(`${SERVER_API_BASE}/api/admin/pods/${podId}/seats`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ seats, format }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Save failed (${res.status})` };
    }
    return { success: "Pod saved" };
  }

  if (intent === "shuffle") {
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/shuffle-seating`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Shuffle failed (${res.status})` };
    }
    return { success: "Seating shuffled — review and save if needed" };
  }

  if (intent === "no-show") {
    const userId = formData.get("userId") as string;
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/users/${userId}/no-show`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `No-show failed (${res.status})` };
    }
    return { success: "No-show recorded; seats/matches replaced with BYE" };
  }

  if (intent === "add-rsvp") {
    const userId = formData.get("userId") as string;
    if (!userId) return { error: "Pick a user" };
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/rsvps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Add RSVP failed (${res.status})` };
    }
    return { success: "Player added (confirmed)" };
  }

  if (intent === "create-walkin") {
    const displayName = (formData.get("displayName") as string | null)?.trim();
    const email = (formData.get("email") as string | null)?.trim() ?? "";
    if (!displayName) return { error: "Walk-in needs a name" };
    const createRes = await fetch(`${SERVER_API_BASE}/api/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify(email.length > 0 ? { displayName, email } : { displayName }),
    });
    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Create user failed (${createRes.status})` };
    }
    const created = await createRes.json() as { user: { id: string; email: string } };
    const rsvpRes = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/rsvps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
      body: JSON.stringify({ userId: created.user.id }),
    });
    if (!rsvpRes.ok) {
      const body = await rsvpRes.json().catch(() => ({}));
      return { error: `User created but RSVP failed: ${body?.error?.message ?? rsvpRes.status}` };
    }
    return { success: `Walk-in ${displayName} created (${created.user.email}) and added` };
  }

  if (intent === "remove-rsvp") {
    const userId = formData.get("userId") as string;
    const res = await fetch(`${SERVER_API_BASE}/api/admin/fridays/${params.fridayId}/rsvps/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Remove failed (${res.status})` };
    }
    return { success: "RSVP cancelled" };
  }

  if (intent === "advance") {
    const res = await fetch(`${SERVER_API_BASE}/api/lifecycle/fridays/${params.fridayId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ch },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error?.message ?? `Advance failed (${res.status})` };
    }
    return { success: "Friday advanced" };
  }

  return null;
}

export default function FridayPods() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { friday, pods, rsvps, players, allCubes, allUsers } = data as unknown as {
    friday: { id: string; date: string; state: { kind: string } };
    pods: Pod[];
    rsvps: Rsvp[];
    players: Record<string, Player>;
    allCubes: Cube[];
    allUsers: Array<{ id: string; displayName: string; email: string }>;
  };

  const stateKind = friday.state.kind;
  const fridayActive = stateKind !== "complete" && stateKind !== "cancelled";
  // A pod is editable while it's still pre-round (drafting/building). Backend
  // also rejects edits if any round has started.
  const podEditable = (p: Pod) => fridayActive && (p.state === "drafting" || p.state === "building");
  const editable = fridayActive && pods.some(p => p.state === "drafting" || p.state === "building");
  const activeRsvps = rsvps.filter(r => ["pending", "confirmed", "locked", "seated"].includes(r.state));
  const cubeById = (id: string) => allCubes.find(c => c.id === id);
  const playerName = (id: string) => players?.[id]?.displayName ?? id.slice(0, 8);

  const totalSeated = pods.reduce((acc, p) => acc + p.seats.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-ink">Assign seating — {friday.date}</h1>
        <Link to={`/admin/fridays/${friday.id}`} className="text-sm text-ink-faint underline">
          back to override
        </Link>
      </div>
      <p className="text-sm text-ink-faint">
        State: <span className="text-amber">{stateKind}</span>
        {" · "}
        <span className="mono" data-mono>{totalSeated}</span> seated of <span className="mono" data-mono>{activeRsvps.length}</span> active RSVPs
        {!fridayActive && (
          <span className="ml-2 text-warn">
            (Friday is {stateKind} — pods are frozen)
          </span>
        )}
        {fridayActive && !editable && (
          <span className="ml-2 text-warn">
            (every pod has at least one round started — seats are frozen)
          </span>
        )}
      </p>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn whitespace-pre-wrap">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      {/* Player list — admin manages RSVPs while seating */}
      {editable && (
        <PlayerListPanel
          fridayId={friday.id}
          rsvps={rsvps}
          players={players}
          allUsers={allUsers}
        />
      )}

      {pods.length === 0 && (
        <p className="rounded-sm border border-rule bg-paper-alt p-4 text-sm text-ink-faint">
          No pods materialized yet. Advance the Friday from <code>vote_closed</code> to create them
          (or use Force lock from the override page).
        </p>
      )}

      {editable && pods.length > 0 && (
        <Form method="post" className="rounded-sm border border-amber bg-amber-soft p-4">
          <p className="text-sm text-ink mb-2">
            <strong>Shuffle seating</strong> runs the auto-packer over the current pod formats and
            replaces seats. Errors are surfaced verbatim — change a pod's format if the packer rejects.
          </p>
          <input type="hidden" name="intent" value="shuffle" />
          <button
            type="submit"
            className="rounded-sm border border-amber bg-paper px-4 py-2 text-sm font-semibold text-amber hover:bg-paper-alt min-h-[44px]"
          >
            Shuffle seating
          </button>
        </Form>
      )}

      {pods.map((pod, idx) => {
        const cube = cubeById(pod.cubeId);
        return (
          <PodEditor
            key={pod.id}
            pod={pod}
            allActiveUserIds={activeRsvps.map(r => r.userId)}
            playerName={playerName}
            cubeName={cube?.name ?? pod.cubeId.slice(0, 8)}
            cubeFormats={cube?.supportedFormats ?? [pod.format]}
            podIndex={idx + 1}
            editable={podEditable(pod)}
          />
        );
      })}

      {stateKind === "locked" && (
        <Form method="post" className="rounded-sm border border-dci-teal bg-dci-teal-soft p-4">
          <p className="text-sm text-ink mb-2">
            Once the seating looks right, confirm the Friday. Begin (confirmed → in progress) is the next click.
          </p>
          <input type="hidden" name="intent" value="advance" />
          <button
            type="submit"
            className="rounded-sm border border-dci-teal bg-paper px-4 py-2 text-sm font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
          >
            Confirm friday (locked &rarr; confirmed)
          </button>
        </Form>
      )}
      {stateKind === "confirmed" && (
        <Form method="post" className="rounded-sm border border-dci-teal bg-dci-teal-soft p-4">
          <p className="text-sm text-ink mb-2">
            Begin the event — once started, pods are frozen and rounds can be fired.
          </p>
          <input type="hidden" name="intent" value="advance" />
          <button
            type="submit"
            className="rounded-sm border border-dci-teal bg-paper px-4 py-2 text-sm font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
          >
            Begin friday (confirmed &rarr; in progress)
          </button>
        </Form>
      )}
    </div>
  );
}

function PodEditor({
  pod,
  allActiveUserIds,
  playerName,
  cubeName,
  cubeFormats,
  podIndex,
  editable,
}: {
  pod: Pod;
  allActiveUserIds: string[];
  playerName: (id: string) => string;
  cubeName: string;
  cubeFormats: string[];
  podIndex: number;
  editable: boolean;
}) {
  const teams: ("A" | "B")[] = ["A", "B"];
  const formId = `pod-form-${pod.id}`;
  const seatsInputId = `pod-seats-${pod.id}`;
  const formatSelectId = `pod-format-${pod.id}`;

  const handlePodSave = (e: React.FormEvent<HTMLFormElement>) => {
    const fmt = (document.getElementById(formatSelectId) as HTMLSelectElement | null)?.value ?? pod.format;
    const isTeamFmt = fmt.startsWith("team_draft_");
    const slots = document.querySelectorAll<HTMLSelectElement>(
      `select[data-seat-slot][data-pod-id="${pod.id}"]`,
    );
    const seats: Array<{ userId: string; team?: "A" | "B" | null }> = [];
    for (const slot of Array.from(slots)) {
      const userId = slot.value;
      if (!userId) continue;
      const team = isTeamFmt
        ? (seats.length % 2 === 0 ? "A" : "B")
        : null;
      seats.push({ userId, team });
    }
    (document.getElementById(seatsInputId) as HTMLInputElement | null)!.value = JSON.stringify(seats);
  };

  return (
    <section className="rounded-sm border border-rule bg-paper-alt p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-ink">
          Pod {podIndex} — {cubeName}
        </h2>
        <span className="text-xs mono text-ink-faint" data-mono>{pod.state}</span>
      </div>

      {/* The pod-save form holds the hidden inputs and format select. Seat
          selects live in the <ol> below and are linked by `form={formId}` so
          per-seat no-show <Form>s can render alongside them without nesting. */}
      <Form id={formId} method="post" onSubmit={handlePodSave}>
        <input type="hidden" name="intent" value="save-pod" />
        <input type="hidden" name="podId" value={pod.id} />
        <input type="hidden" id={seatsInputId} name="seats" value="" />

        <div className="mb-3 flex items-center gap-2">
          <label htmlFor={formatSelectId} className="text-sm text-ink-soft">Format</label>
          <select
            id={formatSelectId}
            name="format"
            defaultValue={pod.format}
            disabled={!editable}
            className="rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink mono"
            data-mono
          >
            {cubeFormats.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
            {!cubeFormats.includes(pod.format) && (
              <option value={pod.format}>{pod.format} (current)</option>
            )}
          </select>
        </div>
      </Form>

      <ol className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => {
          const existing = pod.seats[i];
          const teamLabel = pod.format.startsWith("team_draft_")
            ? ` ${teams[i % 2]}`
            : "";
          const isBye = existing?.userId === "00000000-0000-0000-0000-000000000bee";
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="mono text-xs text-ink-faint w-12" data-mono>
                #{i}{teamLabel}
              </span>
              <select
                form={formId}
                data-seat-slot
                data-pod-id={pod.id}
                defaultValue={existing?.userId ?? ""}
                disabled={!editable}
                className={`flex-1 rounded-sm border bg-paper px-2 py-1.5 text-sm ${existing ? "text-ink border-rule-heavy" : "text-ink-faint border-rule"} ${isBye ? "italic text-ink-faint" : ""}`}
              >
                <option value="">— empty —</option>
                {allActiveUserIds.map(uid => (
                  <option key={uid} value={uid}>{playerName(uid)}</option>
                ))}
              </select>
              {editable && existing && !isBye && (
                <Form method="post" className="contents">
                  <input type="hidden" name="intent" value="no-show" />
                  <input type="hidden" name="userId" value={existing.userId} />
                  <button
                    type="submit"
                    title="Mark as no-show and replace with BYE"
                    className="rounded-sm border border-warn bg-paper px-2 py-1.5 text-xs font-semibold text-warn hover:bg-warn-soft"
                  >
                    no-show
                  </button>
                </Form>
              )}
            </li>
          );
        })}
      </ol>

      {editable && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            form={formId}
            className="rounded-sm border border-ok bg-paper px-4 py-2 text-sm font-semibold text-ok hover:bg-paper-alt min-h-[44px]"
          >
            Save pod
          </button>
          <p className="text-xs text-ink-faint">
            Final size must be 0, 4, 6, or 8 (empty rows are ignored).
          </p>
        </div>
      )}
    </section>
  );
}

function PlayerListPanel({
  fridayId: _fridayId,
  rsvps,
  players,
  allUsers,
}: {
  fridayId: string;
  rsvps: Rsvp[];
  players: Record<string, Player>;
  allUsers: Array<{ id: string; displayName: string; email: string }>;
}) {
  const stateLabel: Record<string, string> = {
    pending: "pending",
    confirmed: "confirmed",
    locked: "locked",
    seated: "seated",
    no_show: "no-show",
    cancelled_by_user: "cancelled",
  };
  const playerName = (id: string) => players?.[id]?.displayName ?? id.slice(0, 8);
  const visibleRsvps = rsvps.filter(r => r.state !== "cancelled_by_user");
  const userIdsWithRsvp = new Set(rsvps.map(r => r.userId));
  const candidates = allUsers.filter(u => !userIdsWithRsvp.has(u.id));

  return (
    <section className="rounded-sm border border-dci-teal bg-paper-alt p-4">
      <h2 className="text-lg font-semibold text-ink mb-2">Player list ({visibleRsvps.length})</h2>
      <p className="text-xs text-ink-faint mb-3">
        Curator-only: add walk-ins or remove someone before/while seating.
        Marking a seat as <em>no-show</em> in a pod also flips this list automatically.
      </p>

      <ul className="mb-4 space-y-1">
        {visibleRsvps.map(r => (
          <li key={r.id} className="flex items-center justify-between text-sm">
            <span className="text-ink">
              {playerName(r.userId)}
              <span className="ml-2 text-xs mono text-ink-faint" data-mono>
                {stateLabel[r.state] ?? r.state}
              </span>
            </span>
            {r.state !== "no_show" && (
              <Form method="post">
                <input type="hidden" name="intent" value="remove-rsvp" />
                <input type="hidden" name="userId" value={r.userId} />
                <button
                  type="submit"
                  title="Cancel this RSVP"
                  className="text-xs text-warn hover:underline"
                >
                  remove
                </button>
              </Form>
            )}
          </li>
        ))}
      </ul>

      <Form method="post" className="flex items-center gap-2">
        <input type="hidden" name="intent" value="add-rsvp" />
        <select
          name="userId"
          defaultValue=""
          className="flex-1 rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
        >
          <option value="" disabled>Pick a user to add</option>
          {candidates.map(u => (
            <option key={u.id} value={u.id}>{u.displayName} — {u.email}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-sm border border-dci-teal bg-paper px-3 py-1.5 text-sm font-semibold text-dci-teal hover:bg-paper-alt"
        >
          Add player
        </button>
      </Form>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink">
          Walk-in not in the list? Create a new user
        </summary>
        <Form method="post" className="mt-2 space-y-2 rounded-sm border border-rule p-3">
          <input type="hidden" name="intent" value="create-walkin" />
          <p className="text-xs text-ink-faint">
            Creates a verified member and RSVPs them as confirmed. Leave email
            blank to auto-generate a <code>@cubehall.local</code> placeholder
            you can fix later from <em>Users</em>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              name="displayName"
              placeholder="Display name"
              required
              className="flex-1 min-w-[160px] rounded-sm border border-rule-heavy bg-paper px-2 py-1.5 text-sm text-ink"
            />
            <input
              name="email"
              type="email"
              placeholder="email (optional)"
              className="flex-1 min-w-[200px] rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
            />
            <button
              type="submit"
              className="rounded-sm border border-dci-teal bg-paper px-3 py-1.5 text-sm font-semibold text-dci-teal hover:bg-paper-alt"
            >
              Create + add
            </button>
          </div>
        </Form>
      </details>
    </section>
  );
}
