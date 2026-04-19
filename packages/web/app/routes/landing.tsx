import { Link } from "react-router";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <header className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-white">
          North London<br />
          <span className="text-amber-400">Cube Community</span>
        </h1>
        <p className="mt-6 max-w-md text-lg text-gray-300">
          Every Friday. Same time. Same place.<br />
          Bring a cube or just show up and draft.
        </p>

        <div className="mt-8 flex gap-4">
          <Link
            to="/login"
            className="rounded-lg bg-amber-500 px-6 py-3 text-lg font-semibold text-gray-950 hover:bg-amber-400 transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="rounded-lg border border-gray-600 px-6 py-3 text-lg font-semibold text-gray-200 hover:border-gray-400 transition-colors"
          >
            Register
          </Link>
        </div>
      </header>

      {/* What this is */}
      <section className="bg-gray-900 py-16 px-4">
        <div className="mx-auto max-w-2xl space-y-10">
          <div>
            <h2 className="text-2xl font-bold text-white">No laws, no masters</h2>
            <p className="mt-2 text-gray-400">
              This is a decentralised, self-organised micro-community.
              There is no committee, no membership fee, no gatekeeping.
              Anyone can bring a cube. Anyone can show up and play.
              The only thing that's fixed is the framework: every Friday,
              same venue, same time.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">The framework</h2>
            <div className="mt-3 rounded-xl bg-gray-800 p-5 space-y-2">
              <Detail label="Where" value="Hitchhiker & Owl, Palmers Green N13" />
              <Detail label="When" value="Every Friday" />
              <Detail label="Doors" value="18:30" />
              <Detail label="P1P1" value="18:45" />
              <Detail label="Entry" value="£7 → venue credit (food & drinks)" />
            </div>
            <p className="mt-3 text-sm text-gray-500">
              Can't afford the £7? RSVP with "Can't afford" and you will be
              covered by the community, no questions asked.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">How it works</h2>
            <div className="mt-3 space-y-4 text-gray-400">
              <Step n="1" text="RSVP so people know you're coming. Doesn't matter if there's a cube yet." />
              <Step n="2" text="Got a cube? Enroll it. Multiple cubes offered? Everyone votes." />
              <Step n="3" text="Friday evening: show up, draft, play 3 rounds. The app handles pairings, timer, and standings." />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">Formats</h2>
            <p className="mt-2 text-gray-400">
              Swiss draft (4/6/8 players), Team draft 2v2, 3v3, 4v4,
              Rochester, Winston, Winchester, Grid, Glimpse, Sealed.
              Whatever the cube supports.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 text-center text-sm text-gray-500">
        Cubehall — Built for the North London cube community
      </footer>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-400">
        {n}
      </span>
      <p>{text}</p>
    </div>
  );
}
