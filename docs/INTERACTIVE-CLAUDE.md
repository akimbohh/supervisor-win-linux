# Interactive Claude

A streaming chat UI for Claude Code (the **Claude** tab), modeled on the archived
`sugyan/claude-code-webui` but reimplemented natively on Supervisor's stack
(vanilla JS + Express + the existing WebSocket hub — no React/Vite, no CDN). It
is the default way to interact with Claude, and it is **interchangeable** with
the Console and Sessions tabs.

## The model: one conversation, three front-ends, bridged by `session_id`

Claude Code persists every conversation as JSONL under
`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`, and any front-end can
re-open it with `claude --resume <session_id>`. So:

- **Interactive Claude** drives a conversation via `claude -p --output-format
  stream-json` (request → stream → done), rendered as chat.
- **Console** runs `claude` live in a PTY (raw terminal).
- **Sessions** spawns `claude rc`.

All three are views over the *same* on-disk conversation. You switch by resuming
the same `session_id` in another mode.

> **One live driver per conversation.** Only one process may actively drive a
> conversation at a time (a PTY, or a streaming run). "Switch mode" hands the
> conversation off — it does not create a second simultaneous driver.

## Backend (`server/lib/interactive.js`, `server/routes/claude.js`)

- Spawns `claude -p --output-format stream-json --verbose [--resume <id>]
  [--permission-mode default|plan|acceptEdits]` via the platform adapter
  (`spawnManaged`/`killTree` — no `process.platform` here), message piped on
  stdin. `--dangerously-skip-permissions` is added for the `default` mode (a
  piped run can't answer an interactive permission prompt), matching the
  maintenance flow; `plan`/`acceptEdits` don't need it.
- **Chats survive the client.** A *chat* is the server-side unit the UI
  attaches to: stable `chatId`, cwd, the Claude `session_id` it resumes, and a
  seq-numbered ring of every published event (`MAX_CHAT_EVENTS`, in-memory,
  capped by `SUPERVISOR_MAX_CLAUDE_CHATS`). Runs are plain server-side child
  processes — a tab switch, WS drop, iOS backgrounding, or page reload never
  touches them. A re-attaching client sends its last seen `seq` and replays the
  gap via `GET /api/claude/chats/:chatId?since=<seq>`.
- Each stdout line is one NDJSON `SDKMessage`, appended to the chat ring and
  republished on the hub topic `claude:<chatId>` as `{ seq, type:
  'claude_json'|'session'|'user'|'done'|'error'|'aborted', … }` (plus unbuffered
  `stderr`, no seq). The user turn is buffered too, so a replay reconstructs
  whole turns. The resumable `session_id` is captured from the stream and
  emitted as a `session` event.
- REST (all behind `requireAuth`): `POST /api/claude/chat` (start; continues the
  chat when `chatId` names a live one, else creates one and returns its id),
  `POST /api/claude/abort` (by `requestId` or `chatId`), `GET /api/claude/chats`
  (list live chats), `POST /api/claude/chats` (create an idle chat up-front —
  the "New session in <folder>" flow), `GET /api/claude/chats/:chatId?since=<seq>`
  (state + replay; 404 after a server restart → client falls back to the
  on-disk transcript), `POST /api/claude/chats/:chatId/rename`,
  `DELETE /api/claude/chats/:chatId` (kill: aborts any in-flight run, drops the
  registry entry; the jsonl transcript stays resumable),
  `POST /api/claude/chats/:chatId/dirs` (replace the chat's `--add-dir` list —
  each entry `ensureSafe`d and must exist; applied from the next run),
  `GET /api/claude/runs`,
  `GET /api/claude/{projects,conversations,conversation,status}`. `cwd` is run
  through `ensureSafe`. Concurrency capped by `SUPERVISOR_MAX_CLAUDE_RUNS`
  (default 8). Gated on a new `claude` capability (is the CLI on PATH?), exposed
  via `/api/system/capabilities`. Chat lifecycle changes are announced on the
  hub topic `claude-chats`.
- Conversation history is read from `~/.claude/projects` (`ConversationSummary`
  / full history), keyed by the `encodeCwd` layout Claude uses on disk.

## Frontend (`web/views/interactive.js`)

A mobile-first, chat-app-style UI (`.chat-*` in `web/styles.css`), deliberately
sleeker than the rest of the app and aimed at non-power users:

- **Context strip**: a folder chip (basename only; tap → bottom sheet with
  Home / `selfRepoPath` ("This app") / recent folders / raw-path entry, recents
  persisted in `localStorage['claude.recentCwds']`) and a mode chip with
  plain-language permission modes ("Do it for me" = `default`, "Plan only" =
  `plan`, "Auto-accept edits" = `acceptEdits`). History and new-chat buttons on
  the right. "Open in terminal" lives in the mode sheet under Power tools.
- **Transcript**: user messages as accent bubbles; assistant replies rendered
  as markdown via the CSP-safe `window.renderMarkdown` (shared from
  `views/files.js`); `tool_use` shown as human one-liners ("Edited `auth.js`",
  "Ran `npm test`") grouped in a card, expandable to raw input + result
  (results attached by `tool_use_id`); the final `result` deduped against the
  last assistant message; an animated "Claude is working…" indicator while
  streaming; inline error rows; a jump-to-latest chip when scrolled up.
- **Composer**: pinned pill input with auto-growing textarea and a round
  send button that morphs into Stop while streaming (Cmd/Ctrl+Enter still
  sends on desktop).
- **Resume with history**: picking a past conversation (bottom sheet) loads
  the full transcript via `GET /api/claude/conversation` and renders it before
  continuing. Falls back to a disabled state with a reason when Claude isn't
  installed.
- **Persistence**: the view returns `persist: true` — `app.js` detaches its DOM
  on tab switch and re-appends it later instead of destroying it, so transcript,
  closures, and the WS handler survive navigation (events keep rendering into
  the off-screen tree). The active chat (`chatId`/`sessionId`/`cwd`) is
  mirrored to `localStorage['claude.activeChat']`; a page reload re-attaches
  and replays from the server ring, falling back to the jsonl transcript if the
  server restarted. On WS drop (iOS backgrounding) a "Reconnecting…" pill shows
  over the transcript; `app.js` reconnects immediately on
  `visibilitychange`/`pageshow` and the view replays everything missed by seq.
  Live events are deduped/ordered by `seq`; a gap (lossy backpressure) triggers
  a replay fetch.

- **Sessions live here now** (the Sessions tab is gone from the nav; `#sessions`
  stays routable): the folder chip is a session switcher — a sheet listing every
  live server chat with name, cwd, running/idle dot, preview, and inline
  rename/kill actions. "New session…" opens the shared directory picker
  (`web/components/dirpicker.js`, a bottom-sheet browser over the Files API)
  and creates an idle chat there.
- **"+" button** beside the composer: Photo (camera roll/camera) and File
  uploads go through `POST /api/files/upload?dest=<session cwd>` via XHR (real
  progress for large files) and are handed to Claude as file paths appended to
  the next message; "Add repo reference" adds a `--add-dir` folder, shown as
  removable accent chips above the composer.

### Entry points & interchange

- **Default entry:** the header "Request a change" (`?`) modal's primary action,
  **Ask Interactive Claude**, prefills the Claude tab. "Open in terminal" remains
  as a secondary Console hand-off.
- **Interactive → Console:** the **Terminal** button opens a Console shell
  running `claude --resume <session_id>` in the same cwd.
- **Sessions → Interactive:** each session card's **Claude** button opens the
  Claude tab at that folder (`#claude/<cwd>`); recent conversations are one tap
  away in the picker.

## Security / invariants

Behind auth; same-origin only (the CLI streams locally — no new external origin,
CSP unchanged); every cwd through `ensureSafe`; WS delivery filtered by
subscription with `claude:` added to backpressure; runs killed on shutdown; the
pure stream helpers (`splitLines`, `sessionIdOf`, `previewOf`, `encodeCwd`) are
unit-tested.

## Known limitations / follow-ups

- **Console → Interactive promotion** currently navigates to the folder rather
  than attaching to the *live* PTY's conversation, because reliably extracting a
  running interactive `claude`'s `session_id` needs verification against the
  installed CLI (does `claude rc` expose a resumable id, and where?). This is the
  verify-gated item from `INTERACTIVE-CLAUDE-PROMPT.md`.
- **Interactive tool-permission approval** (a round-trip "allow this tool?"
  dialog) isn't wired; `default` mode uses skip-permissions and `plan`/
  `acceptEdits` cover the safe cases. A `--permission-prompt-tool` / MCP
  approval bridge is the future enhancement.
- Requires Claude to be **installed and authenticated** on the host; the UI
  disables itself with a reason otherwise.
