# Next request — Liquid-glass buttons (see-through, gradient-themed)

Paste this whole thing into a fresh Claude Code session (or the Maintenance tool) on the supervisor repo.

---

You are working on **Supervisor** (this repo). Read `CLAUDE.md` first. I want every button in the app to look like **liquid glass** — translucent, so you can see the content behind it through a frosted blur, with a soft gradient tint and a glossy edge highlight. Reference for the look and technique: https://github.com/samasante/liquid-glass (Apple-style "Liquid Glass"). A **read-only copy of that library is vendored in this repo at `reference/liquid-glass/`** — read `reference/liquid-glass/PROVENANCE.md` first, then its `src/displacement.ts`, `src/GlassMaterial.tsx`, and `BROWSERS.md` to see how the frost / tint / specular-edge / displacement layers are built before you write any CSS.

**Do NOT install that library.** It's React with a build step; our `web/` is vanilla JS, no framework, no bundler, and a strict CSP. You are copying the *technique*, adapted to our constraints. Ship it as CSS (+ one static inline SVG filter), nothing else.

## Hard constraints — read before writing a line

- **CSP is strict** (`server/server.js`): `script-src 'self'`, `style-src 'self' 'unsafe-inline'`. So: no inline `<script>`, no JS-driven effects, no external libs. An inline `<svg><defs><filter></filter></defs></svg>` block in `index.html` is **markup, not script** → allowed. All the glass lives in `web/styles.css`.
- **Primary device is an iPhone PWA (WebKit).** On iOS/Safari, `backdrop-filter: url(#svgfilter)` for bending the *live* page does **not** work — only frost + tint do. So the real see-through effect must come from `-webkit-backdrop-filter: blur() saturate()` (iOS supports this with the `-webkit-` prefix — always include it). The SVG `feDisplacementMap` refraction (chromatic edge distortion) is a **Chrome/Edge-only progressive enhancement**: gate it behind `@supports` and make sure iOS looks great without it.
- **Legibility is non-negotiable.** Buttons sit over dark, light, and busy backgrounds (terminal text, file lists, diffs). Text and icons must stay clearly readable on every button in every theme. If a translucent button ever fails contrast, fall back to a more opaque tint for that button — don't ship anything you can't read.
- **Fallback when blur is unsupported or the user opts out.** Wrap the glass in `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`; without support, buttons keep today's solid look. Also honor `@media (prefers-reduced-transparency: reduce)` → solid, and keep `prefers-reduced-motion` clean (no animated sheen for those users).
- **Theme-aware.** Works in both the dark `:root` theme and the warm-paper light theme. Glass over a light background needs a light-tinted frost + dark text; over dark, a dark-tinted frost + light text. Drive it from the existing tokens (`--surface-*`, `--accent`, `--border`, `--text*`), don't hardcode colors.

## What "liquid glass" means here (the recipe)

For a glass button, layer these:
1. **Translucent frosted base** — a semi-transparent background (e.g. `rgb(255 255 255 / 0.06)` dark, `rgb(255 255 255 / 0.55)` light) plus `backdrop-filter: blur(12px) saturate(140%)` **and** the `-webkit-` twin. This is the "see through the glass" part.
2. **Gradient tint** — a subtle top-to-bottom gradient overlay so it reads as a curved glass slab, not a flat panel (lighter at the top edge, darker at the bottom). Primary/accent buttons tint the gradient toward `--accent`; danger toward `--danger`.
3. **Edge highlight (the gloss)** — a bright 1px inner top border / inset highlight (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25)`) plus a soft outer drop shadow for lift. This is what sells "glass."
4. **Optional refraction (Chrome only)** — behind `@supports`, apply the inline SVG displacement `filter` for a faint chromatic edge bend. Must be subtle and must no-op cleanly on WebKit.

Add a reusable token block near `:root`, e.g. `--glass-bg`, `--glass-bg-strong`, `--glass-blur`, `--glass-highlight`, `--glass-border`, `--glass-shadow`, with light-theme overrides, so every button pulls from the same source and you can tune the whole app from one place.

## Where to apply it (hit all of these, retheme centrally — don't copy-paste per button)

The button system is centralized on `.btn` (`styles.css:317`) with variants `.primary`, `.ghost`, `.danger`, `.icon`, `.sm`, `.btn-group`. Reskin `.btn` and its variants once. Then extend the same glass to the other button-like surfaces:
- **Composer**: `.chat-send` (and `.chat-send.stop`), `.chat-plus`, `.chat-chip` (folder / mode / add-dir chips).
- **Header**: `.btn.ghost.icon` slots (`#refresh-btn`, `#help-btn`, `#header-action-1/2`).
- **Tab bar**: `.tabbar a` — glass the active/pressed state at least; keep it readable and don't fight the safe-area.
- **Console**: `.kbd-row` keys (`.key`) and the `.term-jump` pill.
- **ToolCard** (`web/components/toolcard.js` renders these; style in `styles.css`): its action buttons / `.tc-*` controls and any sheet buttons.
- **Modals / sheets / toasts**: primary/secondary buttons inside them.

Keep the existing interaction feel: `:active { transform: scale(0.98) }` (0.94 on the send button), `:disabled` dimming, the accent emphasis on `.primary`, and the danger styling. Don't change layout, sizes, radii, or hit targets — this is a **skin**, not a restructure.

## Performance

`backdrop-filter` is GPU-cheap for a few elements but gets expensive when many are on screen or animating at once (the tab bar + composer + a list of chips + a terminal repaint). Keep blur radius modest (≈10–14px), avoid stacking backdrop-filters inside other backdrop-filters, and don't animate the blur. If the console/terminal repaint stutters on device, make the terminal's own buttons the lightest-weight (thin frost, no displacement). Test that scrolling a long file list or the terminal stays smooth on the phone.

## Definition of done

1. Every button listed above is visibly translucent — you can see content/background through a frosted blur — with a gradient tint and a glossy top edge, in **both** themes.
2. On iPhone Safari/PWA it looks like glass (frost + tint + gloss), no broken/opaque boxes, no unreadable text anywhere.
3. In Chrome, the extra SVG refraction shows subtly; on iOS its absence is invisible (still looks great).
4. Blur-unsupported / reduced-transparency / reduced-motion all fall back to clean solid buttons.
5. `.primary` still reads as the accent action; `.danger` still reads as destructive; disabled/active states unchanged.
6. No CSP violations in the console. No new scripts or dependencies. `npm run lint` passes (CSS-only change, but run it).
7. Update `web/sw.js` — bump the `CACHE` version (`supervisor-shell-vNN`) so phones actually pick up the new CSS. Note the new `--glass-*` tokens in a comment.

When done, commit with a clear message and push. Show me a before/after on one screen (a screenshot description is fine) so I can eyeball it on my phone.
