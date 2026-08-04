# Prompt — Add "Interactive Claude" to Supervisor, interchangeable with Console/Sessions

You are working in the **Supervisor** repo (`akimbohh/supervisor-win-linux`, branch off `main`). Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `AUDIT.md` first. **Preserve every invariant** in those docs (vanilla JS + no build step in `web/`; all `process.platform` behind `server/platform/`; strict CSP `script-src 'self'`; auth on every route; `ensureSafe` on every path; WS delivery filtered by `ws.subs`; resource ceilings). This is a real, in-daily-use tool — break nothing that works.

---

## 0. Feasibility (already analyzed — this is why it works)

Two projects invoke Claude in **two different execution models**, and that is exactly what makes them interchangeable:

- **sugyan/claude-code-webui** (archived, TypeScript): backend uses the **`@anthropic-ai/claude-code` SDK `query()`** async generator (`{ prompt, options: { cwd, allowedTools, permissionMode, resume: sessionId, abortController } }`) and streams **NDJSON** (`{ type: "claude_json" | "error" | "done" | "aborted", data: SDKMessage }`) to a React/Vite chat UI. `POST /api/chat`, resume by `sessionId`, conversation history read from `~/.claude/projects`. **No auth.** It is request/response streaming — one prompt in, a stream out, done.
- **Supervisor**: **Console** runs `claude` as a live TUI in a PTY; **Sessions** ("council") spawns `claude rc` and streams logs + stdin. Both are *live, long-lived processes*.

The fact that bridges them: **Claude Code persists every conversation as JSONL under `~/.claude/projects/<cwd-hash>/<session_id>.jsonl`**, and any front-end can re-open it with `claude --resume <session_id>`. So the rich "interactive" UI and the raw terminal are two views over the *same persisted conversation*; you switch by resuming the same `session_id` in the other mode.

**The one real constraint:** you cannot have two *live* drivers on the same conversation at once (the PTY owns the live `claude` process). "Interchangeable" therefore means *hand off the conversation*: detach one side, resume its `session_id` on the other.

It fits Supervisor's stack with **no React/Vite**: reimplement claude-code-webui's proven *backend contract* natively (Express + the existing WS hub) and render it in a vanilla-JS Instrument view. Do **not** iframe/embed the React app — its no-auth, CDN/build, and our CSP `frame-ancestors 'none'` all fight the hardening.

---

## 1. Goal

Add **"Interactive Claude"** — a rich, streaming chat UI for Claude Code (modeled on the archived `sugyan/claude-code-webui`) — and make it the **default** way to start/interact with Claude in Supervisor. Keep the existing **Console** (xterm terminal) and **Sessions** (`claude rc` manager) exactly as they are. Make the three **interchangeable**: a Console/Session running `claude` can be handed off into Interactive Claude, and an Interactive conversation can be opened in a Console terminal — both directions, activatable from the UI.

> Terminology: "council" is read as **Console** (voice-typing), but this prompt covers **both** Console and Sessions, because the `session_id` / resume bridge is identical for each.

## 2. Reference implementation to study (read-only; do NOT vendor its code)

`sugyan/claude-code-webui` — read these files for the contract, then reimplement natively:

- `backend/handlers/chat.ts` — the `query()` call + NDJSON streaming.
- `shared/types.ts` — `ChatRequest`, `StreamResponse`, `ConversationSummary`, `ConversationHistory`.
- `backend/handlers/{projects,histories,abort}.ts` — project list, conversation history from `~/.claude/projects`, abort-by-requestId.
- `frontend/src/hooks/useClaudeStreaming*` and the chat components — how each `SDKMessage` (system / assistant / user tool_use / tool_result / result) is rendered and how permission prompts + plan mode are handled.

## 3. The interchange model (the core design — get this right)

The bridge between all three modes is Claude's **`session_id`** and its on-disk conversation persistence in `~/.claude/projects/<cwd-hash>/<session_id>.jsonl` + `claude --resume <session_id>`.

- **One live driver per conversation.** Only one process may be *actively driving* a conversation at a time (a PTY, or an SDK `query()` run). "Switch mode" = detach the current driver, then resume the same `session_id` in the other mode. Make this explicit in the UI (e.g. "This will stop the terminal session and reopen it here").
- **Interactive → Console:** an "Open in terminal" action creates a Console shell (`shells.create`) whose command is `claude --resume <session_id>` in the same `cwd`.
- **Console/Sessions → Interactive:** a "Promote to Interactive Claude" action that resolves the running conversation's `session_id` (see §6 Verify) and opens it resumed in the Interactive view.
- Everything keys off **(cwd, session_id)**. Persist a small mapping so a conversation's mode/history is discoverable across all three tabs.

## 4. Backend (Express + WS hub, `server/`)

1. New `server/lib/interactive.js`. Prefer driving Claude via the **`@anthropic-ai/claude-code` SDK `query()`** async generator (add it to `dependencies` with a one-line justification in the commit; it's the same engine `claude` already uses). If you'd rather avoid the dep, shell out to `claude -p --output-format stream-json --verbose [--resume <id>] [--permission-mode <mode>]` via `platform.spawnManaged` and parse the NDJSON — but the SDK path is cleaner and matches the reference. Either way route spawn/kill through `server/platform` (no `process.platform` here).
2. Options to support (mirror `ChatRequest`): `message`, `sessionId?` (→ `resume`), `requestId`, `workingDirectory` (**run through `ensureSafe`**), `allowedTools?`, `permissionMode` (`default | plan | acceptEdits`). Respect the existing `maintenanceSkipPermissions` / trust-dialog logic in `lib/claude-config.js` — don't regress the Linux node-pty trust flow.
3. Stream over the **existing WS hub**, not a new socket: publish `StreamResponse`-shaped payloads (`{ type: 'claude_json' | 'error' | 'done' | 'aborted', data }`) on a topic like `claude:<requestId>` (or `claude:<sessionId>`); the client subscribes via `ws.subs` (respect the filtering + backpressure work already in `routes/ws.js`). Provide a REST `POST /api/claude/chat` to start a run and `POST /api/claude/abort` (by `requestId`, via an `AbortController` / `killTree`).
4. Conversation history + project list: `GET /api/claude/projects` and `GET /api/claude/conversations?cwd=…` reading `~/.claude/projects` (⚠ that dir is under `$HOME`, not the app — do **not** route it through the `data/` hard-block, but still `ensureSafe` any user-supplied cwd). Return `ConversationSummary` / `ConversationHistory` shapes.
5. Resource ceilings + capability gating: cap concurrent interactive runs (reuse the `SUPERVISOR_MAX_SESSIONS` pattern, 429 on breach); add a `claude` capability to `server/platform/capabilities.js` (is the `claude` CLI on PATH?) and expose it via `/api/system/capabilities` so the UI can disable Interactive with a reason when Claude isn't installed.
6. Persist the `session_id` for each run as soon as it appears in the stream (the SDK `system` init / `result` messages carry it), so the interchange actions can find it.

## 5. Frontend (vanilla JS, Instrument design, `web/`)

1. New `web/views/interactive.js` registered as a view (`window.InteractiveView`) — **no React, no build step, no CDN**. Render the streamed `SDKMessage`s as chat turns: assistant text, `tool_use` / `tool_result` blocks (collapsible), and the final `result`. Input box + **Stop** button (calls abort), streaming via the WS topic.
2. **Permission / plan UI**: surface tool-approval prompts and plan-mode output as dialogs / inline approvals (reuse `modal.js` / `sheet.js`); a segmented control for `default | plan | acceptEdits`.
3. **Make it the default Claude entry point**: the header "Request a change" (`?`) flow and the Sessions "new" flow should open Interactive Claude by default, with an obvious "Open in terminal" escape hatch. Keep Console and Sessions reachable and unchanged.
4. **Conversation list / resume**: a sidebar of recent conversations (from the history endpoint) with resume-on-tap.
5. **Interchange controls**: "Open in terminal" (→ Console `claude --resume <id>`) in Interactive; "Promote to Interactive" in Console tabs and Session cards. Confirm modals must state that switching detaches the current live driver, and (per the design system) name the machine when destructive.
6. Style strictly with the Instrument tokens / status-language already in `web/styles.css` (`.st`, `.conn`, mono = `--mono`); wire the `killing` / `running` / `done` status glyphs to run state.

## 6. Verify before building (don't assume)

- Confirm **how each mode persists a resumable `session_id`**: interactive / `-p` runs write to `~/.claude/projects` — check whether **`claude rc`** (what Sessions uses) does too, and how to read the id. If `rc` doesn't expose a resumable id, document that Sessions→Interactive handoff requires switching Sessions to a resumable invocation, and adjust.
- Confirm the installed `@anthropic-ai/claude-code` version's `query()` signature and `permissionMode` values against the reference before coding.
- Confirm Claude is authenticated on the server (`claude` logged in / API key) — the Interactive feature needs it; gate on the new capability otherwise.

## 7. Security / invariants (non-negotiable)

Behind `requireAuth`; same-origin only (SDK/CLI streams locally — no new external origin, CSP stays); `ensureSafe` every cwd; no `process.platform` outside `server/platform/`; WS filtering + backpressure respected; add a `node:test` for the NDJSON parser and the session-id resolver; `npm test` and `npm run lint` stay green; reason about Windows even if only testable on Linux (flag Windows-only concerns).

## 8. Non-goals

Do **not** iframe or reverse-proxy the React app; do **not** add a second auth surface or a CDN / bundler; do **not** remove or degrade Console or Sessions; do **not** change the WS transport (reuse the hub).

## 9. Deliverables

Small, revertable commits:

1. Backend interactive lib + routes + capability.
2. Frontend Interactive view.
3. Interchange actions wiring Console / Sessions ↔ Interactive.
4. Making Interactive the default entry point.
5. Tests + `docs/` update (extend `ARCHITECTURE.md` and add a short `docs/INTERACTIVE-CLAUDE.md` describing the `session_id` / resume bridge and the one-live-driver rule).

Report what you verified, what the reference got you, and what you're least sure about.
