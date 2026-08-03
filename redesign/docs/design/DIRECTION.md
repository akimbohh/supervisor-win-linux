# Supervisor — Design Direction

*Deliverable 1 of the redesign brief. The argued visual direction. Read before SYSTEM.md.*

---

## What the app should feel like

**A precise instrument for one person.** The brief's camera analogy is right, and it implies three properties the current design only partially has:

1. **Instant legibility.** The dominant use is a ten-second glance: unlock, look at one status, lock. Every screen must answer "is everything fine?" before the user consciously reads anything.
2. **Calm density.** More on screen, less scrolling — but organized so density reads as *capability*, not clutter. Hierarchy and grouping do the work whitespace can't afford to.
3. **Zero ceremony.** No decorative animation, no onboarding varnish, no marketing surface. Chrome exists to frame content and disappear.

The direction name is **Instrument**: a near-black neutral field, hairline structure, a single loaded monospace that carries the app's voice, and a status language loud enough to read from arm's length.

---

## What changes from the current design, and why

### 1. Neutral surfaces replace tinted ones
The current dark theme leans slightly blue (`#13141a` → `#21222a`). Under five user-selectable accents, a blue-leaning base flatters blue/purple and fights amber/rose. The new surface ladder is **pure neutral** (equal-RGB grays via oklch, zero hue), so every accent sits on the same ground and the *machine hue* (see below) is never contaminated by a base tint. Light theme keeps the current warm-paper instinct — off-white, not inverted gray.

### 2. A real elevation system
Today depth is border-color shifts plus one hardcoded toast shadow. The new system defines five levels — page, raised (cards), sticky (header/tabbar), overlay (sheets/modals, which stack), floating (toasts) — each a **pair**: surface step + shadow recipe, identical semantics in both themes (light uses shadow more, dark uses surface step more). Specified fully in SYSTEM.md.

### 3. One loaded monospace; UI stays system
The current CSS names Inter and JetBrains Mono and loads neither. Decision:

- **UI face: system stack** (`-apple-system … Segoe UI`). The UI face appears in labels and buttons — places where system fonts are indistinguishable from a loaded grotesque. Cost of loading one: ~100 KB and a flash on cellular. Not defensible.
- **Mono face: load IBM Plex Mono** (regular + semibold, latin subset, woff2, ~55 KB total, `font-display: swap`, cached by the service worker after first load). The mono is where the app *lives* — logs, terminal, paths, hex, code, PIDs, metrics. It is the single highest-leverage place to spend bytes, and system monos differ wildly across the app's real platforms (SF Mono vs Cascadia vs whatever the VPS browser has). One face makes logs read identically on every device and gives the app its voice. This is the app's entire webfont budget.

### 4. A single status language
Seven states — running, done, error, **killing**, degraded, disconnected, unreachable — currently render as an assortment of badges, dots, and the literal string ` (pipe)`. The new language: every status is a **glyph + color + word**, never color alone.

- `▶ running` (accent-independent green), `■ done` (neutral), `✕ error` (red), `◌ killing` (amber, animated spin — the missing state), `�③ degraded` (amber outline), `⌀ disconnected` (gray strikethrough), `〰 unreachable` (gray wave).
- Glyphs are drawn as 1.5px-stroke icons in the existing Lucide idiom, not literal unicode.
- The same seven tokens style session badges, shell tab indicators, machine rows, and the connection pill. One vocabulary, used everywhere.

Status glyphs are deliberately **oversized relative to current badges** (16px glyph in a 24px chip) — this is what makes the ten-second glance work.

### 5. Machine identity: texture, name, and hue — three redundant channels
The highest-stakes problem. Per-machine accent alone fails because accent is already user-configurable theming — overloading it means "my amber desktop" breaks the day the user picks amber for the VPS. The design uses three channels, none of which is the user's accent:

1. **Texture (primary, per your instinct).** Each machine gets a distinct background pattern rendered as ultra-low-contrast CSS on the page surface and at full contrast in the header identity block: **dot-grid** for one machine, **corner-bracket grid** for the other (patterns are assignable; two more exist for future machines). Texture is visible on every screen, ambient, and costs zero bytes (CSS gradients).
2. **Name, always.** The header carries a persistent machine block — pattern swatch + hostname + platform glyph (Windows/Linux) — sized as the second-largest thing in the header. Notifications are prefixed `[hostname]` so lock-screen attribution is instant.
3. **Machine hue (secondary).** Each machine has a fixed identity hue used *only* in the identity block, the switcher, and the texture tint — never for buttons or links, so it cannot collide with the user accent.

Destructive confirmations (kill, delete, power) repeat the machine identity inside the confirm modal: "Shut down **thinkpad-vps** (Linux)?" with the pattern swatch. You cannot power off the wrong machine without reading its name twice.

Unreachable and not-signed-in machines get designed full-page states in the switcher's visual language, not error toasts.

### 6. Capability honesty as a component
A capability-disabled control is a first-class component: the control rendered at rest opacity with a **`⌀` capability glyph** replacing its icon, plus a one-line reason in the caption slot ("Sleep unavailable — this host has no suspend state"). Partially degraded subsystems (pipe shells) get a persistent, worded chip in their container header — `◌ degraded · no PTY: no color, no resize` — replacing the ` (pipe)` string.

### 7. Files rebuilt around one bar
The Files toolbar failure is solved structurally, not cosmetically: **one 44px bar** holding breadcrumb (collapsing to `…/parent/current`), a search-expands-in-place button, and a single `＋` and `⋯`. Sort, view toggle, locations, and upload move into the `⋯` sheet and the sidebar sheet. Every "add a thing" in the app becomes the same pattern: a `＋` button opening a menu/sheet — Files, presets, quick keys, pinned folders, shells all use it.

### 8. Long-press becomes a shortcut, never the only path
Everything long-press-only today (preset edit, quick-key edit, tab rename) gains a visible path: row/chip `⋯` overflow reachable by tap and keyboard. Long-press stays as the power-user accelerator.

---

## What stays, and why

- **Dark-first, hairline borders, thin-stroke icons.** These are correct for a developer instrument; the ~90 Lucide-derived icons are kept as-is.
- **Bottom tab bar / left rail split at 768px.** Proven; the rail's dead `.rail-collapsed` variant is deleted.
- **The five accents** (amber default, teal, purple, blue, rose), rebuilt as oklch ramps so all five pass contrast on the new surfaces.
- **Sub-200KB, no framework, no build step.** The prototype is plain HTML/CSS/JS and the implementation plan keeps vanilla JS.
- **`web.new/` ideas worth keeping:** the live-bars running animation (as part of the new status language) and the density control (as a Settings option). The aurora background is dropped — it competes with machine texture, the one background channel that carries meaning.

---

## Alternative considered and rejected

**"Terminal brutalism"** — an all-mono, flat, no-radius direction where the whole UI adopts the terminal's aesthetic (mono UI face, square corners, ASCII-adjacent chrome). Attractive for this audience and genuinely distinctive. Rejected because it fails constraint §2.8: an all-mono UI flattens hierarchy exactly where this app needs it most — at a glance, everything reads at the same temperature, and status stops popping. It also fights rather than frames xterm and CodeMirror: when everything looks like a terminal, the actual terminal loses its figure-ground. The chosen direction keeps the proportional/mono contrast as the primary hierarchy tool.

A second candidate — per-machine accent as the identity channel — was rejected for the overload reason argued in §5.

---

## Direction summary for SYSTEM.md

| Axis | Decision |
|---|---|
| Surfaces | Pure-neutral oklch ladder, dark-first; warm-paper light theme |
| Elevation | 5 levels, surface+shadow pairs, theme-symmetric semantics |
| Type | System UI stack + loaded IBM Plex Mono (2 weights, subset) |
| Accents | 5 user accents as oklch ramps, contrast-verified |
| Status | 7-state glyph+color+word language, used everywhere |
| Machine identity | Texture (primary) + persistent name block + machine hue (secondary) |
| Capability | Disabled-with-reason component + degraded chip |
| Motion | transform/opacity only, 100–200ms, reduced-motion honored |
| Weight | No UI webfont, one mono, no framework, CSS textures |
