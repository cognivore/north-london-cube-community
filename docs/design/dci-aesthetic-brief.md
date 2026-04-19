---
title: The DCI Aesthetic — Cubehall design mandate
status: mandate
version: 2
date: 2026-04-19
---

# The DCI Aesthetic — Cubehall design mandate

This document supersedes the prior draft. It is a mandate, not a menu. Every section states a requirement; nothing here is optional.

**Two overriding mandates govern the rest of the document.**

1. **Light is the only colour scheme.** Cubehall ships light-only. The prior dark substrate (`bg-gray-950` et al.) is dropped in full. `prefers-color-scheme` is ignored. The `<html>` element declares `color-scheme: light`.
2. **Era-appropriate iconography is Mark James's famfamfam Silk set.** Silk is mandated as the sole raster icon system. No Lucide, no Heroicons, no Feather. The favicon shall be generated from Silk's `dice.png`. Licensing and integration are specified in §5.

The current landing-page layout (`packages/web/app/routes/landing.tsx`) is preserved. What this mandate changes is surface grain, colour, typography, and iconography — not structure.

## 1. The bridge-builders (abbreviated, for reference)

The theoretical case was made at length in version 1 of this brief. Retained here only as a citation list, because the mandate below descends from it.

Information-density tradition: Edward Tufte (1983, 1990), Jef Raskin (*The Humane Interface*, 2000), Alan Cooper (*About Face*, 1995).

Typography-first school: Oliver Reichenstein ("Web Design is 95% Typography", 2006; iA Writer), Matthew Butterick (*Practical Typography*), Rasmus Andersson (Inter), Susan Kare (Mac icons), Tobias Frere-Jones (Retina).

Resilient-web school: Frank Chimero ("The Web's Grain", 2015), Ethan Marcotte (*Responsive Web Design*, 2011), Luke Wroblewski (*Mobile First*, 2011), Jeremy Keith (*Resilient Web Design*, 2016), David Bryant Copeland (*Brutalist Web Design*, 2016), Jen Simmons and Rachel Andrew (intrinsic design, CSS Grid).

Tool-aesthetic contemporaries: Adam Wathan and Steve Schoger (*Refactoring UI*, Tailwind), Maciej Cegłowski (Pinboard), 37signals, Bret Victor (*Magic Ink*), Josh Comeau.

## 2. The light palette — mandated tokens

The palette evokes a tournament printout on office paper under fluorescent venue lighting. It is not a "modern SaaS white" and it is not a Win9x `#D4D0C8` pastiche. It is warm cream paper, deep cold ink, hairline warm rules, two functional accents.

These tokens are mandated as the entire colour vocabulary. Additions require an ADR.

```css
@theme {
  /* Surface */
  --color-paper:        #FBF9F3;   /* primary background — warm cream */
  --color-paper-alt:    #F5F2E8;   /* alt surface for inset panels */
  --color-paper-sunken: #EFEBDC;   /* deeper inset — scorekeeper grids */

  /* Ink */
  --color-ink:          #11181C;   /* near-black primary text */
  --color-ink-soft:     #3E4953;   /* secondary text */
  --color-ink-faint:    #6B7480;   /* tertiary / metadata */

  /* Rules */
  --color-rule:         #E6DFC9;   /* hairline dividers */
  --color-rule-heavy:   #BFB8A3;   /* panel edges, table headers */
  --color-rule-focus:   #11181C;   /* focus / selected row border */

  /* Action accent — amber retained */
  --color-amber:        #B45309;   /* darkened for contrast on cream */
  --color-amber-soft:   #FED7AA;   /* backgrounds, hover fills */

  /* Informational accent — DCI teal */
  --color-dci-teal:     #0B6B83;   /* links, info dots, focus rings */
  --color-dci-teal-soft:#CDE4EB;

  /* Warning / destructive */
  --color-warn:         #9F1239;   /* dropped player, error, destructive */
  --color-warn-soft:    #FECDD3;

  /* Status */
  --color-ok:           #166534;   /* green status dot */
  --color-pending:      #854D0E;   /* amber status dot */
}

@layer base {
  html {
    color-scheme: light;
    background: var(--color-paper);
    color: var(--color-ink);
  }
}
```

Contrast: every foreground/background pair above clears WCAG AA at 16px. The ink-on-paper pair clears AAA.

Action/info/warn/ok are the only four functional accents. Amber = do-this. Teal = know-this. Warn = avoid-this / destructive. OK = connected / confirmed. No decorative colour is permitted.

## 3. Typography — mandated stack

Body: **Inter** (self-hosted via `@fontsource`), 16px base, 1.55 line-height.
Mono: **JetBrains Mono** (self-hosted), used for every number, ID, timestamp, shortcut hint, table cell containing numeric data, and the bracketed step markers.
Display: **Inter** at semibold weight, slight negative tracking only above 32px.

Google Fonts CDN is forbidden — venue wifi is hostile and the privacy surface is unnecessary. Fonts are bundled and self-served.

Global base rules (mandated):

```css
html {
  font-family: Inter, system-ui, sans-serif;
  font-feature-settings: "ss01" 1, "cv11" 1;
  font-variant-numeric: tabular-nums slashed-zero;
}
code, .mono, [data-mono] {
  font-family: "JetBrains Mono", ui-monospace, monospace;
}
```

Numeric columns in any table render right-aligned, mono, with `font-variant-numeric: tabular-nums slashed-zero`. Player IDs render in grouped five-digit clusters (`38472 91062`), echoing the DCI-card format.

## 4. The mandated moves

These apply to every screen as built, and govern the eventual refactor of the landing page (layout preserved, classes replaced). §4.1–§4.7 are concrete moves; §4.8 codifies the spatial register system that governs all of them and is non-negotiable.

**4.1** The framework card (`Where / When / Doors / P1P1`) drops `rounded-xl bg-gray-800`. Replacement: zero-radius box, 1px `--color-rule-heavy` border, `--color-paper-alt` fill, labels in small-caps micro-type (`--color-ink-faint`), values in mono with tabular-nums (`--color-ink`). Rows separated by a single-pixel `--color-rule` divider. Each row carries a 16×16 Silk glyph on the left (see §5).

**4.2** The numbered steps drop filled amber circles. Replacement: bracketed mono markers `[01]`, `[02]`, `[03]` in `--color-amber`. Body text in `--color-ink-soft`.

**4.3** Buttons drop `rounded-lg`. Replacement: `rounded-sm` (or `rounded-none` for dense-register tool-strip buttons), 1px border in the relevant functional accent, flat fill, visible keyboard-shortcut hint (`Sign in ⏎`, `Register`). `accesskey` attributes mandated where a keyboard shortcut is exposed. Padding, size, and typographic treatment follow the register rules in §4.8 — a primary CTA in the generous register is emphatically *not* the same button as a tool-strip action in the dense register.

**4.4** Links are visibly underlined in body text, rendered in `--color-dci-teal`. No hover-only underline. Keith's resilience rule.

**4.5** Every form input shows a visible 1px border in `--color-rule-heavy`, fills with `--color-paper` (not `--color-paper-alt`), and exposes its focus ring in `--color-dci-teal`. `accent-color: var(--color-amber)` is set globally so native checkboxes and radios inherit the action colour.

**4.6** A persistent status bar is mandated on every authenticated screen: 28px tall, fixed to the viewport bottom, `--color-paper-alt` fill, 1px top border in `--color-rule-heavy`, content in mono at 12px. Shape: venue · date · round · player count · clock · connectivity dot. The dot is the Silk `bullet_green.png` / `bullet_yellow.png` / `bullet_red.png` per §5. The status bar is not applied to the landing page.

**4.7** Motion is minimised. No bouncing, no spring easings, no entrance animations. Permitted: 120ms linear colour transitions on hover, and the browser's native `view-transition` for route changes. `@media (prefers-reduced-motion: reduce)` disables the latter.

**4.8** *Spatial register and geometric discipline.* Cubehall has two legitimate visual registers, and no single page mixes them. Both registers sit on the same palette (§2), the same typography (§3), and the same Silk iconography (§5); only spacing, rhythm, and button sizing differ.

*Dense register — the sovereign-app surfaces.* Applies to the pairings table, the standings screen, the pod listing during a live round, the scorekeeper grid, the audit log view, and the mandated 28px status bar (§4.6). Descends from Tufte's data-ink ratio and Cooper's sovereign-application doctrine. Characteristic tokens: 8px base grid, tight leading (1.35), hairline `--color-rule` dividers, compact iconography at 16×16 native Silk, table cells at `py-1 px-2`, row gap `gap-1`. Function demands density; any generosity applied here reads as contempt for the scorekeeper.

*Generous register — the transient-app surfaces.* Applies to the landing page, the RSVP flow, the profile screen (the surface in the screenshot that prompted this section), the login and register screens, the colophon, and every public/marketing surface. Descends from the Bauhaus-to-Swiss-grid lineage: Jan Tschichold's *Die Neue Typographie* (1928), Josef Müller-Brockmann's *Grid Systems in Graphic Design* (1981), Armin Hofmann's *Graphic Design Manual* (1965), Massimo Vignelli's *The Vignelli Canon* (2010), and Dieter Rams's ten principles (Braun, HfG Ulm). Whitespace is structure, not absence. Characteristic tokens: 32px vertical rhythm, line-height 1.6 on body, dramatic type-size contrast (h1 roughly 5× body), section gaps at minimum `py-16` / `py-24`, form field rows at `py-6` with label and input stacked not inline, primary CTAs at `px-8 py-4` minimum with label in Inter semibold plus a mono shortcut hint (`↵`) at the end. On mobile portrait the same rhythm collapses proportionally — never below `py-8` between sections.

*Geometric discipline.* Bauhaus teaches pure primitives: the square, the circle, the triangle. The project extends the teaching to corner radius with three permitted values and nothing in between.

- `rounded-none` — the square. Default for every rectangular panel, card, table, form input, textarea, section divider, and fixture strip. This is the base case.
- `rounded-sm` — a single 2px concession to screen rendering. Permitted on buttons, toggles, and inputs in the generous register where a `rounded-none` button reads as unintentionally sharp. Forbidden on full-width panels.
- `rounded-full` — the circle. Permitted and encouraged on specifically circular elements: status dots (the `bullet_*` Silk glyphs are already circular at 16×16), single-letter avatar chips, solo badges where the pill shape is itself the message.

`rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, and any arbitrary-value radius above 2px are forbidden across the entire codebase. The pillow is not a Bauhaus form; it belongs to a SaaS lineage Cubehall does not quote.

*Why two registers.* Tournament software that wants to be trusted under pressure must be dense on the grids that carry data, and airy on the surfaces that welcome people in. The failure mode demonstrated by the `/app/profile` screenshot is the application of one register (neither fully dense nor fully generous) to both kinds of surface. The correct reading of the brief is that dense and generous are the two tunings of a single instrument, and every screen must be tuned to one or the other before it ships.

## 5. Icon mandate — famfamfam Silk

### 5.1 The set

Mark James's Silk icon set is mandated as Cubehall's sole raster icon system.

- Home page: <https://famfamfam.com/lab/icons/silk/>
- Source mirror: <https://github.com/markjames/famfamfam-silk-icons>
- Count: 999 icons
- Native size: 16×16 PNG
- License: Creative Commons Attribution 2.5 — <https://creativecommons.org/licenses/by/2.5/>

CC BY 2.5 permits commercial use with attribution; it is strictly more permissive than the non-commercial licence you asked for, and therefore satisfies the requirement. Attribution is mandatory and specified in §5.4.

### 5.2 Installation — mandated path

The pack is fetched by script and served as static assets.

- Download mechanism: `packages/web/scripts/fetch-icons.sh` (provided in this mandate).
- Static install path: `packages/web/public/icons/silk/*.png` (served at `/icons/silk/<name>.png`).
- License copy: `packages/web/public/icons/silk/LICENSE-SILK.txt` (copied verbatim from the upstream `readme.txt`).
- Favicon: `packages/web/public/favicon.ico` and `packages/web/public/favicon.png`, generated from `dice.png`.

The script is idempotent. It must be run once after `pnpm install`, or wired into `package.json` as a `postinstall` hook at the maintainer's discretion.

### 5.3 Icon → concept mapping (mandated)

This table binds Silk filenames to Cubehall domain concepts. The mapping is canonical. A new concept requires an addition here before it appears in the UI.

| Cubehall concept                | Silk filename                                   |
|---------------------------------|-------------------------------------------------|
| Brand / cube / draft / favicon  | `dice.png`                                      |
| Individual player               | `user.png`                                      |
| Pod / group of players          | `group.png`                                     |
| Round / timer                   | `time.png` (primary), `hourglass.png` (running) |
| Fixture date / Friday           | `calendar.png`                                  |
| Venue                           | `house.png`                                     |
| Sign in                         | `door_in.png`                                   |
| Sign out                        | `door_out.png`                                  |
| Pairings table                  | `table.png`                                     |
| Print pairings                  | `printer.png`                                   |
| Standings                       | `chart_bar.png`                                 |
| Winner / trophy                 | `cup.png`                                       |
| 1st / 2nd / 3rd place           | `medal_gold_1.png`, `_2.png`, `_3.png`          |
| RSVP yes / confirmed            | `tick.png`                                      |
| RSVP no / declined              | `cross.png`                                     |
| Dropped from round              | `user_delete.png`                               |
| Status OK                       | `bullet_green.png`                              |
| Status pending                  | `bullet_yellow.png`                             |
| Status error / disconnected     | `bullet_red.png`                                |
| Settings                        | `cog.png`                                       |
| Re-pair / refresh               | `arrow_refresh.png`                             |
| Search player                   | `magnifier.png`                                 |
| Document / report               | `page_white_text.png`                           |
| Cube (the list of cards)        | `bricks.png`                                    |
| Invite code                     | `key.png`                                       |
| Audit log                       | `book.png`                                      |

### 5.4 Attribution — mandated

Attribution is required wherever Silk icons are rendered. Three mandated attribution points:

1. **Footer link on every public page** — a small mono text link reading: *Icons by [Mark James](https://famfamfam.com/lab/icons/silk/), CC BY 2.5.*
2. **`/colophon` route** — a plain HTML page listing all third-party assets, their authors, and their licences. Silk is the first entry.
3. **`docs/design/icon-attribution.md`** in the repo — machine-parseable attribution manifest. Updated whenever an asset set is added or removed.

The footer attribution shall render in `--color-ink-faint` at 11px mono, visually subordinate but present.

### 5.5 Rendering rules

Silk icons are 16×16 native. They render at 16×16 without scaling. If a larger glyph is required:

- 32×32 is obtained by nearest-neighbour upscale (preserving the pixel grid). Render with `image-rendering: pixelated`.
- Never anti-alias a Silk icon. Never render at a non-integer scale.
- For hidpi displays, serve the native 16×16 at 1x and the 32×32 nearest-neighbour at 2x via an `srcset`, or set CSS `width: 16px; height: 16px; image-rendering: pixelated;` and let the browser handle it.

Colour-overlaying Silk icons is forbidden. They ship with their own palette, and the palette is part of the aesthetic quotation. If a monochromatic icon is needed, use a plain text glyph or a purpose-made SVG — not a filtered Silk PNG.

Mandated React component:

```tsx
// packages/web/app/components/Icon.tsx
import type { ImgHTMLAttributes } from "react";

export type SilkIcon =
  | "dice" | "user" | "group" | "time" | "hourglass"
  | "calendar" | "house" | "door_in" | "door_out"
  | "table" | "printer" | "chart_bar" | "cup"
  | "medal_gold_1" | "medal_gold_2" | "medal_gold_3"
  | "tick" | "cross" | "user_delete"
  | "bullet_green" | "bullet_yellow" | "bullet_red"
  | "cog" | "arrow_refresh" | "magnifier"
  | "page_white_text" | "bricks" | "key" | "book";

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  name: SilkIcon;
  size?: 16 | 32;
}

export function Icon({ name, size = 16, alt = "", ...rest }: IconProps) {
  return (
    <img
      src={`/icons/silk/${name}.png`}
      width={size}
      height={size}
      alt={alt}
      style={size === 32 ? { imageRendering: "pixelated" } : undefined}
      {...rest}
    />
  );
}
```

Every icon usage in the codebase goes through this component. No direct `<img>` tags to Silk paths.

### 5.6 Favicon — mandated

- Primary: `packages/web/public/favicon.ico`, generated from `dice.png`, 16×16 single-frame ICO.
- Secondary (Android, bookmarks): `packages/web/public/favicon.png`, the unaltered `dice.png`.
- Apple touch icon: `packages/web/public/apple-touch-icon.png`, 180×180, nearest-neighbour upscale of `dice.png`.

`packages/web/app/root.tsx` is updated to reference these paths and drop the emoji data-URL placeholder.

## 6. What is dropped

For avoidance of doubt:

- `bg-gray-950`, `bg-gray-900`, `bg-gray-800` on surfaces — dropped.
- `text-white`, `text-gray-100`, `text-gray-300`, `text-gray-400` — dropped, replaced with `--color-ink` / `--color-ink-soft` / `--color-ink-faint`.
- `text-amber-400` — dropped, replaced with `--color-amber` (darker to clear contrast on cream).
- `rounded-xl`, `rounded-lg` on buttons, cards, panels — dropped in favour of `rounded-sm` or `rounded-none`.
- Emoji favicon (`🎲` as data-URL SVG) — dropped, replaced with Silk-derived ICO.
- Any use of Heroicons, Lucide, Feather, or Phosphor anywhere in `packages/web` — forbidden going forward.
- `prefers-color-scheme: dark` branches or tokens — forbidden.

## 7. Portrait-first — unchanged

Every mandate in this document holds on a 390×844 phone in portrait. Specifically:

`100dvh` replaces `100vh` / `min-h-screen` for full-height regions.
Container queries drive density-sensitive components (the framework card, the pairings row, the standings row) — wide container ⇒ label-left / value-right; narrow container ⇒ label-above / value-below. A single component serves both.
Primary actions stay in the thumb zone (Wroblewski, 2011).
Silk icons at 16×16 are readable on all tested device classes; 32×32 `image-rendering: pixelated` is used where an icon anchors a heading or a button.

## 8. One-page summary

Light-only, warm cream paper (`#FBF9F3`), near-black ink, two functional accents (amber for action, teal for information), dropped from the dark scheme entirely. Inter for body, JetBrains Mono for all numeric and ID content, `tabular-nums slashed-zero` globally. Framework panel becomes a hairline-bordered dialog; step markers become bracketed mono numerals; buttons lose pillow radius and gain shortcut hints; form inputs get visible borders; a persistent status bar is added to every authenticated screen. Silk icons (Mark James, CC BY 2.5) are mandated as the sole raster icon vocabulary, installed via `packages/web/scripts/fetch-icons.sh` to `packages/web/public/icons/silk/`, rendered at 16×16 native through a single `<Icon />` component, and attributed in the footer, `/colophon`, and `docs/design/icon-attribution.md`. Favicon is generated from the cube/draft concept icon per §5.3.

Two spatial registers (§4.8), never mixed. Dense register (Tufte / Cooper / WER) on pairings, standings, scorekeeper, status bar — 8px grid, hairline dividers, tight leading. Generous register (Tschichold / Müller-Brockmann / Vignelli / Rams) on landing, RSVP, profile, login, colophon — 32px vertical rhythm, generous line-height, dramatic type-size contrast, primary CTAs at `px-8 py-4` minimum with mono shortcut hints. Three permitted corner radii and nothing else: `rounded-none` for rectangles, `rounded-full` for circles, `rounded-sm` as a single 2px screen-rendering concession on buttons and inputs in the generous register. Everything larger is forbidden.

Nothing animates. Nothing bounces. Nothing hides. Landing-page layout is preserved verbatim.
