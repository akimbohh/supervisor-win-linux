# Supervisor — Design System Specification

*Deliverable 2. Token names are the CSS custom properties the implementation uses. Dark theme is the root; light theme overrides under `[data-theme="light"]` (and `auto` via media query). Machine hue and user accent are independent axes: `data-accent` on `<html>`, `data-machine` on the identity scope.*

---

## 1. Color

### 1.1 Surfaces & structure — dark (root)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a0a` | Page field (machine texture renders on this) |
| `--surface-1` | `#141414` | Cards, inputs, list containers |
| `--surface-2` | `#1c1c1c` | Nested surfaces, chips, hover fills |
| `--surface-3` | `#242424` | Pressed / active fills, skeleton base |
| `--overlay` | `#181818` | Sheets and modals (own step, above surface-1) |
| `--border` | `#2a2a2a` | Default hairline |
| `--border-soft` | `#1f1f1f` | Row separators |
| `--border-strong` | `#3a3a3a` | Focus-adjacent, hover borders |
| `--scrim` | `rgb(0 0 0 / 0.6)` | Modal/sheet backdrop |

All grays are equal-RGB (zero hue) — see DIRECTION.md §"neutral surfaces".

### 1.2 Text — dark

| Token | Value | On `--bg` | On `--surface-1` | On `--surface-2` | Role |
|---|---|---|---|---|---|
| `--text` | `#ededed` | 16.7:1 | 14.9:1 | 13.4:1 | Primary |
| `--text-2` | `#a6a6a6` | 8.4:1 | 7.5:1 | 6.7:1 | Secondary |
| `--text-3` | `#787878` | 4.7:1 | 4.2:1 | 3.8:1 | Tertiary — captions, hints only; never primary content, never below 14px |
| `--text-4` | `#4a4a4a` | 2.1:1 | — | — | Decorative only (grab handles, disabled glyphs) |

Primary and secondary text pass 4.5:1 on every surface. `--text-3` passes 4.5:1 only on `--bg`; it is restricted to supplementary text and is never the sole carrier of information.

### 1.3 Surfaces & text — light (`[data-theme="light"]`)

Warm paper, kept from the current design's instinct.

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--bg` | `#faf9f5` | | `--text` | `#171717` (15.6:1 on bg) |
| `--surface-1` | `#ffffff` | | `--text-2` | `#565452` (7.5:1) |
| `--surface-2` | `#f2f0ea` | | `--text-3` | `#88857f` (3.9:1 — same restriction) |
| `--surface-3` | `#e8e5dd` | | `--text-4` | `#c2bfb8` |
| `--overlay` | `#ffffff` | | `--border` | `#dedbd3` |
| `--scrim` | `rgb(30 28 20 / 0.4)` | | `--border-soft` / `--border-strong` | `#e8e5dd` / `#c4c1b9` |

### 1.4 Accent families (user-selectable, `data-accent`)

Each family defines four tokens. `--accent` is the fill for primary actions; `--accent-text` is the accent used *as text/icon color on surfaces* (darkened until ≥4.5:1 on `--surface-1` in light theme, brightened in dark); `--accent-on` is text on an accent fill; `--accent-soft` is a 14%-alpha wash.

| Family | dark `--accent` | dark `--accent-text` | light `--accent` | light `--accent-text` | `--accent-on` |
|---|---|---|---|---|---|
| amber (default) | `#f5a623` | `#f5b445` (8.9:1 on s1) | `#b06000` | `#8a4c00` (4.9:1) | dark: `#201302` / light: `#fff` |
| teal | `#2dd4bf` | `#4adec9` (10.2:1) | `#0f766e` | `#0d6a63` (5.1:1) | `#02201c` / `#fff` |
| purple | `#a78bfa` | `#b7a2fb` (7.6:1) | `#6d4fd8` | `#5f42c4` (5.6:1) | `#170f33` / `#fff` |
| blue | `#5ea8ff` | `#78b6ff` (8.3:1) | `#175fcc` | `#1355b8` (5.9:1) | `#061731` / `#fff` |
| rose | `#fb7185` | `#fc8a9b` (7.4:1) | `#c22047` | `#ad1c3f` (5.7:1) | `#310711` / `#fff` |

Rule: components use `--accent` only for fills and the focus ring; any accent-colored *text or icon on a surface* uses `--accent-text`. This is what makes all five families safe on both themes.

### 1.5 Semantic colors

| Token | dark | light | Used for |
|---|---|---|---|
| `--ok` / `--ok-soft` | `#4ade80` / 12% | `#15803d` / 10% | running, connected, success |
| `--warn` / `--warn-soft` | `#fbbf24` / 12% | `#a16207` / 10% | killing, degraded, latency-amber |
| `--danger` / `--danger-soft` | `#f87171` / 12% | `#b91c1c` / 10% | error, destructive, disk ≥90% |
| `--info` / `--info-soft` | `#7dd3fc` / 12% | `#0369a1` / 10% | info toasts, neutral emphasis |

All four pass ≥4.5:1 as text on `--surface-1` in their theme. Semantic colors are fixed — they do not shift with accent or machine hue.

### 1.6 Machine identity (`data-machine` scope)

| Token | Purpose |
|---|---|
| `--machine-hue` | One fixed hue per machine (e.g. desktop `210`, VPS `140`); used only via the two tokens below |
| `--machine-ink` | `oklch(0.78 0.09 var(--machine-hue))` dark / `oklch(0.45 0.09 h)` light — identity block text/border |
| `--machine-wash` | `oklch(0.30 0.04 h / 0.35)` — texture tint |
| `--machine-pattern` | CSS background-image pair: `dots` \| `brackets` \| `grid` \| `diag` |

Patterns (all pure CSS, zero assets):
- **dots**: `radial-gradient(var(--machine-wash) 1px, transparent 1px)` on a 22px grid
- **brackets**: two `linear-gradient` corner strokes repeated on a 28px grid
- **grid**: 1px hairline grid, 32px
- **diag**: 45° hairline stripes, 14px period

On `--bg` the pattern renders at ~4% perceived contrast (ambient); in the header identity block and machine switcher rows it renders at full `--machine-ink` contrast.

---

## 2. Type

| Token | Stack |
|---|---|
| `--font` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` |
| `--mono` | `'IBM Plex Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace` |

IBM Plex Mono loaded as woff2, latin subset, weights 400 + 600, `font-display: swap` (system mono is an acceptable flash fallback). Total ≤ 60 KB, SW-cached.

Scale (px / line-height / weight):

| Token | Size | LH | Weight | Use |
|---|---|---|---|---|
| `--type-title` | 18 | 1.3 | 650 | View titles |
| `--type-heading` | 15 | 1.4 | 600 | Modal titles, card headings |
| `--type-body` | 14 | 1.45 | 400 | Default |
| `--type-label` | 13 | 1.4 | 500 | Buttons, tabs, field labels |
| `--type-caption` | 12 | 1.4 | 400 | Help text, meta |
| `--type-micro` | 11 | 1.3 | 600 | Section titles (uppercase, +0.05em), badges |
| `--type-mono` | 13 | 1.55 | 400 | Logs, code, terminal |
| `--type-mono-sm` | 12 | 1.5 | 400 | Paths, hex, PIDs |
| `--type-metric` | 22 | 1.2 | 600 | Stat card values (tabular-nums) |

All numerals in metrics, tables, durations, and sizes use `font-variant-numeric: tabular-nums`.

---

## 3. Spacing, radii, borders

- **Spacing scale**: 2, 4, 6, 8, 12, 16, 20, 24, 32 (`--sp-05`…`--sp-8`). Component-internal gaps come from 4/6/8; section rhythm from 12/16/24.
- **Density**: `data-density="dense"` multiplies vertical paddings by 0.8 (a Settings option, kept from web.new).
- **Radii**: `--r-sm: 6px` (chips, inputs), `--r: 8px` (buttons, rows), `--r-lg: 12px` (cards, modals), `--r-xl: 16px` (sheets top corners), `--r-pill: 999px`.
- **Borders**: 1px everywhere; 1.5px only for icon strokes and checkbox boxes. No 2px+ decorative borders.
- **Touch**: every primary interactive target ≥44×44px. Icon-only buttons are 44px on touch (`@media (pointer: coarse)`), 36px on desktop.

---

## 4. Elevation

Five levels. Each is a surface + shadow pair; dark theme leans on surface steps, light on shadows. Z-index bands are fixed.

| Level | Surface | Shadow (dark) | Shadow (light) | z | Used by |
|---|---|---|---|---|---|
| 0 page | `--bg` + machine pattern | none | none | 0 | Page field |
| 1 raised | `--surface-1` + `--border` | none | `0 1px 2px rgb(30 28 20/.06)` | 0 | Cards, inputs, list containers |
| 2 sticky | `--bg` @ 85% + blur(12px), border edge | `0 1px 0 var(--border)` | same | 40 | Header, tab bar, selection bar |
| 3 overlay | `--overlay` + `--border` | `0 12px 32px rgb(0 0 0/.5)` | `0 12px 32px rgb(30 28 20/.18)` | 60+ | Sheets, modals — stacked modals add +2 z and a darkened scrim each |
| 4 floating | `--surface-2` + `--border-strong` | `0 8px 24px rgb(0 0 0/.45)` | `0 8px 24px rgb(30 28 20/.16)` | 100 | Toasts, restart banner |

Rule: shadows never carry meaning alone; every elevated surface also has its border. Nothing uses ad-hoc `box-shadow`.

---

## 5. Motion

- **Durations**: `--t-fast: 90ms` (press feedback), `--t: 150ms` (hover, fades), `--t-slow: 220ms` (sheets, modals).
- **Easings**: `--ease: cubic-bezier(.4,0,.2,1)`; sheets enter with `cubic-bezier(.32,.72,.24,1)`.
- **Animates**: modal/sheet enter-exit (transform+opacity), toast enter, tab underline, toggle knob, status "running" bars, killing spinner, skeleton shimmer, armed-Ctrl pulse.
- **Deliberately does not animate**: list reflow, metric value changes (values swap instantly — a 2.5s tick must not shimmer), log appends, theme/accent switches, layout at breakpoints.
- **Live-update grammar**: new data replaces content instantly; the only "this moved" cue is the sparkline itself and a 300ms `--surface-2` flash on a row whose *status* (not value) changed.
- `prefers-reduced-motion`: all durations → 1ms; running-bars and killing-spinner swap to static glyphs; skeleton becomes a static fill.

---

## 6. Iconography

Existing set kept: Lucide-derived, 24×24 viewBox, 1.5px stroke, round caps, `currentColor`, rendered 16–20px. Rules:
- Every icon-only control carries `aria-label` (not `title` alone).
- Icons never appear without either a text label or an `aria-label` + tooltip.
- New glyphs required by this system (status set below, platform marks, capability `⌀`) are drawn in the same idiom.

---

## 7. Status language

One vocabulary for sessions, shells, machines, and the connection pill. Always **glyph + color + word** (color never alone). The chip: 24px height, glyph 16px, `--type-micro` word, `--r-pill`, soft background of its semantic color.

| State | Glyph | Color | Motion |
|---|---|---|---|
| running | triangle-right / live-bars variant on session cards | `--ok` | bars animate (reduced-motion: static) |
| done | square | neutral (`--text-2`) | none |
| error | ✕ | `--danger` | none |
| killing | dashed circle | `--warn` | 1.2s spin |
| degraded | triangle-alert outline | `--warn` | none |
| disconnected | slashed circle | `--text-3` on `--surface-2` | none |
| unreachable | broken-wave | `--text-3` on `--surface-2` | none |

Connection pill states: `● 42ms` ok / amber 100–300ms / red >300ms / `⌀ stale`. Degraded chip long-form (shell header): `degraded · no PTY — no color, resize, or prompts`.

**Capability-disabled control**: the control at 55% opacity, its icon replaced by `⌀`, `aria-disabled`, and a one-line `--type-caption` reason beneath (or in its tooltip + sheet row subtitle when space-constrained). Never hidden, never a dead tap.

---

## 8. Third-party surface themes

Both derive from tokens; containers are level-1 surfaces with a designed header row (never bare embeds).

### xterm.js
`background: --bg`, `foreground: --text`, `cursor/cursorAccent: --accent / --accent-on`, `selectionBackground: --accent @25%`. ANSI 16: black `#1c1c1c`, red `#f87171`, green `#4ade80`, yellow `#fbbf24`, blue `#5ea8ff`, magenta `#a78bfa`, cyan `#2dd4bf`, white `#a6a6a6`; brights: `#3a3a3a`, `#fca5a5`, `#86efac`, `#fde047`, `#93c5fd`, `#c4b5fd`, `#5eead4`, `#ededed`. Light theme maps to the light semantic set with `background: #faf9f5`.

### CodeMirror 5
Gutter `--surface-2` / text `--text-3`; active line `--surface-2`; cursor `--accent`; selection `--accent-soft`; matching bracket `--accent-text`; syntax: keywords `--accent-text`, strings `--ok` (dark) / `#15803d` (light), comments `--text-3` italic, numbers `--warn`, defs `--info`. Same mapping file emits both themes.

---

## 9. Token diff vs current `web/styles.css`

New: `--overlay`, `--scrim`, `--accent-text`, `--ok*`, elevation shadow tokens, `--machine-*`, type scale tokens, `--sp-*`.
Changed: all surface/border/text values (neutralized), accent families (ramps with `--accent-text`), `--danger` (brightened for dark-theme text use).
Removed: `--rail-collapsed-w` (dead), `--accent-dim` (replaced by ramp), ad-hoc density utility classes in favor of the scale.
