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
    maintenance.js     singleton headless `claude -p` run in selfRepoPath
    claude-config.js   pre-accepts Claude's folder-trust dialog via node-pty
    restart.js         self-restart via start.bat (Windows-only)
  routes/              thin Express routers, all behind auth.requireAuth except /api/auth
    auth.js files.js sessions.js console.js system.js processes.js push.js
    settings.js maintenance.js ws.js
web/                   PRODUCTION frontend: vanilla JS, no build step, PWA
  app.js               router + WS client + shortcuts + restart banner
  views/ components/   per-tab views; toast/modal/sheet/sparkline/util
  vendor/              committed CodeMirror 5 / xterm / pdf.js / highlight.js (via build.js)
web.new/               REDESIGN prototype: React + Babel-standalone (in-browser JSX), mocked data
supervisor.js          LEGACY single-file v0 prototype (embedded HTML) — superseded by server/
build.js               copies vendor assets node_modules → web/vendor (npm postinstall)
start.bat              Windows launcher (kills stale PID, npm install, node server/server.js)
start-web-new.bat      same but SUPERVISOR_WEB_DIR=web.new
kill.bat               kills PID-file process + port-7778 listeners
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
- Every live update flows through `lib/hub.js` topics → single WebSocket `/ws`. Topic names: `sessions`, `session:<id>`, `shells`, `shell:<id>`, `files:<abs path>`, `system`, `settings`, `maintenance`, `notify` (server-internal).
- **Known architectural flaw**: `routes/ws.js` broadcasts *every* hub event to *every* client — `ws.subs` is recorded but never used for filtering. Fixing this is planned (UPDATE-1.2); don't build features that depend on the broadcast-all behavior.
- `paths.js ensureSafe()` is the only guard for file APIs. It is string-prefix based: it does **not** resolve symlinks and does **not** protect `data/` by default. Planned fix in UPDATE-1.1.
- Session/shell spawn uses `shell:true` with caller-supplied command/args — arbitrary exec by design (post-auth).
- Windows quirks are everywhere: `taskkill /pid /f /t` instead of SIGKILL, `cmd.exe` fallback shell, persistent PowerShell host in metrics.js, 8.3 paths, `start.bat` PID-file dance. Test mentally against both platforms; repo name is supervisor-win-**linux**.
- Vendor libs are committed under `web/vendor/` — never hand-edit them; change `build.js` instead.
- `supervisor.js` at the repo root is dead legacy code — do not extend it.

## Working agreements for Claude sessions

- The user drives scope via prompts and `docs/updates/UPDATE-*.md`. Match changes to the active update doc.
- Keep the no-framework/no-build philosophy of `web/` unless an update doc explicitly says otherwise.
- Never commit anything under `data/` or a real `.env`. `data/` contains the password hash, the cookie-signing secret, and VAPID private keys.
- When changing WS topics or API shapes, update **both** frontends or note the divergence in the PR.
- Update `AUDIT.md` checkboxes / the relevant `docs/updates/UPDATE-*.md` when you fix an audited item.
