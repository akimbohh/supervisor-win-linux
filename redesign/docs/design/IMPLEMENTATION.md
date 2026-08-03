# Supervisor — Implementation Plan

*Deliverable 4. How to get from the current `web/` to the Instrument design. The vanilla-JS, no-build-step constraint stays — no case for changing it: the app's scale (six views, one contributor) never amortizes a bundler, and the redesign is expressible entirely in CSS custom properties + the existing component idiom.*

The prototype in `prototype/` is the reference: its `_src/tokens.css` is written to drop into `web/styles.css`'s place, and its component markup mirrors the existing `el()`-built DOM closely enough to diff against.

---

## Phase 0 — Tokens (ship alone, zero behavior change)

Pure `styles.css` swap. Everything else keeps working while looking new.

1. Replace the `:root` token block with the SYSTEM.md set: neutral surface ladder, `--overlay`, `--scrim`, text tiers, semantic set, elevation shadows (`--sh-1/3/4`), spacing/radius/type tokens.
2. Replace the five accent blocks with the new families **including `--accent-text`**, and add the five light-theme accent overrides (the current CSS has none — accents are unreadable-risk on light today).
3. Add `@font-face` for IBM Plex Mono (2 files under `web/fonts/`), extend `--mono`, add the fonts to `sw.js` cache list, bump `CACHE`.
4. Delete dead CSS: `.rail-collapsed`, `#menu-btn`, `--accent-dim` uses → `filter: brightness()`.
5. Mechanical find/replace across views: accent-as-text-color (`color: var(--accent)`) → `var(--accent-text)`; every ad-hoc `box-shadow` → the elevation tokens.

Risk: low. Test: every tab, both themes, all five accents.

## Phase 1 — Status language + connection pill

1. Add the `.st` chip component and the seven glyphs to `icons.js` (`st-killing`, `st-cap`, `wave-broken` etc. from the prototype shell).
2. `views/sessions.js`: replace badge rendering with `stChip()`; **add the `killing` state** (set on kill-POST, cleared on the `session:*` exit event).
3. `views/console.js`: replace the ` (pipe)` suffix with the degraded chip on the tab + the degraded strip above the terminal (prototype `console.html` markup).
4. `app.js`: connection dot + latency badge → one `.conn` pill with the four thresholds.
5. Restyle toasts/badges to the new tokens (markup unchanged).

## Phase 2 — Machine identity (new feature)

Backend first: a `machines` registry in `data/settings.json` (name, url, platform, pattern, hue), a `/api/machines` route, and per-machine reachability pings proxied by whichever instance you're talking to (or client-side fetch with timeout).

Frontend, all in one PR since it's additive chrome:
1. `data-machine` on `<html>`; `--machine-*` tokens + the four CSS patterns; `body::before` texture layer.
2. Header machine chip (prototype `shell.html` markup) replacing the static logo; switcher sheet with the four row states (current / online / unreachable / not-signed-in).
3. `confirmModal()` in `util.js` gains a `machine: true` option rendering the identity block — turn it on for kill/delete/power/close-shell.
4. `server/lib/push.js`: prefix notification titles with `[hostname]`.
5. Unreachable + sign-in interstitials (prototype modals).

## Phase 3 — Files restructure (the big one)

`views/files.js` (~3000 lines) is restructured, not rewritten: list rendering, preview kinds, clipboard logic, and API calls survive; the toolbar and layout change.

1. Replace the wrapping toolbar with the one-bar layout (`f-bar`): crumb strip (collapse middle segments to `…` beyond 3), search-toggle, `＋`, `⋯`.
2. Move sort / view toggle / show-hidden / open-in-console/claude / pin / refresh into the `⋯` sheet; sort gets its own sheet (persistence unchanged).
3. Desktop ≥1024px: 3-column grid (existing sidebar + list + preview become grid children); <1024px: sidebar and preview render into `sheet.open()`.
4. Selection bar: rebuild as the sticky bottom bar; **fix Rename** (disabled with reason when >1 selected); clipboard bar as its second state.
5. Long-press keeps 500ms/8px but every long-press target gains a visible `⋯`/kebab path.
6. Markdown preview: swap the renderer for an escaped one (the audit's XSS hole) — render to text nodes, allow a whitelist.

## Phase 4 — Sessions & Console polish

1. New-session modal + folder picker + preset edit → new markup, same endpoints; presets get the chip-with-kebab pattern.
2. Session detail: `log-resume` pill (pause on >30px up-scroll, resume button), match stepping (already exists — restyle), stdin row, Send-to-Claude.
3. **Unify Send-to-Claude**: extract `sendToClaude(text)` into `util.js` — always threads text through `#sessions/new/<folder>` with prePrompt state; Console's clipboard hack calls it too.
4. Quick keys: armed-Ctrl visual (`.qk.armed` + pulse), kebab/right-click menu parity for edit/remove, key picker restyled.
5. Empty states: one `emptyState()` idiom, written for each view (two per list view: none vs. no-match).

## Phase 5 — Accessibility & cleanup sweep

1. `modal.js`/`sheet.js`: `role="dialog"`, `aria-modal`, focus trap, focus return (prototype `openModal` is the reference implementation).
2. Every dynamically-created icon button: `aria-label` (grep for `title:` in view code).
3. Wire or delete pull-to-refresh (recommend: wire it in Files and Processes only); wire the restart banner to the restart POST (`sessionStorage` flag already exists server-side).
4. Capability API: `/api/system` already returns platform; add a `caps` object (suspend, gpu, pty). Render capability-disabled controls from it.
5. Keyboard shortcuts table in Settings; `prefers-reduced-motion` audit.

## Ship order & increments

Each phase ships alone. 0 and 1 are a weekend; 2 requires the multi-machine backend decision; 3 is the long pole; 4–5 are steady polish. Nothing blocks on anything later than itself.
