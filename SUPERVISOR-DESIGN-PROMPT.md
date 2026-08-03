# Supervisor — Visual & Interaction Redesign Brief

**Your job: redesign this app's entire interface, from a fresh visual starting point, without losing a single feature.**

Read this whole brief before designing anything. The feature checklist in §4 is the contract — every item in it must exist in your redesign, in some form. You may move things, merge things, and change how they are reached. You may not delete them.

---

## 1. What you are redesigning

**Supervisor** is a single-user remote control panel. It runs on the author's machines and is used almost entirely **from a phone over Tailscale** — often one-handed, often standing up, often to check on something that is already running. It is a PWA installed to the home screen. It is also used from a desktop browser, but the phone is the primary case and always wins a tradeoff.

It does six things:

| Tab | Purpose |
|---|---|
| **Sessions** | Spawn and supervise Claude Code processes in arbitrary folders. Watch their logs live. Kill, restart, answer them. |
| **Files** | A full file manager over the entire disk. Browse, preview everything, edit code, bulk operations, trash. |
| **Console** | Persistent terminal sessions (xterm.js) with a custom on-screen key row, because phones don't have Esc or Ctrl. |
| **Processes** | System process list with kill. |
| **System** | Live CPU / memory / disk / network / GPU dashboard with history, plus power controls. |
| **Settings** | Everything configurable, plus account and backup. |

The current interface is a hand-built vanilla-JS app with no framework and no build step. It works. It is dense, functional, and slightly austere — dark, amber-accented, borrowing from developer-tool conventions. It is not badly designed. It is **under-designed**: it grew feature by feature, and it shows in the toolbars, the inconsistent "add a thing" patterns, and the accessibility gaps.

Your starting point is that existing design, because it is the most complete statement of what the app actually does. Your output should not look like it.

---

## 2. Hard constraints

These are not negotiable. Design within them.

1. **Mobile-first, and mean it.** Design the phone layout first and completely. Assume a 390×844 viewport, a thumb, and safe-area insets top and bottom. The desktop layout is an adaptation of the mobile design, not the other way round.
2. **Dark-first, with a real light theme.** Both must be first-class. The current light theme is a warm off-white treatment, not an inverted dark theme — keep that instinct.
3. **Five accent colors, user-selectable.** Currently amber / teal / purple / blue / rose. Every component must work with any of them. Do not design something that only looks right in amber.
4. **Density is a feature.** This is a power tool for one technical user. It is not a consumer app. Do not solve crowding by adding whitespace until only four things fit on screen — solve it with hierarchy, grouping, and progressive disclosure. The user would rather see more and scroll less.
5. **Speed over polish.** This loads over cellular on a phone. Heavy fonts, large images, elaborate animation, and framework weight are all costs the user pays every time they open the app to check one thing. The current app has a sub-200KB JS shell and instant load. Do not regress that. Prefer CSS to JS, prefer system fonts to webfonts unless you can justify the bytes, prefer transform/opacity animation to layout animation.
6. **Two embedded third-party surfaces you must design around, not restyle away:** xterm.js (the terminal) and CodeMirror 5 (the code editor). They render their own DOM with their own themes. Your design system needs to supply them coherent color themes and give them well-defined containers, not fight them.
7. **Touch targets ≥44px** for anything primary. The current app has icon-only buttons well below that.
8. **The app must be legible at a glance.** The most common interaction is: unlock phone, open app, look at one status, lock phone. Optimize for that.

---

## 3. What's wrong with the current design (your actual brief)

These are observed problems, in rough priority order. A successful redesign resolves most of them.

1. **Files' toolbar is crowded to the point of failure.** On a phone it carries breadcrumbs, a Locations button, a filter input, and five icon buttons (sort, view toggle, new, upload, more) in one wrapping flex row — which wraps to two or three lines of chrome before any file is visible. This is the single worst screen in the app.
2. **"How do I add a thing" is inconsistent.** Quick keys use a trailing `+` chip. Presets use an "Add preset" chip. Pinned folders use a dedicated form row. Files uses a `+` button opening a menu. Four patterns for one concept.
3. **Long-press is the only way to reach several features, with no visible affordance and no keyboard path at all.** Editing a preset, editing a quick key, and renaming a console tab are all long-press-only. A user who doesn't already know cannot discover them. A keyboard user cannot reach them.
4. **Icon-only buttons rely on `title` tooltips instead of `aria-label`** across most dynamically-created controls. Modals and sheets don't set `role="dialog"`/`aria-modal`, don't trap focus, and don't return focus to the trigger on close — you can tab straight out of an open modal into the page behind it.
5. **There is no elevation system.** Depth is communicated entirely by border and background color shifts, plus one hardcoded `box-shadow` on toasts. Modals, sheets, and cards have no coherent layering language.
6. **Status is under-communicated.** A session mid-kill renders as a neutral "done" badge. A degraded shell appends the literal string ` (pipe)` to its tab name. A disconnected WebSocket is a small colored dot. These are the most important states in the app and they're the quietest things on screen.
7. **Two fonts are named in the CSS stack and neither is ever loaded** (Inter, JetBrains Mono). Everyone sees system fallbacks. Decide deliberately: load them, or design for system UI + system mono properly.
8. **The log viewer is the app's most-used surface and gets the least design.** It's a black `<pre>` at a fixed `52vh` with a search row bolted on top. Auto-scroll pausing, match navigation, and the send-to-stdin row all exist but read as accreted controls rather than a designed reading experience.
9. **Empty states are inconsistent in tone and structure**, and several important ones (no shells, no matching files) barely exist.
10. **Dead UI in the CSS misleads:** a `.rail-collapsed` variant with no toggle, a hidden `#menu-btn`, a fully-implemented pull-to-refresh that nothing calls.

---

## 4. Feature preservation checklist — the contract

Every item below exists today and must survive. Reorganize freely; delete nothing. Where an item is marked ⚠️ it is a known problem — fix it as part of the redesign rather than faithfully reproducing it.

### Global shell

- Header: app title/identity, live WebSocket connection indicator with latency (green/amber/red/stale thresholds), help button.
- **Restart banner** with a pending → ready state sequence. ⚠️ Currently has no trigger; wire it or design it out deliberately.
- Six-destination navigation: bottom tab bar on mobile, left rail ≥768px.
- Hash routing with sub-paths and deep links: `#sessions/new/<folder>`, `#console/<path>`, `#files`, `#system`, etc.
- Global keyboard shortcuts: `?` help overlay, `g`+`s/f/c/p/y/t` to jump tabs, `Esc` closes topmost modal/sheet, `Ctrl+S` saves in the editor.
- Theme (dark/light/auto) and accent selection, applied via `data-theme` / `data-accent` on the root.
- Global error surfacing.
- A **"Request a change"** maintenance modal that hands a request off to an interactive Claude session in the app's own repo.
- Login page: password field with show/hide, "trust this device for 60 days" checkbox, `?next=` redirect preservation.

### Components that exist and must have designed equivalents

Toast (success/error/info/warn kinds, icon + title + body + dismiss, auto-dismiss with a persistent variant, stacked bottom-center mobile / bottom-right desktop, `aria-live`); Modal (**stack-aware** — modals open on top of modals, Esc closes only the topmost, three sizes ~520/800/1100px, backdrop-click gated by a `dismissible` flag); Sheet (single-instance bottom sheet, grab handle, safe-area aware); Sparkline (inline SVG, filled area + stroke, auto-scaling, degrades to a single point for one value); Empty state (icon + title + body + optional action, with a monospace left-aligned variant for stack traces); Skeleton loaders; Confirm and Prompt modals; Long-press interaction (500ms, 8px cancel threshold, haptic tick) ⚠️ must gain visible affordances and keyboard equivalents; Pull-to-refresh ⚠️ implemented but never wired; ~90 inline Lucide-derived SVG icons at 24×24, 1.5px stroke, `currentColor`; buttons (primary / ghost / danger / small / icon-only / segmented groups); form fields (label + help + error); toggle switches; checkboxes; cards; badges (with a dot variant, four semantic colors); list rows with a selected state; `kbd` key pills.

### Sessions

Search across folder/name/tag/log (debounced). Filter: All / Running / Exited. Group by: none / folder / tag, persisted. Preset chips that launch on tap and edit on long-press ⚠️, plus an add-preset affordance. Session cards showing: status badge (running / done / error ⚠️ *and a missing "killing" state*), name or folder basename, folder path, tag badge, live-ticking duration for running sessions, a three-line log preview, and actions — Open log, Kill (running only, confirmed), Restart (stopped only), Remove (confirmed, different copy for live vs. dead), Rename + Tag. Card body tap opens detail. Two distinct empty states (nothing at all vs. nothing matching). "Clear exited" action. Group section headers.

**Session detail modal** — the most important screen in the app: status badge, folder, started-at; search with live match count, highlight-all, and prev/next stepping that scrolls matches to center and wraps; the log viewport itself (auto-scroll pinned to bottom, **pausing when the user scrolls >30px up and resuming when they return**, monospace, wrapping, ~10MB client buffer); a send-to-stdin input shown only while running; Copy log; **Send to Claude** (takes the current text selection or the last 2000 chars, opens a new session pre-filled with it); Kill / Restart in the footer; live log and status streaming.

**New Session modal**: folder input + a **folder picker** (layered modal with a path field, quick-location chips, a scrollable directory-only list with a parent row, and a "Choose this folder" action); a three-way command mode selector (`claude rc` / plain `claude` / custom args); a pre-prompt textarea; an env-vars textarea (`KEY=value` per line, `#` comments); an optional "save as preset" name; Launch.

**Preset edit modal**: name, folder, args, pre-prompt, delete (existing only).

### Files

Three-column desktop layout (locations sidebar / list / preview) collapsing to single-column mobile with the sidebar and preview each becoming bottom sheets. Breadcrumb navigation handling both Windows and POSIX paths. Fuzzy-subsequence filter. Sort modal (name/size/modified/type, direction toggle, **persisted per folder**). List ↔ grid view toggle, persisted, with lazy image thumbnails in grid mode. Create menu (folder / text / Markdown / JS / JSON). Upload with a persistent progress toast. Folder menu: open in Console, open in Claude, pin folder, trash, refresh, show hidden.

Sidebar: quick locations (home, desktop, documents, downloads, drives or `/`), user-pinned folders with inline unpin, up to 8 recent folders, trash entry.

Selection: long-press or Ctrl/Cmd+click to enter multi-select; a selection bar with count and actions — Cut, Copy, Move, Zip (named archive), Download (falls back to zip for multi/dir), Rename ⚠️ *silently renames only the first item — fix or disable*, Delete; plus Paste and Cancel. A **separate clipboard bar** when the clipboard has content but nothing is selected: "Cut: N" / "Copied: N", Paste here, Clear. Cut clears the clipboard after paste; copy does not.

Trash modal: per-item name, original path, relative trashed-time, Restore, Delete forever, plus Empty trash.

Preview pane, per file kind: **image**; **audio**; **video** (seekable via HTTP range); **PDF** (first 5 pages rendered to canvas, with a truncation notice); **zip** (entry listing); **Markdown** (three tabs — rendered preview with syntax-highlighted code blocks / raw highlighted source / editor) ⚠️ *the current renderer is an XSS hole — the redesign must assume a properly escaped renderer*; **text** (view + edit tabs, with a truncation notice for large files); **binary** (hex dump of the first 512 bytes). Every kind shares a file toolbar: Download, Rename, Copy path, Delete.

Editor: CodeMirror with line numbers, bracket matching/closing, active-line highlight, `Ctrl/Cmd+S` to save, `Ctrl+F` find, a word-wrap toggle, an "unsaved" indicator, and a plain-textarea fallback.

Live file-change updates for the current folder.

### Console

Shell tab bar: per-tab alive/dead status dot, name, close (confirmed), rename on long-press ⚠️, a trailing "New" tab, and a degraded-mode indicator when the shell has no real PTY ⚠️ *currently the literal string " (pipe)" appended to the name — design this properly*.

The terminal itself: xterm.js, full 16-color dark theme with an accent-colored cursor, 5000-line scrollback, scrollback replay when reopening a tab, fit-to-container on resize and orientation change.

**Quick key row** — this is the app's signature feature and deserves real design attention. It renders a user-editable, cross-device-synced list of keys with six kinds: raw key, **sticky Ctrl toggle** (visibly armed until the next keypress consumes it), `cd <path>`, multi-line script, send-to-Claude, and clipboard paste. Each key: tap to fire, long-press for remove/edit ⚠️. A trailing `+` opens a **key picker** with three tabs — a preset grid (Esc, Tab, Ctrl, arrows, `| ~ / \ " ' $ & * #`, Ctrl+C/D/L/R, Send to Claude, Paste), a `cd` path builder, and a script builder.

⚠️ Console's "Send to Claude" only copies to the clipboard and navigates, requiring a manual paste, while Sessions' equivalent threads the text through properly. Design them as one consistent action.

### Processes

Filter by name or PID. A sortable five-column grid (PID / name / CPU / memory / action) with click-to-sort headers, direction flipping, and CPU-descending default. Per-row Kill with a confirm naming the process. A 200-row render cap with a "showing first 200 of N" notice. Skeleton loading. Distinct empty states. Auto-refresh with a manual refresh control.

### System

Four stat cards (CPU, Memory, Disk aggregate, Uptime) with values, hints, and sparklines where history exists. A per-core grid with progress bars. A per-disk list with bars that turn danger-colored at ≥90%. A network card with instantaneous down/up rates, cumulative totals, and two stacked sparklines. A GPU card (rendered only when a GPU is present). A top-processes list with a link through to the Processes tab. A power card: Sleep / Restart / Shutdown / Cancel pending, each behind a confirm modal **with a password re-prompt** ⚠️ *"Cancel pending" shares the destructive treatment despite being harmless — differentiate it*. Live updates every 2.5s. Skeleton loading.

### Settings

Eleven sections in order: **Appearance** (theme segmented control, five accent swatches); **Notifications** (four toggles including one explicitly labeled "coming soon", a disk-threshold number input, and a push subsystem with per-device enable, a test button, and a live subscription list with per-row unsubscribe); **Pinned folders** (ordered list with reorder arrows disabled at the edges, remove, and an add row); **Sessions** (auto-trust toggle); **Session presets** (list with delete, empty state); **Files** (show-hidden toggle, path blocklist textarea with save) ⚠️ *saving it empty silently disables all path protection — "reset to defaults" must be a distinct, explicit action*; **Account** (change password, logout); **Maintenance** (explanatory copy ⚠️ *currently describes a flow that no longer exists* + repo path); **Keyboard shortcuts** reference table; **Backup** (export / import / reset to defaults); **About** (uptime, hostname, platform, version, and a "force refresh — clear cache" action).

### PWA

Installable with a standalone display mode, maskable icons, a themed splash, and app shortcuts (new session / files / console). An offline-capable service worker. Push notifications in four categories — session finished, **session asks for input** (sticky / requires interaction), session error, disk low — each deep-linking into the right tab.

---

## 5. Two new requirements the redesign must accommodate

The app is being ported to run on multiple machines simultaneously. Your design has to absorb both of these; they are not afterthoughts.

### 5.1 Machine identity — the most important new problem

The user will run Supervisor on a **Windows desktop** and a **Linux VPS**, and switch between them from one phone. Both instances render the same six tabs with the same controls.

**The user must never be able to confuse them.** Someone who kills the wrong process, deletes the wrong folder, or shuts down the wrong machine because two screens looked identical has been failed by the design.

Design a machine identity system:
- A machine switcher, reachable from anywhere, showing each registered machine with a label, platform, and live reachability status.
- **Persistent, unmissable, ambient identity** while you are on a machine — not a small label in a corner you'd have to look for. Consider per-machine accent color, but understand that accent is already user-configurable for theming, so think carefully about whether you're overloading one signal.
- A designed state for "this machine is unreachable" and for "you're not signed in to this machine yet."
- Push notifications must be attributable to a machine at a glance on the lock screen.

This is the highest-stakes design problem in the brief. Give it real thought and show your reasoning.

### 5.2 Capability-aware degraded states

Not every machine can do everything. A headless Linux VPS has no sleep state, no GPU, no window capture, and possibly no working PTY. The rule is: **nothing is hidden, everything is honest.** An unsupported feature renders as a disabled control with a one-line explanation of *why* — "Sleep unavailable — this host has no suspend state" — never as a silent absence and never as a control that fails when tapped.

Design the vocabulary for this: what a capability-disabled control looks like, how its explanation is surfaced without cluttering the screen, and how a **partially degraded** subsystem reads (the biggest real case: shells running without a PTY, which lose color, resize, and interactive prompt handling).

---

## 6. Design direction

You are not being handed a visual direction. That is your work. But here is the frame:

The app should feel like **a precise instrument for one person**, not a dashboard product. It's closer to a well-designed camera than to an admin console. The user opens it fifteen times a day for ten seconds each. It should be fast, quiet, confident, and never make him look twice to understand what he's seeing.

Some things worth resolving deliberately:

- **What is the app's visual voice?** The current one is dark, near-black, amber-accented, thin-bordered, developer-tool-adjacent. That's a reasonable default and a slightly generic one. Explore whether something more distinctive serves the app better — but justify it against the constraints in §2, particularly speed and density.
- **How does depth work?** You need a real elevation system covering: page surface, cards, sticky header, bottom sheets, modals (which stack), and toasts (which float above everything).
- **How does status read?** Running, exited cleanly, errored, killing, degraded, disconnected, unreachable. Seven states across sessions, shells, and machines. Design one coherent status language and use it everywhere rather than a badge here and a colored dot there.
- **How is live data expressed?** Everything in this app moves — logs stream, metrics tick every 2.5s, files change under you. Design how "this just updated" reads without becoming noisy. The current app mostly just replaces content silently.
- **What is the type system?** You need a UI face and a monospace face, and monospace carries an unusual amount of weight here (logs, terminal, paths, code, hex). Decide whether to load real fonts and defend the byte cost, or design properly against system stacks.
- **How does the layout adapt?** Mobile single column with a bottom tab bar → tablet → desktop with a left rail and, in Files' case, three columns. Define the breakpoints and what changes at each.

---

## 7. Deliverables

Produce these in order. Show your work between steps rather than emitting everything at once.

1. **`docs/design/DIRECTION.md`** — the visual direction, argued. What the app should feel like, what you're changing from the current design and why, what you're keeping and why. Include at least one alternative direction you considered and rejected, with the reason.

2. **`docs/design/SYSTEM.md`** — the full design system as a specification:
   - Color: surfaces, borders, text hierarchy, five accent families, semantic colors (success/warning/danger/info), all defined for **both** dark and light themes, as CSS custom properties. Include contrast ratios for every text-on-surface pair; nothing primary below 4.5:1.
   - Type scale, weights, line heights, both faces.
   - Spacing scale, radii, border weights.
   - **Elevation scale** — the thing that doesn't exist today.
   - Motion: durations, easings, and an explicit list of what animates and what deliberately doesn't. Honor `prefers-reduced-motion`.
   - Iconography rules.
   - The status language from §6.
   - xterm and CodeMirror theme mappings derived from the same tokens.

3. **A working static prototype**, as self-contained HTML files with inlined CSS (no build step, no framework, no CDN — the app has none of these and neither should your prototype). Cover, at minimum: all six tabs at 390px **and** at 1440px; the session detail modal with a live-looking log; the Files three-column desktop layout and its mobile sheet behavior; the console with the quick-key row and an armed Ctrl state; the machine switcher and a machine-unreachable state; a capability-disabled control; the full component library on one page; both themes; at least two accents. Use realistic data — real-looking paths, real-looking log output, real process names. Placeholder lorem will hide exactly the problems this app has.

4. **`docs/design/IMPLEMENTATION.md`** — how to get from the current `web/` to this design: which CSS custom properties change, which components need restructuring versus restyling, what order to do it in, and what can ship incrementally. The current frontend is vanilla JS with no build step and that constraint stays unless you make an explicit, argued case otherwise.

5. **A completed §4 checklist** with every item marked as: preserved as-is / redesigned (with a note on what changed) / fixed (for ⚠️ items) — and nothing unaccounted for.

---

## 8. How you'll be judged

- **Nothing was lost.** The §4 checklist is complete and honest.
- **The Files screen is no longer the worst screen in the app.**
- **You cannot confuse two machines.** Not at a glance, not while distracted, not on a lock-screen notification.
- **Every ⚠️ is resolved** by a deliberate decision, not quietly reproduced.
- **It's fast.** No webfont you can't defend, no framework, no animation that costs a frame on a phone.
- **It's accessible.** Focus is visible and trapped in dialogs and returned on close. Icon-only controls are labeled. Every long-press has a keyboard and pointer alternative. Nothing is conveyed by color alone.
- **It's opinionated.** A redesign that just applies more padding and rounder corners to the existing layout is a failure. Bring an actual point of view — and argue for it.

Where this brief and the existing app disagree about how something works, check the app. Where you disagree with this brief, say so before you design around it.
