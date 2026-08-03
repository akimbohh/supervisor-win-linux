# UPDATE 1.2 — WebSocket topic filtering & realtime correctness

Status: **proposed**
Scope: `server/routes/ws.js`, `server/lib/hub.js`, `server/lib/watchers.js`, both frontends' WS clients
Risk: medium (changes the live-update transport; both UIs depend on it)
Depends on: UPDATE-1.1 (do security first)

## The problem

`routes/ws.js` records each client's subscriptions in `ws.subs` (via `sub`/
`unsub` messages) but **never uses them**. The hub's `'msg'` event is wired
straight to `broadcast()`, which sends *every* event to *every* connected
client:

```
hub.on('msg', broadcast);   // ws.js:35 — fan-out to all, ignores ws.subs
```

Consequences:

- **Wasted bandwidth/CPU**: a phone sitting on the Sessions tab still receives
  every `system` metrics tick (2.5 s), every `files:<path>` event for folders
  another tab is watching, every `shell:<id>` byte from every terminal.
- **Cross-tab leakage of activity**: not a hard secret leak for a single user,
  but every client learns about every file change, shell, and session
  everywhere — noisy and unnecessary.
- **The watcher ref-count is half-wired to nothing**: `watchers.js` starts a
  chokidar watcher when a client subscribes to `files:<path>`, but since events
  are broadcast to everyone anyway, the subscription set only gates *watcher
  lifecycle*, not *delivery*. The delivery side silently ignores it.
- **Scaling ceiling**: harmless at 1 user/2 tabs, but the architecture can't
  grow (multiple devices, future multi-user) without this fix.

## The fix

Make delivery honor `ws.subs`:

- Replace the blanket `hub.on('msg', broadcast)` with per-client filtering:
  for each client, send a message only if its `topic` is in `ws.subs`, with a
  small set of **always-delivered** control topics (`hello`, `pong`,
  `server`, `settings`, `sessions`, `shells`, and the `notify`-derived
  push—decide the global set explicitly).
- Keep wildcard/prefix semantics where the UI expects them (`files:` and
  `session:`/`shell:` are exact-topic today; confirm the client subscribes to
  the exact resolved path/id).
- Ensure re-subscription on reconnect still works (client resends its `sub`
  set; server rebuilds `ws.subs` and re-arms watchers).

## Secondary correctness items in the same area

- **Backpressure**: `broadcast()` calls `c.send(data)` with no check on
  `bufferedAmount`. A slow mobile link on a busy shell can grow an unbounded
  send buffer. Drop or coalesce high-frequency topics (`system`, `shell:<id>`)
  when `bufferedAmount` exceeds a threshold.
- **Heartbeat / dead-socket reaping**: the server answers `ping` but never
  initiates its own ws-level ping; half-open sockets (phone sleeps, Tailscale
  drops) linger until TCP notices. Add a server-side ping/`isAlive` sweep that
  terminates unresponsive clients and frees their watchers.
- **`session:<id>` log streaming** currently pushes every stdout chunk; batch
  small chunks (e.g. 50 ms flush) to cut message count on chatty sessions.

## Acceptance

- With two tabs (one on System, one on Sessions), the Sessions tab's WS
  receives no `system` frames (verify in devtools).
- Subscribing/unsubscribing to `files:<path>` starts/stops both the watcher and
  the delivery.
- Killing network on a device causes the server to reap the socket within one
  heartbeat interval and close its watchers.
- Both `web/` and `web.new/` still update live after the change.

## Notes

`CLAUDE.md` flags the broadcast-all behavior as a known flaw; remove that note
once this lands.
