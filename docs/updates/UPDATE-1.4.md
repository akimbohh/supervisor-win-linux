# UPDATE 1.4 — Cross-platform (Linux) parity & robustness

Status: **proposed**
Scope: `server/lib/metrics.js`, `server/lib/sessions.js`, `server/lib/shells.js`, `server/lib/restart.js`, `server/routes/system.js`, launcher scripts
Risk: low–medium
Depends on: none (independent of 1.1–1.3)

The repo is named `supervisor-win-**linux**`, and `metrics.js`/`shells.js` have
Unix branches, but several features are Windows-only or Windows-assuming. This
update brings Linux (and, incidentally, macOS) up to first-class status so the
same binary runs anywhere.

## 1.4.1 — Self-restart is Windows-only

`lib/restart.js` shells out to `start.bat` via `cmd /c start`. On Linux the
`/api/maintenance/restart` endpoint throws "start.bat not found".

**Fix**: add a POSIX restart path — re-exec the node process
(`process.execPath` + `process.argv`) detached, or document that restart
requires a process manager (pm2/systemd) and expose a "supervisor will exit;
your service manager restarts it" mode. Provide a `supervisor.service`
(systemd) example and a `start.sh`.

## 1.4.2 — GPU metrics assume `nvidia-smi`

`metrics.js gpu()` only knows Nvidia. On Linux with AMD/Intel, or on machines
without `nvidia-smi`, the card silently disappears.

**Fix**: add AMD (`rocm-smi`) and generic (`/sys/class/drm`, `sensors`) probes,
or at least a graceful "GPU: not available" state that the UI renders instead
of hiding the card.

## 1.4.3 — Power actions

`routes/system.js` maps sleep to `systemctl suspend` and shutdown to
`shutdown -h +0` on non-Windows. These require root/polkit and will fail
silently for a normal user. Detect and report the failure (currently
`cp.exec` errors are swallowed after the response is sent), and document the
`sudoers`/polkit rule needed.

## 1.4.4 — Process list / kill semantics

`metrics.listProcsUnix` uses `ps -eo pid,comm,%cpu,rss`; `comm` truncates long
names and `%cpu` is lifetime-average, not instantaneous (unlike the Windows
path's `CPU` seconds). Normalize the meaning of the CPU column across
platforms so the UI's sort/labels are truthful. `killPid` uses `SIGTERM` only
on Unix — add an escalation to `SIGKILL` after a grace period to match the
Windows `taskkill /f` force semantics.

## 1.4.5 — Path & shell assumptions

- `paths.js getQuickLocations()` lists `Desktop/Documents/Downloads` which may
  not exist on a headless Linux box — filter to existing dirs (Windows drive
  enumeration already does `accessSync`).
- Default shell fallback is fine (`$SHELL || /bin/bash`), but the piped
  fallback banner and `TERM=dumb` path should be tested on Linux where node-pty
  usually builds cleanly (so the fallback rarely triggers) — add a smoke test.

## 1.4.6 — Launcher scripts

Provide `start.sh` / `kill.sh` mirroring the `.bat` files (PID-file handling,
`npm install` bootstrap, port cleanup with `fuser`/`lsof`). Keep the `.bat`
files for Windows.

## Acceptance

- `npm start` on Linux yields working System metrics (CPU/mem/disk/net,
  GPU-or-graceful-absence), Processes list + kill, power actions that either
  work or report why not, and a restart path that doesn't reference `.bat`.
- No feature silently no-ops on Linux without a user-visible reason.
