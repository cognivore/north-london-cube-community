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
        <p className="mt-4 max-w-md text-lg text-gray-400">
          Friday night MTG cube drafts at Hitchhiker & Owl.
          RSVP, vote on cubes, and track your matches.
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

      {/* Features */}
      <section className="bg-gray-900 py-16 px-4">
        <div className="mx-auto max-w-2xl space-y-12">
          <Feature
            title="RSVP in one tap"
            description="Tap /in to reserve your seat for Friday. No group chats, no confusion."
          />
          <Feature
            title="Cube voting"
            description="When multiple cubes are offered, ranked-choice voting picks the best fit."
          />
          <Feature
            title="Live pairings & timer"
            description="Swiss and team draft pairings generated automatically. Server-authoritative round timer on your phone."
          />
          <Feature
            title="Standings & history"
            description="Match results and standings computed in real-time. Track your record across weeks."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 text-center text-sm text-gray-500">
        Cubehall — Built for the North London cube community
      </footer>
    </div>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <p className="mt-1 text-gray-400">{description}</p>
    </div>
  );
}
