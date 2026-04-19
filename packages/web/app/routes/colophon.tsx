import { Link } from "react-router";

export default function Colophon() {
  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      <main className="flex-1 mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-3xl font-semibold text-ink">Colophon</h1>
        <p className="mt-4 text-ink-soft">
          Third-party assets used in Cubehall, with attribution as required
          by their respective licences.
        </p>

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-ink">
            famfamfam Silk icon set
          </h2>
          <p className="mt-3 text-ink-soft">
            Cubehall uses the famfamfam Silk icon set, 999 16&times;16 PNG icons
            created by Mark James and released under a Creative Commons
            Attribution 2.5 licence. The set is available at{" "}
            <a
              href="https://famfamfam.com/lab/icons/silk/"
              className="underline text-dci-teal"
              rel="noopener noreferrer"
            >
              famfamfam.com/lab/icons/silk/
            </a>
            . Our full copy of the licence accompanies the icons in the
            distribution.
          </p>

          <dl className="mt-6 border border-rule-heavy bg-paper-alt text-sm">
            <ColophonRow label="Author" value="Mark James" />
            <ColophonRow label="Upstream" value="famfamfam.com/lab/icons/silk/" href="https://famfamfam.com/lab/icons/silk/" />
            <ColophonRow label="Source mirror" value="github.com/markjames/famfamfam-silk-icons" href="https://github.com/markjames/famfamfam-silk-icons" />
            <ColophonRow label="Count" value="999 icons" />
            <ColophonRow label="Size / format" value="16x16 PNG" />
            <ColophonRow label="Licence" value="Creative Commons Attribution 2.5" href="https://creativecommons.org/licenses/by/2.5/" last />
          </dl>
        </section>

        <div className="mt-12">
          <Link to="/" className="underline text-dci-teal">
            &larr; Back to Cubehall
          </Link>
        </div>
      </main>

      <footer className="border-t border-rule py-8 text-center text-sm text-ink-faint">
        <p>Cubehall — Built for the North London cube community</p>
        <p className="mt-2 mono" style={{ fontSize: "11px" }}>
          Icons by{" "}
          <a
            href="https://famfamfam.com/lab/icons/silk/"
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

function ColophonRow({
  label,
  value,
  href,
  last = false,
}: {
  label: string;
  value: string;
  href?: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2${
        last ? "" : " border-b border-rule"
      }`}
    >
      <dt className="text-ink-faint uppercase tracking-wider text-xs" style={{ fontVariant: "small-caps" }}>
        {label}
      </dt>
      <dd className="mono text-ink" data-mono>
        {href ? (
          <a href={href} className="underline text-dci-teal" rel="noopener noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
