import { useLoaderData } from "react-router";
import { api } from "../../../lib/api";

export async function loader({ params }: { params: { cubeId: string } }) {
  const result = await api.listCubes();
  if (!result.ok) throw new Response("Failed", { status: 500 });
  const cube = result.data.cubes.find((c: any) => c.id === params.cubeId);
  if (!cube) throw new Response("Not found", { status: 404 });
  return { cube };
}

export default function CubeDetail() {
  const { cube } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{cube.name}</h1>
        <a
          href={cube.cubecobraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-amber-400 hover:text-amber-300"
        >
          View on CubeCobra
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <InfoItem label="Card count" value={String(cube.cardCount)} />
        <InfoItem label="Preferred pod" value={String(cube.preferredPodSize)} />
        <InfoItem label="Min pod" value={String(cube.minPodSize)} />
        <InfoItem label="Max pod" value={String(cube.maxPodSize)} />
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-400">Formats</h3>
        <div className="mt-1 flex flex-wrap gap-2">
          {cube.supportedFormats.map((f: string) => (
            <span
              key={f}
              className="rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300"
            >
              {f.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      {cube.retired && (
        <p className="text-sm text-red-400">This cube is retired.</p>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-900 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
