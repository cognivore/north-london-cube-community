import { Link } from "react-router";
import { Icon } from "../components/Icon";
import type { SilkIcon } from "../components/Icon";

export default function Landing() {
  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      {/* Hero */}
      <header className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-ink">
          North London<br />
          <span className="text-amber">Cube Community</span>
        </h1>
        <p className="mt-6 max-w-md text-lg text-ink-soft">
          Every Friday. Same time. Same place.<br />
          Bring a cube or just show up and draft.
        </p>

        <div className="mt-8 flex gap-4">
          <Link
            to="/login"
            accessKey="s"
            className="rounded-sm border border-amber bg-amber-soft px-6 py-3 text-lg font-semibold text-ink"
          >
            <span className="inline-flex items-center gap-2">
              <Icon name="door_in" />
              Sign in <span className="mono text-ink-faint text-sm">&crarr;</span>
            </span>
          </Link>
          <Link
            to="/register"
            className="rounded-sm border border-rule-heavy bg-paper px-6 py-3 text-lg font-semibold text-ink"
          >
            Register
          </Link>
        </div>
      </header>

      {/* What this is */}
      <section className="border-t border-rule bg-paper py-16 px-4">
        <div className="mx-auto max-w-2xl space-y-10">
          <div>
            <h2 className="text-2xl font-semibold text-ink">No gods, no masters</h2>
            <p className="mt-2 text-ink-soft">
              This is a decentralised, self-organised micro-community.
              There is no committee, no membership fee, no gatekeeping.
              Anyone can bring a cube. Anyone can show up and play.
              The only thing that's fixed is the framework: every Friday,
              same venue, same time. We follow a{" "}
              <a href="/code-of-conduct" className="text-dci-teal underline">Code of Conduct</a>{" "}
              based on the{" "}
              <a href="https://berlincodeofconduct.org/" className="text-dci-teal underline" rel="noopener noreferrer">Berlin Code of Conduct</a>.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-ink">The framework</h2>
            <div className="mt-3 border border-rule-heavy bg-paper-alt">
              <FrameworkRow icon="house" label="Where" value="Hitchhiker & Owl, Palmers Green N13" />
              <FrameworkRow icon="calendar" label="When" value="Every Friday" />
              <FrameworkRow icon="door_in" label="Doors" value="18:30" />
              <FrameworkRow icon="time" label="P1P1" value="18:45" />
              <FrameworkRow icon="ruby" label="Entry" value="£7 → venue credit (food & drinks)" last />
            </div>
            <p className="mt-3 text-sm text-ink-faint">
              Can't afford the &pound;7? RSVP with "Can't afford" and you will be
              covered by the community, no questions asked.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-ink">How it works</h2>
            <div className="mt-3 space-y-4">
              <Step n="01" text="RSVP so people know you're coming. Doesn't matter if there's a cube yet." />
              <Step n="02" text="Got a cube? Enroll it. Too many? Least recent plays — vote if you feel strongly." />
              <Step n="03" text="Friday evening: show up, draft, play 3 rounds. The app handles pairings, timer, and standings." />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-rule py-8 text-center text-sm text-ink-faint">
        <p>Cubehall — Built for the North London cube community</p>
        <p className="mt-2 mono" style={{ fontSize: "11px" }}>
          Icons by{" "}
          <a
            href="https://github.com/markjames/famfamfam-silk-icons/blob/master/index.png"
            className="underline text-dci-teal"
            rel="noopener noreferrer"
          >
            Mark James
          </a>
          , CC BY 2.5.
        </p>
      </footer>
    </div>
  );
}

function FrameworkRow({
  icon,
  label,
  value,
  last = false,
}: {
  icon: SilkIcon;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5${
        last ? "" : " border-b border-rule"
      }`}
    >
      <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-ink-faint uppercase tracking-wider text-xs w-16">
        <Icon name={icon} />
        <span style={{ fontVariant: "small-caps" }}>{label}</span>
      </span>
      <span className="mono text-ink text-sm" data-mono>
        {value}
      </span>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mono shrink-0 text-amber font-bold" data-mono>
        [{n}]
      </span>
      <p className="text-ink-soft">{text}</p>
    </div>
  );
}
