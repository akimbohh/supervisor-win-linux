# Supervisor redesign — "Instrument"

Deliverables for `SUPERVISOR-DESIGN-PROMPT.md`, in the brief's order:

1. `docs/design/DIRECTION.md` — the argued visual direction
2. `docs/design/SYSTEM.md` — full design-system spec (tokens, both themes, five accents, elevation, motion, status language, xterm/CodeMirror mappings)
3. `prototype/` — working static prototype: self-contained HTML, no framework, no CDN, no build step. Open `prototype/index.html`. Works at 390px and 1440px.
4. `docs/design/IMPLEMENTATION.md` — migration plan from the current `web/`
5. `docs/design/CHECKLIST.md` — §4 feature-preservation accounting

`prototype/_src/` holds the shared sources (`tokens.css`, `shell.html`, per-page bodies); each `prototype/*.html` is assembled from them by simple string substitution and is fully standalone. Edit `_src/` and re-concatenate, or edit the built files directly.

Commit this folder as-is:

```
git add redesign/
git commit -m "Add Instrument redesign: direction, system spec, prototype, implementation plan, checklist"
```
