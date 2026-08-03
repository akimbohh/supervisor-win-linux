# Multi-machine — controlling several hosts from one phone (§4)

**Status:** backend + design landed; the header switcher UI is the remaining
frontend piece (see "Implementation status" at the end).

## Goal

Run Supervisor on the Windows desktop **and** the Linux VPS, and switch between
them from the phone — different machines in different sessions, one app. The
single most important property is that **you can never issue a destructive
command against the wrong machine because two tabs looked identical.**

## Architecture: peer instances + a client-side switcher

Each machine runs a **full, independent Supervisor instance** (already true).
There is **no central hub** proxying traffic — that would be a single point of
failure, would double shell-hot-path latency, and would let the VPS read the
desktop's disk. Instead the *phone* owns the list of machines and re-targets
which instance the whole app talks to.

```
   phone (owns the registry, in localStorage)
   ├── https://desktop.tailnet:7778   (win32, hue 210, dots)
   └── https://vps.tailnet:7778       (linux, hue 140, grid)
        each: own password, own cookie (per-origin), own data/
```

### Registry (client-side)

A list of `{ id, label, baseUrl, platform, hue, pattern }` in `localStorage`
(`supervisor.machines`). The phone owns it; the server never stores it. Adding
the second machine on a phone is done by **pasting its URL** or scanning a
**QR code** the first machine can render.

### Switcher (header)

The header carries a persistent **machine chip** — pattern swatch + hostname +
platform glyph — sized as the second-largest thing in the header. Tapping it
opens a switcher sheet listing every registered machine with a live health dot.
Selecting one re-points every API call and the WebSocket at that `baseUrl` and
resets view state (current tab/scroll). Because cookies are per-origin, this is
just a navigation to the other origin; a machine you're not signed into routes
to its own login preserving the destination.

### Per-machine identity — three redundant channels

Per the design brief, machine identity is **not** the user's accent (that's
theming and would collide). Instead:

1. **Texture** (primary): a low-contrast CSS pattern on the page surface
   (`dots` / `grid` / `diag`), full-contrast in the header swatch. Zero assets.
   Driven by `data-machine-pattern` on `<html>` + `--machine-hue`.
2. **Name** (always): the header machine chip + `[hostname]` prefix on every
   push notification.
3. **Hue** (secondary): a fixed identity hue used only in the identity block and
   texture tint — never for buttons/links, so it can't collide with the accent.

Destructive confirmations (kill / delete / power / service stop) repeat the
machine identity inside the confirm modal.

### Health at a glance

Each registered machine is polled with the **unauthenticated `GET /api/ping`**
(`{ ok, app, version, platform, hostname }`) on a timeout, so the switcher shows
"VPS up, desktop asleep" without switching or being signed in. Version skew
between instances is shown rather than failing weirdly.

### Attributable notifications

`lib/push.js` prefixes every notification title with `[<machineLabel>]`
(`settings.machineLabel`, else hostname) and includes `machine` in the payload,
so a "Session finished" on the lock screen names its host and its deep link can
target the right instance.

## Backend pieces (landed)

- `GET /api/ping` — unauthenticated identity/health (exempt from the
  default-password gate; exposes no secrets).
- `settings.machineLabel / machinePattern / machineHue` — this instance's
  identity, served via `/api/settings` so the frontend can render its own chip
  and texture.
- Push titles prefixed with the machine label.
- Machine-identity CSS (`data-machine-pattern`, `--machine-hue`, `.machine-chip`,
  swatches) in `web/styles.css`.

## Implementation status

- [x] Peer-model decision + design (this doc).
- [x] `/api/ping` health endpoint.
- [x] Per-instance identity settings + `/api/settings` exposure.
- [x] Machine-identity CSS (texture, chip, swatches).
- [x] Push notification attribution.
- [ ] **Frontend switcher UI** — header machine chip, switcher sheet, registry
      in localStorage, per-machine health polling, re-target of `window.api` +
      WS `baseUrl`, QR/paste add-flow, identity in destructive confirms. This is
      the remaining piece; it is additive chrome over the existing app and does
      not change the server contract.

## Security note

`connect-src 'self'` in the CSP means the switcher re-points by **navigating to
the other origin**, not by cross-origin fetch/WS from one instance to another —
so no instance ever holds another's cookie, and a compromised instance can't
read its peers. This is deliberate and should stay.
