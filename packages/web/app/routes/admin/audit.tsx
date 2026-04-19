import { useLoaderData } from "react-router";

export async function loader() {
  // Will be wired to API
  return { events: [] };
}

export default function AuditLog() {
  const { events } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink">Audit Log</h1>

      {events.length === 0 ? (
        <p className="text-ink-faint">No audit events yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e: any) => (
            <div key={e.id} className="rounded-sm bg-paper-alt p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium text-ink">{e.action}</span>
                <span className="text-xs text-ink-faint">{e.at}</span>
              </div>
              <p className="text-xs text-ink-faint">
                {e.subject.kind}:{e.subject.id} by {e.actorId}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
