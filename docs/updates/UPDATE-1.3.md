# UPDATE 1.3 — Bring `web.new/` to parity with `web/` (and modernize the frontend)

Status: **proposed** (large; multi-phase)
Scope: `web.new/**`, plus a new build step (`build.js`/`tools/`), plus a server CSP header
Risk: medium (new UI can ship behind `SUPERVISOR_WEB_DIR` without touching `web/`)
Depends on: UPDATE-1.1.6 (CSP) pairs with the XSS hardening here; otherwise independent

The `web.new/` redesign is a **visual shell at ~10–15% functional parity**: its
views render from `window.SUPER_DATA` mocks and make **no** `window.api` /
`App.subscribe` / `fetch` calls. The only real wiring is the boot sequence in
`ws.jsx` (`/api/auth/me`, `/api/settings`, WS connect) and the maintenance
modal's `POST /api/maintenance/interactive`. `web/` remains the production UI.

There is already a detailed, phase-by-phase parity brief in the repo:
**`CLAUDE-CODE-PROMPT.md`** (7 phases, 59 items) plus **`WEB-NEW-AUDIT.md`**
(§13 44-row checklist) and **`UI-FEATURE-INVENTORY.md`** (the spec). This
update **adopts those as the parity work** and adds the modernization and
security items the frontend audit surfaced on top.

## Part A — Modernization (do these first; they de-risk everything else)

### 1.3.A1 — Add a build step, drop Babel-standalone (highest value)
`web.new/index.html:59-61` loads `@babel/standalone` (~3MB) from unpkg and
transpiles ~1,900 lines of JSX **on the main thread at every load**, blocking
first paint and forcing fragile manual script ordering (the `ws.jsx` header
comment calls out iOS Safari load-order races). Introduce esbuild (or Vite) to
bundle+transpile to plain JS. The repo already has `build.js` and
`tools/babel-check/` to build on. This single change removes: the 3MB download,
the per-load transpile, the script-order fragility, **and** the SRI/supply-chain
gap below.

> Note: this relaxes the project's "no build step" rule **for `web.new` only**.
> `web/` stays build-free. That's an explicit, worth-it trade — flag it in the
> PR. `CLAUDE-CODE-PROMPT.md` currently says "stay in the no-build setup"; this
> update supersedes that instruction.

### 1.3.A2 — Kill the un-pinned CDN dependency (security)
Until A1 lands, at minimum add `integrity` (SRI) hashes to the React/ReactDOM/
Babel `<script>` tags in `web.new/index.html` and `login.html`, and add a
server-side CSP. After A1 the app is fully first-party and this collapses to
"serve local vendor bundles like `web/` does." (Audit §2.1)

### 1.3.A3 — Fix the dead light theme
`web.new/styles.css` has **no** `[data-theme="light"]` / `prefers-color-scheme`
rules, so the Dark/Light/Auto toggle (`app.jsx:243`, `ws.jsx:96`) only changes
the `theme-color` meta. Port the light + auto token sets from
`web/styles.css:72-95`. (Audit §2.2)

### 1.3.A4 — Ship the missing PWA icons
`web.new/` has only `icon.svg`; `index.html:15`, `manifest.webmanifest:13-14`,
and `sw.js:98-99` reference `icon-192.png`/`icon-512.png`/`icons/` that 404.
Rasterize from `icon.svg` with `tools/gen-icons.js` into `web.new/icons/`, and
reconcile the manifest vs SW icon paths (root-level vs `icons/`). (Audit §2.2)

## Part B — Feature parity (the bulk — follow `CLAUDE-CODE-PROMPT.md`)

Work the 7 phases in `CLAUDE-CODE-PROMPT.md` in order. Summary of the blocking
data-plane work (all currently mock in `web.new`):

1. **Plumbing** — wire the existing `window.App` WS singleton into the views;
   real hash routing that preserves per-view state; port login page; modal
   stack / toast / sheet already exist as ports — connect them.
2. **Maintenance + restart** automation (mostly present; verify end-to-end).
3. **Sessions** — real `sessions` topic, `session:<id>` log stream + stdin,
   all card actions, new-session + folder-picker + preset modals. Drop
   `window.SUPER_DATA.sessions`.
4. **Files** — the biggest lift: `/api/files/*`, preview per kind (CodeMirror /
   pdf.js / highlight.js lazily, copied from `web/vendor/`), selection mode,
   trash, realtime `files:<path>` events.
5. **Console** — replace the fake `<div>` terminal with xterm.js + real
   `shell:<id>` I/O + quick-keys + key-picker.
6. **Processes / System / Settings** — real APIs, 8s process refresh, GPU +
   sparklines, power buttons with password modal, and the entire Settings
   backend half (push enrolment, pins, blocklist, password, backup).
7. **Utilities + polish** — port `web/components/util.js` helpers, view
   transitions, per-view header actions, global error handling.

Split `view-others.jsx` (571 lines, five views) into `view-files.jsx`,
`view-console.jsx`, `view-processes.jsx`, `view-system.jsx`,
`view-settings.jsx` as the prompt specifies.

## Part C — Security & correctness fixes to apply *during* the port

- **1.3.C1 — Sanitize the Markdown/HTML sink (High).** `web/views/files.js`
  `renderMarkdown` (~904-942) injects file-derived HTML via `innerHTML`. When
  porting Files to `web.new`, replace the hand-rolled renderer + `html:`
  injection with a sanitizing renderer (DOMPurify or a strict allowlist). File
  contents are attacker-influenceable (uploads / Claude-written files) → stored
  XSS. Pair with the server CSP from UPDATE-1.1.6. (Audit §2.1)
- **1.3.C2** — Fix carried-over bugs while touching each file:
  - `view-others.jsx:197-201` console `closeTab` next-tab off-by (pre-removal array).
  - `view-sessions.jsx:202-209` `SessionDetail` unguarded `s.status`.
  - `util.jsx:105-115` `throttle` stale-`now` trailing delay.
  - `view-others.jsx:30-39` long-press `setTimeout` fires without a matching pointer event.
  - Remove dead code (`web/views/console.js:482-490`), de-dupe the two `login.html` and `util.js`/`util.jsx`.
- **1.3.C3 — Accessibility.** Segmented controls/toggles/nav in `view-others.jsx`
  are `div`/`button` without `role`/`aria-pressed`/labels; the terminal isn't
  focusable; modals don't trap or restore focus. Add roles, focus management,
  keyboard operability.

## Part D — SW / offline correctness

Precache the **built** bundle (from A1), not the raw `.jsx` (which still needs
Babel to run offline). Add a content hash to bundle filenames so cache
invalidation is automatic instead of the manual `CACHE` bump in
`web.new/sw.js:10`. Keep the `/api/*` + `/ws` pass-through (already correct).

## Acceptance

- `web.new` loads with **no external CDN request** and no in-browser Babel.
- Pointing `SUPERVISOR_WEB_DIR=web.new` at the server yields a UI that passes
  every row of `WEB-NEW-AUDIT.md` §13 and behaves identically to `web/` on the
  flows in `UI-FEATURE-INVENTORY.md`.
- Light theme works; PWA installs with correct icons; push shows the right icon.
- A malicious `.md` file cannot execute script in the preview.
- Once green, plan retirement of `web/` (separate update).
