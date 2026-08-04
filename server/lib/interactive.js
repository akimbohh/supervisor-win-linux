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
const platform = require('../platform');

const MAX_RUNS = parseInt(process.env.SUPERVISOR_MAX_CLAUDE_RUNS || '8', 10);
const runs = new Map(); // requestId -> { proc, requestId, cwd, sessionId, startedAt, buf }

function topicFor(requestId) { return 'claude:' + requestId; }
function newRequestId() { return 'req' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'); }

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

// Start a streaming Claude run. Returns { requestId, topic, sessionId? }.
function start({ message, sessionId, cwd, permissionMode, allowedTools } = {}) {
  if (!platform.capabilities().claude) {
    const e = new Error('Claude Code CLI not found on this host'); e.code = 'ENOCLAUDE'; throw e;
  }
  if (typeof message !== 'string' || !message.trim()) {
    const e = new Error('message required'); e.code = 'EINVAL'; throw e;
  }
  const workdir = cwd ? ensureSafe(cwd) : os.homedir();
  if (!fs.existsSync(workdir)) { const e = new Error('cwd does not exist'); e.code = 'ENOENT'; throw e; }
  if (runs.size >= MAX_RUNS) {
    const e = new Error('Too many Claude runs (' + MAX_RUNS + '). Stop one first.'); e.code = 'ELIMIT'; throw e;
  }

  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (sessionId) args.push('--resume', String(sessionId));
  if (permissionMode && ['default', 'plan', 'acceptEdits'].includes(permissionMode)) args.push('--permission-mode', permissionMode);
  if (Array.isArray(allowedTools) && allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  // Self-editing/agent runs generally can't answer an interactive permission
  // prompt over a pipe; honor the same setting the maintenance flow uses.
  if (settings.get().maintenanceSkipPermissions !== false && (!permissionMode || permissionMode === 'default')) {
    args.push('--dangerously-skip-permissions');
  }

  const requestId = newRequestId();
  const topic = topicFor(requestId);
  let proc;
  try {
    proc = platform.spawnManaged('claude', args, { cwd: workdir, windowsHide: true, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const err = new Error('Failed to spawn claude: ' + e.message); err.code = 'ESPAWN'; throw err;
  }

  const run = { proc, requestId, cwd: workdir, sessionId: sessionId || null, startedAt: Date.now(), buf: '' };
  runs.set(requestId, run);

  // Pipe the prompt on stdin (avoids arg-quoting issues), then close it.
  try { if (proc.stdin) { proc.stdin.write(message); proc.stdin.end(); } } catch (e) {}

  proc.stdout && proc.stdout.on('data', (chunk) => {
    const { lines, rest } = splitLines(run.buf, chunk.toString());
    run.buf = rest;
    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; } // ignore non-JSON noise
      const sid = sessionIdOf(obj);
      if (sid && sid !== run.sessionId) { run.sessionId = sid; hub.publish(topic, { type: 'session', sessionId: sid }); }
      hub.publish(topic, { type: 'claude_json', data: obj });
    }
  });
  proc.stderr && proc.stderr.on('data', (chunk) => {
    hub.publish(topic, { type: 'stderr', data: chunk.toString() });
  });
  proc.on('error', (err) => {
    hub.publish(topic, { type: 'error', error: err.message });
    runs.delete(requestId);
  });
  proc.on('exit', (code, signal) => {
    // Flush any trailing partial line.
    if (run.buf) { try { const obj = JSON.parse(run.buf); hub.publish(topic, { type: 'claude_json', data: obj }); } catch (e) {} }
    hub.publish(topic, signal ? { type: 'aborted' } : (code === 0 ? { type: 'done', sessionId: run.sessionId } : { type: 'error', error: 'claude exited with code ' + code }));
    runs.delete(requestId);
  });

  return { requestId, topic, sessionId: run.sessionId };
}

function abort(requestId) {
  const run = runs.get(requestId);
  if (!run) return false;
  try { if (run.proc && run.proc.pid) platform.killTree(run.proc.pid, 'SIGTERM'); } catch (e) {}
  return true;
}

function listRuns() {
  return [...runs.values()].map(r => ({ requestId: r.requestId, cwd: r.cwd, sessionId: r.sessionId, startedAt: r.startedAt }));
}

// ── Conversation history (~/.claude/projects) ───────────────────────────────
// Claude persists each conversation as <session_id>.jsonl under a per-project
// directory whose name is the project path with separators replaced by dashes.

function projectsRoot() { return path.join(os.homedir(), '.claude', 'projects'); }

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
  start, abort, listRuns, count, closeAll,
  listProjects, listConversations, readConversation,
  // exported for tests
  splitLines, sessionIdOf, previewOf, encodeCwd,
};
