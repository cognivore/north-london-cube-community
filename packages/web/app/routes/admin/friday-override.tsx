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
      <h1 className="text-2xl font-bold text-white">
        Admin: {friday.date}
      </h1>
      <p className="text-sm text-gray-400">
        Current state: <span className="text-amber-400">{friday.state.kind}</span>
      </p>

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

      <Form method="post" className="space-y-4 rounded-xl border border-red-900 bg-gray-900 p-4">
        <h2 className="text-lg font-semibold text-red-400">Force cancel</h2>
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-300">
            Reason
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            required
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white"
            placeholder="Admin cancellation reason"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-500 min-h-[44px]"
        >
          Force cancel Friday
        </button>
      </Form>
    </div>
  );
}
