---
title: The DCI Aesthetic — a design brief for Cubehall
status: draft
date: 2026-04-19
---

# The DCI Aesthetic

A design brief for Cubehall that fuses the dense, trusted, tool-like feel of Wizards Event Reporter and the DCI-number era with modern web typography, Tailwind, and portrait-first screens. The current landing-page layout stays intact; this document is about the grain of the surface, not the skeleton underneath.

## 1. What we are trying to reignite

Before we can pick our bridge-builders, we have to name the thing we are nostalgic for. The old Wizards Event Reporter (WER) and the DCI ecosystem it sat inside produced a very specific feeling, and most modern Magic software has failed to reproduce it. A forensic list:

The software was obviously a tool. Battleship-grey MFC dialogs. Tabs. Inset grids. A status bar at the bottom that told you, with a little green dot, whether the DCI Reporter back-end was reachable. The fonts were boring. The layouts were dense. Nothing moved unless you told it to. When you clicked *Pair Round*, the grid populated in a single frame.

It was also unmistakably numeric. The ten-digit DCI number was the player's identity, printed on a laminated card, recited at the table, written in sharpie on top of a deck-registration sheet. Numbers in that world were never decorative; they were always right-aligned, always tabular, always the same width as their neighbours. The whole rating system leaned on the visual rhythm of those fixed columns.

And it was trusted. Even when it crashed at round three of a Regionals, scorekeepers trusted WER because it looked trustworthy in the way a circuit-breaker panel looks trustworthy — inert, labelled, the same today as yesterday. The absence of delight was load-bearing. A bouncy button on a pairings screen would have felt like the wrong uniform.

If we can translate that triplet — **obviously a tool**, **unmistakably numeric**, **inert-looking to the point of being trusted** — into portrait-first web, Cubehall starts to feel like a piece of tournament infrastructure rather than a homework project that happens to run drafts.

## 2. The bridge-builders

These are the writers and designers whose work lets us carry the WER feeling forward without dragging along its bugs or its Win32 ceiling. Five generations, roughly grouped.

### The information-density tradition

**Edward Tufte** is the unavoidable ancestor. *The Visual Display of Quantitative Information* (1983) and *Envisioning Information* (1990) argued for a data-ink ratio, small multiples, and the elimination of chartjunk. His work is the theoretical backing for every dense tournament readout ever printed. Every pairings sheet, every standings table, every Elo graph is a Tufte page in disguise. His relevance to Cubehall is that *most* of our screens will be, fundamentally, tables — and Tufte gives us the license to make them narrow-ruled, minimally-bordered, and numerically uncompromising rather than apologising for being tables by wrapping each row in a drop-shadowed card.

**Jef Raskin**, writing in *The Humane Interface* (2000), argued for monotony, modelessness, and keyboard primacy. His zooming user interface never shipped, but his contempt for "feature bloat disguised as friendliness" is exactly the ethos you want on a scorekeeper's screen. Raskin's rules — that a tool should have no surprising modes, that the user should never have to ask "what state is this in?" — are the spiritual source of any good pairings-and-standings page.

**Alan Cooper**'s *About Face* (1995, now in its fourth edition with Reimann and Cronin) introduced goal-directed design and personas. The useful bit for us is his insistence that sovereign applications — the ones you sit inside for a whole session — should look different from transient utilities. WER is a sovereign app. Cubehall's round screen should be a sovereign app. The landing page is a transient one. Different visual contracts.

### The typography-first school

**Oliver Reichenstein** published "Web Design is 95% Typography" in 2006 and followed it with the iA Writer family — applications whose entire identity is a single well-chosen monospaced screen. Reichenstein is the direct bridge between WER's typographic conservatism and modern web design: he showed the industry that reverence for letterforms, grid, and vertical rhythm is not retro but foundational. His writing is the permission slip for Cubehall to lean into Berkeley Mono or JetBrains Mono in places other sites would reach for Poppins.

**Matthew Butterick**'s *Practical Typography* (butterick.com/practical-typography, free online, 2013 onwards) is the working handbook. It is opinionated, concrete, and reliably right about measure, leading, hyphenation, and hanging punctuation. Butterick also writes and sells typefaces (Equity, Concourse, Triplicate) built around the observation that the software world under-uses small-caps, true italics, and numeric alternates. Anywhere Cubehall displays a DCI-style ID, a date, or a score, Butterick's rules apply. His chapter on tables is short, sharp, and — importantly — written for non-designers who have to ship.

**Rasmus Andersson**, who drew Inter while at Figma, designed specifically for mixed screen sizes, tabular numerals, and slashed zeros. Inter is the quietest way to get a Swiss-modernist feel on a device class Raskin never saw. It is also OFL-licensed. Inter + `font-variant-numeric: tabular-nums slashed-zero` is, in one stroke, the closest thing to a direct port of the DCI-card vibe into a phone browser.

**Susan Kare**'s Mac icons, printed at 16×16 and 32×32, are a reminder that crisp, pixel-honest iconography scales into a world of high-DPI screens surprisingly well. If we ever need a glyph — a checkmark beside an RSVP, a dot in a status bar — we should think Kare before we think Lucide's fashionable hairline.

### The resilient-web school

**Frank Chimero**'s essay "The Web's Grain" (2015) is the canonical argument that web design should flow with rather than against the medium. "The fundamental unit of the web is not the page but the edge between things." This is the single best corrective to the temptation to rebuild WER's fixed-pixel MFC dialogs verbatim. Instead we take what was valuable about WER (density, legibility, trust) and let it flex.

**Ethan Marcotte** coined "responsive web design" in 2010 (*A List Apart*, and a book the next year from A Book Apart). Fluid grids, flexible images, media queries — the conceptual backbone of any site that lives on a phone.

**Luke Wroblewski**'s *Mobile First* (2011) took Marcotte's responsive idea and inverted the priority stack. You design for the smallest, most-constrained surface first; desktop is the progressive enhancement. This matters enormously for Cubehall because the actual tournament surface — the round screen, the standings screen, the pairings screen — is always going to be consumed on a phone held in portrait by a player who is already holding a draft pile.

**Jeremy Keith**'s *Resilient Web Design* (2016, free online) argues for a progressive-enhancement stance that would have been familiar to anyone who worked on the original WER: your app must still work when the network is bad, when JavaScript fails, when the screen is small. Cubehall runs in a venue with basement-grade wifi; Keith's ethos is not optional.

**David Bryant Copeland**'s "Brutalist Web Design" manifesto (brutalist-web.design, 2016) is a short list of rules — visible links, readable body text, minimum contrast, no stealing scroll — that produces sites that look like WER in spirit without pretending to be WER in surface. If you want a single page to hand a developer as they build a pairings table, this is it.

**Jen Simmons** and **Rachel Andrew** popularised CSS Grid and "intrinsic web design" between 2016 and 2019. Intrinsic design is the argument that we should stop laying things out to imaginary device sizes and instead let content find its own comfortable width. This maps cleanly onto tournament UIs: a pairings table wants to be as wide as it needs to be, on whatever screen it lands on.

### The tool-aesthetic contemporaries

**Adam Wathan** and **Steve Schoger** (Tailwind and *Refactoring UI*) are the practical engine that makes this whole fusion cheap. Tailwind's utility-first approach is ideologically aligned with Raskin's modelessness — every class does one legible thing — and it makes the kind of surgical, token-level decisions we need (tabular nums here, 1px border there, a hairline shadow only on hover) tractable inside a React Router app. Their book, *Refactoring UI* (2018), is the most honest how-to on visual hierarchy that isn't purely decorative. Its chapters on depth, layout, and colour are the correct compass even when we want to go harder and drier than its default examples.

**Maciej Cegłowski**'s Pinboard (pinboard.in, 2009 onwards) is the living demonstration of "utilitarian tool, on the web, on purpose". The site has barely changed in fifteen years because it did not need to. His public writing ("A Rocket To Nowhere", "The Website Obesity Crisis") is a useful counterweight to every urge to over-engineer a UI.

**37signals** — Jason Fried and DHH — are the corporate-software equivalent. Basecamp's recent rebrand and the Hey and Once product lines all lean into a deliberately "business software from 2008" look that is not accidental. Their design team (Jonas Downey and others) have written extensively about picking a look that will age slowly. Their palette decisions — a flat background, one or two accent colours, typographic restraint — are directly transferable.

**Bret Victor**'s essays, particularly *Magic Ink* (2006) and *Up and Down the Ladder of Abstraction* (2011), argue that information software should behave like a well-designed document, not an application. He will never say the word *tournament* but his argument for "context-sensitive information graphics that answer the user's question before they ask" is precisely the argument for the round screen we want to build — one that shows every player their pairing, their match number, their seat, and the round timer without a single click.

**Josh Comeau** writes the best public reference material for modern CSS — his blog posts on stacking contexts, layout modes, and container queries are the operational manual that turns the above philosophy into code. Pair with Sara Soueidan for everything accessibility-adjacent.

### The quieter undercurrent

A handful of less-named influences are worth naming explicitly because they sit exactly on the seam we are trying to weld:

The *LettError* duo, **Erik van Blokland** and **Just van Rossum**, whose playful-but-rigorous typographic programming work pre-figured variable fonts and parametric typography. They are the reason we can cheaply animate numbers in a way Raskin would have approved of.

**Tobias Frere-Jones** (Retina, Whitney, the numerals-for-small-sizes tradition at Hoefler & Co.) — his essays on numeric typography, particularly on *Retina* for the *Wall Street Journal*'s share-tables, are a direct prescription for how Cubehall should set standings. Retina was drawn to stay legible at 4pt on cheap newsprint; a phone under venue lighting is the same problem, slightly relocated.

**Donald Knuth**'s TeX (1978 onwards) is the distant root of everything in this document that concerns tabular alignment. If you ever wonder whether a given row of numbers looks right, ask whether TeX's `tabular` environment would have placed it the same way.

## 3. The synthesis — fusing past and present

The current Cubehall landing page is not wrong; it is simply generic. The existing layout — hero, "no laws, no masters", the framework card, the numbered steps, the formats paragraph, a thin footer — is the right information in the right order, and we should leave it exactly as it is. What we are changing is the surface grain.

Seven moves, in priority order.

### 3.1 Typography becomes the identity

The strongest single intervention is to replace the default Tailwind sans with a deliberate pairing. A neo-grotesque for body (Inter, Söhne, or IBM Plex Sans — Inter is the safest and freest) and a geometric or machine-like monospace for every numeric, ID-like, or tabular element (Berkeley Mono if the budget allows, JetBrains Mono or IBM Plex Mono if not, Departure Mono if you want the CRT tilt to be unmistakable). Display type — the "North London / Cube Community" header — wants an older, slightly quieter treatment than the current `tracking-tight` amber: Reichenstein's rule of thumb is that display type on the web should feel like something you could engrave. Consider dropping tracking, increasing weight to semibold rather than bold, and letting the word-break do the work it already does.

Load all this via `@fontsource` packages or self-hosted WOFF2. Do not rely on Google Fonts CDN; venue wifi is hostile. Apply `font-variant-numeric: tabular-nums slashed-zero` in a single global rule and forget about it.

### 3.2 Numbers earn their own reverence

Anywhere a number appears — round numbers, match numbers, seats, scores, timer, DCI-style player IDs when we re-introduce them — it goes in mono, right-aligned in tables, with `font-feature-settings: "zero" 1, "ss01" 1`. Make player IDs display as grouped five-digit clusters (e.g. `38472 91062`) the way the old DCI cards did — this is equal parts nostalgia, checksum-hostile-to-misreading, and legibility win on small screens.

### 3.3 The framework card becomes a status panel

The existing `Where / When / Doors / P1P1` rows are the single element on the landing page where WER's DNA can express itself unmistakably. Keep the layout — label left, value right — but strip the `rounded-xl` softness and the `bg-gray-800` fill. Replace with a 1px hairline border in a desaturated blue-grey (something around `#2a3442`), zero radius, label in small-caps micro-type, value in mono with tabular-nums. Between rows, a single-pixel divider. The entire card reads as if it had been screenshotted out of a tournament-software dialog and dropped into a website — which is the point.

### 3.4 Numbered steps become bracketed line-items

Replace the filled amber circles with bracketed monospace numerals (`[01]`, `[02]`, `[03]`) in a pale-on-dark tone. This evokes a changelog, a README, or a numbered tournament procedure step rather than an onboarding wizard. Surface text stays exactly where it is.

### 3.5 Buttons stop pretending to be pillows

The current `rounded-lg` amber call-to-action is fine, but it reads as 2019-SaaS. Go harder: `rounded-sm` or `rounded-none`, a 1px border in the amber, a flat fill (or no fill and amber text on hover), and a visible keyboard-shortcut hint — `Sign in ⏎` for the primary, `Register` for the secondary. Include `accesskey` attributes. WER did not have affordances, but it had shortcuts, and shortcut-hinting is the correct modern translation.

### 3.6 Colour leans toward a tournament palette

Keep gray-950 as the substrate; keep amber as one accent. Introduce a second accent — a DCI-card teal-blue around `#4a9eb8` — for *informational* elements: the status dot in a future persistent footer, links inside body text, focus rings. Reserve amber for actions. Reserve red for destructive / warning / dropped-from-round states. This three-accent discipline is straight out of Schoger & Wathan, and it maps onto tournament semantics (go / info / stop) cleanly.

### 3.7 The footer gains a status stripe later

Not on the landing page — you said layout stays — but plan for it. Every authenticated page in Cubehall should end in a fixed-height status bar, maybe 28px, that shows venue, tonight's round, player count, clock, and a little green/amber/red dot for back-end connectivity. That bar is the single most direct quote of WER's DNA, and once you have it you will find it does half the trust-building work for free.

## 4. The portrait-first dimension

Everything above holds on desktop. The constraint that matters more is the 390×844 pixel phone held in one hand by a player who is mid-draft. Three notes.

Use `100dvh` not `100vh` for full-height heroes; it handles the iOS URL bar correctly where `min-h-screen` does not.

Put container queries on every density-sensitive element — the framework panel, the standings rows, the pairings cells. On a narrow container a label-above-value stacked layout is correct; on a wider one a label-left, value-right row is correct. The same component serves both without a media query. This is Rachel Andrew's intrinsic-design argument in one CSS rule.

Respect the thumb zone. Luke Wroblewski's data from *Mobile First* still holds: the bottom third of the screen is the easy-reach region. Primary actions want to live there on small screens. The current landing page's Sign-in / Register pair is already centred-mid; on phones it is below the fold, which is fine and thumb-friendly. Keep it so.

## 5. What this looks like as code

A sketch of the Tailwind configuration and app.css changes — not to be applied yet, just to make the above concrete.

```css
/* app.css */
@import "tailwindcss";

@theme {
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Berkeley Mono", ui-monospace, monospace;
  --font-display: "Inter", system-ui, sans-serif;

  --color-amber-500: #d97706;          /* keep, but slightly desaturated */
  --color-dci-teal: #4a9eb8;
  --color-rule: #2a3442;               /* hairline borders */
  --color-surface: #0a0f14;            /* deeper than gray-950 */
}

@layer base {
  html {
    font-feature-settings: "ss01" 1, "zero" 1, "cv11" 1;
    font-variant-numeric: tabular-nums slashed-zero;
  }
  :focus-visible {
    outline: 2px solid var(--color-dci-teal);
    outline-offset: 2px;
  }
}
```

And three component-level rules that would (when the time comes) upgrade the three elements identified above, without touching the layout:

```tsx
// Detail row in the framework card
<div className="flex justify-between border-b border-[var(--color-rule)] py-2 last:border-b-0">
  <span className="font-mono text-xs uppercase tracking-widest text-gray-500">{label}</span>
  <span className="font-mono text-sm tabular-nums text-gray-100">{value}</span>
</div>

// Step row
<div className="flex gap-3">
  <span className="font-mono text-sm text-amber-500">[{n.padStart(2, "0")}]</span>
  <p className="text-gray-400">{text}</p>
</div>

// Primary button
<Link className="rounded-sm border border-amber-500 bg-amber-500 px-6 py-3 font-mono text-sm uppercase tracking-wide text-gray-950 hover:bg-transparent hover:text-amber-500 transition-colors">
  Sign in <span className="opacity-60">⏎</span>
</Link>
```

None of these change the landing page's skeleton. They all change its voice.

## 6. A brief further-reading list

If you want to chase any of the threads in this document, these are the short-and-long reads that pay back the time.

Tufte, *The Visual Display of Quantitative Information* (1983) and *Envisioning Information* (1990). Two hours with each of these is worth a year of reading blog posts about dashboards.

Reichenstein, "Web Design is 95% Typography" (ia.net, 2006).

Butterick, *Practical Typography*, read online for free (butterick.com/practical-typography). Start with "Typography in ten minutes" and "Summary of key rules".

Chimero, "The Web's Grain" (frankchimero.com, 2015). Twenty minutes. Re-read twice a year.

Wroblewski, *Mobile First* (A Book Apart, 2011). Still the cleanest argument for portrait-first.

Keith, *Resilient Web Design* (resilientwebdesign.com, 2016, free online).

Copeland, "Brutalist Web Design" (brutalist-web.design, 2016). Twenty minutes.

Wathan & Schoger, *Refactoring UI* (2018). The tactical reference for every decision not covered above.

Raskin, *The Humane Interface* (2000). Skim. Keep chapter 3 nearby.

Victor, *Magic Ink* (worrydream.com, 2006). A longer read, but the single strongest argument for what the tournament-round screen should eventually become.

## 7. Recommendations, in one page

Keep the current landing layout unchanged. Replace the default Tailwind font stack with Inter for body, a chosen mono for numerics, and a restrained display treatment. Turn on `tabular-nums` and `slashed-zero` globally. Pull the framework card away from rounded-card styling toward 1px-hairline, monospace-value, small-caps-label rows that read as a dialog out of tournament software. Replace the filled-circle step numerals with bracketed monospaced `[01]`-style markers. Harden the buttons: lose the pillow radius, add keyboard-shortcut hints, visible borders. Introduce a DCI-teal as the second accent, reserved for informational elements; keep amber for action, red for warning. Plan for a persistent status-bar footer on authenticated pages — it is not for the landing but it is the single strongest quote of WER's DNA once drafts are running. On phones, use `dvh` instead of `vh`, container queries for density-sensitive rows, and make sure every tabular number remains right-aligned at any width.

Do not animate numbers. Do not bounce buttons. Do not hide information behind accordions. The tournament software we are echoing was trusted because it was still — and stillness, on a 390-pixel-wide screen held by someone mid-draft, is the rarest and most valuable quality we can offer.
