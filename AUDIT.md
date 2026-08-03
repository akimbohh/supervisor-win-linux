# Supervisor — Code Audit

Date: 2026-08 · Scope: full repository at import (`server/`, `web/`, `web.new/`, `supervisor.js`, launchers, docs).
Method: full read of every first-party source file (backend read directly; frontend read via a dedicated sub-audit). Vendor assets (`web/vendor/`) excluded.

This is the reference audit. Fixes are organized into `docs/updates/UPDATE-1.x.md`; each finding below links to the update that carries it. Check items off as they land.

## Legend

Severity reflects impact **within the project's stated threat model**: a single trusted user, reached only over a private Tailscale network, with intentional post-auth arbitrary command execution and no TLS. "Critical/High" therefore means a hole the design does *not* intend (pre-auth exposure, secret leakage, escalation to a permanent bypass) — not merely "runs commands," which is the point of the app.

---

## 1. Backend

### 1.1 Critical

- [ ] **Login rate-limit is bypassable via spoofed `X-Forwarded-For`.**
  `server/server.js:53` sets `app.set('trust proxy', true)`; `server/routes/auth.js:7` (`getIp`) and the lockout in `server/lib/auth.js:99-121` key entirely on `req.ip`. With `trust proxy` fully trusting, `req.ip` is read from the client-controlled `X-Forwarded-For` header, so an attacker rotates that header per request and never trips the 5s→30m backoff — defeating the *only* brute-force defense on the single password. → **UPDATE-1.1.1**

### 1.2 High

- [ ] **The file API can read and overwrite the app's own secrets.**
  `server/lib/paths.js` `ensureSafe()` + the default blocklists (lines 10-21) do not include the repo's `data/` directory or `.env`. An authenticated request can `GET /api/files/read?path=<repo>/data/secret.bin` to exfiltrate the HMAC cookie-signing key (→ **forge session cookies forever, surviving password change**), read `data/passwd.json` (scrypt hash) and `data/vapid.json` (push private key), and `POST /api/files/write`/`delete` to corrupt them. → **UPDATE-1.1.2**
- [ ] **Blocklist is prefix-only and symlink-blind.**
  `isBlocked()` (`paths.js:35-43`) compares `path.resolve(p)` against resolved prefixes but never calls `fs.realpath`; `fs-ops.js listDir` (lines 33-36) *follows* symlinks. A symlink inside an allowed folder pointing into a blocked path (or into `data/`) escapes the guard. Windows 8.3 short names (`C:\PROGRA~1`) and casing variants also sidestep a naive prefix match. → **UPDATE-1.1.3**

### 1.3 Medium

- [ ] **Legacy `supervisor.js` is an unauthenticated RCE server.**
  The root `supervisor.js` (v0 prototype) has no auth, sets `Access-Control-Allow-Origin: *` (line 87), and spawns `claude rc` in any folder on an unauthenticated `POST /api/sessions` (lines 130-143). Running `node supervisor.js` exposes full command execution to the whole network. It is dead code but its name invites exactly that. → **UPDATE-1.1.5**
- [ ] **Headless maintenance hangs — missing the flag its own comment relies on.**
  `server/lib/maintenance.js:60` documents `--dangerously-skip-permissions`, but the spawn at line 74 is `spawn('claude', ['-p'], …)` without it. stdin is closed right after the prompt (lines 92-95), so any Edit/Write permission prompt can never be answered and the run stalls until timeout. → **UPDATE-1.1.4**
- [ ] **WebSocket broadcasts every event to every client.**
  `server/routes/ws.js:35` wires `hub.on('msg', broadcast)`; `ws.subs` is populated by `sub`/`unsub` (lines 47-60) but never consulted for delivery. Every client receives every `system` tick, every `files:*` event, every `shell:*` byte. Wasteful and leaky; caps scalability. → **UPDATE-1.2**
- [ ] **No WS backpressure or dead-socket reaping.**
  `broadcast()` (`ws.js:27-32`) calls `c.send` without checking `bufferedAmount`; the server answers `ping` but never initiates its own heartbeat, so half-open sockets (phone sleep, Tailscale drop) linger and leak their watchers. → **UPDATE-1.2**
- [ ] **Power-action errors are swallowed after the response is sent.**
  `server/routes/system.js:32` runs `cp.exec(cmd)` and immediately returns `{ ok:true }`; on Linux these commands often need root/polkit and fail silently. → **UPDATE-1.4.3**

### 1.4 Low / design-aware

- [ ] Cookie has no `Secure` (intentional — no TLS) and `sameSite:'lax'` with no CSRF token. JSON-body-only mutations are an implicit CSRF barrier, but make `Secure` opt-in (`SUPERVISOR_TLS`) and document the decision. → **UPDATE-1.1.6**
- [ ] `secret.bin` is never rotated on password change, so a previously-leaked signing key keeps minting valid cookies. → **UPDATE-1.1.2**
- [ ] Dead imports: `routes/console.js`, `routes/files.js`, `routes/sessions.js` all `require` `hub`/`settings` they don't use. → **UPDATE-1.5.2**
- [ ] "Asks for input" detection (`sessions.js:78-86`) is fragile stdout scraping (`?`, `(y/n)`). → **UPDATE-1.6** (structured stream-json).
- [ ] `.env` **overrides** real environment variables (`server.js:16-31`) — documented but a footgun.

### 1.5 What the backend gets right

scrypt + `timingSafeEqual` password check; atomic JSON writes (tmp + rename, `store.js`); HMAC-signed tokens with expiry and constant-time comparison; trash with manifest + 500-item cap; per-WS chokidar watcher ref-counting; a clever persistent-PowerShell host to avoid per-tick spawn cost (`metrics.js`); graceful shutdown with child cleanup; the PID-file stale-kill dance; `ensureSafe` applied on every fs operation; `x-powered-by` disabled; no `eval`; input validation on nearly every route.

---

## 2. Frontend

Two frontends ship: `web/` (the working, production vanilla-JS PWA) and `web.new/` (a React + Babel-standalone redesign that is **a visual shell at ~10–15% functional parity** — its views render from `window.SUPER_DATA` mocks and make no `window.api` / `App.subscribe` / `fetch` calls). Parity work is **UPDATE-1.3**.

### 2.1 High

- [ ] **Stored-XSS surface in the Markdown preview (`web/`, inherited by `web.new/` when ported).**
  `web/views/files.js` `renderMarkdown` (~lines 904-942) builds HTML from **file contents** and injects it via the `html:` prop (which sets `innerHTML`, `util.js:20`). Text and code blocks are escaped, but link labels/inline constructs are only partially sanitized and rely on an `https?:` URL anchor rather than validating surrounding markup. File contents are attacker-influenceable (uploads, or a Claude session writing files) → stored XSS on the control panel. Fix with a sanitizing renderer (DOMPurify/allowlist) + a server CSP before porting Files to `web.new`. → **UPDATE-1.3 / UPDATE-1.1.6 (CSP)**
- [ ] **CDN dependencies with no SRI and no CSP (`web.new/`).**
  `web.new/index.html:59-61` and `login.html:47-49` load React, ReactDOM, and `@babel/standalone` from `unpkg.com` with `crossorigin` but no `integrity` hash. A hijacked unpkg response runs with full privileges on the panel. `web/` has no external runtime dependency. → **UPDATE-1.3** (build step removes it entirely).

### 2.2 Medium

- [ ] **`web.new` is mock-only.** `view-sessions.jsx` / `view-others.jsx` make zero backend calls; every button `stopPropagation()`s to a no-op. Sessions/Files/Console/Processes/System/Settings are all stubs vs the working `web/views/*`. → **UPDATE-1.3** (the bulk of the work).
- [ ] **Light theme is dead in `web.new`.** `web.new/styles.css` has no `[data-theme="light"]` / `prefers-color-scheme` rules, yet the theme toggle flips `data-theme` (`app.jsx:243`, `ws.jsx:96`). Choosing Light only changes the `theme-color` meta. `web/styles.css:72-95` implements it. → **UPDATE-1.3**
- [ ] **Missing PWA icons in `web.new`.** Only `icon.svg` exists; `index.html:15`, `manifest.webmanifest:13-14`, and `sw.js:98-99` reference `icon-192.png`/`icon-512.png`/`icons/` that 404 (server icon route serves from a nonexistent `web.new/icons`). Breaks home-screen install + push icons. Rasterize via `tools/gen-icons.js`. → **UPDATE-1.3**
- [ ] **Babel-in-browser (~3MB) transpiles ~1,900 lines of JSX on the main thread every load**, blocking first paint; also forces fragile manual script ordering (`ws.jsx` header notes iOS Safari races). → **UPDATE-1.3** (adopt esbuild/Vite; the repo already has `build.js` + `tools/babel-check/`).

### 2.3 Low (concrete bugs, `file:line`)

- [ ] `view-others.jsx:197-201` — console `closeTab` sets active to `tabs[0].id` from the **pre-removal** array → active id can point at the just-closed tab.
- [ ] `view-sessions.jsx:202-209` — `SessionDetail` reads `s.status` with no guard when the id is missing (latent until real data).
- [ ] `web/views/sessions.js:664-671` — uptime-ticker maps `.tabular` spans positionally onto running sessions, but exited cards also emit `.tabular` (line 170) → indices drift, wrong cards get uptime text (only when `groupBy==='none' && filter==='all'`).
- [ ] `util.jsx:105-115` / `web/components/util.js:101-111` — `throttle` trailing-delay uses a stale `now`, firing late/early.
- [ ] `view-others.jsx:30-39` — long-press `setTimeout` can still enter select-mode if the `{once:true}` pointer handlers never fire; allocates closures per press.
- [ ] `web/views/console.js:482-490` — dead `origActivate`/re-wrapped `reload`; confusing and fragile.

### 2.4 What the frontend gets right

`web/` is a genuinely complete, dependency-light PWA: real WS client with exponential-backoff reconnect + re-subscribe + ping/pong RTT (faithfully ported into `web.new/ws.jsx`), httpOnly SameSite cookie auth (token never in localStorage), service worker that correctly passes through `/api/*` and `/ws` (never caches authenticated data), CodeMirror/xterm/pdf.js lazily used, and a coherent design system. The `web.new` visual layer (aurora, density, live-bars, donuts, fonts) is polished and worth keeping.

---

## 3. Cross-cutting

- [ ] **No tests, linter, CI, or type checking.** For a project whose headline feature is unattended self-editing, this is the highest-leverage gap. → **UPDATE-1.5**
- [ ] **Windows-centric.** Self-restart (`lib/restart.js`) is `.bat`-only; GPU metrics are Nvidia-only; Linux power actions need privileges; process CPU semantics differ across platforms. The repo is named `-win-linux`; make Linux first-class. → **UPDATE-1.4**
- [ ] **Two divergent frontends.** Long-term, bring `web.new` to parity (UPDATE-1.3) then retire `web/`. Until then, changes to WS topics / API shapes must update both or note the divergence.

---

## 4. Update-doc index

| Update | Theme | Priority |
|--------|-------|----------|
| UPDATE-1.1 | Security & correctness hardening (backend) | **do first** |
| UPDATE-1.2 | WebSocket topic filtering & realtime correctness | high |
| UPDATE-1.3 | Bring `web.new/` to parity with `web/` | high (large) |
| UPDATE-1.4 | Cross-platform (Linux) parity & robustness | medium |
| UPDATE-1.5 | Tests, linting, CI, error handling | high (enabler) |
| UPDATE-1.6 | Feature enhancements & product backlog | backlog |

Recommended order: **1.1 → 1.5 (test harness) → 1.2 → 1.3/1.4 in parallel → 1.6**.
