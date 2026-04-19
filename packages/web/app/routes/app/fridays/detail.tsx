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

  // Get covered count via API (coordinator-only info)
  const user = meResult.ok ? meResult.data.user : null;
  let coveredCount = 0;
  if (user?.role === "coordinator") {
    const API_BASE = `http://localhost:${process.env.API_PORT ?? "37556"}`;
    try {
      const res = await fetch(`${API_BASE}/api/fridays/${params.fridayId}/covered-count`, {
        headers: cookieHeader(request),
      });
      if (res.ok) {
        const data = await res.json();
        coveredCount = data.count ?? 0;
      }
    } catch {}
  }

  return {
    ...fridayResult.data,
    allCubes: cubesResult.ok ? cubesResult.data.cubes : [],
    currentUser: user,
    coveredCount,
  };
}

export async function action({ request, params }: { request: Request; params: { fridayId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "rsvp-in" || intent === "rsvp-in-covered") {
    const covered = intent === "rsvp-in-covered";
    const result = await api.rsvp(params.fridayId, "in", { ...ch, covered });
    if (!result.ok) return { error: result.error.message };
    const msg = covered
      ? "You're in! The community has you covered."
      : "You're in!";
    return { success: msg };
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
  const { friday, enrollments, rsvps, pods, allCubes, currentUser, coveredCount } = data;

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
          <h1 className="text-2xl font-bold text-ink">{formatted}</h1>
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
              className="rounded-sm border border-rule-heavy px-3 py-1.5 text-xs text-ink-faint hover:border-rule-heavy hover:text-ink"
            >
              Advance &rarr;
            </button>
          </Form>
        )}
      </div>

      {/* Feedback */}
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

      {/* RSVP */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">
          Attending ({activeRsvps.length})
        </h2>

        {currentUser?.role === "coordinator" && coveredCount > 0 && (
          <p className="mt-1 text-sm text-amber">
            {coveredCount} attendee{coveredCount !== 1 ? "s" : ""} need{coveredCount === 1 ? "s" : ""} entry covered
          </p>
        )}

        {activeRsvps.length > 0 && (
          <ul className="mt-2 space-y-1">
            {activeRsvps.map((r: any) => (
              <li key={r.id} className="text-sm text-ink-soft">
                {r.userId === currentUser?.id ? (
                  <span className="text-amber">You</span>
                ) : (
                  r.userId.slice(0, 8)
                )}
              </li>
            ))}
          </ul>
        )}

        {canRsvp && (
          <div className="mt-3 space-y-2">
            {!amIn ? (
              <div className="flex gap-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="rsvp-in" />
                  <button
                    type="submit"
                    className="rounded-sm border border-ok bg-paper px-6 py-3 text-base font-bold text-ok hover:bg-paper-alt min-h-[44px]"
                  >
                    I'm in! (&pound;7)
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="rsvp-in-covered" />
                  <button
                    type="submit"
                    className="rounded-sm border border-ok bg-paper px-4 py-3 text-sm font-medium text-ok hover:bg-paper-alt min-h-[44px]"
                  >
                    I'm in (can't afford)
                  </button>
                </Form>
              </div>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="rsvp-out" />
                <button
                  type="submit"
                  className="rounded-sm bg-paper border border-rule-heavy px-4 py-3 text-sm font-medium text-ink-soft hover:bg-paper-alt min-h-[44px]"
                >
                  Cancel RSVP
                </button>
              </Form>
            )}
          </div>
        )}
      </section>

      {/* Cube enrollment */}
      <section className="rounded-sm border border-rule bg-paper-alt p-4">
        <h2 className="text-lg font-semibold text-ink">
          Cubes ({activeEnrollments.length})
        </h2>

        {activeEnrollments.length > 0 && (
          <div className="mt-2 space-y-2">
            {activeEnrollments.map((e: any) => {
              const cube = allCubes.find((c: any) => c.id === e.cubeId);
              const isMyEnrollment = e.hostId === currentUser?.id;
              return (
                <div key={e.id} className="flex items-center justify-between rounded-sm bg-paper-sunken px-3 py-2">
                  <div>
                    <p className="font-medium text-ink">{cube?.name ?? "Unknown cube"}</p>
                    <p className="text-xs text-ink-faint">
                      {cube?.supportedFormats?.join(", ")} | {cube?.cardCount} cards
                    </p>
                  </div>
                  {isMyEnrollment && canEnroll && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="withdraw" />
                      <input type="hidden" name="enrollmentId" value={e.id} />
                      <button type="submit" className="text-xs text-warn hover:text-warn">
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
            <p className="text-sm text-ink-faint">Bring a cube:</p>
            {myCubes.map((cube: any) => (
              <Form method="post" key={cube.id}>
                <input type="hidden" name="intent" value="enroll" />
                <input type="hidden" name="cubeId" value={cube.id} />
                <button
                  type="submit"
                  className="w-full rounded-sm border border-amber bg-amber-soft px-4 py-3 text-left hover:bg-amber-soft min-h-[44px]"
                >
                  <p className="font-medium text-amber">{cube.name}</p>
                  <p className="text-xs text-ink-faint">{cube.supportedFormats?.join(", ")}</p>
                </button>
              </Form>
            ))}
          </div>
        )}

        {canEnroll && myCubes.length === 0 && (
          <p className="mt-2 text-sm text-ink-faint">
            Got a cube? <Link to="/app/cubes/new" className="text-dci-teal underline">Add it</Link> and enroll it here.
          </p>
        )}
      </section>

      {/* Vote section */}
      {canVote && activeEnrollments.length >= 3 && (
        <section className="rounded-sm border border-dci-teal bg-dci-teal-soft p-4">
          <h2 className="text-lg font-semibold text-ink">Vote (optional)</h2>
          <p className="mt-1 text-sm text-ink-faint">
            Have a strong preference? Rank the cubes. Otherwise, the least
            recently played cubes will be selected automatically.
          </p>
          <Form method="post" className="mt-3 space-y-2">
            <input type="hidden" name="intent" value="vote" />
            {activeEnrollments.map((e: any) => {
              const cube = allCubes.find((c: any) => c.id === e.cubeId);
              return (
                <label key={e.id} className="flex items-center gap-3 rounded-sm bg-paper px-3 py-2">
                  <input type="checkbox" name="ranking" value={e.id} className="rounded" />
                  <span className="text-ink">{cube?.name ?? e.cubeId.slice(0, 8)}</span>
                </label>
              );
            })}
            <button
              type="submit"
              className="w-full rounded-sm border border-dci-teal bg-paper py-2.5 font-semibold text-dci-teal hover:bg-paper-alt min-h-[44px]"
            >
              Submit vote
            </button>
          </Form>
        </section>
      )}

      {/* Pods */}
      {pods.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-ink">Pods</h2>
          {pods.map((p: any) => (
            <Link
              key={p.id}
              to={`/app/pods/${p.id}`}
              className="block rounded-sm border border-rule bg-paper-alt p-4 hover:border-amber"
            >
              <div className="flex justify-between">
                <span className="font-medium text-ink">
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
    scheduled: "text-ink-faint bg-paper-alt",
    open: "text-ok bg-paper-alt",
    enrollment_closed: "text-amber bg-amber-soft",
    vote_open: "text-dci-teal bg-dci-teal-soft",
    vote_closed: "text-dci-teal bg-dci-teal-soft",
    locked: "text-dci-teal bg-dci-teal-soft",
    confirmed: "text-dci-teal bg-dci-teal-soft",
    in_progress: "text-amber bg-amber-soft",
    complete: "text-ink-faint bg-paper-alt",
    cancelled: "text-warn bg-warn-soft",
    drafting: "text-dci-teal bg-dci-teal-soft",
    building: "text-amber bg-amber-soft",
    playing: "text-amber bg-amber-soft",
    pending: "text-ink-faint bg-paper-alt",
  };

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[state] ?? "text-ink-faint bg-paper-alt"}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}
