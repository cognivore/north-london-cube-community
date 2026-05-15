/**
 * VenueCard — there is exactly one venue: The Owl & Hitchhiker.
 *
 *  - `full`    : iframe map embed + name + address + link buttons. Use on
 *                landing / info sections.
 *  - `compact` : tiny strip with name + address + one Google Maps link. Use
 *                inside friday detail and other narrow contexts.
 */

const NAME = "The Owl & Hitchhiker";
const ADDRESS = "471 Holloway Rd, Archway, London N7 6LE";
const MAPS_URL = "https://maps.app.goo.gl/ae9BhBH59TWZ5uu99";
const MAP_EMBED_SRC =
  "https://maps.google.com/maps?q=471%20Holloway%20Rd%2C%20Archway%2C%20London%20N7%206LE&t=&z=16&ie=UTF8&iwloc=&output=embed";

export function VenueCard({ variant = "full" }: { variant?: "full" | "compact" }) {
  if (variant === "compact") {
    return (
      <a
        href={MAPS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-sm border border-rule bg-paper-alt p-3 text-sm hover:bg-paper"
      >
        <MiniPubGlyph />
        <span className="flex-1">
          <span className="block font-semibold text-ink">{NAME}</span>
          <span className="block text-xs text-ink-faint">{ADDRESS}</span>
        </span>
        <span className="text-xs text-dci-teal underline">Open in Maps</span>
      </a>
    );
  }

  return (
    <div className="overflow-hidden rounded-sm border border-rule-heavy bg-paper-alt">
      <iframe
        title="Owl & Hitchhiker on Google Maps"
        src={MAP_EMBED_SRC}
        width="100%"
        height="240"
        style={{ border: 0 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <div className="space-y-2 p-4">
        <h3 className="text-lg font-semibold text-ink">{NAME}</h3>
        <p className="text-sm text-ink-soft">{ADDRESS}</p>
        <div className="pt-1">
          <a
            href={MAPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-sm border border-dci-teal bg-paper px-3 py-2 text-sm font-medium text-dci-teal hover:bg-paper-alt"
          >
            Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  );
}

function MiniPubGlyph() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2" y="14" width="36" height="22" rx="1" fill="#e7e0cf" stroke="#a8997a" />
      <rect x="6" y="20" width="6" height="6" fill="#bfd5d9" stroke="#7c9296" />
      <rect x="16" y="20" width="6" height="6" fill="#bfd5d9" stroke="#7c9296" />
      <rect x="26" y="20" width="6" height="6" fill="#bfd5d9" stroke="#7c9296" />
      <rect x="17" y="28" width="6" height="8" fill="#8a6a3f" stroke="#5a4423" />
      <path d="M2 14 L20 4 L38 14 Z" fill="#a8997a" stroke="#7a6d52" />
    </svg>
  );
}
