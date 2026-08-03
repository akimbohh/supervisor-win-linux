# Supervisor Redesign — §4 Checklist Accounting

*Deliverable 5. Every item from the brief's §4 contract, marked **preserved** (as-is in concept, restyled), **redesigned** (structure or reach changed — with note), or **fixed** (a ⚠️ item resolved by decision). "Prototype:" names where to see it; items without a live demo are specified in SYSTEM.md/IMPLEMENTATION.md and noted.*

## Global shell
- Header identity → **redesigned**: machine chip (pattern + hostname + platform) replaces the static logo; app title beside it. Prototype: every page.
- WS indicator + latency thresholds → **preserved** as the unified `.conn` pill (4 states). Prototype: components.html.
- Restart banner ⚠️ no trigger → **fixed**: wired to the restart POST via the existing sessionStorage flag (IMPLEMENTATION §5.3); pending/ready styles kept in tokens.
- Six-destination nav, tab bar / rail at 768px → **preserved**. Prototype: resize any page.
- Hash routing + deep links → **preserved** (plan §4; prototype uses per-page files, routing unchanged in the real app).
- Keyboard shortcuts `?`, `g`-chords, Esc, Ctrl+S → **preserved**; `?` and `g` work in the prototype.
- Theme/accent via `data-theme`/`data-accent` → **preserved**; live in prototype Settings.
- Global error surfacing → **preserved** (toast error kind).
- "Request a change" maintenance modal → **preserved**, copy rewritten to describe the real flow (⚠️ Settings copy fixed). Prototype: `?` key or help button.
- Login page (show/hide, trust-60-days, `?next=`) → **redesigned** into the per-machine sign-in modal + standalone login (same fields); prototype: machine switcher → mira.

## Components
- Toast (4 kinds, persistent variant, stacking, aria-live) → **preserved**. Prototype: components.html.
- Modal (stack-aware, Esc-topmost, 3 sizes, dismissible flag) → **preserved** + **fixed** ⚠️: role=dialog, aria-modal, focus trap, focus return. Prototype: "Stacked modals".
- Sheet (grab handle, safe-area) → **preserved**.
- Sparkline → **preserved**. Prototype: system.html.
- Empty state (+ mono stack-trace variant) → **preserved**; mono variant spec'd (SYSTEM type tokens).
- Skeleton → **preserved**.
- Confirm/Prompt modals → **redesigned**: confirm gains the machine-identity block for destructive actions.
- Long-press ⚠️ → **fixed**: kept as accelerator; every target gains a visible kebab/⋯ and right-click path. Prototype: quick keys, presets, shell tabs.
- Pull-to-refresh ⚠️ never wired → **fixed by decision**: wire in Files + Processes only (plan §5.3).
- ~90 Lucide icons → **preserved**; 7 status glyphs added in the same idiom.
- Buttons (all variants) / form fields / toggles / checkboxes / cards / badges / list rows / kbd pills → **preserved**, retokened. Prototype: components.html.

## Sessions
- Search, All/Running/Exited filter, group-by persisted → **preserved**.
- Preset chips ⚠️ long-press-edit → **fixed**: chip = launch + visible kebab = edit; add-preset uses the universal `＋` pattern.
- Card contents (status/name/folder/tag/ticking duration/3-line preview/actions) → **preserved**; ⚠️ missing "killing" state → **fixed** (chip + disabled Kill). Prototype: sessions.html card 3.
- Remove copy live-vs-dead, Clear exited, group headers, two empty states → **preserved** (empty states: components.html).
- Session detail (status/folder/started; search count + prev/next wrap-to-center; auto-scroll pause >30px + resume; stdin only-while-running; Copy log; Send to Claude; Kill/Restart; streaming) → **preserved**, log viewport **redesigned** as a designed reading surface (resume pill, centered match). Prototype: sessions.html → any card.
- New Session modal (folder picker layered modal, 3-way command mode, pre-prompt, env vars, save-as-preset) → **preserved**. Prototype: "New session" → Browse.
- Preset edit modal → **preserved**.

## Files
- 3-column desktop / sheets mobile → **preserved**. Prototype: files.html at 1440 vs 390.
- Breadcrumbs (Win+POSIX) → **preserved**, middle-collapse added.
- Fuzzy filter → **preserved** (expand-in-place search). Sort modal per-folder → **preserved** (sheet). List/grid persisted + thumbnails → **preserved** (grid in ⋯; thumbnails spec'd).
- Create menu / upload progress toast / folder menu → **preserved**, all behind the unified `＋` and `⋯` (⚠️ toolbar crowding → **fixed**: one 44px bar).
- Sidebar (locations, pinned+unpin, 8 recents, trash) → **preserved**.
- Multi-select (long-press or Ctrl/Cmd+click), selection bar (Cut/Copy/Move/Zip/Download/Rename/Delete/Paste/Cancel) → **preserved**; ⚠️ Rename-first-item-only → **fixed**: disabled with reason when >1 selected.
- Clipboard bar (Cut:N / Copied:N, paste-clears-cut) → **preserved**. Prototype: select → Copy.
- Trash modal (restore, delete-forever, empty) → **preserved**. Prototype: sidebar → Trash.
- Preview kinds (image/audio/video/PDF+truncation/zip/Markdown 3-tab/text/binary hex) + shared file toolbar → **preserved**; ⚠️ Markdown XSS → **fixed by requirement**: escaped renderer (plan §3.6). Prototype shows md/code/text/image kinds.
- CodeMirror editor (line numbers, Ctrl+S, find, wrap toggle, unsaved badge, textarea fallback) → **preserved**, theme retokened (SYSTEM §8).
- Live file-change updates → **preserved**.

## Console
- Tab bar (status dot, name, confirmed close, trailing New) → **preserved**; ⚠️ rename long-press-only → **fixed**: visible rename affordance on tab; ⚠️ " (pipe)" → **fixed**: degraded chip + strip with worded reason + "Why?" explainer. Prototype: console.html tab 2.
- xterm 16-color theme, scrollback, replay, fit → **preserved** (token mapping SYSTEM §8; prototype terminal is a mock per no-vendor constraint).
- Quick key row, 6 kinds, sticky-Ctrl visibly armed, trailing `＋` picker (3 tabs) → **preserved** + armed state **redesigned** (fill + pulse). ⚠️ long-press-only edit → **fixed** (kebab menu + right-click).
- ⚠️ Console vs Sessions Send-to-Claude divergence → **fixed**: one `sendToClaude()` threads text properly from both (plan §4.3).

## Processes
- Filter, sortable 5-col grid (CPU-desc default), kill-with-named-confirm, 200-row cap notice, skeleton, empty states, auto+manual refresh → all **preserved**. Prototype: processes.html.

## System
- 4 stat cards + sparklines, per-core grid, disks (danger ≥90%), network rates+totals+2 sparklines, GPU-when-present, top-procs link → **preserved**. Prototype: system.html.
- Power with password re-prompt → **preserved** + machine identity repeated in the confirm; ⚠️ Cancel-pending treated as destructive → **fixed**: ghost button, disabled until something is pending.
- 2.5s live updates, skeletons → **preserved**.

## Settings
- All eleven sections → **preserved** in order; notifications "coming soon" toggle **redesigned** as capability-disabled pattern.
- ⚠️ empty blocklist silently disarms → **fixed**: inline warning + explicit "Reset to defaults" as a separate action. Prototype: settings.html (clear the textarea).
- ⚠️ Maintenance copy describes dead flow → **fixed**: rewritten to the real hand-off.
- Push (per-device enable/test/list/unsubscribe), pinned reorder w/ edge-disabled arrows, auto-trust, presets list, account, shortcuts table, backup, about + force-refresh → **preserved**. Prototype: settings.html.

## PWA
- Installable, maskable icons, splash, shortcuts, offline SW → **preserved** (unchanged mechanics; icon regenerated per machine? — no: one app icon, machine identity is in-app + notification prefix).
- Push categories ×4, deep links, sticky ask-input → **preserved**; **redesigned**: titles prefixed `[hostname]` for lock-screen attribution (§5.1 requirement).

## §5 New requirements
- Machine switcher, ambient identity, unreachable + not-signed-in states, notification attribution → **built**: texture + name + hue, three redundant channels (DIRECTION §5). Prototype: machine chip on every page.
- Capability-aware degraded states → **built**: capability-disabled control with reason, degraded chip long-form. Prototype: system.html power card, console.html.

**Nothing from §4 is deleted.** Items not live in the static prototype (audio/video/PDF/zip previews, real xterm/CodeMirror, push flows) are constrained out by the no-vendor-library rule and covered by SYSTEM §8 + IMPLEMENTATION phases.
