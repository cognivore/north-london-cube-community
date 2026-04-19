---
title: Third-party asset attributions
status: mandate
date: 2026-04-19
---

# Third-party asset attributions

This is the canonical manifest of third-party assets used in Cubehall.
Every asset set listed here must be attributed on the public-facing
`/colophon` page and in every footer where its assets are rendered.

Updating this file is mandatory whenever an asset set is added, removed,
or upgraded.

## Silk icon set

| Field                  | Value                                                              |
|------------------------|--------------------------------------------------------------------|
| Name                   | famfamfam Silk Icons                                               |
| Author                 | Mark James                                                         |
| Author contact         | mjames@gmail.com                                                   |
| Upstream home          | https://famfamfam.com/lab/icons/silk/                              |
| Source mirror          | https://github.com/markjames/famfamfam-silk-icons                  |
| Count                  | 999 icons                                                          |
| Native size / format   | 16×16 PNG                                                          |
| Licence                | Creative Commons Attribution 2.5                                   |
| Licence URL            | https://creativecommons.org/licenses/by/2.5/                       |
| Licence file in repo   | `packages/web/public/icons/silk/LICENSE-SILK.txt`                  |
| Installed location     | `packages/web/public/icons/silk/*.png`                             |
| Fetch mechanism        | `packages/web/scripts/fetch-icons.sh`                              |
| Derived favicon        | `packages/web/public/favicon.ico` (from `dice.png`)                |
| Required in footer     | Yes — link to https://famfamfam.com/lab/icons/silk/                |
| Required in /colophon  | Yes                                                                |

### Required attribution text

On every public page (footer), rendered in mono type at 11px,
`--color-ink-faint`:

> Icons by [Mark James](https://famfamfam.com/lab/icons/silk/), CC BY 2.5.

On the `/colophon` page, as a prose paragraph:

> Cubehall uses the famfamfam Silk icon set, 999 16×16 PNG icons
> created by Mark James and released under a Creative Commons
> Attribution 2.5 licence. The set is available at
> https://famfamfam.com/lab/icons/silk/. Our full copy of the
> licence accompanies the icons in the distribution.

### Notes on licence compliance

CC BY 2.5 permits commercial and non-commercial use, modification,
and redistribution, subject to attribution. Cubehall therefore:

- ships the unmodified pack under its original licence
- displays the licence copy at `/icons/silk/LICENSE-SILK.txt`
- renders the required footer attribution on every public page
- includes the pack on the `/colophon` page

If the pack is ever customised (colour overlay, resizing beyond
nearest-neighbour integer scaling, re-cropping), the modifications
must be disclosed on the `/colophon` page. The mandate currently
forbids such modifications — see `dci-aesthetic-brief.md` §5.5.
