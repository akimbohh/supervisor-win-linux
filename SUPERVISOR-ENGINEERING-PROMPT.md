# Supervisor — Audit, Cross-Platform Port, and Hardening Brief

**Read this entire document before writing a single line of code.**

You are being handed a working personal infrastructure tool. It is not a toy and it is not disposable — it runs on the author's machine every day and it is how he controls his computers from his phone. Your job is to understand it deeply, port it cleanly, harden it honestly, and improve it without breaking a single thing that currently works.

---

## 0. What this repo is

`supervisor` is a single-user, mobile-first remote control panel. It is a Node/Express + `ws` backend serving a vanilla-JS PWA. It is reached from a phone over Tailscale. It currently runs on Windows only.

Six tabs:

| Tab | What it does |
|---|---|
| **Sessions** | Spawns and supervises Claude Code processes (`claude rc`) in arbitrary folders. Live log streaming, kill/restart/rename/tag, stdin injection, saved presets (folder + args + pre-prompt), push notification when a session finishes or asks a question. |
| **Files** | A real file manager over the whole disk. Browse, preview (text/code/Markdown/image/PDF/video/audio/hex/zip), edit in CodeMirror with Ctrl+S, multi-select bulk move/copy/duplicate/zip/download/delete, trash with restore, upload, live updates via chokidar. |
| **Console** | Persistent shell tabs on xterm.js, backed by `node-pty` with a piped fallback. Scrollback persisted to disk. Editable quick-key chips. |
| **Processes** | System-wide process list with kill. |
| **System** | CPU per-core, memory, disks, network throughput, GPU, top processes, sparkline history, power actions behind a password re-prompt. |
| **Settings** | Theme/accent, pinned folders, presets, path blocklist, web push per-device toggles, password change, settings export/import. |

~13,000 lines of hand-written code (excluding vendored CodeMirror/xterm/pdf.js/highlight.js). No build step for the frontend. No tests. No linter. No CI.

### Key files

```
server/server.js                  entry — express + ws + static + .env loader
server/lib/auth.js                scrypt + HMAC-signed cookies + IP rate limiting
server/lib/paths.js               path resolution, blocklist, quick locations
server/lib/store.js               atomic JSON persistence
server/lib/settings.js            read-through settings cache
server/lib/hub.js                 in-process pub/sub
server/lib/fs-ops.js              list/read/write/copy/move/trash/zip
server/lib/watchers.js            chokidar wrappers, ref-counted per WS connection
server/lib/sessions.js            Claude Code session lifecycle
server/lib/shells.js              node-pty (or piped fallback) shells + scrollback
server/lib/metrics.js             CPU/mem/disk/net/GPU/process list
server/lib/claude-config.js       auto-accepts Claude's workspace-trust dialog via PTY
server/lib/maintenance.js         self-modification flows (see §7)
server/lib/restart.js             self-restart (Windows-only today)
server/lib/push.js                VAPID + Web Push
server/routes/*.js                REST + /ws
web/                              vanilla-JS PWA (app.js, styles.css, icons.js, views/, components/)
web.new/                          abandoned React-via-CDN rewrite — see §8
supervisor.js                     DEAD legacy entry point — see §2 CRIT-1
start.bat / kill.bat / start-web-new.bat
```

---

## 1. Your mission, in order

You will work in four phases. **Do not skip ahead.** Each phase ends with a written artifact committed to the repo.

### Phase A — Understand (produce `docs/ARCHITECTURE.md`)

Read every non-vendored file. Then write an architecture document that explains, in your own words:

- The full request lifecycle for an authenticated API call and for a WebSocket message.
- How state flows: `hub` → WS broadcast → frontend `App` → view re-render. Where the cache-invalidation seams are.
- The lifecycle of a Claude session from `POST /api/sessions` to process exit and push notification, including the `claude-config.js` trust-dialog dance and why it exists.
- The lifecycle of a shell from `POST /api/console` through PTY allocation, scrollback flushing, and `shell:write` hot-path over WS.
- Every piece of persisted state in `data/` and what breaks if each file is deleted.
- A dependency graph of `server/lib/*` modules.
- **A list of everything you found that is dead, half-wired, or contradicts its own comments.** There is a lot. Some is catalogued below; find the rest.

Do not proceed until this document is accurate. If any of my claims below contradict what you read in the code, **the code wins** — note the discrepancy and correct me in your document.

### Phase B — Fix and port (the bulk of the work)

Sections §2 through §6 below. Security fixes land first, then the platform abstraction, then multi-machine.

### Phase C — Harden (produce tests + CI)

Section §9.

### Phase D — Polish (produce `docs/CHANGELOG.md`)

Section §7 and §10.

---

## 2. Security — fix these before anything else

The threat model is: *single user, reached over Tailscale, no TLS, full remote code execution by design.* That model is acceptable. What is not acceptable is any path by which a **non-authenticated** party gains access, or by which a single content-injection bug escalates to full machine control. Everything below was found in a real audit of the current code. Verify each one yourself before fixing — do not take my word for it.

**CRIT-1 — `supervisor.js` is an unauthenticated RCE server sitting in the repo root.**
It is dead code (`package.json` `main` points at `server/server.js`), but it is a fully functional standalone server that spawns `claude rc` in any client-supplied folder with `shell: true`, zero auth, `Access-Control-Allow-Origin: *`, bound to `0.0.0.0`. Anyone who runs `node supervisor.js` — including a future you, or a stale shortcut, or a misconfigured process manager — opens the machine to the network. **Delete it.** If any of its logic is still wanted, port it into `server/lib/` first.

**CRIT-2 — Markdown preview is a stored-XSS-to-full-compromise chain.**
`web/views/files.js` `renderMarkdown()` escapes HTML *only inside fenced code blocks*. Everything else — headings, lists, inline code, bold — is regex-substituted against raw, unescaped source and injected via `innerHTML`. Any `.md` file containing `<img onerror=…>` executes JS in the authenticated origin. There is **no CSP anywhere**. The session cookie authenticates same-origin `fetch()`, so that JS can spawn shells, read/write any file, kill processes. This is a file manager whose entire purpose is opening files you downloaded from the internet.
Fix properly: escape the entire source first, then apply substitutions to the escaped text; or vendor a real sanitizing Markdown renderer. Then add a strict `Content-Security-Policy` header in `server.js` (`default-src 'self'`, no `unsafe-inline` — you will need to move inline handlers/styles out to make this stick), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.

**CRIT-3 — Default password `"supervisor"` + default bind `0.0.0.0` + no forced rotation.**
`auth.js` `ensureInitialPassword()` falls back to a literal default when no env var is set; `server.js` binds all interfaces by default. The only warning is a console line nobody reads on a background service. Add a forced first-login password change (block every route except `/api/auth/change-password` while the credential is still the default), and log loudly + refuse to bind non-loopback if the password is still default.

**HIGH-1 — Rate limiting is trivially bypassed.**
`server.js` sets `app.set('trust proxy', true)` with no actual proxy in front, so `req.ip` is derived from a client-controlled `X-Forwarded-For`. `routes/auth.js` buckets by `req.ip`. A new header value per attempt = a fresh bucket = unlimited brute force against a single-factor credential guarding full RCE. Fix: only trust the proxy when explicitly configured (`SUPERVISOR_TRUST_PROXY=1`), and default to the raw socket address. Also add a **global** attempt ceiling that is not per-IP.

**HIGH-2 — Sessions cannot be revoked.**
Tokens are stateless HMAC-signed JSON with only `exp` (12h, or **60 days** for "trusted device"). `POST /api/auth/change-password` rotates the hash but not the signing secret — a stolen cookie survives the very action a user takes to secure the account. Fix: rotate `data/secret.bin` on password change, add a server-side token-version counter, and add a visible "Sign out all devices" control.

**HIGH-3 — The WebSocket broadcasts everything to everyone.**
`routes/ws.js` `broadcast()` iterates `wss.clients` and sends every hub event to every socket. `ws.subs` is populated by `sub`/`unsub` but **never consulted when broadcasting** — it only drives file-watcher ref-counting. Every open tab receives every shell's byte stream, every session's log, and every watched path's events. Fix: filter by subscription. This is both a bandwidth fix and a blast-radius fix.

**HIGH-4 — `multer@1.x` is deprecated, and upload limits are absurd.**
10 GB per file × 200 files per request with no total cap. Move to `multer@2.x`, set sane per-request and per-file caps, and make them configurable.

**MED-1 — The Linux blocklist protects the kernel but not the app's own secrets.**
`paths.js` `DEFAULT_BLOCKLIST_NIX = ['/proc','/sys','/dev']`. Nothing stops the Files tab from browsing to `data/secret.bin` (the session signing key) or `data/passwd.json` (the password hash) and downloading or deleting them. Add the app's own `data/` directory to the blocklist **on both platforms, unconditionally, not user-removable**, plus sensible Linux defaults (`/boot`, `/etc/shadow`, `/etc/sudoers`, `/root` when not running as root, `/run`).

**MED-2 — An empty blocklist textarea silently disables all path protection.**
Saving a blank field persists `[]`, and `getBlocklist()`'s `Array.isArray` check treats that as "no restrictions" rather than "use defaults". Make "Reset to defaults" an explicit, distinct action from "allow everything", and require a typed confirmation for the latter.

**MED-3 — `ensureSafe()` uses `path.resolve`, not `fs.realpath`.** A symlink inside an allowed directory pointing into a blocked one defeats the string comparison. Resolve real paths before comparing.

**MED-4 — `readToken()` accepts `?token=` on *every* route, not just the WS upgrade.** Tokens leak into access logs, proxy logs, and browser history. Restrict query-string auth to the `/ws` upgrade only.

**MED-5 — No resource ceilings.** Unlimited PTYs and unlimited child processes per authenticated client. Add configurable caps with clear errors.

**MED-6 — Read-modify-write races.** `store.js` writes atomically (tmp + rename) but callers in `settings.js` `update()` and `fs-ops.js` `moveToTrash()` read → mutate → write with no lock. Concurrent requests silently clobber. Add a per-file async mutex.

**LOW** — `failures` Map in `auth.js` grows unbounded per distinct IP (evict on expiry); scrypt `N=16384` is low for a single-factor RCE gate (raise it — this endpoint is hit a handful of times a day); dependencies are all caret-ranged with no `npm ci` in any start script.

---

## 3. Cross-platform port — the core of the work

**The target is genuinely cross-platform, not a migration.** The Windows machine must keep working exactly as it does today. Linux (Ubuntu 24.04, headless VPS, 6 vCore / 12 GB / 160 GB) becomes an equal first-class target. Windows-desktop-only capabilities are **kept and degraded gracefully** — hidden or disabled with an explanatory state when the running host cannot support them, never silently broken and never deleted.

### 3.1 Introduce a platform layer

Today platform branching is scattered inline as `process.platform === 'win32'` checks across at least seven files, and one file forgets the check entirely. Replace this with an explicit adapter:

```
server/platform/index.js        selects and exports the adapter for the current host
server/platform/capabilities.js declares what this host can do (see §3.2)
server/platform/win32.js
server/platform/linux.js
server/platform/base.js         shared logic + throws for unimplemented capabilities
```

The adapter interface should cover, at minimum: `defaultShell()`, `spawnManaged(cmd, args, opts)` (see §3.3), `killTree(pid)`, `listProcesses()`, `topProcesses()`, `disks()`, `netSample()`, `gpu()`, `powerAction(action)`, `quickLocations()`, `defaultBlocklist()`, `selfRestart()`, `serviceStatus()`. No `process.platform` checks should survive outside `server/platform/`.

### 3.2 Capability declaration — this is how "degrade gracefully" gets implemented

Add `GET /api/system/capabilities` returning a flat map the frontend consumes to decide what to render:

```js
{
  platform: 'linux',            // 'win32' | 'linux' | 'darwin'
  headless: true,               // no GUI session detected
  pty: true,                    // node-pty loaded successfully
  gpu: false,                   // nvidia-smi present
  power: { shutdown: true, restart: true, sleep: false, cancel: true },
  windowCapture: false,         // Windows Graphics Capture API
  serviceManager: 'systemd',    // 'systemd' | 'pm2' | 'none'
  containers: true,             // docker/podman socket reachable
  fsPermissions: true,          // POSIX chmod/chown meaningful
  drives: false                 // drive-letter enumeration
}
```

**Rule: no feature is deleted for Linux.** Every capability the frontend cannot use renders as a disabled control with a one-line explanation of *why* ("Sleep is unavailable on this host — virtualized hardware has no suspend state"), not as an absence. The user should be able to look at a Linux Supervisor and see the same app, honestly labeled.

### 3.3 The specific breakages you must fix

Verify each against the code, then fix:

| # | Location | Problem | Direction |
|---|---|---|---|
| P-1 | `server/lib/restart.js` | Unconditionally spawns `cmd /c start … start.bat`. **No platform check at all.** `POST /api/maintenance/restart` is fully broken on Linux (ENOENT → 500, no restart). | Branch into the adapter. Under systemd, the correct implementation is `process.exit(0)` and let `Restart=always` bring it back. Under pm2, same. Only Windows needs the respawn dance. |
| P-2 | `sessions.js` `start()`, `maintenance.js` (headless run) | Spawned with `shell: true`, then killed with `SIGTERM` **to the wrapping `/bin/sh`**, not the grandchild `claude`. Long-running sessions survive a "Kill" click on Linux as orphans. | Drop `shell: true` on POSIX (argv arrays are already used — the shell wrapper is pointless there). Spawn `detached: true` and kill the process group with `process.kill(-pid, …)`. Keep `shell: true` on Windows where `claude` is `claude.cmd`. This is what `spawnManaged`/`killTree` in the adapter are for. |
| P-3 | `routes/system.js` power actions | `cp.exec(cmd, {timeout})` is called **with no callback**, and the surrounding `try/catch` cannot catch async failures — the API returns `{ok:true}` even when the command failed. On Linux, `shutdown -h +0` needs root, which the service should not have. | Pass a real callback and surface stderr/exit code. Ship a documented, scoped sudoers rule (`NOPASSWD: /usr/sbin/shutdown`) or use polkit + `systemctl poweroff`. Report `sleep` as unsupported via capabilities on virtualized hosts rather than issuing a command that fails. |
| P-4 | `package.json` `optionalDependencies.node-pty` | Native module. On a bare Ubuntu VPS without `build-essential python3 make g++`, it silently fails to build. This cascades: shells lose PTY semantics **and** `claude-config.js` `trustFolderInteractive()` returns `{ok:false}` forever, so Claude's workspace-trust dialog is never accepted, so every new session hangs on an unanswerable prompt while showing as "running". `sessions.js` swallows the failure in an empty `catch`. | Detect at boot. Log a loud, actionable warning. Surface `pty:false` in capabilities and show a persistent banner in the UI explaining the consequence and the fix (`apt install build-essential python3`). Document the manual fallback: SSH in and run `claude` once per folder. Never let a session silently hang. |
| P-5 | `paths.js` `getQuickLocations()` | Windows enumerates drive letters with an `fs.accessSync` existence check. Linux gets a bare `/` plus Home/Desktop/Documents/Downloads added **without** an existence check — on a headless VPS those XDG dirs don't exist and the entries 404 when tapped. | Existence-check every quick location. On Linux, enumerate real mountpoints from `/proc/mounts` (excluding pseudo-filesystems) so mounted volumes get the same one-tap access drive letters give on Windows. |
| P-6 | `watchers.js` | `chokidar.watch()` with no `usePolling` option and no handling of inotify exhaustion. Ubuntu's `fs.inotify.max_user_watches` default is low; each subscribed folder gets its own watcher. `ENOSPC` surfaces only as a `console.warn` — live file updates silently stop with zero user-facing signal. Network/overlay/bind mounts don't deliver inotify events at all. | Add a `usePolling` setting. Detect and surface `ENOSPC` distinctly over the WS to the client as a visible degraded state. Document `sysctl fs.inotify.max_user_watches=524288` in the Linux setup guide. |
| P-7 | `metrics.js` `disksUnix()` | `df -kP` parsed with `ln.split(/\s+/)` — a mountpoint containing a space corrupts the column split. | Use `df -kP --output=source,size,used,avail,pcent,target` (mountpoint last) or a syscall-based approach. |
| P-8 | `metrics.js` `netSample()` (POSIX branch) | Sums every non-loopback interface from `/proc/net/dev`, including `docker0`, `veth*`, `tailscale0` — double-counts and reports meaningless totals on a VPS. | Filter to physical/primary interfaces; make the interface set configurable. |
| P-9 | `.bat` files + missing service story | `start.bat`, `kill.bat`, `start-web-new.bat` are the entire lifecycle story and none of them run on Linux. There is no `systemd` unit, no `start.sh`. `README.md` only documents pm2 "on Windows". | Ship `deploy/supervisor.service` (systemd, `Type=simple`, dedicated non-root user, `Restart=always`, explicit `Environment=PATH=…` so `claude` resolves — systemd's default PATH will not find an npm-global or nvm binary), `deploy/install-linux.sh`, and a `start.sh`/`stop.sh` pair. `server.js` already handles `SIGTERM`/`SIGINT` gracefully, so `systemctl stop` will work correctly once the unit exists. |
| P-10 | `data/settings.json`, `data/claude-trusted.json` | Contain hardcoded Windows paths (`C:\Users\Beatt\…`) in `recentFolders`, `selfRepoPath`, and the trust cache. Copying `data/` to Linux carries stale, unresolvable paths. | Add a migration/first-run sanitizer that drops path entries which fail an existence check for the current platform, and reseeds `selfRepoPath` from `path.resolve(__dirname,'..','..')`. |
| P-11 | Frontend cosmetics | `web/views/sessions.js` and `web/views/settings.js` hardcode `placeholder="C:\path\to\…"` in three inputs, and the blocklist help text says "Default Windows: system folders". | Drive all of these from the `isWin`/`home` fields already returned by `GET /api/files/locations`. |
| P-12 | `shells.js` piped fallback kill | Non-Windows, non-PTY path does `this.proc.kill('SIGTERM')` — kills the shell, not its children. | Same process-group treatment as P-2. |
| P-13 | `fs-ops.js` `statFile()` | Returns real `mode`/`uid`/`gid` on Linux, and **no UI surfaces or edits them.** On Linux this is a genuinely missing feature (`chmod +x` is routine). | Add a permissions panel to the Files detail view: octal mode display, an executable-bit toggle, owner/group display. Gate it on the `fsPermissions` capability so Windows shows it as N/A. |
| P-14 | `fs-ops.js` `listDir()` symlinks | Broken symlinks silently render as 0-byte files (the target `stat` fails into an empty catch). Common on Linux. | Add a `broken: true` flag and render broken links distinctly. |

**Already correct — do not "fix" these:** `os.homedir()` is used everywhere instead of `%USERPROFILE%`; the `EXDEV` cross-device fallback in `moveMany`/`moveToTrash` is right and matters more on Linux than Windows; `fs-ops.js` uses `lstat` correctly for symlink detection; the frontend path helpers in `web/components/util.js` and the breadcrumb builder in `files.js` already handle both separators; the `.env` loader and `SIGTERM` handling are platform-clean; the `node-pty` try/require + graceful-fallback *architecture* is good even though its consequences (P-4) are under-communicated.

---

## 4. Multi-machine — control several hosts from one phone

This is a new capability, and it is the reason the port matters. The author wants to run Supervisor on **both** the Windows desktop and the Linux VPS, and switch between them from the phone — different machines in different sessions, one app.

Design and implement this. Some constraints and a recommended shape:

**Recommended architecture: peer instances + a client-side machine switcher.** Do *not* build a central hub that proxies everything — that adds a single point of failure, doubles the latency on the shell hot path, and means the VPS can read the desktop's files. Instead:

- Each machine runs a full, independent Supervisor instance. This is already true today; you are formalizing it.
- The frontend gains a **machine registry**: a list of `{id, label, baseUrl, platform, color}` entries, stored per-device in `localStorage` (not on the server — the phone owns the list).
- A **machine switcher** in the header: tap to change which instance the entire app is pointed at. All API calls and the WS connection re-target. State (current tab, scroll position) resets cleanly; the switch should feel instant and unambiguous.
- **Per-machine visual identity.** Each registered machine gets an accent color and a label. When you are on the VPS, the app should *look* like the VPS. This is the single most important safety feature in the whole design — the user must never issue a destructive command against the wrong machine because two tabs looked identical.
- **Independent auth per machine.** Each instance has its own password and issues its own cookie. Cookies are scoped per origin, so this works naturally over Tailscale hostnames. The switcher must handle "not signed in to this machine yet" by routing to that instance's login without losing the destination.
- **Cross-machine status at a glance.** The machine switcher should show a live reachability + health dot per registered machine (a cheap unauthenticated `/api/ping` returning `{ok, platform, version}`, or an authenticated lightweight poll — your call, but justify it). The user should be able to see "VPS is up, desktop is asleep" without switching.
- **Push notifications must be attributable.** A "Session finished" notification arriving on the phone must say *which machine*. Add the machine label to the push payload and to the `notify` hub event, and make the notification's deep link target the right instance.

Also handle:
- **Offline/unreachable machines** — clear degraded state, retry with backoff, never a spinner that hangs forever.
- **Version skew** — if two instances run different Supervisor versions, say so rather than failing weirdly.
- **A "machines" section in Settings** for add/edit/remove/reorder, with a QR-code or paste-a-URL flow to make adding the second machine on a phone tolerable.

Write your design into `docs/MULTI-MACHINE.md` before implementing. If you believe a different architecture is better, argue for it there — but the peer model is the default and the burden is on the alternative.

---

## 5. Linux-native features to add

Windows-only capabilities keep working. Linux gets equivalents in the same conceptual slots, gated on capabilities so the UI stays honest on both platforms:

- **Services (new tab or a System section).** `systemctl list-units --type=service`, with start/stop/restart/enable/disable and status. This is the Linux answer to the Processes tab's desktop-centric framing. Gate on `serviceManager === 'systemd'`.
- **Journald log viewer.** `journalctl -u <unit> -f` streamed over the existing WS shell plumbing. Follow mode, unit filter, priority filter, and a jump-to-now control. This is high value on a headless box.
- **Containers**, if a Docker or Podman socket is reachable: list, start/stop/restart, logs, exec into a shell (reuse the existing PTY plumbing). Gate on `containers`.
- **Package/update status** — pending `apt` updates and whether a reboot is required (`/var/run/reboot-required`). Read-only is fine; do not auto-install.
- **Firewall status** — `ufw status` / `nftables` summary, read-only.
- **Listening ports** — `ss -tlnp` rendered as a table with the owning process, linked to the Processes tab. Genuinely useful on a VPS and trivially cheap.
- **Disk pressure** that actually works — see §7 for the existing threshold bug.
- **File permissions UI** (P-13).

Do not add all of these blindly. Build the platform layer and the capability system first, then add these in order of value, and stop when the app starts feeling crowded rather than capable. Note what you deferred and why.

---

## 6. Correctness bugs to fix along the way

- **`maintenance.js` spawns `claude -p` without `--dangerously-skip-permissions` despite a comment claiming it passes the flag.** With piped stdio and no TTY, if Claude ever stops to ask for a tool permission it can never receive one — the process hangs forever and `isBusy()` locks `maintenance.start()` permanently (`EBUSY` on every subsequent request) with no timeout. Decide whether the flag was intentionally dropped, then either restore it or rewrite the comment — and add a hard timeout regardless.
- **The disk-low push threshold is inert.** The Settings UI exposes a 1–50% control, but `metrics.js` only *emits* the `disk-low` event at a hardcoded `pct >= 95` floor; `push.js` then applies the user's threshold to an event that never fires earlier. Setting 40% gets you nothing until 95%. Move the threshold check into the emitter.
- **The restart banner has no trigger.** `App.markRestarting()`, the sessionStorage flag, and the pending→ready banner sequence are all fully built, and nothing in the shipped UI ever calls `markRestarting()`. Either wire it to the restart flow or delete it.
- **Two parallel maintenance subsystems both fully implemented, only one reachable.** The headless `claude -p` flow (`/request`, `/status`, `/cancel`, `/reset`, plus a `maintenance` WS topic) has zero frontend callers; the interactive hand-off (`/interactive`) is the live one. Settings' help text describes the dead one. **Decide.** Resurrect it with UI, or delete it and fix the copy. Do not leave both.
- **Console's "Send to Claude" copies to clipboard and navigates**, requiring a manual paste, while Sessions' equivalent threads the prompt through properly. Make them consistent.
- **"Killing" session status renders as a neutral "done" badge** — no in-progress case in the status branch. Add one.
- **Multi-select rename silently renames only the first item.** Disable it for multi-select or implement pattern-based batch rename.
- **`attachPullToRefresh` is fully implemented and never called anywhere.** Wire it or delete it.
- **`.rail-collapsed` CSS exists with no JS toggle.** Same decision.
- **The `notify` WS topic is broadcast and consumed by nothing client-side.** Consider surfacing an in-app notification feed, or stop broadcasting it.
- **Manifest shortcut `#sessions/new` doesn't match the `#sessions/new/<folder>` deep-link format the view parses** — harmless today (opens a blank modal) but confirm it's intentional.
- **`--font` and `--mono` name Inter and JetBrains Mono first and neither font is ever loaded.** Either self-host them or drop them from the stack. Aspirational CSS is a lie in the codebase.

---

## 7. Engineering standards for this work

- **Small, reviewable, individually revertable commits.** One concern per commit. A commit that both fixes XSS and refactors the platform layer is a bad commit.
- **Never break Windows.** Every change gets reasoned about on both platforms. If you cannot test Windows, say so explicitly in the commit message and flag what needs manual verification.
- **No new runtime dependencies without justification** in the commit message. The frontend has zero build step and zero framework — that is a deliberate, defended choice documented in the README. Do not casually add a bundler or React to the backend-adjacent code.
- **Keep vendored assets vendored.** `build.js` copies CodeMirror/xterm/pdf.js/highlight.js out of `node_modules` at install time so the app works without a CDN. Do not introduce CDN dependencies (see §8 for why).
- **Update the README as you go.** It is currently accurate and good. Keep it that way — the Linux setup path, the capability matrix, and the multi-machine setup all need to land there.
- **When you find something I did not list, fix it and tell me.** This brief is a starting map, not a complete one.
- **When you disagree with something in this brief, say so before implementing it.** You have read the code more recently than I have.

---

## 8. On `web.new/`

There is an in-progress React rewrite in `web.new/`. Assess it honestly and then **make a recommendation, do not silently continue it.**

What is actually there (`WEB-NEW-AUDIT.md` in the repo is stale on this point and understates it): the shell layer is close to parity — a real login page, a full WS client with exponential-backoff reconnect and topic re-subscription, hash routing with sub-paths, a stack-aware modal, toasts, sheets, global shortcuts, the restart-banner state machine, and a working maintenance hand-off. The hard, easy-to-get-wrong parts are done.

What is not there: all six content views are **100% hardcoded mock data**. Only three real `/api/*` calls exist in the entire tree. No xterm.js, no CodeMirror, no PDF.js, no file operations, no real session control.

Its architecture has real problems: React, ReactDOM, and Babel-standalone are loaded from `unpkg.com` **with no Subresource Integrity**, into a client that holds cookie-authenticated access to a remote-code-execution panel. A compromised or MITM'd CDN response is game over. JSX is transpiled in the browser on every page load — a measurable regression against the current hand-written JS on a phone over cellular. The service worker precaches nothing from the CDN, so the "offline-capable PWA" is a fiction. Its README describes a deployment path (`python3 -m http.server`) that would break auth entirely.

Given that a full visual redesign is happening in parallel (see the companion design brief), the likely correct answer is: **do not invest further in `web.new/` as-is.** Either delete it, or — if its shell-layer work is worth keeping — extract the WS client and routing logic, drop the CDN + in-browser-Babel architecture for a real build step or a return to vanilla, and fold it into the redesign. Make the call, write it down with reasoning, and do not leave a third frontend in the repo.

---

## 9. Tests and CI — non-negotiable

There are currently zero tests, no linter, and no CI for a tool that performs remote code execution by design.

Minimum bar:

- **`node:test` + `node --test`.** No new test framework dependency needed.
- **Security-critical unit tests first**, because these are the ones whose regression is catastrophic: `paths.js` `ensureSafe()` (traversal, symlink escape, blocklist matching, case sensitivity on both platforms, empty-blocklist behavior), `auth.js` (token signing/verification, expiry, tampering, rate-limit bucketing, `X-Forwarded-For` handling), `store.js` (atomic write, concurrent update), zip handling (zip-slip on extract paths), and the Markdown escaper (a table of XSS payloads that must all render inert).
- **Platform-adapter contract tests** — a shared suite both adapters must satisfy, so a Windows-only change that breaks the Linux adapter's interface fails in CI.
- **A smoke test** that boots the server on an ephemeral port, logs in, hits every route, and shuts down cleanly.
- **ESLint** with a config that would have caught the empty `catch` blocks that hide P-4's failures.
- **GitHub Actions** running lint + tests on both `ubuntu-latest` and `windows-latest`. This is the single highest-leverage thing you can add to a cross-platform codebase.

---

## 10. Definition of done

- [ ] `docs/ARCHITECTURE.md` exists and is accurate.
- [ ] `docs/MULTI-MACHINE.md` exists and the design is implemented.
- [ ] `docs/CHANGELOG.md` records every change with reasoning.
- [ ] `supervisor.js` is gone. The Markdown XSS is fixed and CSP is enforced. All CRIT and HIGH items in §2 are closed, with tests.
- [ ] No `process.platform` check exists outside `server/platform/`.
- [ ] `GET /api/system/capabilities` exists and the frontend consumes it; every unsupported feature renders as an explained disabled state, not an absence.
- [ ] A fresh `git clone` on Ubuntu 24.04 reaches a working, boot-persistent install via a documented script and a systemd unit — with `node-pty` verified working or a loud, actionable warning if not.
- [ ] Windows still works, verified against every tab.
- [ ] The phone can switch between the Windows box and the VPS, with unmistakable per-machine visual identity and attributable push notifications.
- [ ] `npm test` and `npm run lint` pass on both platforms in CI.
- [ ] Every "dead or half-wired" item in §6 has been resolved by a deliberate decision, not left ambient.
- [ ] The README describes the actual, current state of the software.

---

## 11. How to work

Work in phases. Commit as you go. After each phase, stop and report: what you did, what you found that this brief got wrong, what you decided differently and why, and what you are least confident about. Do not batch four phases of work into one silent run.

Where this brief and the code disagree, the code wins — and tell me.
