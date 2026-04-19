import { Form, useLoaderData, useActionData } from "react-router";
import { api } from "../../lib/api";

export async function loader({ params }: { params: { fridayId: string } }) {
  const result = await api.getFriday(params.fridayId);
  if (!result.ok) throw new Response("Not found", { status: 404 });
  return result.data;
}

export async function action({ request, params }: { request: Request; params: { fridayId: string } }) {
  const formData = await request.formData();
  const reason = formData.get("reason") as string;

  const res = await fetch(`/api/admin/fridays/${params.fridayId}/force-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const body = await res.json();
    return { error: body.error?.message ?? "Failed" };
  }

  return { success: "State forced" };
}

export default function FridayOverride() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { friday } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">
        Admin: {friday.date}
      </h1>
      <p className="text-sm text-ink-faint">
        Current state: <span className="text-amber">{friday.state.kind}</span>
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
    </div>
  );
}
