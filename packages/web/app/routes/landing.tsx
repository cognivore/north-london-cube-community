import type { ReactNode } from "react";
import type { MetaFunction } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { Icon } from "../components/Icon";
import type { SilkIcon } from "../components/Icon";
import { VenueCard } from "../components/venue-card";
import type { VenueCardData } from "../components/venue-card";
import { api, cookieHeader } from "../lib/api";

// Two-venue rotation: odd Fridays at Arcadia Games, even Fridays at Bad Moon
// Cafe ("BMC") on Holloway Rd. Ids mirror packages/server/src/venue-rotation.ts.
const ARCADIA_VENUE_ID = "65b5de32-cbb2-44a9-a254-0c0b9cd20849";
const BAD_MOON_VENUE_ID = "bf396686-777e-4dff-ac15-4eee93eb493e";

// SSR fallbacks if the venues aren't in the DB yet (degrades gracefully).
const ARCADIA_FALLBACK: VenueCardData = {
  name: "Arcadia Games",
  address: "46 Essex St., Temple, London WC2R 3JF",
  mapUrl: "https://maps.app.goo.gl/ZuBqaM4FWVjNGm84A",
};
const BAD_MOON_FALLBACK: VenueCardData = {
  name: "Bad Moon Cafe (Holloway Rd)",
  address: "Arch 5, 303 Holloway Rd, London N7 8HS",
  mapUrl: "https://maps.app.goo.gl/49t27kY8y69MBvtZA",
};

export async function loader({ request }: { request: Request }) {
  const result = await api.me({ headers: cookieHeader(request) });
  if (result.ok) return redirect("/app");
  const venuesRes = await api.listVenues();
  const venues = venuesRes.ok ? venuesRes.data.venues : [];
  const byId = (id: string) => venues.find((v: any) => v.id === id) ?? null;
  return { arcadia: byId(ARCADIA_VENUE_ID), badMoon: byId(BAD_MOON_VENUE_ID) };
}

export const meta: MetaFunction = () => [
  { title: "North London Cube Community" },
  { name: "description", content: "Weekly MTG cube drafts every Friday in North London — odd weeks at Arcadia Games (Temple), even weeks at Bad Moon Cafe on Holloway Road. No committee, no gatekeeping — just show up and draft." },
  { property: "og:title", content: "North London Cube Community" },
  { property: "og:description", content: "Weekly MTG cube drafts every Friday in North London — Arcadia Games (odd weeks) & Bad Moon Cafe, Holloway Rd (even weeks)." },
  { property: "og:image", content: "https://north.cube.london/og.png" },
  { property: "og:type", content: "website" },
  { property: "og:url", content: "https://north.cube.london" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: "North London Cube Community" },
  { name: "twitter:description", content: "Weekly MTG cube drafts every Friday in North London — Arcadia Games (odd weeks) & Bad Moon Cafe, Holloway Rd (even weeks)." },
  { name: "twitter:image", content: "https://north.cube.london/og.png" },
  { name: "theme-color", content: "#f59e0b" },
];

/** Render a venue's name as a map link when it has one, plain text otherwise. */
function venueLink(v: VenueCardData): ReactNode {
  if (v.mapUrl && v.mapUrl.length > 0) {
    return (
      <a href={v.mapUrl} className="text-dci-teal underline" target="_blank" rel="noopener noreferrer">
        {v.name}
      </a>
    );
  }
  return <span>{v.name}</span>;
}

export default function Landing() {
  const data = useLoaderData<typeof loader>() as { arcadia: any | null; badMoon: any | null };
  const toCard = (v: any | null, fallback: VenueCardData): VenueCardData =>
    v ? { name: v.name, address: v.address ?? "", mapUrl: v.mapUrl ?? "" } : fallback;
  const arcadia = toCard(data?.arcadia, ARCADIA_FALLBACK);
  const badMoon = toCard(data?.badMoon, BAD_MOON_FALLBACK);

  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      {/* Site identity bar */}
      <nav className="flex items-center justify-center gap-2.5 px-4 pt-6 pb-2">
        <img
          src="/hero.webp"
          alt=""
          width={28}
          height={22}
          style={{ imageRendering: "pixelated" }}
        />
        <span className="text-sm font-medium tracking-wide text-ink-faint uppercase">
          North London Cube Community
        </span>
      </nav>

      {/* Hero */}
      <header className="flex flex-col items-center px-4 pt-10 sm:pt-16 pb-12 text-center">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-ink">
          Friday night<br />
          <span className="text-amber">cube drafts</span>
        </h1>

        <p className="mt-5 max-w-sm text-lg text-ink-soft">
          RSVP, cube selection, pods and pairings &mdash; all run through this site.
        </p>

        <div className="mt-8 w-full max-w-xs space-y-3">
          <Link
            to="/register"
            className="block w-full rounded-sm bg-amber border border-amber py-3.5 text-center text-lg font-bold text-white min-h-[48px]"
          >
            Register to play
          </Link>
          <p className="text-sm text-ink-faint">
            Already have an account?{" "}
            <Link to="/login" className="text-dci-teal underline">Sign in</Link>
          </p>
        </div>

        <p className="mt-8 text-sm text-ink-faint">
          P1P1 18:30 every Friday in North London
        </p>
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
              same time, rotating between Arcadia Games and Bad Moon Cafe on Holloway Road.
              We follow a{" "}
              <a href="/code-of-conduct" className="text-dci-teal underline">Code of Conduct</a>{" "}
              based on the{" "}
              <a href="https://berlincodeofconduct.org/" className="text-dci-teal underline" rel="noopener noreferrer">Berlin Code of Conduct</a>.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-ink">The framework</h2>
            <div className="mt-3 border border-rule-heavy bg-paper-alt">
              <FrameworkRow
                icon="house"
                label="Where"
                value={
                  <span className="block space-y-0.5">
                    <span className="block">{venueLink(arcadia)} <span className="text-ink-faint">— odd Fridays</span></span>
                    <span className="block">{venueLink(badMoon)} <span className="text-ink-faint">— even Fridays</span></span>
                  </span>
                }
              />
              <FrameworkRow icon="calendar" label="When" value="Every Friday" />
              <FrameworkRow icon="door_in" label="Doors" value="18:00" />
              <FrameworkRow icon="time" label="P1P1" value="18:30" />
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

          <div>
            <h2 className="text-2xl font-semibold text-ink">Find us</h2>
            <p className="mt-1 text-sm text-ink-faint">
              We alternate weekly. Check the app for which venue this Friday lands at.
            </p>
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-ink-faint" style={{ fontVariant: "small-caps" }}>Odd Fridays</p>
                <VenueCard venue={arcadia} />
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-ink-faint" style={{ fontVariant: "small-caps" }}>Even Fridays</p>
                <VenueCard venue={badMoon} />
              </div>
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
  value: ReactNode;
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
