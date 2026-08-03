# Fonts

The Instrument design loads **IBM Plex Mono** as the app's single webfont — it
carries logs, the terminal, paths, hex, code, PIDs, and metrics (the places the
app actually lives). The UI face stays the system sans stack (no webfont).

`styles.css` already declares the `@font-face` rules and lists `'IBM Plex Mono'`
first in `--mono`, with `font-display: swap` — so until the files below exist,
the app falls back cleanly to the system monospace stack (no layout shift, no
missing-glyph boxes, and no font is *named without being loadable* thanks to the
`local()` + graceful fallback).

To enable the webfont, drop these two files here:

```
web/fonts/ibm-plex-mono-400.woff2   (weight 400, latin subset)
web/fonts/ibm-plex-mono-600.woff2   (weight 600, latin subset)
```

Get them from the `@ibm/plex-mono` npm package or Google Fonts (self-host — do
NOT hotlink; the CSP forbids external font hosts). A latin subset keeps both
files ≈55 KB total. The service worker (`sw.js`) caches `/fonts/*` after first
load, so the flash only happens once per device.

These binaries are intentionally not committed (keeps the repo lean and avoids
shipping fonts of ambiguous license state); adding them is a one-step, optional
enablement.
