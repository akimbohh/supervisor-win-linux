# CLAUDE.md — Supervisor project context

Context file for Claude Code sessions working on this repository. Read this before touching anything.

## What this project is

**Supervisor** is a personal remote control panel for a single Windows PC (with partial Linux support), reached from a phone over Tailscale. One user, one password, no multi-tenancy. It bundles:

- **Sessions** — Claude Code session manager (`spawn claude rc` in a folder, stream logs, kill/restart, presets).
- **Files** — full file manager (browse/preview/edit/upload/zip/trash) over the whole disk minus a blocklist.
- **Console** — persistent shell tabs (node-pty, falls back to piped `cmd.exe`).
- **Processes** — process list + kill.
- **System** — CPU/mem/disk/net/GPU dashboard + shutdown/restart/sleep.
- **Settings** — theme, presets, blocklist, web-push notifications, password, backup/restore.
- **Maintenance** — self-modification: runs headless or interactive Claude *on this very repo* (`/api/maintenance/*`, `selfRepoPath` setting).

Threat model: private Tailscale network, single trusted user. There is **no TLS** and the design deliberately allows arbitrary command execution *after* auth (shells, sessions with custom commands). That is a feature, not a bug — but pre-auth surface and secret handling still matter.

## Repository map

```
server/                Node backend (Express 4 + ws, CommonJS, no TS, no tests)
  server.js            entry: .env loader, static serving, route mounting, WS setup
  lib/
    auth.js            scrypt password + HMAC-signed cookie tokens + per-IP login rate limit
    paths.js           path normalize + blocklist (ensureSafe) + quick locations
    store.js           atomic JSON persistence into data/
    settings.js        read-through settings cache (DEFAULTS here)
    hub.js             in-process EventEmitter pub/sub ('msg' + per-topic)
    fs-ops.js          list/read/write/copy/move/trash/zip-list
    watchers.js        chokidar per-path watchers, ref-counted per WS client
    sessions.js        Claude Code session lifecycle (spawn shell:true), log ring, persistence
    shells.js          shell tabs: node-pty or piped fallback, scrollback files in data/shells/
    metrics.js         persistent PowerShell host (Win) / ps+df (Linux), history ring
    push.js            VAPID web-push, subs in data/push-subs.json, hub 'notify' bridge
    maintenance.js     singleton headless `claude -p` run in selfRepoPath (flag+timeout fixed)
    claude-config.js   pre-accepts Claude's folder-trust dialog via node-pty
    restart.js         thin wrapper → platform.selfRestart()
    mutex.js           tiny keyed async mutex (serializes RMW on shared JSON)
  platform/            THE ONLY place that reads process.platform (§3 adapter)
    index.js           selects win32 | linux | base(posix) for the host
    capabilities.js    detects+caches what this host can do → GET /api/system/capabilities
    base.js win32.js linux.js   adapter impls (PS host lives in win32.js)
  routes/              thin Express routers, all behind auth.requireAuth except /api/auth + /api/ping
    auth.js files.js sessions.js console.js system.js processes.js push.js
    settings.js maintenance.js ws.js
web/                   PRODUCTION frontend: vanilla JS, no build step, PWA
  app.js               router + WS client + shortcuts + restart banner
  login.js             login page behavior (externalized so CSP script-src 'self' holds)
  views/ components/   per-tab views; toast/modal/sheet/sparkline/util
  fonts/               IBM Plex Mono drop-in (README; woff2 not committed)
  vendor/              committed CodeMirror 5 / xterm / pdf.js / highlight.js (via build.js)
redesign/              "Instrument" redesign: docs/design/* spec + no-build prototype
build.js               copies vendor assets node_modules → web/vendor (npm postinstall)
start.bat / start.sh   launchers (Windows / POSIX); kill.bat / stop.sh
deploy/                systemd unit + install-linux.sh + README (P-9)
test/                  node:test suites (paths/auth/markdown/store/mutex/platform/smoke)
data/                  RUNTIME STATE — gitignored. passwd.json, secret.bin (HMAC key),
                       vapid.json, settings.json, sessions.json, shells.json,
                       session-logs/, shells/ (scrollback), trash/, supervisor.pid
UI-FEATURE-INVENTORY.md   complete catalogue of every web/ feature (the spec)
WEB-NEW-AUDIT.md          gap report: web.new vs web (44-row checklist in §13)
CLAUDE-CODE-PROMPT.md     ready-made prompt to bring web.new to parity
AUDIT.md                  full code audit (2026-08) — read before refactoring
docs/updates/             UPDATE-1.1.md … 1.6.md — versioned improvement roadmap
                          (1.1 security, 1.2 WS filtering, 1.3 web.new parity,
                           1.4 Linux parity, 1.5 tests/CI, 1.6 features)
```

## How to run

- Windows: `start.bat` (or `start-web-new.bat` for the redesign UI). Node ≥18.
- Any OS: `npm install && npm start` → http://localhost:7778. First-run password comes from `SUPERVISOR_PASSWORD` in `.env` (default fallback `supervisor`).
- `.env` **overrides** real environment variables (intentional; see server.js loadDotEnv).
- No test suite and no linter exist yet. Verify changes with `node --check <file>` and by booting the server.

## Conventions & gotchas

- CommonJS everywhere in `server/`; vanilla ES in `web/` (no modules — files are concatenated into globals via `<script>` order); `web.new/` uses JSX transpiled **in the browser** by Babel-standalone.
- All persistence is small JSON files via `lib/store.js` (atomic tmp+rename). No DB.
- Every live update flows through `lib/hub.js` topics → single WebSocket `/ws`. Topic names: `sessions`, `session:<id>`, `shells`, `shell:<id>`, `files:<abs path>`, `system`, `settings`, `maintenance`, `notify` (server-internal). **`routes/ws.js` now filters delivery by `ws.subs`** (was broadcast-all; fixed HIGH-3) — the global-topic set is `hello`/`pong`/`server`/`settings`.
- `paths.js ensureSafe()` is the guard for file APIs. It now **resolves real paths** (symlink-safe) and **hard-blocks `data/` + `.env`** unconditionally (fixed MED-1/3). An empty blocklist falls back to defaults; disabling needs `blocklistAllowAll`.
- Session/shell spawn goes through `platform.spawnManaged` + `killTree`: `shell:true`+`taskkill` on Windows, detached process groups + `process.kill(-pid)` on POSIX. **Do not add `process.platform` checks outside `server/platform/`** — route new platform behavior through the adapter.
- Capabilities: call `platform.capabilities()` / `GET /api/system/capabilities`; render unsupported features as disabled-with-reason, never hidden.
- Windows quirks live in `platform/win32.js` (taskkill, `cmd.exe`, persistent PowerShell host, `start.bat`). Test mentally against both platforms; repo name is supervisor-win-**linux**. Windows paths here were only runnable on Linux — flag Windows-only changes for manual verification.
- Tests: `npm test` (node:test), `npm run lint` (ESLint). Add a regression test with any security/platform fix.
- Vendor libs are committed under `web/vendor/` — never hand-edit them; change `build.js` instead.
- `supervisor.js` at the repo root is dead legacy code — do not extend it.

## Working agreements for Claude sessions

- The user drives scope via prompts and `docs/updates/UPDATE-*.md`. Match changes to the active update doc.
- Keep the no-framework/no-build philosophy of `web/` unless an update doc explicitly says otherwise.
- Never commit anything under `data/` or a real `.env`. `data/` contains the password hash, the cookie-signing secret, and VAPID private keys.
- When changing WS topics or API shapes, update **both** frontends or note the divergence in the PR.
- Update `AUDIT.md` checkboxes / the relevant `docs/updates/UPDATE-*.md` when you fix an audited item.
