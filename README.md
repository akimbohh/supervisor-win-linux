# Supervisor

A personal remote control panel for a Windows PC, accessed from a phone over Tailscale.

It's:

- **Sessions** — a Claude Code session manager. Spawn `claude rc` in any folder, watch the live log from your phone, kill or restart, save folder+args+pre-prompt as one-tap presets.
- **Files** — a real file manager. Browse anywhere, preview text/code/Markdown/images/PDFs/video/audio/zip, edit text in CodeMirror with Ctrl+S, multi-select to bulk move/copy/zip/download/delete, real-time updates when files change on disk.
- **Console** — persistent shell tabs powered by node-pty (full xterm.js terminal, ANSI colours, command history). Falls back to a piped `cmd.exe` if node-pty fails to install.
- **Processes** — system-wide process list with kill button.
- **System** — CPU (per-core + total), memory, disks, network throughput, GPU (Nvidia), top processes, plus shutdown/restart/sleep with password re-prompt.
- **Settings** — theme, accent, pinned folders, presets, blocklist, web push notifications, change password, backup/restore.

It's designed for a single user, runs as a background Node service on Windows, and is meant to be reached over a private network like Tailscale.

---

## Quick start

You need **Node.js 18 or newer**.

### The easy way (Windows)

Double-click **`start.bat`**. It will:
1. Run `npm install` if `node_modules` is missing.
2. Copy `.env.example` → `.env` if `.env` is missing.
3. Start the server.

Edit `.env` to set your password before the very first sign-in (or use the default `changeme` and change it from **Settings → Account** afterwards).

### Or by hand

```
npm install
npm start
```

Configuration is read from `.env` at startup (a tiny built-in loader, no `dotenv` dependency). **`.env` values override real environment variables** — the file is the source of truth. To use a real env var instead, comment out the corresponding line in `.env`.

Setting `SUPERVISOR_PASSWORD` is **only needed the first time** — after that it's hashed into `data/passwd.json` and the env var is ignored. To run on a different port for one launch, edit `SUPERVISOR_PORT` in `.env`.

Then open one of the URLs the server prints, for example:

```
Local:    http://localhost:7778
Tailscale http://100.x.y.z:7778
```

On your phone, hit the Tailscale URL, log in, then tap **Add to Home Screen** in the browser menu — the app installs as a PWA.

### Running as a background service

Easiest path on Windows: use [`pm2`](https://pm2.keymetrics.io/) or the Task Scheduler.

```bash
npm install -g pm2
pm2 start server/server.js --name supervisor
pm2 save
pm2-startup install   # so it survives reboots
```

Or with NSSM (`nssm install Supervisor`), or via a Scheduled Task with action `node` and arguments `server/server.js`.

---

## Environment variables

| Var | Default | What |
|---|---|---|
| `SUPERVISOR_PORT` | `7778` | HTTP port |
| `SUPERVISOR_BIND` | `0.0.0.0` | Bind address (use `127.0.0.1` to restrict to localhost only) |
| `SUPERVISOR_PASSWORD` | `supervisor` | **Only on first run** — sets the initial password, then is ignored |

All other configuration lives in `data/settings.json` and is editable from the Settings tab.

---

## Files & folders

```
server/                  Node backend
  server.js              entry — express + ws + static
  lib/
    auth.js              scrypt + HMAC-signed session cookies + rate limiting
    paths.js             path resolution + blocklist
    store.js             atomic JSON persistence
    settings.js          read-through settings cache
    hub.js               in-process pub/sub
    fs-ops.js            list / read / write / copy / move / trash / zip-list
    watchers.js          chokidar wrappers, ref-counted per WS connection
    sessions.js          Claude Code session lifecycle + persistence
    shells.js            node-pty (or piped cmd.exe) shell sessions + scrollback
    metrics.js           CPU / memory / disks / net / GPU / process list
    push.js              VAPID + Web Push subscriptions, hub→push bridge
  routes/
    auth.js              /api/auth/login | logout | me | change-password
    files.js             /api/files/...
    sessions.js          /api/sessions/...
    console.js           /api/console/...
    system.js            /api/system + /api/system/power
    processes.js         /api/processes + /api/processes/:pid/kill
    settings.js          /api/settings (GET/PATCH/reset/export/import)
    push.js              /api/push/vapid-key | subscribe | test
    ws.js                /ws — single connection per client; topic pub/sub

web/                     Static frontend (no build step on the user side)
  index.html             app shell
  login.html             auth page
  app.js                 router + WS client + state
  styles.css             design system (dark-first, amber accent)
  icons.js               inline SVG icons (Lucide-derived)
  manifest.webmanifest   PWA manifest
  sw.js                  service worker — shell cache + push handler
  components/            toast, modal, sheet, sparkline, util
  views/                 sessions, files, console, processes, system, settings
  vendor/                CodeMirror 5 / xterm / pdf.js / highlight.js (committed)

data/                    Created on first run. Holds password hash, signing
                         secret, session metadata, scrollbacks, push subs,
                         settings, trash. Excluded from git.

build.js                 Copies vendor JS/CSS from node_modules into
                         web/vendor/ at install time (npm postinstall).
                         Idempotent and safe to re-run.
```

---

## Architecture choices (and why)

- **Vanilla JS, no framework.** Sub-200 KB JS shell, 0 build step, instant load on cellular.
- **CodeMirror 5, not 6.** v5 ships a UMD bundle that just works — v6 needs bundling and added complexity that isn't worth it for in-browser file editing.
- **Single WebSocket, topic pub/sub.** One persistent socket per tab. Everything live (file changes, session logs, shell I/O, system metrics, settings updates) flows through it. The frontend subscribes to `files:<path>`, `session:<id>`, `shell:<id>`, `system`, `sessions`, `shells`, `settings` as needed.
- **node-pty optional.** It's a native module that occasionally fails to build. If it's missing, shells fall back to a piped `cmd.exe`. Reduced features (no resize, no tty colours) but everything still works.
- **scrypt + HMAC, no JWT library.** Node's `crypto` already has both. Cookie value is `base64url(JSON).hex(HMAC)`, secret stored in `data/secret.bin`.
- **Trash, not delete.** Deletes go to `data/trash/` with a manifest; visible from Files → menu → Trash; auto-capped at 500 items.
- **Per-WS watcher refcount.** chokidar watchers start when a client subscribes to `files:<path>` and close when the last subscriber disconnects.

---

## Permissions and safety

- All API and WebSocket connections require auth.
- Failed logins are rate-limited per IP with exponential backoff (5s → 15s → 60s → 5m → 30m).
- The path blocklist (Settings → Files) prevents reads/writes inside protected paths. Default Windows blocklist:
  - `C:\Windows`
  - `C:\Program Files\Windows Defender`
  - `C:\$Recycle.Bin`
  - `C:\System Volume Information`
  - `C:\PerfLogs`
- Power actions (shutdown/restart/sleep) require entering the password again.
- Killing the supervisor's own PID is refused.

There is **no TLS** — the assumption is you reach the server over Tailscale, which gives you a private network with WireGuard encryption end-to-end. If you expose this to the public internet, put a TLS-terminating proxy in front of it.

---

## Push notifications

Tap **Settings → Notifications → Enable on this device** while signed in. The browser will ask for permission, then the device gets a Web Push subscription. The server stores subscriptions in `data/push-subs.json` and broadcasts:

- **Session finished** — when a Claude Code process exits
- **Session asks for input** — heuristic match on prompts that end with `?` or `(y/n)`
- **Session error** — non-zero exit
- **Disk low** — when any drive crosses the configured threshold (default 10% free remaining)

Each category has a per-device toggle.

---

## Keyboard shortcuts (desktop)

| Keys | Action |
|---|---|
| `?` | Show shortcuts overlay |
| `g s` | Sessions |
| `g f` | Files |
| `g c` | Console |
| `g p` | Processes |
| `g y` | System |
| `g t` | Settings |
| `Ctrl+S` | Save (in file editor) |
| `Esc` | Close modal / sheet |

---

## Recovering or resetting

- **Forgot the password?** Stop the server, delete `data/passwd.json`, set `SUPERVISOR_PASSWORD` and start again.
- **Want a clean slate?** Delete the whole `data/` folder.
- **Need to inspect logs?** stdout/stderr go to the terminal (or pm2 logs).

---

## Status

Built end-to-end as one project. Every tab in the spec is wired and working. Vendor assets are committed under `web/vendor/` so a fresh `npm install && npm start` does not need network for anything except the npm registry itself.
