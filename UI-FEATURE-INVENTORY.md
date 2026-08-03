# Supervisor UI — Complete Feature Inventory
*Generated before Claude Design redesign. Use this to audit `web-new/` when ready.*

---

## Global Shell / App Frame

### Header (`app-header`)
- **Logo**: `layers` icon (16px) in `#brand-logo` span, left of title
- **Page title**: `<span id="page-title">` updates on every tab switch to: Sessions / Files / Console / Processes / System / Settings
- **Connection dot** (`#connection-dot`): badge with dot, shows "live" (success/green) when WebSocket connected, "offline" (muted) when not
- **Latency badge** (`#latency-badge`): hidden by default, shown when WS is connected. Displays round-trip ping in ms (e.g. `42ms`). Color-coded: green <100ms, amber 100–300ms, red >300ms. Shows `…` (warn state) if pong is overdue >4s. Updates every 5 seconds.
- **Header action slots** (`#header-action-1`, `#header-action-2`): two ghost icon buttons, hidden by default; views wire them up (Sessions uses #1 for "New session" plus icon, Console uses #1 for "New shell" plus icon)
- **Help button** (`#help-btn`): `help` icon (18px), always visible, opens the "Request a change" maintenance modal

### Restart Banner (`#restart-banner`)
- Shown as a top-of-page banner (above header) when a server restart is triggered
- **Pending state**: "Server is restarting…" — shown while WS is disconnected after restart
- **Ready state**: "Server restarted" + "Reload now" primary button — shown when WS reconnects within 5 min
- Auto-dismissed / ignored if restart flag is stale (>5 min)
- Uses `sessionStorage.supervisorRestarting` to persist across the disconnection window

### Tab Bar (`#tabbar`, `nav.tabbar`)
Six tabs, each with icon + label:
| Tab | Icon | Label | Hash |
|---|---|---|---|
| Sessions | `rocket` | Sessions | `#sessions` |
| Files | `folder` | Files | `#files` |
| Console | `terminal` | Console | `#console` |
| Processes | `layers` | Processes | `#processes` |
| System | `cpu` | System | `#system` |
| Settings | `settings` | Settings | `#settings` |

- Active tab gets `.active` class
- Tab icons are 20px
- Keyboard shortcuts: `g s/f/c/p/y/t` navigate to respective tabs (two-key chord, 800ms window)

### Routing
- Hash-based (`location.hash`)
- Supports incremental routing within a tab via `view.route(rest)` — avoids re-mount on sub-path change
- View transitions via `document.startViewTransition` when available, with fallback
- Previous view's `destroy()` is always called before mounting a new view

### WebSocket
- Auto-connects on boot, auto-reconnects with exponential backoff (500ms → 15s max)
- Re-subscribes all topics on reconnect
- Pub/sub: `App.subscribe(topic)`, `App.unsubscribe(topic)`, `App.onMessage(handler)`
- Ping/pong loop runs every 5s while connected

### Theme / Accent System
- Theme: `dark` | `light` | `auto` — applied as `data-theme` on `<html>`
- Accent: `amber` | `teal` | `purple` | `blue` | `rose` — applied as `data-accent` on `<html>`
- `<meta name="theme-color">` updates to `#0a0a0b` (dark) or `#fafaf7` (light) to match
- Live settings updates pushed over WebSocket (`topic: 'settings'`)

### Service Worker
- Registered at `/sw.js`
- Periodic update check every 5 min
- On new SW install, posts `skipWaiting` immediately
- On controller change, reloads page once (deduplicated)

### Global Error Handling
- `window.error` → `toast.error` with message
- `unhandledrejection` → `toast.error` with reason

### Keyboard Shortcuts (global)
- `?` → opens "Request a change" maintenance modal
- `g` then `s/f/c/p/y/t` → navigate to tab (chord within 800ms)
- Ignored when focus is inside `INPUT`, `TEXTAREA`, or `contentEditable`

### Maintenance Modal ("Request a change")
- Triggered by `?` key or help button
- Textarea with placeholder: *"e.g. 'The login button on mobile is too small — make it bigger.'"*
- Help text: "Opens a Console shell with `claude` running and auto-pastes your prompt. The request is also copied to your clipboard."
- "Open in interactive Claude" primary button: POSTs to `/api/maintenance/interactive`, opens Console tab, activates the new shell via `localStorage.consoleActivateShell`
- "Close" ghost button
- Modal size: `lg`

---

## Login Page (`login.html`)

- `layers` icon (22px) as logo above title
- Title: "Supervisor"
- Subtitle: "Sign in to your remote control panel."
- **Password field** with show/hide toggle (`eye` / `eye-off` icon, 16px), positioned absolute inside field row
- **"Trust this device for 60 days"** checkbox row (custom checkbox rendered as `.checkbox` span, hidden native input)
- **Sign in** button (primary), disables + shows "Signing in…" during submit
- Error message in `#err` div below field
- On success: redirects to `?next=` param or `/`
- Theme color: `#0a0a0b`
- Mobile-locked viewport (no zoom, viewport-fit=cover)

---

## Sessions View

### Toolbar
- **Search input**: placeholder "Search folder, tag, log…" — fuzzy matches folder, name, tag, lastLog (80ms debounce)
- **Filter buttons** (sm): All / Running / Exited — active gets `primary` style, others `ghost`
- **Group button** (sm, ghost): cycles None → By folder → By tag, shows `layers` icon (14px) + label, persisted to `localStorage('sessions.group')`

### Presets Bar
- Shown only when presets exist
- "Presets" section label
- Each preset: ghost sm button with `zap` icon (14px) + name, title = folder path
- **Long-press on preset** → opens edit/delete modal
- "Add preset" button with `plus` icon (12px)

### Session Cards
Each card is `.card.hover` with:
- **Status dot**: `badge dot success` ("live") if running, `badge dot danger` if error/non-zero exit, plain otherwise ("done")
- **Title**: session name or basename of folder or session ID (bold, truncated)
- **Folder path**: muted, 12px, truncated
- **Tag badge**: `#tagname` if present
- **Duration / status**: tabular, muted, right-aligned — shows running duration (live-updated every 1s) or status string
- **Last log preview**: last 3 lines of log, in `<pre>`, 11px mono, dark background (`#000`), max 64px height, no scroll

### Card Actions Row
- **"Open log"** ghost sm button with `log` icon — opens detail modal
- **"Kill"** ghost sm danger button with `stop` icon — shows confirm modal; only shown when running
- **"Restart"** ghost sm button with `rotate-ccw` icon — only shown when not running
- **Delete (trash)** ghost sm danger icon button — works for both live (force-kill) and exited sessions; confirm modal text changes based on live/dead state
- **Tag/rename** ghost sm icon button with `tag` icon — two sequential `promptModal` calls: name then tag

Clicking anywhere on card body → opens log detail modal.

### Empty States
- "No sessions yet" with "Spawn Claude Code in a folder." body + "New session" primary button
- "No sessions match" with filter hint + same button

### Grouping
- **By folder**: section header = folder path
- **By tag**: section header = tag or "(no tag)"
- **None**: flat list

### "Clear exited" button
- Ghost sm, `trash` icon (12px), shown at bottom when any exited sessions visible
- Confirm modal before clearing

### Session Detail Modal (log viewer)
- Modal size: `xl`
- Title: session name or folder path
- **Status badge** + **folder path** + **"started N ago"** in header row
- **Search bar**: input + match count label + prev/next (chevron-up/down, 14px) navigation buttons
  - Highlights matches with `--accent-soft` background, `--accent` color
- **Log host**: fixed-height (52vh, min 240px), black background (`#000`), `#dfe1e3` text, 12px mono, word-wrap, auto-scroll (pauses when user scrolls up, resumes when at bottom within 30px)
  - Buffer capped at 10MB, drops oldest
- **Send-to-stdin row**: shown only when running; mono input, sends on Enter with newline appended
- **Action row**: "Copy log" (copies buffer) + "Send to Claude" (takes selection or last 2000 chars, opens new session modal with pre-prompt)
- **Modal footer actions**: "Kill" (danger, only if running) or "Restart" (primary, if not running) + "Close"
- Live log streaming via WS topic `session:{id}`

### New Session Modal
- Modal size: `lg`
- **Folder field**: mono input + "Browse" button with `folder` icon (14px)
  - Browse opens folder picker (layered modal)
- **Command mode**: three sm buttons — "claude rc" / "claude (then /rc)" / "Custom args…"
  - Custom args: shows mono input below, hidden otherwise
- **Pre-prompt** textarea: placeholder "e.g. 'Read README.md, then propose three improvements.'"
  - Help text: "Sent as the first message after Claude starts."
- **Env vars** textarea: KEY=value per line, placeholder `ANTHROPIC_MODEL=claude-opus-4-7`
  - Help text shown
- **Save as preset** input: optional preset name
- "Cancel" ghost + "Launch" primary

### Folder Picker (layered modal)
- Path input (mono) + "Go" button; Enter also navigates
- Quick location chips row (up to 8, from API)
- Scrollable list (max 50vh, bordered) showing only directories:
  - ".." parent row with `arrow-up` icon
  - Folder rows with `folder` icon (accent color)
  - "No subfolders here" message if empty
  - Loading skeleton (5 rows)
- "Cancel" ghost + "Choose this folder" primary
- Resolves `null` if dismissed

### Preset Edit Modal
- Fields: Name, Folder (mono), Args (space-separated, mono), Pre-prompt (textarea)
- Actions: Delete (ghost danger, only for existing) + Cancel + Save

### Data / Realtime
- Subscribes to `sessions` topic
- 1-second tick updates running-time labels
- Deep link: `#sessions/new/<folder>` opens new session modal pre-filled

---

## Files View

### Layout
- **Desktop (≥920px)**: 3-column grid — sidebar (220px) | file list | preview pane
  - When no file selected: sidebar + list (2-col)
- **Mobile (<920px)**: single column; sidebar in bottom sheet (drawer)
- Responsive via `matchMedia` + `ResizeObserver`

### Top Bar
- **Breadcrumb row**: clickable crumb segments, supports Windows (`C:\`) and Unix (`/`) paths
- **Search/filter input**: "Filter files…" — fuzzy-char matching (all chars of filter must appear in order), 80ms debounce
- **Sort button**: `sort` icon — opens sort modal
- **View toggle**: `grid`/`list` icon — cycles list ↔ grid, persisted to `localStorage('files.viewMode')`
- **New (+) button**: opens Create menu
- **Upload button**: `upload` icon — opens file picker (multi-select)
- **More button**: `more` icon — opens folder menu
- **Mobile only**: "Locations" button (prepended) opens sidebar drawer

### Sidebar
- **Quick** section: pinned/system locations with icon, name, unpin button (user pins only)
- **Recent** section: up to 8 recently visited folders (folder-open icon, muted; truncated name, full path as title)
- **Trash** section: single row opening trash modal
- Desktop: always visible; Mobile: bottom sheet

### Sort Modal
Options: Name | Size | Modified | Type
- Active sort shows accent badge with arrow (↑/↓); toggling same key reverses direction
- Sort preference persisted per-folder via `/api/settings` PATCH (`fileSort` map)

### Create Menu
Options:
- New folder (`folder` icon)
- New file (`.txt` with empty content)
- New Markdown (`.md` with `# Untitled\n`)
- New JS file (`.js` with comment)
- New JSON file (`.json` with empty object)

### Folder Menu ("More")
- Open in Console → `#console/<encoded-path>`
- Open in Claude → `#sessions/new/<encoded-path>`
- Pin folder → adds to pinned via settings
- Reveal trash
- Refresh (force reload)
- Show hidden (toggles `hiddenFiles` setting)

### File List (list mode, `.file-row`)
Each row: icon | name (truncated) | size (or `—` for dirs) | modified time (relative, absolute on hover)
- Click: navigate (dirs) or open preview (files)
- Ctrl/Meta+click: toggle selection
- Long-press (500ms): enters select mode, selects item, vibrates 20ms

### File Grid (grid mode, `.file-grid`, `.file-tile`)
- Image files: lazy-loaded thumbnail (`/api/files/raw`), cover-fit, onerror fallback to icon
- Other files: large icon (28px), accent color for dirs, text-2 for files
- Name below
- Same click/long-press behavior

### Selection Mode (`.sel-bar`)
Badge showing count + buttons:
- Cut (`scissors`) → stores to clipboard state
- Copy (`copy`) → stores to clipboard state
- Move (`move`) → promptModal for destination
- Zip (`archive`) → promptModal for name → download-zip URL
- Download → single file download, or zip for multi
- Rename (`edit`) → promptModal for new name (renames first selected)
- Delete (`trash`, danger) → confirm → moves to trash
- Spacer
- Paste (`check`, primary) — only when clipboard has content
- Cancel (`x`) — clears selection

### Clipboard Paste Bar
When clipboard has content but nothing selected, shows persistent bar: "Cut: N" or "Copied: N" badge + "Paste here" primary + "Clear" ghost.

### File Operations
- **Move**: `/api/files/move` POST with paths + dest
- **Copy**: `/api/files/copy` POST
- **Zip**: `/api/files/download-zip` GET with paths query params → browser download
- **Download**: `/api/files/raw?download=1`
- **Rename**: `/api/files/rename` POST {from, to}
- **Delete**: `/api/files/delete` POST → moves to trash
- **New folder**: `/api/files/mkdir`
- **New file**: `/api/files/touch` + optional `/api/files/write`
- **Upload**: multipart POST to `/api/files/upload?dest=...`; "Uploading N…" persistent toast during upload

### Trash Modal
- Lists items with: name, original path, relative time
- Per-item: Restore (`rotate-ccw`) + Delete forever (`trash` danger with confirm)
- Footer: "Empty trash" (danger, with confirm showing count) + "Close" primary

### Preview Pane
Opens to the right on desktop; bottom sheet on mobile.

Preview header: file icon + name + size + close button (`x`, 14px).

**By file kind:**
- **Image**: `<img>` + file toolbar
- **Audio**: `<audio controls>` + file toolbar
- **Video**: `<video controls>`, black bg, max 70vh + file toolbar
- **PDF**: PDF.js renderer (lazy-loaded), first 5 pages on canvas at 1.5x scale, "Showing first N of M pages" if truncated + file toolbar
- **Archive (zip)**: Entry list with name, size, isDir icon; "(truncated)" if many + file toolbar
- **Markdown**: Three tabs — Preview (custom markdown renderer) | Raw (syntax-highlighted) | Edit (CodeMirror/textarea) + file toolbar
- **Text**: Two tabs — View (syntax-highlighted, truncation notice if file large) | Edit (CodeMirror/textarea) + file toolbar
- **Binary**: Hex dump of first 512 bytes + file toolbar

**File toolbar** (appears on all previews):
- Download (`download` icon)
- Rename (`edit` icon) → promptModal
- Copy path (`link` icon) → copies to clipboard
- Delete (`trash` danger) → confirm → trash

### Editors
**CodeMirror 5** (lazy-loaded) with:
- Theme: `material-darker`
- Line numbers, auto-close brackets, match brackets, active line highlight
- Indent: 2 spaces, smart indent
- Word wrap toggle button
- `Ctrl+S`/`Cmd+S` to save
- `Ctrl+F` for find
- Unsaved indicator badge ("unsaved")
- Language modes: JS/TS/JSX, JSON, HTML, CSS, Markdown, YAML, Python, Rust, Shell, SQL, C-like, Go, XML

**Fallback textarea** when CodeMirror not available:
- Min height 300px, 60vh height, mono font
- Same Ctrl+S shortcut

### Markdown Renderer (built-in, no deps)
Supports: headings (h1–h6), bold, italic, inline code, fenced code blocks (with hljs highlighting), links, bullet lists, blockquotes, paragraphs.

### Realtime
- Subscribes to `files:<path>` topic when navigating to a folder
- On any FS event → `loadList(true)` (force reload)
- Navigation records to `/api/files/recent`
- URL updated silently via `history.replaceState` (no re-mount)

---

## Console View

### Layout
- Full-height column: tab bar → terminal host → keyboard row
- Tab bar at top with `term-bar` class
- Terminal fills remaining height (`flex: 1 1 auto`)
- Keyboard row at bottom

### Shell Tabs (`.term-tab`)
Each tab shows:
- **Status dot**: 6px circle, green (`--success`) if alive, muted if dead
- **Shell name** (default or renamed) + ` (pipe)` suffix if not using PTY
- **Close X** (`x` icon, 12px) with confirm modal
- **Long-press on tab** → promptModal to rename shell
- Active tab gets `.active` class
- "New" tab always appended at right end (opens `createShell`)
- Empty state message: "No shells. Tap + to start one."

### xterm.js Terminal
- Font: `ui-monospace, SF Mono, Cascadia Mono, Consolas, monospace`, 13px
- Cursor: blinking, amber (`#f59e0b`)
- 5000-line scrollback
- Full 16-color theme (dark): background `#000000`, foreground `#dfe1e3`, amber cursor
- FitAddon: resizes terminal cols/rows to container, sends resize to server
- Scrollback replay on attach (from `info.scrollback`)
- Input sent via WS (`shell:write`) with HTTP fallback
- Output received via WS (`shell:<id>` topic, event `data`)
- Exit event: writes `\r\n[exited]\r\n` to terminal

### Keyboard Row (`.kbd-row`)
- Shown only when a shell is active
- Renders configured quick keys from `app.settings.quickKeys`
- **Trailing `+` slot**: always shown, opens key picker

**Quick key types:**
- `key`: sends raw data string to shell
- `ctrl-toggle`: toggles Ctrl modifier (button highlights with accent color when active); next `key` with single char gets Ctrl-modified
- `cd`: sends `cd "<path>"\r`
- `script`: sends multiline script (newlines become `\r`)
- `send-claude`: copies terminal selection to clipboard + navigates to Sessions new with folder
- `paste`: reads clipboard (Clipboard API) or falls back to promptModal

**Long-press on quick key**: opens action menu (Edit / Remove / Cancel)

### Key Picker Modal
Three tabs:
- **Preset**: grid of preset buttons (Esc, Tab, Ctrl, ↑↓←→, |, ~, /, \\, ", ', $, &, *, #, Ctrl+C/D/L/R, Send to Claude, Paste)
- **cd path**: label input + path input (mono), "Add" button
- **Script**: label input + textarea (6 rows), "Add" button

### Deep Link
`#console/<encoded-path>` creates a new shell in that cwd on first load.

### Maintenance Hand-off
`localStorage.consoleActivateShell` → activates that shell ID on load (then removes key).

### Resize Handling
`ResizeObserver` on termHost + `orientationchange` → `fitAll()` (80ms debounced).

---

## Processes View

### Layout
- Search input (flex 1 1 240px): "Filter by name or PID…", 80ms debounce
- Refresh button (`refresh` icon) — manual reload
- Process count meta label ("N / M processes")
- Table card (`.card`, overflow hidden)

### Table
- Grid: `90px 1fr 90px 100px 80px`
- Header row: surface-2 bg, 12px, text-2 color — columns: PID | Name | CPU | Memory | (actions)
- Each column header is clickable to sort (toggles asc/desc); active column shows ↑/↓ indicator
- Default sort: CPU descending

### Rows
- PID: tabular muted text-sm
- Name: truncated, full path as title
- CPU: tabular text-sm (one decimal, or `—`)
- Memory: tabular text-sm (fmtBytes)
- Kill button: sm ghost danger, `x` icon (12px) + "Kill" — confirm modal with PID

### Limits / Performance
- Shows first 200 processes; "Showing first 200 of N — narrow with filter." if more
- Auto-refresh every **8 seconds** (intentionally slow; Windows PowerShell spawn is expensive)
- Skeleton shown synchronously on first load

---

## System View

### Stat Cards (top grid, `repeat(auto-fit, minmax(180px, 1fr))`)
- **CPU**: current % with sparkline, CPU model as hint
- **Memory**: current % with sparkline, used/total as hint
- **Disk**: aggregate % across all disks, used/total as hint (no sparkline)
- **Uptime**: formatted duration, hostname as hint (no sparkline)

Sparklines: 32px height for CPU and Memory, 30px for network.

### Detail Sections (below cards)

**Cores card** (if `perCpu` available):
- Grid of per-core cells: core number + % label + 6px progress bar
- Grid: `repeat(auto-fit, minmax(140px, 1fr))`

**Disks card**:
- Each disk: mount + label, used/total/% right-aligned, 6px progress bar
- Bar color: `--danger` if ≥90%, `--accent` otherwise

**Network card**:
- ↓ Down + ↑ Up in 16px bold tabular
- Total received + Total sent in smaller tabular
- Two sparklines: RX then TX (30px each)

**GPU card** (if `snap.gpu` non-empty):
- Each card: name + util%/memUsed/memTotal/temp right-aligned, progress bar

**Top Processes card**:
- Up to 8 processes: name (PID) + memory + CPU (if available)
- "Open Processes →" link to `#processes` in card header

**Power card**:
- Sleep button (moon icon)
- Restart button (rotate-ccw icon, danger)
- Shutdown button (power icon, danger)
- Cancel pending button (x icon)
- All require password confirmation modal (except Cancel pending which just confirms)

### Live Updates
- Subscribes to `system` WS topic
- Skeleton shown synchronously while fetching

---

## Settings View

Max-width 720px, sections separated by `.section-title` labels.

### Appearance
**Theme**: Dark (`moon`) | Light (`sun`) | Auto (`monitor`) — active gets `primary` style
**Accent**: 5 color swatches (36×36px square buttons) — amber, teal, purple, blue, rose — active gets ring shadow

### Notifications
Four toggles (custom toggle UI with `.toggle` + `.knob`):
- "Session finished" — when Claude Code session exits
- "Session asks for input" — when Claude waits on prompt
- "Long-running console command finished" — "(coming soon)"
- "Disk space low" — with threshold setting below

**Disk-low threshold**: number input (1–50), default 10% free remaining

**Push notifications subsection**:
- Status text (N devices subscribed / none)
- "Enable on this device" primary button with `bell` icon
- "Test" ghost button with `send` icon → sends test push to all devices
- List of subscribed devices: label + push endpoint hostname + unsubscribe X button

### Pinned Folders
- List of pins: pin icon | display name | path (muted) | ↑/↓ reorder buttons (disabled at edges) | X remove button
- "No pins yet" empty state
- Add row: mono path input + display name input + "Add" primary button with `plus` icon

### Sessions
- Toggle: "Auto-trust folders for Claude Code" — pre-accepts workspace-trust dialog by writing `~/.claude.json`

### Session Presets
- List: zap icon (accent) | name + folder + args summary | trash delete button
- "No presets — save one from the Sessions tab…" empty state

### Files
- Toggle: "Show hidden files"
- **Path blocklist**: textarea (min 120px, mono), one path per line, "Save blocklist" primary button with `save` icon

### Account
- Change password: current + new + repeat inputs (all password type) + "Change password" primary button with `lock` icon
- Logout button: ghost danger, `power` icon

### Maintenance
- Explanatory text about the `?` button workflow
- Supervisor repo path: mono input + "Save" primary button
- (Used by "Request a change" to know where to run Claude)

### Keyboard Shortcuts (reference card)
Table of: `?`, `g s/f/c/p/y/t`, `Esc`, `Ctrl+S` with descriptions, each key in `.kbd` pill

### Backup
- "Export settings" ghost button with `download` icon → downloads `supervisor-settings.json`
- "Import settings" ghost button with `upload` icon → file picker, parses JSON, imports
- "Reset to defaults" ghost danger button with `rotate-ccw` icon — confirm modal

### About
- Server uptime, Hostname, Platform, App version ("1.0.0")
- "Force refresh (clear cache)" ghost button — purges SW cache, unregisters SW, deletes all caches, reloads

---

## UI Components

### Modal (`window.modal`)
- Stack-aware (multiple modals can be open simultaneously)
- Z-index: `50 + stackIndex * 2`
- Backdrop click closes (when `dismissible`, default true)
- Escape key closes topmost dismissible modal
- Sizes: default (md ~520px) | `lg` (800px) | `xl` (1100px)
- Header: title + X close button (when dismissible)
- Body: scrollable
- Footer: action buttons
- Fade-out animation (150ms opacity) on close
- `onClose` callback fired when any dismissal path runs

### Toast (`window.toast`)
- `toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)`, `toast.warn(msg)`
- Persistent toasts with `{ duration: 0 }` and manual `.dismiss()`
- Auto-dismiss with configurable duration
- Positioned in `#toasts` (aria-live="polite")

### Sheet (`window.sheet`)
- Bottom-sheet drawer (slides up from bottom)
- Used for mobile sidebar locations drawer, mobile file preview
- `sheet.open({ title, content, onClose })`
- `sheet.close()`

### Sparkline (`window.sparkline(values, { height })`)
- SVG sparkline, filled area chart
- Takes array of numbers, renders as filled path
- Used for CPU, memory, network (RX/TX) history

### Utility Functions
- `el(tag, props, children)` — DOM builder
- `fmtBytes(n)` — B/KB/MB/GB/TB, smart precision
- `fmtDur(ms)` — Ns / Nm Ns / Nh Nm / Nd Nh
- `fmtRelative(when)` — "just now" / "Ns ago" / "Nm ago" / "Nh ago" / "Nd ago" / locale date
- `fmtAbs(when)` — `toLocaleString()`
- `escapeHtml(s)` — escapes `& < > " '`
- `debounce(fn, ms)` — trailing-edge debounce
- `throttle(fn, ms)` — leading + trailing throttle
- `vibrate(pattern)` — wraps `navigator.vibrate`
- `copyToClipboard(text)` — Clipboard API with `execCommand` fallback
- `basename(p)`, `dirname(p)`, `joinPath(a, b)` — cross-platform (/ and \)
- `getExt(name)` — lowercased extension
- `fileKind(name)` — returns: `image` | `audio` | `video` | `pdf` | `archive` | `markdown` | `text` | `binary`
- `modeForExt(ext)` — returns CodeMirror mode string
- `emptyState({ icon, title, body, action })` — standard empty/error state widget
- `skeleton(rows)` — loading skeleton (36px rows, 8px radius)
- `confirmModal({ title, body, danger, confirmText, cancelText })` — promise-based
- `promptModal({ title, label, initial, placeholder, confirmText })` — promise-based
- `attachLongPress(el, fn)` — 500ms hold detection (touch + mouse), 8px movement cancels, returns cleanup fn
- `attachPullToRefresh(scroller, fn)` — pull >80px to refresh

### Icon System (`window.icon(name, { size })`)
- SVG icon function, all icons inline
- Default size: varies by context (typically 16–20px in toolbar, 12–14px in badges/buttons)

---

## PWA / Mobile Details
- `manifest.webmanifest` linked
- `apple-mobile-web-app-capable` + `black-translucent` status bar
- `user-scalable=no, maximum-scale=1, viewport-fit=cover`
- App title: "Supervisor"
- Icons: `/icons/icon.svg`

---

## Vendor Libraries
- **CodeMirror 5** — code editor (lazy-loaded in Files view)
- **xterm.js** — terminal emulator (lazy-loaded in Console view)
- **xterm-addon-fit** — terminal resize addon
- **highlight.js** (common bundle) — syntax highlighting
- **PDF.js** — PDF rendering (dynamic import in Files preview)

---

---

## Automation: Interactive Claude Hand-off (the "Open in interactive Claude" flow)

This is the most complex automated sequence in the app. It is triggered when the user submits the "Request a change" modal. Here is every step, in order.

### Step 1 — Frontend (`app.js` → `showMaintenanceModal`)
1. User types a description in the textarea and clicks "Open in interactive Claude"
2. The prompt text is **copied to the clipboard** (`window.copyToClipboard`) as a fallback in case the auto-paste fails
3. POSTs to `/api/maintenance/interactive` with `{ text: <prompt> }`
4. On success, response contains `{ shellId, prompt }`
5. `shellId` is written to **`localStorage.consoleActivateShell`** so the Console view knows which shell to activate
6. `window.toast.info('Request copied — opening Claude.')` is shown
7. The modal closes
8. `location.hash = '#console'` — navigates to the Console tab

### Step 2 — Backend creates the shell (`maintenance.js` route → `shells.create`)
- A new persistent shell is created with **`name: 'Maintenance Claude'`** and `cwd` = `selfRepoPath` from settings
- Shell spawns via **node-pty** (PTY mode) if available, otherwise piped fallback (shows `(pipe)` in tab)
- The shell ID is returned to the frontend in the same HTTP response (so the localStorage hand-off happens before the Console view even mounts)

### Step 3 — Auto-trust (before the shell is created, if needed)
Before creating the shell, the server runs `claudeConfig.trustFolderInteractive(repoPath)` if `settings.autoTrustClaudeFolders !== false`. Full sequence:

1. Checks `data/claude-trusted.json` — if this folder is already cached, **skip entirely** (no PTY spawn, ~0ms cost)
2. Spawns `claude` in a **fresh PTY** (`node-pty`) using `cmd /c claude` (Windows) or `sh -c claude` (Unix)
   - PTY size: 100 cols × 30 rows
3. Reads all PTY output, **strips ANSI escape codes** — including converting `\x1b[NC` (cursor-right N spaces) back to literal spaces (because Claude's TUI uses cursor escapes for menu layout, which would otherwise make the trust text unrecognisable)
4. Watches the stripped text for the regex `/trust this folder|safety check|Yes, I trust/i`
5. When matched: sends **`\r`** (Enter) to the PTY — accepts the default "Yes, I trust this folder" option
6. Waits **1200ms** for Claude to persist the trust state internally, then kills the PTY
7. Marks the folder in `data/claude-trusted.json` (persistent cache)
8. Hard timeout: **8 seconds** — if the trust prompt never appeared, resolves with `{ ok: false, reason: 'timeout' }` and continues anyway
9. If node-pty is unavailable, returns `{ ok: false, reason: 'node-pty unavailable' }` and skips (no error thrown)

### Step 4 — Phase 1 auto-type: launch Claude (`maintenance.js` route)
- **800ms after the shell is created**, the server calls `shells.write(shellId, 'claude\r')`
- This types `claude` + Enter into the PTY, starting the interactive Claude TUI
- The 800ms delay is intentional: gives the shell process time to finish spawning and print its initial prompt

### Step 5 — Phase 2 auto-paste: inject the prompt
This uses a **quiet-period detection** strategy instead of a fixed delay (because Claude's startup time varies):

1. The server subscribes to the hub topic `shell:<shellId>`
2. Every time a data chunk arrives from the shell, it resets a **1500ms timer**
3. When the timer fires without interruption (i.e. Claude's TUI has gone quiet), it calls `shells.write(shellId, promptText + '\r')`
4. **Hard timeout: 15 seconds** — if the shell never goes quiet, the paste fires anyway
5. The `promptText` has **all newlines collapsed to single spaces** before sending — this prevents Claude's TUI from treating newlines as "submit" and committing a partial prompt
6. Once pasted, the hub listener is removed (one-shot)

### Step 6 — Frontend activates the correct shell (`console.js`)
When the Console view mounts (triggered by step 1's `location.hash = '#console'`):
1. Reads `localStorage.consoleActivateShell`
2. Removes the key immediately
3. Checks if a shell with that ID exists in the list
4. If yes: **activates that specific shell** (focuses it, renders its xterm instance)
5. If no: falls back to activating the first shell in the list

---

## Automation: Sessions Pre-Prompt Injection

When a session is launched with a `prePrompt` field (either from the "New session" modal or a preset):

1. Session spawns `claude [args]` in the target folder (e.g. `claude rc`)
2. Server waits **800ms**
3. Writes `prePrompt + '\n'` to the process's **stdin**
4. This works because `claude rc` reads initial input from stdin — the delay gives claude time to start listening

---

## Automation: Server Self-Restart

Triggered by the "Apply & restart" action (or `/api/maintenance/restart` POST):

1. Server spawns **`start.bat`** in the supervisor repo root using `cmd /c start "" /D <repoRoot> start.bat` — **detached**, `stdio: 'ignore'`, `.unref()`'d so it outlives the parent
2. Waits **500ms** (lets the HTTP response flush to the client)
3. Deletes `data/supervisor.pid`
4. Calls `process.exit(0)` — the old server dies

`start.bat` in the new console window then:
- Reads `data/supervisor.pid` and taskkills any leftover PID
- Starts the new server process

On the **client side** (`app.js`):
1. Before POSTing restart, the UI writes `sessionStorage.supervisorRestarting = Date.now()`
2. Calls `App.markRestarting()` which shows the "Server is restarting…" banner
3. The WS disconnects (server died) → `setConnDot('offline')`, ping loop stops
4. When WS reconnects within **5 minutes**: `checkRestartFlagOnReconnect()` fires → shows "Server restarted / Reload now" banner
5. If reconnect takes >5 min: flag is considered stale, banner is hidden and sessionStorage key removed

---

## Things to Verify in `web-new/`

When the redesign is done, check that every item in this list is accounted for:

1. [ ] Connection dot + latency badge with color thresholds
2. [ ] Restart banner (pending + ready states)
3. [ ] All 6 tabs with correct icons and hash routing
4. [ ] Header action slots wired per-view (Sessions: new, Console: new shell)
5. [ ] Help (?) button + maintenance modal with interactive Claude hand-off
6. [ ] Login: show/hide password, trust checkbox, redirect-to-next
7. [ ] Sessions: search, filter, group-by, preset bar, 1s uptime tick
8. [ ] Session cards: last-log preview snippet, all 4 action buttons, tag badge
9. [ ] Session detail: search/highlight/navigate in log, auto-scroll behavior, send-to-stdin
10. [ ] New session: folder browse picker, mode chooser, pre-prompt, env vars, save-as-preset
11. [ ] Files: sidebar (quick + recent + trash), breadcrumbs for both path separators
12. [ ] Files: list mode columns + grid mode thumbnail images
13. [ ] Files: selection toolbar with cut/copy/paste clipboard state
14. [ ] Files: all file kinds previewed (image, audio, video, PDF, zip, markdown, text, binary hex)
15. [ ] Files: CodeMirror editor with unsaved badge, word-wrap toggle, Ctrl+S
16. [ ] Files: markdown renderer (headings, code blocks, lists, blockquotes)
17. [ ] Files: upload with persistent progress toast
18. [ ] Files: trash modal with restore + delete-forever
19. [ ] Files: per-folder sort persistence
20. [ ] Console: multi-tab shells, status dot, rename on long-press, (pipe) suffix
21. [ ] Console: keyboard row with all preset types, Ctrl-toggle, long-press edit/remove
22. [ ] Console: xterm color theme (amber cursor, dark bg)
23. [ ] Console: send-to-claude, paste from clipboard (with fallback modal)
24. [ ] Processes: 8s auto-refresh, 200-row cap, sort by CPU/mem/name/pid
25. [ ] System: sparklines on CPU + memory, per-core bars, disk bars (danger at 90%), network RX/TX sparklines, GPU section, top-procs link, power buttons with password confirm
26. [ ] Settings: theme switcher, accent swatches with ring highlight, all 4 notification toggles + push
27. [ ] Settings: pinned folders reorder (↑/↓), all backup options, force-refresh
28. [ ] Settings: keyboard shortcut reference table with .kbd pills
29. [ ] Keyboard shortcuts: g-chord navigation, ? for maintenance modal
30. [ ] Theme/accent applied as data attributes on `<html>`, theme-color meta updates
31. [ ] View transitions (startViewTransition) with fallback
32. [ ] Long-press behavior (session cards, file rows, console tabs, quick keys)
33. [ ] Pull-to-refresh (if present on mobile scroll containers)
34. [ ] Toast system: success/error/info/warn + persistent toasts
35. [ ] Modal stack: multiple modals, z-index stacking, Esc closes topmost
36. [ ] Sheet component for mobile drawers
37. [ ] Interactive Claude hand-off: clipboard copy + localStorage shell hint + navigate to Console
38. [ ] Auto-trust PTY flow: cached, ANSI stripping, Enter on trust prompt, 1.2s grace, 8s timeout
39. [ ] Phase 1 auto-type: `claude\r` sent 800ms after shell created
40. [ ] Phase 2 auto-paste: quiet-period detection (1500ms), newlines collapsed, 15s hard fallback
41. [ ] Console view reads `localStorage.consoleActivateShell` on mount and activates correct shell
42. [ ] Pre-prompt injection: 800ms delay then write to stdin
43. [ ] Self-restart: detached start.bat spawn, 500ms flush, process.exit(0)
44. [ ] Restart banner: sessionStorage flag → pending banner → reconnect → reload banner
