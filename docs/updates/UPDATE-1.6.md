# UPDATE 1.6 — Feature enhancements & product roadmap

Status: **ideas / backlog**
Scope: full stack
Risk: varies per item
Depends on: 1.1 (security) and 1.5 (tests) should land first

A backlog of user-facing improvements, ordered roughly by value-to-effort.
These are opt-in and should each get their own scoped update doc when picked
up. None should be started before the security work in 1.1.

## Sessions

- **Reattach to live sessions across a supervisor restart.** Today
  `bootRestore()` marks prior sessions as "exited (supervisor restarted)" — the
  child `claude` may still be alive but is orphaned. Explore launching sessions
  under a detached, re-discoverable process group (or a tiny PTY broker) so a
  supervisor restart doesn't kill/lose the agent.
- **Structured session output.** Parse `claude` stream-json (`--output-format
  stream-json`) instead of raw stdout scraping so "asks for input" /
  "finished" detection is reliable rather than the current `?`/`(y/n)` heuristic
  in `sessions.js detectIntent()`.
- **Per-session resource + cost surfacing** if the CLI exposes it.

## Files

- **Server-side search** (name + content grep) with cancellation.
- **Chunked/resumable uploads** and download-as-zip streaming progress (current
  upload cap is 10 GB in one multipart request — fragile on mobile).
- **Text diff / conflict guard** on save: detect the file changed on disk since
  it was opened (mtime check) before overwriting via the atomic writer.
- **Image thumbnails** generated server-side (cached) instead of shipping full
  images to the grid view.

## Console

- **Shared shells across devices** (already possible since scrollback is
  server-side) — make attaching to an existing shell from a second device a
  first-class, tested flow, with input arbitration.
- **Configurable shell profiles** (pick bash/pwsh/wsl, starting cwd, env).

## System / notifications

- **More notification channels**: the `hub 'notify'` bridge is push-only; add
  optional ntfy/Telegram/webhook sinks for users without web-push.
- **Configurable metric tick + on-demand-only mode** to save battery/CPU when
  no client is viewing System (tie into UPDATE-1.2's per-topic delivery so
  metrics only sample when someone is subscribed).
- **Alerting thresholds** (CPU/temp/disk) beyond the single disk-low push.

## Maintenance / self-update

- **Git-aware maintenance**: run maintenance on a branch, show the diff in the
  UI, and require an explicit "apply" (commit) step instead of editing the
  working tree in place. Massively safer than the current
  `--dangerously-skip-permissions` write-to-disk flow (see 1.1.4).
- **Update channel**: `git pull` + `npm install` + restart button with a
  changelog view.

## Platform / packaging

- **Single-command installers**: `winget`/MSI for Windows, systemd unit +
  install script for Linux (ties into 1.4).
- **Optional TLS** with a self-signed or Tailscale-cert flow so the app is
  safe even off-Tailscale (ties into 1.1.6).

## UI

- Everything in UPDATE-1.3 (bring `web.new/` to parity), then retire `web/`.
- Accessibility pass (focus management in modals, ARIA live regions, keyboard
  reachability) — partly covered in 1.3 but worth a dedicated sweep.

---

When you pick an item, spin it into `UPDATE-1.7.md` (or the next free number)
with concrete acceptance criteria, and link back here.
