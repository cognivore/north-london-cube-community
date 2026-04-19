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
        <h1 className="text-2xl font-bold text-ink">Cubes</h1>
        <Link
          to="/app/cubes/new"
          className="rounded-sm bg-amber-soft border border-amber px-4 py-2 text-sm font-semibold text-ink hover:bg-amber-soft min-h-[44px] flex items-center"
        >
          Add cube
        </Link>
      </div>

      {cubes.length === 0 ? (
        <p className="text-ink-faint">No cubes registered yet.</p>
      ) : (
        <div className="space-y-3">
          {cubes.map((cube: any) => (
            <Link
              key={cube.id}
              to={`/app/cubes/${cube.id}`}
              className="block rounded-sm border border-rule bg-paper-alt p-4 hover:border-rule-heavy transition-colors"
            >
              <p className="font-semibold text-ink">{cube.name}</p>
              <p className="mt-0.5 text-sm text-ink-faint">
                {cube.supportedFormats.join(", ")} | {cube.cardCount} cards
              </p>
              {cube.retired && (
                <span className="mt-1 inline-block text-xs text-warn">Retired</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
