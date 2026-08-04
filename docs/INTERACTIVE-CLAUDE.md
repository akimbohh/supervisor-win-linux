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
- Each stdout line is one NDJSON `SDKMessage`, republished on the hub topic
  `claude:<requestId>` as `{ type: 'claude_json'|'session'|'stderr'|'done'|
  'error'|'aborted', data|sessionId|error }`. The resumable `session_id` is
  captured from the stream and emitted as a `session` event.
- REST (all behind `requireAuth`): `POST /api/claude/chat` (start),
  `POST /api/claude/abort` (by `requestId`), `GET /api/claude/runs`,
  `GET /api/claude/{projects,conversations,conversation,status}`. `cwd` is run
  through `ensureSafe`. Concurrency capped by `SUPERVISOR_MAX_CLAUDE_RUNS`
  (default 8). Gated on a new `claude` capability (is the CLI on PATH?), exposed
  via `/api/system/capabilities`.
- Conversation history is read from `~/.claude/projects` (`ConversationSummary`
  / full history), keyed by the `encodeCwd` layout Claude uses on disk.

## Frontend (`web/views/interactive.js`)

Chat list + composer (Send / Stop), a cwd field, a `default|plan|acceptEdits`
segmented control, and a conversation picker to resume by `session_id`. Streams
over the WS topic. Renders assistant text, collapsible `tool_use`/`tool_result`
blocks, and the final `result`. Falls back to a disabled state with a reason
when Claude isn't installed.

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
