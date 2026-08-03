# Supervisor — web

Personal server supervisor PWA. Single-page app, no build step.

## Layout

```
web/
├── index.html              # entry — full-bleed PWA shell
├── manifest.webmanifest    # PWA install manifest
├── sw.js                   # offline service worker
├── icon.svg                # app icon (vector)
├── styles.css              # design tokens + components
├── icons.jsx               # icon set (Lucide-style)
├── tweaks-panel.jsx        # in-app design tweaks (theme/accent/density…)
├── app.jsx                 # shell: header, dock, view switcher
├── view-sessions.jsx       # Sessions (Claude Code agents)
└── view-others.jsx         # Files, Console, Processes, System, Settings
```

## Run locally

Any static server works — service workers require http(s), not `file://`:

```bash
# Python
python3 -m http.server 8080 -d web

# Node
npx serve web -l 8080
```

Open http://localhost:8080 — on iOS/Android you can "Add to Home Screen"
to install as a standalone PWA.

## Notes

- React + Babel-standalone via CDN, no bundler.
- `data-*` attributes on `<html>` drive theming: `data-theme`, `data-accent`,
  `data-density`, `data-aurora`, `data-layout`. Tweaks panel writes to these.
- Replace `icon-192.png` / `icon-512.png` with rasterized versions of `icon.svg`
  before shipping if you want sharper home-screen icons. The SVG icon works
  on iOS 16+ and modern Android.
- Service worker caches the app shell; bump `CACHE` in `sw.js` on each release
  to invalidate.

## Mock data

Sessions, processes, files, and console output are currently mocked in
`view-*.jsx` and `app.jsx`. Swap these for fetches against your supervisor
backend (`/api/sessions`, `/api/procs`, WebSocket for console streams).
