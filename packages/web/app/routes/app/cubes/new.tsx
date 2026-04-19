import { Form, redirect, useActionData } from "react-router";
import { api, cookieHeader } from "../../../lib/api";

export async function action({ request }: { request: Request }) {
  const cookie = cookieHeader(request);
  const formData = await request.formData();

  const result = await api.createCube({
    name: formData.get("name"),
    cubecobraUrl: formData.get("cubecobraUrl"),
    supportedFormats: (formData.getAll("supportedFormats") as string[]).length > 0
      ? formData.getAll("supportedFormats")
      : ["swiss_draft"],
    preferredPodSize: parseInt(formData.get("preferredPodSize") as string, 10) || 8,
    minPodSize: parseInt(formData.get("minPodSize") as string, 10) || 4,
    maxPodSize: parseInt(formData.get("maxPodSize") as string, 10) || 8,
  }, { headers: cookie });

  if (!result.ok) return { error: result.error.message };
  return redirect("/app/cubes");
}

export default function NewCube() {
  const actionData = useActionData<typeof action>();

  const formats = [
    { value: "swiss_draft", label: "Swiss Draft" },
    { value: "team_draft_2v2", label: "Team Draft 2v2" },
    { value: "team_draft_3v3", label: "Team Draft 3v3" },
    { value: "team_draft_4v4", label: "Team Draft 4v4" },
    { value: "rochester", label: "Rochester" },
    { value: "winston", label: "Winston" },
    { value: "winchester", label: "Winchester" },
    { value: "grid", label: "Grid" },
    { value: "glimpse", label: "Glimpse" },
    { value: "sealed", label: "Sealed" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Add cube</h1>

      {actionData?.error && (
        <div className="rounded-lg bg-red-900/50 p-3 text-sm text-red-300">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300">
            Cube name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
            placeholder="My Vintage Cube"
          />
        </div>

        <div>
          <label htmlFor="cubecobraUrl" className="block text-sm font-medium text-gray-300">
            CubeCobra URL
          </label>
          <input
            id="cubecobraUrl"
            name="cubecobraUrl"
            type="url"
            required
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
            placeholder="https://cubecobra.com/cube/overview/mycube"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-300">Supported formats</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {formats.map((f) => (
              <label key={f.value} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  name="supportedFormats"
                  value={f.value}
                  defaultChecked={f.value === "swiss_draft"}
                  className="rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500"
                />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          {(["preferredPodSize", "minPodSize", "maxPodSize"] as const).map((field) => (
            <div key={field}>
              <label htmlFor={field} className="block text-sm font-medium text-gray-300">
                {field === "preferredPodSize" ? "Preferred" : field === "minPodSize" ? "Min" : "Max"} pod
              </label>
              <select
                id={field}
                name={field}
                className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white focus:border-amber-500 focus:outline-none min-h-[44px]"
                defaultValue={field === "minPodSize" ? "4" : "8"}
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
          className="w-full rounded-lg bg-amber-500 py-2.5 font-semibold text-gray-950 hover:bg-amber-400 min-h-[44px]"
        >
          Create cube
        </button>
      </Form>
    </div>
  );
}
