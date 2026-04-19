import { Link, useLoaderData } from "react-router";
import { api } from "../../../lib/api";

export async function loader() {
  const result = await api.listCubes();
  return { cubes: result.ok ? result.data.cubes : [] };
}

export default function CubesList() {
  const { cubes } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Cubes</h1>
        <Link
          to="/app/cubes/new"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-amber-400 min-h-[44px] flex items-center"
        >
          Add cube
        </Link>
      </div>

      {cubes.length === 0 ? (
        <p className="text-gray-400">No cubes registered yet.</p>
      ) : (
        <div className="space-y-3">
          {cubes.map((cube: any) => (
            <Link
              key={cube.id}
              to={`/app/cubes/${cube.id}`}
              className="block rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-gray-700 transition-colors"
            >
              <p className="font-semibold text-white">{cube.name}</p>
              <p className="mt-0.5 text-sm text-gray-400">
                {cube.supportedFormats.join(", ")} | {cube.cardCount} cards
              </p>
              {cube.retired && (
                <span className="mt-1 inline-block text-xs text-red-400">Retired</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
