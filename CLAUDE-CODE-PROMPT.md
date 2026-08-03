# Claude Code prompt — bring `web.new/` to feature parity with `web/`

Copy everything below the `---` into Claude Code (e.g. `claude` in the supervisor repo, or pipe via `claude -p "$(cat CLAUDE-CODE-PROMPT.md)"`).

---

## Task

Bring `web.new/` to **functional parity** with `web/`. Keep the new UI's visual identity. Touch **only** files inside `web.new/`. Do not modify `web/`, `server/`, `data/`, `tools/`, `supervisor.js`, `build.js`, or anything outside `web.new/`.

## Read these first, in this order

1. `UI-FEATURE-INVENTORY.md` — the spec. Every feature in `web/` is catalogued here.
2. `WEB-NEW-AUDIT.md` — the gap report. Every "Missing" or "Partial" row is a task. Section 12 has a 16-item priority order. Section 13 has the 44-row checklist.
3. `web.new/README.md` — confirms the rewrite is currently a mocked prototype.
4. `web/app.js`, `web/views/*.js`, `web/components/*.js`, `web/login.html`, `web/sw.js` — the canonical implementations to mirror.
5. `server/routes/*` and `server/maintenance.js` (read-only) — to understand the API + WS contract you must wire up.

## Hard rules

- **Only edit files in `web.new/`.** No exceptions. The server is the source of truth and is already correct.
- **Preserve the visual identity** of `web.new/`. Specifically keep:
  - Aurora background, density control (dense/medium/airy), lime accent (6th option), live-bars running-status chip animation, ring/donut progress visuals on stat cards, glass summary header on Processes, Inter + JetBrains Mono fonts, the `data-screen-label` cosmetic, the tweaks panel.
  - The current CSS in `web.new/styles.css` is the visual contract. You may add new selectors and tokens, but do not rewrite the existing aesthetic.
- **Stay in the no-build React + Babel-standalone setup.** Do not introduce bundlers, TypeScript, or npm packages. Vendor libraries are loaded from `web.new/vendor/...` the same way `web/` does.
- Match the original API + WS contract exactly. Topic names (`sessions`, `system`, `files:<path>`, `session:<id>`, `shell:<id>`, `settings`), HTTP routes (`/api/sessions`, `/api/files/*`, `/api/procs`, `/api/system`, `/api/maintenance/*`, `/api/settings`), and event payloads must match what the server emits — read `server/` to confirm.
- When `WEB-NEW-AUDIT.md` says a feature is **Missing**, implement it. When it says **Partial**, finish it. When it says **Present**, leave it alone.

## What to build (priority order from audit § 12)

Work through these in order. Commit-sized chunks are fine. After each phase, smoke-test by opening the page and exercising the feature.

### Phase 1 — Plumbing (nothing else works without this)

1. **App.js-equivalent shell**: WebSocket auto-connect + exponential-backoff reconnect (500ms→15s), pub/sub (`subscribe`/`unsubscribe`/`onMessage`), 5s ping/pong loop, re-subscribe on reconnect. Expose as a small `App` global or React context. Replace the fake `latency` `setInterval` in `app.jsx` with real round-trip measurement.
2. **Connection dot + latency badge** with the original 3-color thresholds (<100 green, 100–300 amber, >300 red, `…` if pong overdue >4s, hidden when offline).
3. **Hash-based routing** (`location.hash` + `hashchange` listener) replacing `useState('sessions')`. Support sub-paths: `#sessions/new/<folder>`, `#console/<encoded-path>`. Per-view state should NOT be blown away on every tab switch — keep mounted views or persist their state.
4. **Login page** — port `web/login.html` to `web.new/login.html`. Show/hide password toggle, "Trust this device for 60 days" checkbox, redirect to `?next=` param. Match the dark surface + amber accent of the new design but keep the old behavior.
5. **Modal stack** (replace `web/components/modal.js`): stack-aware z-index, backdrop-click-to-close (when dismissible), Escape closes topmost, sizes `md`/`lg`/`xl`, fade-out animation (150ms), `onClose` callback. Promise-based `confirmModal` and `promptModal` helpers.
6. **Toast system** (replace `web/components/toast.js`): `success`/`error`/`info`/`warn`, persistent toasts with `{duration:0}` and `.dismiss()`, queued in `aria-live="polite"` region.
7. **Sheet** component for mobile drawers (`web/components/sheet.js`) — used by mobile sidebar in Files and the session detail.
8. **Service worker** at `web.new/sw.js`: bump cache name when needed, but ALSO add periodic update check (every 5min) registered from the app shell, `skipWaiting` on install, reload-on-controllerchange (deduplicated).

### Phase 2 — Maintenance + Restart automation (operationally critical)

9. **Maintenance modal** — the "Request a change" dialog. Triggered by `?` key (when not in INPUT/TEXTAREA/contentEditable) and by the help button. Textarea + "Open in interactive Claude" primary + "Close" ghost. On submit:
   - copy prompt to clipboard (`copyToClipboard` with `execCommand` fallback)
   - POST `/api/maintenance/interactive` with `{ text }`
   - on response, write `localStorage.consoleActivateShell = shellId`
   - toast `Request copied — opening Claude.`
   - `location.hash = '#console'`
10. **Console view reads `localStorage.consoleActivateShell` on mount**, removes the key, activates that shell ID (or first shell as fallback).
11. **Restart banner** above the header. Two phases: "Server is restarting…" while WS disconnected, "Server restarted / Reload now" once WS reconnects within 5 minutes. State persisted via `sessionStorage.supervisorRestarting`. Auto-stale after 5 min.
12. **Global keyboard shortcuts**: `?` → maintenance modal; `g` then `s/f/c/p/y/t` → tab navigation (chord with 800ms window). Ignored when focus is inside `INPUT`, `TEXTAREA`, or `contentEditable`.

### Phase 3 — Sessions view

13. **Real data** — subscribe to `sessions` WS topic; render `s.name`, `s.folder`, `s.tag`, `s.status`, `s.startedAt`, `s.lastLog` (last 3 lines). Drop the `window.SUPER_DATA.sessions` mocks.
14. **1-second uptime ticker** for running cards (only re-render the duration label).
15. **Last-log preview**: last 3 lines, dark `<pre>`, max 64px height, no scroll.
16. **All 4 card actions** wired: Open log, Kill (with confirm), Restart (when not running), Tag/rename (two `promptModal`s — name then tag), Delete trash (with live-vs-dead confirm copy).
17. **Long-press on session card** opens edit mode if needed. Long-press on preset chip → preset edit modal.
18. **Empty states** with CTA buttons (no sessions / no matches).
19. **Group-by persistence** to `localStorage('sessions.group')`.
20. **"Clear exited"** confirm + `/api/sessions/clear-exited` POST.
21. **Session detail modal** (size `xl`):
    - search input + match count + prev/next chevrons
    - log host: 52vh height, black bg, 12px mono, auto-scroll with pause-on-scroll-up + resume-when-near-bottom-30px
    - 10MB log buffer cap, oldest-drop
    - send-to-stdin row visible only when running
    - "Copy log" + "Send to Claude" (selection or last 2000 chars → opens new-session modal pre-filled)
    - footer: Kill (running) / Restart (exited) / Close
    - live streaming via WS topic `session:<id>`
22. **New session modal** (`lg`):
    - Folder field with Browse button → folder picker layered modal
    - Command mode: "claude rc" / "claude (then /rc)" / "Custom args…" (custom shows mono input)
    - Pre-prompt textarea
    - Env vars textarea (KEY=value per line)
    - "Save as preset" optional name input
    - Cancel / Launch
23. **Folder picker** layered modal: path input + "Go" button (Enter also goes), quick-locations chip row, scrollable directory list (max 50vh), `..` parent row, loading skeleton, Cancel + Choose buttons.
24. **Preset edit modal**: name / folder / args / pre-prompt fields, Delete / Cancel / Save.
25. **Deep link `#sessions/new/<folder>`** opens new-session modal pre-filled.

### Phase 4 — Files view (biggest lift)

26. **Real file API**: `/api/files/list`, `/raw`, `/move`, `/copy`, `/rename`, `/delete`, `/mkdir`, `/touch`, `/write`, `/upload`, `/download-zip`, `/recent`. Replace `window.SUPER_DATA.files` mocks.
27. **Layout split**: desktop ≥920px = sidebar (220px) + list + preview pane (3-col when file selected, 2-col otherwise). Mobile <920px = single column with sidebar in bottom sheet.
28. **Sidebar**: Quick (pinned + system locations), Recent (up to 8 from API), Trash row.
29. **Breadcrumbs** that handle Windows (`C:\`) and Unix (`/`) paths and are clickable.
30. **Sort modal** (Name/Size/Modified/Type, with direction arrow). Sort persisted per-folder via `/api/settings` PATCH (`fileSort` map).
31. **List/grid toggle** persisted to `localStorage('files.viewMode')`. Grid mode lazy-loads image thumbnails via `/api/files/raw`.
32. **Create menu**: New folder, New file (.txt empty), New Markdown (.md `# Untitled\n`), New JS (.js comment), New JSON (`{}`).
33. **Folder menu** ("More"): Open in Console (`#console/<path>`), Open in Claude (`#sessions/new/<path>`), Pin folder, Reveal trash, Refresh, Show hidden (toggles `hiddenFiles` setting).
34. **Selection mode**: long-press 500ms with 8px movement-cancel + `vibrate(20)`, Ctrl/Meta-click toggle. Toolbar: Cut, Copy, Move (promptModal dest), Zip (promptModal name), Download (single or zip), Rename, Delete (confirm → trash), Paste (when clipboard has content), Cancel.
35. **Clipboard paste bar** when clipboard has content but nothing selected: "Cut: N" / "Copied: N" + "Paste here" + "Clear".
36. **Persistent upload toast** during multipart upload to `/api/files/upload?dest=...`.
37. **Trash modal**: list with Restore + Delete-forever (confirm) per item, Empty trash footer button (confirm with count).
38. **Preview pane** by file kind. Use `fileKind(name)` returning `image|audio|video|pdf|archive|markdown|text|binary`:
    - Image: `<img>`
    - Audio: `<audio controls>`
    - Video: `<video controls>` black bg max 70vh
    - PDF: PDF.js renderer (lazy-loaded from `web.new/vendor/pdfjs/`), first 5 pages on canvas at 1.5x
    - Archive: `/api/files/zip-list` entry list with name/size/isDir
    - Markdown: 3 tabs — Preview (custom md renderer) / Raw (highlight.js) / Edit (CodeMirror)
    - Text: 2 tabs — View (highlight.js with truncation notice for big files) / Edit (CodeMirror)
    - Binary: hex dump of first 512 bytes
    - All previews show a file toolbar: Download / Rename / Copy path / Delete.
39. **CodeMirror 5** lazy-loaded from `web.new/vendor/codemirror/` (copy from `web/vendor/codemirror/`). Theme `material-darker`, line numbers, auto-close brackets, match brackets, active line, indent 2 spaces. Modes: JS/TS/JSX, JSON, HTML, CSS, Markdown, YAML, Python, Rust, Shell, SQL, C-like, Go, XML. Word-wrap toggle, unsaved badge, Ctrl/Cmd+S to save, Ctrl+F to find. Fallback to textarea (300px min, 60vh, mono) if CodeMirror unavailable.
40. **Custom markdown renderer** (port from `web/views/files.js`) — h1–h6, bold, italic, inline code, fenced code blocks with `highlight.js`, links, bullet lists, blockquotes, paragraphs.
41. **highlight.js** common bundle vendored from `web/vendor/highlight/`.
42. **Realtime FS events**: subscribe to `files:<path>` topic; on any event, force-reload list. `history.replaceState` for the URL silently (no remount). `/api/files/recent` POST on navigate.
43. **Pull-to-refresh** on mobile scroll containers (>80px pull triggers reload).

### Phase 5 — Console view

44. **xterm.js** lazy-loaded from `web.new/vendor/xterm/` (copy from `web/vendor/xterm/`). Replace the hand-rolled div terminal entirely. Font `ui-monospace, SF Mono, Cascadia Mono, Consolas, monospace` 13px, blinking amber `#f59e0b` cursor, 5000-line scrollback, dark 16-color theme (bg `#000000`, fg `#dfe1e3`), FitAddon resizes cols/rows + sends to server.
45. **Real shell I/O**: scrollback replay on attach (from `info.scrollback`), input via WS `shell:write` with HTTP fallback, output via topic `shell:<id>` event `data`, exit event writes `\r\n[exited]\r\n`.
46. **Tab features**: long-press tab → rename `promptModal`, close X with confirm modal, `(pipe)` suffix when not using PTY (already partially present), empty-state message.
47. **Customizable quick keys** from `app.settings.quickKeys`. All 6 types:
    - `key`: sends raw data
    - `ctrl-toggle`: highlights with accent when active; next single-char key gets Ctrl-modified
    - `cd`: sends `cd "<path>"\r`
    - `script`: sends multiline script (newlines → `\r`)
    - `send-claude`: copies terminal selection + navigates to `#sessions/new/<folder>`
    - `paste`: reads clipboard (Clipboard API) or `promptModal` fallback
48. **Long-press on quick key** → action menu (Edit / Remove / Cancel).
49. **Trailing `+` slot** opens **key picker modal** with 3 tabs:
    - Preset: grid of buttons (Esc, Tab, Ctrl, ↑↓←→, |, ~, /, \\, ", ', $, &, *, #, Ctrl+C/D/L/R, Send to Claude, Paste)
    - cd path: label + path inputs + Add
    - Script: label + textarea + Add
50. **Deep link `#console/<encoded-path>`** creates new shell in that cwd on first load.
51. **Resize handling**: ResizeObserver on term host + `orientationchange` → debounced `fitAll()` (80ms).

### Phase 6 — Processes / System / Settings backend

52. **Processes**: `/api/procs` data, **8s auto-refresh** (slow on purpose for Windows PowerShell), 200-row cap with "Showing first 200 of N" notice, kill confirm modal showing PID, skeleton on first load, full `fmtBytes` ladder.
53. **System**: subscribe to `system` WS topic, skeleton on first load. Add the missing pieces:
    - Disk bar color = `--danger` when ≥90%, `--accent` otherwise
    - Network sparklines (RX + TX, 30px each)
    - **GPU card** when `snap.gpu` non-empty (name, util%/memUsed/memTotal/temp, progress bar)
    - Top processes: 8 entries (not 5), with "Open Processes →" link
    - **Power buttons**: Sleep (moon), Restart (rotate-ccw, danger), Shutdown (power, danger), Cancel pending. Each requires **password confirmation modal** (use `promptModal` with `type=password`). Cancel pending just confirms.
54. **Settings — backend half** (live-sync via `settings` WS topic):
    - **Push notifications** subsection: status text (N devices subscribed), "Enable on this device" button (Web Push subscribe + POST endpoint), "Test" button (sends test push), list of subscribed devices with unsubscribe X.
    - **Disk-low threshold** number input (1–50, default 10).
    - **Pinned folders**: list with ↑/↓ reorder (disabled at edges), X remove, Add row (path + display name).
    - **Sessions**: "Auto-trust folders for Claude Code" toggle (writes `~/.claude.json`).
    - **Session presets**: list with delete, "No presets" empty state.
    - **Files**: "Show hidden files" toggle, "Path blocklist" textarea (one path per line) + Save.
    - **Account**: Change password (current + new + repeat) + Logout (danger).
    - **Maintenance**: Supervisor repo path mono input + Save (used by Maintenance modal flow).
    - **Keyboard shortcuts** reference card: table of `?`, `g s/f/c/p/y/t`, `Esc`, `Ctrl+S` with descriptions.
    - **Backup**: Export settings (downloads `supervisor-settings.json`), Import settings (file picker + JSON parse), Reset to defaults (confirm).
    - **About**: server uptime, hostname, platform, app version, "Force refresh (clear cache)" button (unregisters SW + purges all caches via `caches.keys` + `caches.delete` + reload).

### Phase 7 — Utilities + polish

55. **Utility module** (`web.new/util.jsx` or similar): port these from `web/components/util.js`:
    - `fmtBytes` (B/KB/MB/GB/TB with smart precision)
    - `fmtDur` (Ns / Nm Ns / Nh Nm / Nd Nh)
    - `fmtRelative` ("just now" / "Ns ago" / "Nm ago" / "Nh ago" / "Nd ago" / locale date)
    - `fmtAbs` (`toLocaleString()`)
    - `escapeHtml`, `debounce`, `throttle`, `vibrate`
    - `copyToClipboard` (Clipboard API + `execCommand` fallback)
    - `basename`, `dirname`, `joinPath` (handle both `/` and `\`)
    - `getExt`, `fileKind`, `modeForExt`
    - `emptyState({icon,title,body,action})`, `skeleton(rows)`
    - `attachLongPress(el, fn)` — 500ms hold, 8px movement cancel, returns cleanup, vibrates 20ms
    - `attachPullToRefresh(scroller, fn)` — 80px pull
56. **Theme-color meta** updates to `#0a0a0b` (dark) or `#fafaf7` (light) when theme changes.
57. **`document.startViewTransition`** on tab change with fallback when unsupported.
58. **Header action slots** wired per-view, not hard-coded conditionals in `app.jsx`. Each view receives a way to register its primary action (like `web/`'s `#header-action-1`).
59. **Global error handling**: `window.error` → `toast.error(msg)`, `unhandledrejection` → `toast.error(reason)`.

## Things to keep from `web.new/` (don't accidentally remove these)

- Density control (`dense`/`medium`/`airy`) — surface as a Settings toggle alongside theme/accent.
- Aurora background toggle.
- Lime accent color (6th option — leave the 5 originals: amber, teal, purple, blue, rose, plus lime).
- Live-bars chip animation for running session status.
- Donut/ring progress visual on stat cards (use it in addition to or instead of the original sparkline — your call, but keep the visual).
- Glass summary header on Processes (count / total CPU / total MEM).
- Inter + JetBrains Mono fonts via Google Fonts CDN.
- Tweaks panel (`tweaks-panel.jsx`) — leave it. It's dev tooling for the design phase via `__edit_mode_*` postMessage.

## File layout you should end up with

```
web.new/
├── index.html               # entry, mounts <App>
├── login.html               # NEW — port from web/login.html
├── manifest.webmanifest
├── sw.js                    # add periodic update + reload-on-controllerchange
├── icon.svg
├── styles.css               # extend, don't rewrite
├── icons.jsx                # extend with any missing icons used by web/
├── util.jsx                 # NEW — utilities ported from web/components/util.js
├── ws.jsx                   # NEW — WebSocket client + pub/sub + ping
├── modal.jsx                # NEW — modal stack + confirm/prompt helpers
├── toast.jsx                # NEW — toast system
├── sheet.jsx                # NEW — bottom-sheet drawer
├── markdown.jsx             # NEW — md renderer
├── tweaks-panel.jsx         # KEEP
├── app.jsx                  # rewire: real WS, hash routing, restart banner, ?-key, g-chord
├── view-sessions.jsx        # full feature port
├── view-files.jsx           # NEW — split out from view-others; full feature port
├── view-console.jsx         # NEW — split out; xterm + quick keys + key picker
├── view-processes.jsx       # NEW — split out; real API + 8s refresh + confirm
├── view-system.jsx          # NEW — split out; sparklines + GPU + power w/ password
├── view-settings.jsx        # NEW — split out; full backend half
└── vendor/
    ├── codemirror/          # copy entire folder from web/vendor/codemirror/
    ├── xterm/               # copy entire folder from web/vendor/xterm/
    ├── highlight/           # copy entire folder from web/vendor/highlight/
    └── pdfjs/               # copy entire folder from web/vendor/pdfjs/
```

`view-others.jsx` should be split into 5 view files. `app.jsx` stays slim.

## How to verify

After each phase, smoke-test:

- Phase 1: page loads, dot turns green, latency shows real ms, hash changes navigate, modal opens/closes/stacks, login page works, SW updates without manual reload.
- Phase 2: pressing `?` opens Maintenance modal, submitting creates a real shell and lands on Console with that shell active and the prompt being typed in. Restarting from Settings shows the banner sequence.
- Phase 3: real sessions render, all card actions work end-to-end against the server, send-to-stdin works on a running Claude session, log streams live.
- Phase 4: navigate folders on real disk, preview every file kind, edit a file in CodeMirror with Ctrl+S, upload progress toast appears, trash flow works, FS events update list in real time.
- Phase 5: real shells via xterm.js, scrollback replays on tab switch, all quick-key types work, key picker modal adds new keys.
- Phase 6: processes auto-refresh every 8s and cap at 200, system view shows GPU/network sparklines, power buttons require password.
- Phase 7: every utility used by ported code resolves, view transitions work, theme-color meta updates.

When everything in `WEB-NEW-AUDIT.md` § 13's 44-row checklist is "Present", you're done.

## What success looks like

`web.new/` is a drop-in replacement for `web/`. The server doesn't change. Visiting the same URLs, pressing the same shortcuts, and using the same flows all behave identically — but the UI is the new design (aurora, density, live-bars, fonts, etc.). I should be able to point Express's `static` middleware at `web.new/` instead of `web/` and notice nothing missing.
