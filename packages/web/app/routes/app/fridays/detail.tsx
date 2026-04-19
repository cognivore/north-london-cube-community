import { Form, useLoaderData, useActionData, Link } from "react-router";
import { api, cookieHeader } from "../../../lib/api";

export async function loader({ request, params }: { request: Request; params: { fridayId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const [fridayResult, cubesResult, meResult] = await Promise.all([
    api.getFriday(params.fridayId, ch),
    api.listCubes(ch),
    api.me(ch),
  ]);
  if (!fridayResult.ok) throw new Response("Not found", { status: 404 });
  return {
    ...fridayResult.data,
    allCubes: cubesResult.ok ? cubesResult.data.cubes : [],
    currentUser: meResult.ok ? meResult.data.user : null,
  };
}

export async function action({ request, params }: { request: Request; params: { fridayId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "rsvp-in") {
    const result = await api.rsvp(params.fridayId, "in", ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "You're in!" };
  }

  if (intent === "rsvp-out") {
    const result = await api.rsvp(params.fridayId, "out", ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "RSVP cancelled" };
  }

  if (intent === "enroll") {
    const cubeId = formData.get("cubeId") as string;
    const result = await api.enrollCube(params.fridayId, cubeId, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Cube enrolled!" };
  }

  if (intent === "withdraw") {
    const eid = formData.get("enrollmentId") as string;
    const result = await api.withdrawEnrollment(params.fridayId, eid, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Enrollment withdrawn" };
  }

  if (intent === "vote") {
    const ranking = formData.getAll("ranking") as string[];
    const result = await api.vote(params.fridayId, ranking, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Vote submitted!" };
  }

  if (intent === "advance") {
    const API_BASE = `http://localhost:${process.env.API_PORT ?? "37556"}`;
    const res = await fetch(`${API_BASE}/api/lifecycle/fridays/${params.fridayId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookieHeader(request) },
    });
    if (!res.ok) return { error: "Advance failed" };
    return { success: "Friday advanced!" };
  }

  return null;
}

export default function FridayDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { friday, enrollments, rsvps, pods, allCubes, currentUser } = data;

  const stateKind = friday.state.kind;
  const canRsvp = ["open", "enrollment_closed", "vote_open", "vote_closed"].includes(stateKind);
  const canEnroll = stateKind === "open";
  const canVote = stateKind === "vote_open";
  const activeRsvps = rsvps.filter((r: any) => r.state === "in");
  const activeEnrollments = enrollments.filter((e: any) => !e.withdrawn);

  // User's cubes that aren't already enrolled
  const enrolledCubeIds = new Set(activeEnrollments.map((e: any) => e.cubeId));
  const myCubes = allCubes.filter(
    (c: any) => c.ownerId === currentUser?.id && !enrolledCubeIds.has(c.id) && !c.retired,
  );

  const myRsvp = rsvps.find((r: any) => r.userId === currentUser?.id);
  const amIn = myRsvp?.state === "in";

  const date = new Date(friday.date + "T00:00:00");
  const formatted = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{formatted}</h1>
          <p className="mt-1 text-sm">
            <StateChip state={stateKind} />
          </p>
        </div>

        {/* Advance button for hosts/admin — dev tool */}
        {!["complete", "cancelled"].includes(stateKind) && (
          <Form method="post">
            <input type="hidden" name="intent" value="advance" />
            <button
              type="submit"
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-500 hover:text-white"
            >
              Advance →
            </button>
          </Form>
        )}
      </div>

      {/* Feedback */}
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

      {/* RSVP */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-lg font-semibold text-white">
          Attending ({activeRsvps.length})
        </h2>

        {activeRsvps.length > 0 && (
          <ul className="mt-2 space-y-1">
            {activeRsvps.map((r: any) => (
              <li key={r.id} className="text-sm text-gray-300">
                {r.userId === currentUser?.id ? (
                  <span className="text-amber-400">You</span>
                ) : (
                  r.userId.slice(0, 8)
                )}
              </li>
            ))}
          </ul>
        )}

        {canRsvp && (
          <div className="mt-3 flex gap-2">
            {!amIn ? (
              <Form method="post">
                <input type="hidden" name="intent" value="rsvp-in" />
                <button
                  type="submit"
                  className="rounded-lg bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-500 min-h-[44px]"
                >
                  I'm in!
                </button>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="rsvp-out" />
                <button
                  type="submit"
                  className="rounded-lg bg-gray-700 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-gray-600 min-h-[44px]"
                >
                  Cancel RSVP
                </button>
              </Form>
            )}
          </div>
        )}
      </section>

      {/* Cube enrollment */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-lg font-semibold text-white">
          Cubes ({activeEnrollments.length})
        </h2>

        {activeEnrollments.length > 0 && (
          <div className="mt-2 space-y-2">
            {activeEnrollments.map((e: any) => {
              const cube = allCubes.find((c: any) => c.id === e.cubeId);
              const isMyEnrollment = e.hostId === currentUser?.id;
              return (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                  <div>
                    <p className="font-medium text-white">{cube?.name ?? "Unknown cube"}</p>
                    <p className="text-xs text-gray-400">
                      {cube?.supportedFormats?.join(", ")} | {cube?.cardCount} cards
                    </p>
                  </div>
                  {isMyEnrollment && canEnroll && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="withdraw" />
                      <input type="hidden" name="enrollmentId" value={e.id} />
                      <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                        Withdraw
                      </button>
                    </Form>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canEnroll && myCubes.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-gray-400">Bring a cube:</p>
            {myCubes.map((cube: any) => (
              <Form method="post" key={cube.id}>
                <input type="hidden" name="intent" value="enroll" />
                <input type="hidden" name="cubeId" value={cube.id} />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left hover:bg-amber-500/20 min-h-[44px]"
                >
                  <p className="font-medium text-amber-400">{cube.name}</p>
                  <p className="text-xs text-gray-400">{cube.supportedFormats?.join(", ")}</p>
                </button>
              </Form>
            ))}
          </div>
        )}

        {canEnroll && myCubes.length === 0 && currentUser?.profile?.hostCapable && (
          <p className="mt-2 text-sm text-gray-500">
            All your cubes are already enrolled.{" "}
            <Link to="/app/cubes/new" className="text-amber-400">Add a new cube</Link>
          </p>
        )}
      </section>

      {/* Vote section */}
      {canVote && activeEnrollments.length >= 3 && (
        <section className="rounded-xl border border-blue-800 bg-blue-900/20 p-4">
          <h2 className="text-lg font-semibold text-white">Vote</h2>
          <p className="mt-1 text-sm text-gray-400">
            Rank the cubes in order of preference.
          </p>
          <Form method="post" className="mt-3 space-y-2">
            <input type="hidden" name="intent" value="vote" />
            {activeEnrollments.map((e: any) => {
              const cube = allCubes.find((c: any) => c.id === e.cubeId);
              return (
                <label key={e.id} className="flex items-center gap-3 rounded-lg bg-gray-800 px-3 py-2">
                  <input type="checkbox" name="ranking" value={e.id} className="rounded" />
                  <span className="text-white">{cube?.name ?? e.cubeId.slice(0, 8)}</span>
                </label>
              );
            })}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 min-h-[44px]"
            >
              Submit vote
            </button>
          </Form>
        </section>
      )}

      {/* Pods */}
      {pods.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Pods</h2>
          {pods.map((p: any) => (
            <Link
              key={p.id}
              to={`/app/pods/${p.id}`}
              className="block rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-amber-500/30"
            >
              <div className="flex justify-between">
                <span className="font-medium text-white">
                  {p.format.replace(/_/g, " ")}
                </span>
                <StateChip state={p.state} />
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const colors: Record<string, string> = {
    scheduled: "text-gray-400 bg-gray-800",
    open: "text-green-400 bg-green-900/30",
    enrollment_closed: "text-yellow-400 bg-yellow-900/30",
    vote_open: "text-blue-400 bg-blue-900/30",
    vote_closed: "text-blue-300 bg-blue-900/20",
    locked: "text-purple-400 bg-purple-900/30",
    confirmed: "text-purple-300 bg-purple-900/20",
    in_progress: "text-amber-400 bg-amber-900/30",
    complete: "text-gray-400 bg-gray-800",
    cancelled: "text-red-400 bg-red-900/30",
    drafting: "text-blue-400 bg-blue-900/30",
    building: "text-yellow-400 bg-yellow-900/30",
    playing: "text-amber-400 bg-amber-900/30",
    pending: "text-gray-400 bg-gray-800",
  };

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[state] ?? "text-gray-400 bg-gray-800"}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}
