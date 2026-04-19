import { Form, useLoaderData, useActionData, redirect } from "react-router";
import { api, cookieHeader } from "../../../lib/api";

export async function loader({ request, params }: { request: Request; params: { cubeId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const result = await api.listCubes(ch);
  if (!result.ok) throw new Response("Failed", { status: 500 });
  const cube = result.data.cubes.find((c: any) => c.id === params.cubeId);
  if (!cube) throw new Response("Not found", { status: 404 });
  return { cube };
}

export async function action({ request, params }: { request: Request; params: { cubeId: string } }) {
  const ch = { headers: cookieHeader(request) };
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update") {
    const data: Record<string, any> = {};
    const name = formData.get("name") as string;
    if (name) data.name = name;

    const cubecobraUrl = formData.get("cubecobraUrl") as string;
    if (cubecobraUrl) data.cubecobraUrl = cubecobraUrl;

    const formats = formData.getAll("supportedFormats") as string[];
    if (formats.length > 0) data.supportedFormats = formats;

    data.preferredPodSize = parseInt(formData.get("preferredPodSize") as string, 10) || 8;
    data.minPodSize = parseInt(formData.get("minPodSize") as string, 10) || 4;
    data.maxPodSize = parseInt(formData.get("maxPodSize") as string, 10) || 8;

    const result = await api.updateCube(params.cubeId, data, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Cube updated!" };
  }

  if (intent === "retire") {
    const result = await api.updateCube(params.cubeId, { retired: true }, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Cube retired." };
  }

  if (intent === "unretire") {
    const result = await api.updateCube(params.cubeId, { retired: false }, ch);
    if (!result.ok) return { error: result.error.message };
    return { success: "Cube reactivated!" };
  }

  return null;
}

const ALL_FORMATS = [
  { value: "swiss_draft", label: "Swiss Draft" },
  { value: "team_draft_2v2", label: "Team Draft 2v2" },
  { value: "team_draft_3v3", label: "Team Draft 3v3" },
  { value: "team_draft_4v4", label: "Team Draft 4v4" },
  { value: "rochester", label: "Rochester" },
  { value: "housman", label: "Housman" },
  { value: "grid", label: "Grid" },
  { value: "glimpse", label: "Glimpse" },
  { value: "sealed", label: "Sealed" },
];

export default function CubeDetail() {
  const { cube } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{cube.name}</h1>
        <a
          href={cube.cubecobraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-dci-teal underline"
        >
          View on CubeCobra
        </a>
      </div>

      {actionData?.error && (
        <div className="rounded-sm bg-warn-soft p-3 text-sm text-warn">{actionData.error}</div>
      )}
      {actionData?.success && (
        <div className="rounded-sm border border-ok bg-paper-alt p-3 text-sm text-ok">{actionData.success}</div>
      )}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="update" />

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink-soft">Cube name</label>
          <input
            id="name" name="name" type="text" defaultValue={cube.name}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="cubecobraUrl" className="block text-sm font-medium text-ink-soft">CubeCobra URL</label>
          <input
            id="cubecobraUrl" name="cubecobraUrl" type="url" defaultValue={cube.cubecobraUrl}
            className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:ring-1 focus:ring-dci-teal focus:outline-none"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">Supported formats</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ALL_FORMATS.map((f) => (
              <label key={f.value} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox" name="supportedFormats" value={f.value}
                  defaultChecked={cube.supportedFormats?.includes(f.value)}
                  className="rounded border-rule-heavy bg-paper focus:ring-dci-teal"
                />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          {(["preferredPodSize", "minPodSize", "maxPodSize"] as const).map((field) => (
            <div key={field}>
              <label htmlFor={field} className="block text-sm font-medium text-ink-soft">
                {field === "preferredPodSize" ? "Preferred" : field === "minPodSize" ? "Min" : "Max"} pod
              </label>
              <select
                id={field} name={field}
                defaultValue={String(cube[field])}
                className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink focus:border-dci-teal focus:outline-none min-h-[44px]"
              >
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8">8</option>
              </select>
            </div>
          ))}
        </div>

        <button
          type="submit"
          className="w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink min-h-[44px]"
        >
          Save changes
        </button>
      </Form>

      <div className="border-t border-rule pt-4">
        {cube.retired ? (
          <Form method="post">
            <input type="hidden" name="intent" value="unretire" />
            <button type="submit" className="text-sm text-dci-teal underline">
              Reactivate this cube
            </button>
          </Form>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="retire" />
            <button type="submit" className="text-sm text-warn underline">
              Retire this cube
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
