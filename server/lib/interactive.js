// Interactive Claude — a streaming chat driver over the Claude Code CLI, modeled
// on sugyan/claude-code-webui but reimplemented natively on Supervisor's stack.
//
// Execution model: spawn `claude -p --output-format stream-json --verbose` with
// the user's message on stdin; each stdout line is one NDJSON SDKMessage which
// we republish over the hub topic `claude:<requestId>` as a StreamResponse
// `{ type: 'claude_json'|'error'|'done'|'aborted', data }`. A conversation is
// resumed by passing `--resume <sessionId>`; the id is captured from the stream
// and is the bridge to Console/Sessions (see docs/INTERACTIVE-CLAUDE.md).
//
// One live driver per conversation: this module owns the process for a run; the
// terminal/Sessions hand-off is a resume, not a second simultaneous driver.
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const hub = require('./hub');
const { ensureSafe } = require('./paths');
const settings = require('./settings');
const claudeConfig = require('./claude-config');
const platform = require('../platform');

const STDERR_KEEP = 4000; // tail of stderr surfaced on a non-zero exit

const MAX_RUNS = parseInt(process.env.SUPERVISOR_MAX_CLAUDE_RUNS || '8', 10);
const runs = new Map(); // requestId -> { proc, requestId, chat, startedAt, buf }

function newRequestId() { return 'req' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'); }

// ── Chats: server-side conversation state that survives the client ──────────
// A chat is the unit the UI attaches to: stable id, cwd, the Claude session_id
// it resumes, and a seq-numbered ring of every StreamResponse published for it.
// A client that disconnects (tab switch, iOS backgrounding, reload) re-attaches
// with its last seen seq and replays what it missed; the run itself is a
// server-side child process and never depends on a socket being open.
const MAX_CHATS = parseInt(process.env.SUPERVISOR_MAX_CLAUDE_CHATS || '32', 10);
const MAX_CHAT_EVENTS = 2000; // per-chat replay ring
const chats = new Map(); // chatId -> chat

function newChatId() { return 'c' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'); }
function topicFor(chatId) { return 'claude:' + chatId; }

// Validate a caller-supplied --add-dir list: each entry must be a safe,
// existing directory. Returns the resolved list.
function sanitizeAddDirs(dirs) {
  if (!Array.isArray(dirs)) return [];
  const out = [];
  for (const d of dirs.slice(0, 16)) {
    if (typeof d !== 'string' || !d.trim()) continue;
    const safe = ensureSafe(d); // throws EBLOCKED on blocklisted paths
    if (!fs.existsSync(safe) || !fs.statSync(safe).isDirectory()) {
      const e = new Error('Not a directory: ' + d); e.code = 'ENOENT'; throw e;
    }
    if (!out.includes(safe)) out.push(safe);
  }
  return out;
}

function createChat({ cwd, sessionId, permissionMode, name, addDirs } = {}) {
  if (chats.size >= MAX_CHATS) {
    // Evict the least-recently-active idle chat; running chats are never evicted.
    const idle = [...chats.values()].filter(c => c.status !== 'running')
      .sort((a, b) => a.lastActivity - b.lastActivity);
    if (idle.length) chats.delete(idle[0].chatId);
    else { const e = new Error('Too many active chats (' + MAX_CHATS + ')'); e.code = 'ELIMIT'; throw e; }
  }
  const chat = {
    chatId: newChatId(), cwd: cwd || null, sessionId: sessionId || null,
    permissionMode: permissionMode || 'default', status: 'idle',
    name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 60) : null,
    addDirs: sanitizeAddDirs(addDirs),
    model: null, // --model alias/full name; null = the CLI's configured default
    preview: '',
    seq: 0, events: [], createdAt: Date.now(), lastActivity: Date.now(),
    currentRequestId: null,
  };
  chats.set(chat.chatId, chat);
  hub.publish('claude-chats', { event: 'created', chatId: chat.chatId });
  return chat;
}

function renameChat(chatId, name) {
  const chat = chats.get(chatId);
  if (!chat) return false;
  chat.name = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 60) : null;
  hub.publish('claude-chats', { event: 'changed', chatId, status: chat.status });
  return true;
}

// Kill a chat: abort any in-flight run and drop the registry entry. The
// on-disk jsonl transcript is Claude's and stays resumable from history.
function deleteChat(chatId) {
  const chat = chats.get(chatId);
  if (!chat) return false;
  if (chat.currentRequestId) { try { abort(chat.currentRequestId); } catch (e) {} }
  chats.delete(chatId);
  hub.publish('claude-chats', { event: 'removed', chatId });
  return true;
}

// Replace a chat's --add-dir list (applies from the next run).
function setChatDirs(chatId, dirs) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  chat.addDirs = sanitizeAddDirs(dirs);
  hub.publish('claude-chats', { event: 'changed', chatId, status: chat.status });
  return chat.addDirs;
}

// Append to the replay ring and publish live. Every buffered event carries a
// monotonic per-chat seq so clients can detect gaps and re-fetch.
function pushEvent(chat, payload) {
  const ev = { seq: ++chat.seq, ...payload };
  chat.events.push(ev);
  if (chat.events.length > MAX_CHAT_EVENTS) chat.events.splice(0, chat.events.length - MAX_CHAT_EVENTS);
  chat.lastActivity = Date.now();
  hub.publish(topicFor(chat.chatId), ev);
  return ev;
}

// Chat state + events after `since`, or null if the chat is unknown
// (e.g. the server restarted — the client then falls back to the
// ~/.claude/projects transcript via its sessionId).
function snapshot(chatId, since) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const n = Number(since) || 0;
  return {
    chatId: chat.chatId, cwd: chat.cwd, sessionId: chat.sessionId,
    permissionMode: chat.permissionMode, status: chat.status, seq: chat.seq,
    name: chat.name, addDirs: chat.addDirs, model: chat.model,
    events: chat.events.filter(e => e.seq > n),
    oldestSeq: chat.events.length ? chat.events[0].seq : chat.seq,
  };
}

function listChats() {
  return [...chats.values()].map(c => ({
    chatId: c.chatId, cwd: c.cwd, sessionId: c.sessionId, status: c.status,
    name: c.name, addDirs: c.addDirs, model: c.model, preview: c.preview,
    seq: c.seq, createdAt: c.createdAt, lastActivity: c.lastActivity,
  })).sort((a, b) => b.lastActivity - a.lastActivity);
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

// Incrementally split a byte/utf8 stream into complete lines. Returns the
// complete lines plus the trailing partial to carry into the next chunk.
function splitLines(prev, chunk) {
  const buf = (prev || '') + chunk;
  const parts = buf.split('\n');
  const rest = parts.pop(); // trailing partial (or '' if chunk ended on \n)
  return { lines: parts.map(l => l.replace(/\r$/, '')).filter(l => l.length), rest };
}

// Extract a resumable session id from an SDK stream-json message, if present.
// stream-json carries session_id on the system/init message and on result.
function sessionIdOf(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (typeof msg.session_id === 'string') return msg.session_id;
  if (msg.data && typeof msg.data.session_id === 'string') return msg.data.session_id;
  return null;
}

// Best-effort plain-text preview of an assistant/user message for history rows.
function previewOf(msg) {
  try {
    const m = msg.message || msg;
    const content = m && m.content;
    if (typeof content === 'string') return content.slice(0, 140);
    if (Array.isArray(content)) {
      const t = content.find(b => b && b.type === 'text' && typeof b.text === 'string');
      if (t) return t.text.slice(0, 140);
    }
  } catch (e) {}
  return '';
}

// ── Run lifecycle ───────────────────────────────────────────────────────────

function count() { return runs.size; }

// Start a streaming Claude run inside a chat. If `chatId` names a live chat we
// continue it (its cwd/sessionId win); otherwise a new chat is created — also
// when the given chatId is unknown, e.g. after a server restart, so the client
// can always just send and use the returned chatId.
// async: a first run in an untrusted folder must accept Claude's workspace-trust
// dialog first, or `claude` exits 1 (the "code 1 in a different folder" bug).
// Returns { requestId, chatId, topic, sessionId, seq }.
async function start({ message, chatId, sessionId, cwd, permissionMode, allowedTools, addDirs, model } = {}) {
  if (!platform.capabilities().claude) {
    const e = new Error('Claude Code CLI not found on this host'); e.code = 'ENOCLAUDE'; throw e;
  }
  if (typeof message !== 'string' || !message.trim()) {
    const e = new Error('message required'); e.code = 'EINVAL'; throw e;
  }
  if (runs.size >= MAX_RUNS) {
    const e = new Error('Too many Claude runs (' + MAX_RUNS + '). Stop one first.'); e.code = 'ELIMIT'; throw e;
  }

  let chat = chatId ? chats.get(chatId) : null;
  if (chat && chat.status === 'running') {
    const e = new Error('Chat is already streaming a reply. Stop it first.'); e.code = 'EBUSY'; throw e;
  }
  const workdir = chat && chat.cwd ? chat.cwd : (cwd ? ensureSafe(cwd) : os.homedir());
  if (!fs.existsSync(workdir)) { const e = new Error('cwd does not exist'); e.code = 'ENOENT'; throw e; }

  // Pre-accept Claude's workspace-trust dialog for this folder (cached per
  // folder; ~1.5s only on first use). Without it, `claude -p` refuses an
  // untrusted folder and exits 1 — the "code 1 in a different folder" bug.
  // Best-effort — don't block the run if it fails.
  if (settings.get().autoTrustClaudeFolders !== false) {
    try { await claudeConfig.trustFolderInteractive(workdir); } catch (e) {}
  }

  if (!chat) chat = createChat({ cwd: workdir, sessionId, permissionMode, addDirs });
  else if (addDirs !== undefined) chat.addDirs = sanitizeAddDirs(addDirs);
  chat.cwd = workdir;
  if (permissionMode) chat.permissionMode = permissionMode;
  if (model !== undefined) {
    // Alias ('fable', 'opus', 'sonnet[1m]', …) or full name ('claude-fable-5').
    // Strict charset: spawnManaged uses shell:true on Windows, so never let
    // arbitrary strings near the argv. null/'' clears back to the CLI default.
    if (model && !/^[A-Za-z0-9._\-[\],]{1,64}$/.test(String(model))) {
      const e = new Error('bad model name'); e.code = 'EINVAL'; throw e;
    }
    chat.model = model || null;
  }
  const resumeId = sessionId || chat.sessionId;

  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (resumeId) args.push('--resume', String(resumeId));
  if (chat.model) args.push('--model', chat.model);
  for (const d of chat.addDirs) args.push('--add-dir', d);
  if (permissionMode && ['default', 'plan', 'acceptEdits'].includes(permissionMode)) args.push('--permission-mode', permissionMode);
  if (Array.isArray(allowedTools) && allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  // Self-editing/agent runs generally can't answer an interactive permission
  // prompt over a pipe; honor the same setting the maintenance flow uses.
  if (settings.get().maintenanceSkipPermissions !== false && (!permissionMode || permissionMode === 'default')) {
    args.push('--dangerously-skip-permissions');
  }

  const requestId = newRequestId();
  const topic = topicFor(chat.chatId);
  let proc;
  try {
    proc = platform.spawnManaged('claude', args, { cwd: workdir, windowsHide: true, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const err = new Error('Failed to spawn claude: ' + e.message); err.code = 'ESPAWN'; throw err;
  }

  const run = { proc, requestId, chat, startedAt: Date.now(), buf: '', errBuf: '' };
  runs.set(requestId, run);
  chat.status = 'running';
  chat.currentRequestId = requestId;
  chat.sessionId = resumeId || chat.sessionId;
  // The user turn goes into the ring too, so a replay reconstructs whole turns.
  chat.preview = message.slice(0, 80);
  pushEvent(chat, { type: 'user', text: message });

  function settle(finalEvent) {
    runs.delete(requestId);
    if (chat.currentRequestId === requestId) { chat.status = 'idle'; chat.currentRequestId = null; }
    pushEvent(chat, finalEvent);
    hub.publish('claude-chats', { event: 'changed', chatId: chat.chatId, status: chat.status });
  }

  // Pipe the prompt on stdin (avoids arg-quoting issues), then close it.
  try { if (proc.stdin) { proc.stdin.write(message); proc.stdin.end(); } } catch (e) {}

  proc.stdout && proc.stdout.on('data', (chunk) => {
    const { lines, rest } = splitLines(run.buf, chunk.toString());
    run.buf = rest;
    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; } // ignore non-JSON noise
      const sid = sessionIdOf(obj);
      if (sid && sid !== chat.sessionId) { chat.sessionId = sid; pushEvent(chat, { type: 'session', sessionId: sid }); }
      pushEvent(chat, { type: 'claude_json', data: obj });
    }
  });
  proc.stderr && proc.stderr.on('data', (chunk) => {
    // Buffer the tail so a non-zero exit can surface the real reason; also
    // publish live (unbuffered, no seq — chatty and worthless in a replay).
    run.errBuf = (run.errBuf + chunk.toString()).slice(-STDERR_KEEP);
    hub.publish(topic, { type: 'stderr', data: chunk.toString() });
  });
  proc.on('error', (err) => {
    settle({ type: 'error', error: err.message });
  });
  proc.on('exit', (code, signal) => {
    if (run.buf) { try { const obj = JSON.parse(run.buf); pushEvent(chat, { type: 'claude_json', data: obj }); } catch (e) {} }
    if (signal) {
      settle({ type: 'aborted' });
    } else if (code === 0) {
      settle({ type: 'done', sessionId: chat.sessionId });
    } else {
      // Surface claude's actual stderr instead of an opaque exit code.
      const detail = (run.errBuf || '').trim();
      settle({ type: 'error', error: 'claude exited with code ' + code + (detail ? ': ' + detail.slice(-800) : '') });
    }
  });

  hub.publish('claude-chats', { event: 'changed', chatId: chat.chatId, status: chat.status });
  return { requestId, chatId: chat.chatId, topic, sessionId: chat.sessionId, seq: chat.seq };
}

function abort(requestId) {
  const run = runs.get(requestId);
  if (!run) return false;
  try { if (run.proc && run.proc.pid) platform.killTree(run.proc.pid, 'SIGTERM'); } catch (e) {}
  return true;
}

// Abort whatever run a chat currently streams (for clients that re-attached
// mid-run and never saw the requestId).
function abortChat(chatId) {
  const chat = chats.get(chatId);
  if (!chat || !chat.currentRequestId) return false;
  return abort(chat.currentRequestId);
}

function listRuns() {
  return [...runs.values()].map(r => ({ requestId: r.requestId, chatId: r.chat.chatId, cwd: r.chat.cwd, sessionId: r.chat.sessionId, startedAt: r.startedAt }));
}

// ── Conversation history (~/.claude/projects) ───────────────────────────────
// Claude persists each conversation as <session_id>.jsonl under a per-project
// directory whose name is the project path with separators replaced by dashes.

function projectsRoot() { return path.join(os.homedir(), '.claude', 'projects'); }

// Does a resumable conversation with this id exist under this cwd? Used to avoid
// passing --resume across folders (which makes claude exit 1).
function conversationExists(cwd, sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(String(sessionId))) return false;
  try { return fs.existsSync(path.join(projectsRoot(), encodeCwd(cwd), sessionId + '.jsonl')); }
  catch (e) { return false; }
}

// The encoding Claude uses isn't reversible (both '/' and '-' map to '-'), so we
// list all project dirs and, for a cwd filter, match on the encoded form.
function encodeCwd(cwd) { return path.resolve(cwd).replace(/[/\\:]/g, '-'); }

async function listProjects() {
  const root = projectsRoot();
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { return { available: false, reason: 'no ~/.claude/projects', projects: [] }; }
  const projects = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    let n = 0;
    try { n = (await fsp.readdir(path.join(root, ent.name))).filter(f => f.endsWith('.jsonl')).length; } catch (e) {}
    projects.push({ dir: ent.name, conversations: n });
  }
  return { available: true, projects };
}

async function listConversations(cwd) {
  const root = projectsRoot();
  const dir = cwd ? path.join(root, encodeCwd(cwd)) : null;
  let files = [];
  try {
    if (dir) {
      files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
    } else {
      // No cwd → scan every project dir.
      const projDirs = await fsp.readdir(root, { withFileTypes: true });
      for (const p of projDirs) {
        if (!p.isDirectory()) continue;
        const pd = path.join(root, p.name);
        for (const f of (await fsp.readdir(pd))) if (f.endsWith('.jsonl')) files.push(path.join(pd, f));
      }
    }
  } catch (e) { return { available: false, reason: 'no conversations', conversations: [] }; }

  const summaries = [];
  for (const file of files) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      if (!lines.length) continue;
      let first = null, last = null, preview = '';
      for (const ln of lines) {
        let o; try { o = JSON.parse(ln); } catch (e) { continue; }
        const t = o.timestamp || (o.message && o.message.timestamp);
        if (t && !first) first = t;
        if (t) last = t;
        const p = previewOf(o); if (p) preview = p;
      }
      summaries.push({
        sessionId: path.basename(file, '.jsonl'),
        startTime: first, lastTime: last, messageCount: lines.length,
        lastMessagePreview: preview,
      });
    } catch (e) {}
  }
  summaries.sort((a, b) => String(b.lastTime || '').localeCompare(String(a.lastTime || '')));
  return { available: true, conversations: summaries };
}

async function readConversation(cwd, sessionId) {
  if (!/^[\w-]+$/.test(String(sessionId || ''))) { const e = new Error('bad sessionId'); e.code = 'EINVAL'; throw e; }
  const file = path.join(projectsRoot(), encodeCwd(cwd), sessionId + '.jsonl');
  const raw = await fsp.readFile(file, 'utf8'); // throws ENOENT if missing
  const messages = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  return { sessionId, messages };
}

function closeAll() {
  for (const r of runs.values()) { try { if (r.proc && r.proc.pid) platform.killTree(r.proc.pid, 'SIGTERM'); } catch (e) {} }
}

module.exports = {
  start, abort, abortChat, listRuns, count, closeAll,
  listChats, snapshot, renameChat, deleteChat, setChatDirs,
  listProjects, listConversations, readConversation,
  // exported for tests
  splitLines, sessionIdOf, previewOf, encodeCwd, conversationExists, createChat, pushEvent, sanitizeAddDirs,
};
