/**
 * VenueCard — renders whatever venue the caller passes in.
 *
 *  - `full`    : large card with name, address, map link button. Use on
 *                landing / info sections.
 *  - `compact` : tiny strip with name + address + map link. Use inside friday
 *                detail and other narrow contexts.
 *
 * mapUrl is treated as an opaque user-supplied string — coordinators paste
 * whatever they like (OSM, Google, w3w, …) and it renders as a plain link.
 */

export type VenueCardData = {
  name: string;
  address: string;
  mapUrl?: string | null;
};

export function VenueCard({
  variant = "full",
  venue,
}: {
  variant?: "full" | "compact";
  venue: VenueCardData;
}) {
  const { name, address, mapUrl } = venue;
  const hasMap = !!mapUrl && mapUrl.length > 0;

  if (variant === "compact") {
    const inner = (
      <>
        <MiniPubGlyph />
        <span className="flex-1">
          <span className="block font-semibold text-ink">{name}</span>
          {address && <span className="block text-xs text-ink-faint">{address}</span>}
        </span>
        {hasMap && <span className="text-xs text-dci-teal underline">Open in Maps</span>}
      </>
    );
    if (hasMap) {
      return (
        <a
          href={mapUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-sm border border-rule bg-paper-alt p-3 text-sm hover:bg-paper"
        >
          {inner}
        </a>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-sm border border-rule bg-paper-alt p-3 text-sm">
        {inner}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-sm border border-rule-heavy bg-paper-alt">
      <div className="space-y-2 p-4">
        <h3 className="text-lg font-semibold text-ink">{name}</h3>
        {address && <p className="text-sm text-ink-soft">{address}</p>}
        {hasMap && (
          <div className="pt-1">
            <a
              href={mapUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-sm border border-dci-teal bg-paper px-3 py-2 text-sm font-medium text-dci-teal hover:bg-paper-alt"
            >
              Open in Maps
            </a>
          </div>
        )}
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
