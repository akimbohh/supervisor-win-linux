# Decision: remove `web.new/` (§8)

**Date:** 2026-08 · **Status:** decided — `web.new/` deleted.

## Context

The repo carried a third frontend, `web.new/`: an in-progress React rewrite
loaded from a CDN with in-browser Babel. The engineering brief §8 asked for an
honest assessment and an explicit call — "do not leave a third frontend in the
repo."

## What was actually there

- **Shell layer near parity:** a real login page, a full WebSocket client with
  exponential-backoff reconnect + topic re-subscription, hash routing with
  sub-paths, a stack-aware modal, toasts, sheets, global shortcuts, the
  restart-banner state machine, and a working maintenance hand-off.
- **Content layer entirely mock:** all six views rendered from hardcoded
  `window.SUPER_DATA`. Only three real `/api/*` calls existed in the whole tree.
  No xterm.js, no CodeMirror, no PDF.js, no file operations, no session control.

## Why it was removed rather than continued

1. **A full visual redesign is happening in parallel** (the "Instrument"
   redesign under `redesign/`, with a real design system and migration plan
   that targets the existing vanilla `web/`). Investing in `web.new/`'s React
   shell would be throwaway work against that direction.
2. **Its architecture is a security regression for this app.** React, ReactDOM,
   and Babel-standalone loaded from `unpkg.com` **with no Subresource
   Integrity**, into a client holding cookie-authenticated access to a
   remote-code-execution panel — a compromised/MITM'd CDN response is game over.
   This is exactly what the new CSP (`script-src 'self'`, no CDN) forbids.
3. **In-browser Babel transpiles on every load** — a measurable regression on a
   phone over cellular versus the hand-written `web/`.
4. **Its "offline PWA" was fiction** — the service worker precached nothing from
   the CDN, and its documented deployment path (`python3 -m http.server`) would
   break auth entirely.
5. **The shell-layer ideas worth keeping already exist in `web/`.** `web/app.js`
   has the same WS client (reconnect, re-subscribe, ping/pong), modal/sheet/
   toast components, hash routing, global shortcuts, and the restart-banner
   state machine — first-party, no CDN, no build step. There was nothing unique
   to extract.

## Decision

Delete `web.new/` and `start-web-new.bat`. The redesign is implemented by
migrating the production `web/` frontend to the Instrument design system
(vanilla JS, no build step, no CDN), per `redesign/docs/design/IMPLEMENTATION.md`.

The historical gap reports (`WEB-NEW-AUDIT.md`, `CLAUDE-CODE-PROMPT.md`) are kept
as record but no longer describe a live target.
