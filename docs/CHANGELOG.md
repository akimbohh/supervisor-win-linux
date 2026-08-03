# Changelog

Work delivered against `SUPERVISOR-ENGINEERING-PROMPT.md` (audit / cross-platform
port / hardening) and the `SUPERVISOR-DESIGN-PROMPT.md` "Instrument" redesign.
Each entry notes the reasoning; commit hashes are on the
`claude/supervisor-audit-context-si3r9d` branch.

## Security (§2) — done first, as directed

- **CRIT-1 — deleted `supervisor.js`.** A dead but fully functional
  unauthenticated server (CORS `*`, `0.0.0.0`, spawns `claude rc` in any folder)
  that `node supervisor.js` would have exposed to the network. Logic superseded
  by `server/lib/sessions.js`.
- **CRIT-2 — Markdown stored-XSS fixed + CSP.** `renderMarkdown()` now escapes
  the entire source before applying substitutions (code blocks extracted first
  so highlight.js still sees raw source), links restricted to http/https. Added
  a strict CSP (`script-src 'self'` — blocks inline scripts *and* inline event
  handlers, the real XSS defense), plus `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. To make `script-src
  'self'` hold, `login.html`'s inline script moved to `login.js` and `index.html`'s
  inline `onerror=` handlers were removed. Verified inert against an XSS payload
  table (now a test).
- **CRIT-3 — default-password lockdown.** While the credential is the built-in
  default, every API except `/api/auth/*` returns 403 `mustChangePassword`, and
  the server refuses to bind anything but loopback (override
  `SUPERVISOR_ALLOW_DEFAULT_BIND=1`). `isDefaultPassword()` is cached (scrypt).
- **HIGH-1 — rate-limit bypass closed.** `trust proxy` is gated behind
  `SUPERVISOR_TRUST_PROXY=1` (was blanket-true, so `X-Forwarded-For` rotated the
  bucket freely). Added a global sliding-window failure ceiling on top of the
  per-IP backoff.
- **HIGH-2 — revocable sessions.** `change-password` now rotates `secret.bin`
  *and* bumps a persisted token epoch (so a stolen cookie dies on the very
  action meant to secure the account), then re-issues the acting cookie. New
  `POST /api/auth/logout-all`.
- **HIGH-3 — WebSocket subscription filtering.** Delivery honors `ws.subs`
  (was broadcast-all — every tab got every shell's bytes and every watched
  path). Added per-client backpressure and a 30s heartbeat that reaps half-open
  sockets and frees their watchers.
- **HIGH-4 — `multer` 1.x→2.x, sane upload caps** (1 GB/file, 50 files,
  4 GB/request; overridable), 413 on breach. Was 10 GB×200, no total cap.
- **MED-1/2/3 — path safety.** Hard, non-overridable blocklist for the app's own
  `data/` + `.env` (Files API could read `secret.bin`/`passwd.json`); an empty
  blocklist falls back to defaults instead of disabling protection
  (`blocklistAllowAll` gates the "allow everything" case); `ensureSafe()`
  resolves real paths so a symlink can't escape into a blocked dir.
- **MED-4** — `?token=` query auth restricted to the `/ws` upgrade (was every
  route → leaked into logs/history).
- **MED-5** — resource ceilings: `SUPERVISOR_MAX_SHELLS` (24),
  `SUPERVISOR_MAX_SESSIONS` (32), 429 on breach.
- **MED-6** — a keyed async mutex serializes the trash-manifest
  read-modify-write (concurrent deletes clobbered it). `settings.update()` has
  no await between read and write, so it was already atomic (code wins over the
  brief; left as-is).
- **LOW** — scrypt `N` 16384→32768 with params stored per-hash (old passwords
  still verify, upgrade on next change); stale per-IP failure entries evicted.

## Cross-platform port (§3)

- **Platform adapter (`server/platform/`)** — `win32` / `linux` / `base` (POSIX)
  selected by `index.js`, the *only* place that reads `process.platform`
  (verified: none remain in `server/lib` or `server/routes`). Interface covers
  shell/spawn/kill, metrics, power, restart, service status, capabilities, and
  Linux-native helpers. The persistent PowerShell host moved into `win32.js`.
- **Capability system + `GET /api/system/capabilities`** — a flat map the
  frontend consumes to render unsupported features as *explained disabled
  states*. Demonstrated end-to-end: System's Sleep button is disabled with a
  reason on a virtualized host.
- **P-1** systemd/pm2-aware `selfRestart` (no `.bat` on Linux); **P-2/P-12**
  POSIX spawns are detached process groups killed via `process.kill(-pid)` so
  `claude`/shell children aren't orphaned; **P-3** power actions report real
  success/failure; **P-4** `node-pty` availability surfaced as `caps.pty`;
  **P-5** quick locations existence-checked + `/proc/mounts`; **P-7** `df` parse
  anchors numeric columns; **P-8** net sampling filters virtual interfaces;
  **P-10** boot sanitizer drops stale/cross-platform paths; **P-13** `chmod` +
  `/api/files/chmod` (capability-gated); **P-14** broken symlinks flagged. GPU
  gained an AMD `rocm-smi` fallback.
- **P-9 — Linux deploy story:** `deploy/supervisor.service`,
  `deploy/install-linux.sh`, `start.sh`/`stop.sh`, and `deploy/README.md` (with
  the polkit/sudoers rule for power and the inotify sysctl).

## Correctness (§6)

- Headless maintenance no longer hangs — `--dangerously-skip-permissions` is
  actually passed (its comment claimed it), plus a hard timeout so a stall can't
  permanently lock `isBusy()`.
- Disk-low threshold moved into the emitter (was a hardcoded `>=95%` floor that
  made the 1–50% setting inert).
- Restart banner wired: a Settings → Maintenance "Restart supervisor" button
  calls the previously-dead `App.markRestarting()`.
- Multi-select rename no longer silently renames just the first item.
- Fonts: dropped Inter/JetBrains Mono from the stacks (never loaded); IBM Plex
  Mono wired via `@font-face` + graceful fallback (`web/fonts/README.md`).
- Dead code removed: `.rail-collapsed` CSS, unused imports (`cookieLib`, `hub`,
  `normalize`, `dataPath`, `nextSeq`, unused `os`) — surfaced by the new ESLint.

## `web.new/` (§8)

Removed. It was a mock-only third frontend whose only real work already exists
first-party in `web/`, with a CDN+in-browser-Babel architecture the new CSP
forbids. Rationale in `docs/DECISION-web-new.md`.

## Multi-machine (§4)

- `GET /api/ping` (unauthenticated identity/health), per-instance identity
  settings (`machineLabel`/`machinePattern`/`machineHue`), machine-attributed
  push (`[hostname]` title prefix), and the machine-identity CSS (texture, chip,
  swatches). Design in `docs/MULTI-MACHINE.md`. The header **switcher UI** is the
  remaining piece (see Deferred).

## Linux-native features (§5)

- `GET /api/system/{services,ports,packages,firewall}` and
  `POST /api/system/services/:unit/:action` (password re-confirmed), over the
  Linux adapter helpers, capability-gated, degrading gracefully with reasons.

## Design — "Instrument" (design brief)

- **Phase 0 tokens** — `web/styles.css` re-valued to the neutral Instrument
  system (surface ladder, `--accent-text`, `--overlay`/`--scrim`, elevation,
  ok/warn aliases) preserving every legacy variable name so component CSS is
  unchanged. Five accents as fill+text pairs; real light/auto accent overrides.
- Status-language / connection-pill / machine-identity / capability-disabled
  component classes + glyphs added (CSS + icons).
- The redesign source (direction, system spec, prototype, checklist) is
  committed under `redesign/`.

## Tests / CI (§9)

- `node:test` suite (23 tests): path safety, auth (tokens/epoch/rate-limit),
  Markdown XSS table, store atomicity, mutex, platform-adapter contract, and a
  boot smoke test. ESLint flat config. GitHub Actions matrix
  (ubuntu+windows × node 18/20/22): `node --check`, lint, tests.

## Deferred (honest accounting)

Not done in this pass; each is additive and does not change the server contract:

- **Design Phases 1–5** (the large frontend migration): the status-language JS
  wiring on session/shell badges, the Files one-bar restructure + 3-column
  layout, the xterm/CodeMirror re-theme, sessions/console polish, and the a11y
  sweep (focus traps, ARIA). Phase 0 (the visual foundation) is in; the rest is
  mechanical view-by-view work tracked by `redesign/docs/design/IMPLEMENTATION.md`.
- **Multi-machine switcher UI** (header chip, registry, health polling,
  re-target) — backend + design + CSS are in; the UI is the remaining piece.
- **§5 richer UIs**: a journald follow-viewer and container management (list/
  start/stop/logs/exec) were scoped out to avoid crowding; the cheap read-only
  status endpoints landed. `IBM Plex Mono` woff2 files are a documented drop-in.
- **Windows** changes are reasoned on both platforms but were only executable on
  Linux here; the Windows adapter paths (PowerShell host, taskkill, start.bat)
  are unchanged in behavior and need a manual smoke test on a real Windows host.
