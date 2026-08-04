# Vendored reference: samasante/liquid-glass

This folder is a **read-only reference copy**, not a dependency. Nothing in
Supervisor imports it or builds against it. It's here so a Claude session (or
you) can read the real "Liquid Glass" implementation while reskinning
Supervisor's buttons — see `../../LIQUID-GLASS-PROMPT.md`.

- **Source:** https://github.com/samasante/liquid-glass
- **Commit:** `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (2026-06-23)
- **License:** MIT © 2026 Sam Asante — see `LICENSE` in this folder.

## What was copied

`README.md`, `BROWSERS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`,
`package.json`, all of `src/`, all of `examples/`, and `docs/hero.jpg`.

## What was left out (and why)

- `docs/lens.gif` (~3.6 MB) and the whole `site/` demo app (~2.6 MB of video
  frames + a Vite project) — too heavy to carry in this repo. Grab them from
  the upstream link above if you want the live demo.
- Lockfiles / tooling config (`pnpm-lock.yaml`, `.prettier*`, `.github/`,
  `tsup.config.ts`, `tsconfig.json`) — irrelevant to reading the technique.

## How to use it as a reference (important)

The upstream library is **React + a build step + `feDisplacementMap` SVG
refraction**, and its live-DOM bending is **Chrome/Edge only**. Supervisor's
`web/` is vanilla JS, no bundler, strict CSP, and runs primarily in an
**iOS/WebKit PWA**. So do **not** try to import or port this code — read it to
understand the *look* (frosted translucency, gradient tint, specular edge,
optional displacement refraction), then reimplement as plain CSS. The
button-reskin brief in `LIQUID-GLASS-PROMPT.md` spells out that adaptation.

Key upstream files worth reading:
- `src/displacement.ts` — how the displacement map (SDF → R/G = X/Y offset,
  B = specular mask) is built. This is the Chrome-only refraction.
- `src/GlassMaterial.tsx` / `src/GlassSurface.tsx` — how the frost, tint, and
  edge highlight layers stack.
- `BROWSERS.md` — the Safari/Firefox caveats that drive our iOS-first fallback.
