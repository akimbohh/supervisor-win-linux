// Claude Code session manager: spawn, capture log, persist metadata, broadcast updates.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const hub = require('./hub');
const { readJSON, writeJSON, dataPath, ensureDataDir } = require('./store');
const { ensureSafe } = require('./paths');
const settings = require('./settings');
const claudeConfig = require('./claude-config');
const platform = require('../platform');

const SESSIONS_FILE = 'sessions.json';
const LOG_DIR = 'session-logs';
const MAX_LOG_BYTES = 10 * 1024 * 1024; // per-session ring cap (in memory)
const LOG_TAIL_KEEP = 256 * 1024;       // bytes kept persisted on disk for resume
// Resource ceiling (MED-5): cap concurrently-running Claude sessions.
const MAX_SESSIONS = parseInt(process.env.SUPERVISOR_MAX_SESSIONS || '32', 10);

const sessions = new Map(); // id -> { meta, proc, logBuf, listeners }

function newId() {
  const id = 's' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex');
  return id;
}

function topicFor(id) { return 'session:' + id; }

function ensureLogDir() {
  ensureDataDir();
  fs.mkdirSync(dataPath(LOG_DIR), { recursive: true });
}

function logFile(id) { return path.join(dataPath(LOG_DIR), id + '.log'); }

function loadAll() {
  const data = readJSON(SESSIONS_FILE, { sessions: [] });
  return data.sessions || [];
}
function saveAll(list) { writeJSON(SESSIONS_FILE, { sessions: list }); }

function persistMeta() {
  const list = [...sessions.values()].map(s => ({
    id: s.meta.id,
    folder: s.meta.folder,
    args: s.meta.args,
    env: s.meta.env || null,
    prePrompt: s.meta.prePrompt || null,
    status: s.meta.status,
    startedAt: s.meta.startedAt,
    exitedAt: s.meta.exitedAt || null,
    exitCode: s.meta.exitCode != null ? s.meta.exitCode : null,
    pid: s.meta.pid || null,
    name: s.meta.name || null,
    tag: s.meta.tag || null,
    model: s.meta.model || null,
    lastLog: tailString(s.logBuf || '', 400),
  }));
  saveAll(list);
}

function tailString(s, n) { return s.length > n ? s.slice(-n) : s; }

function appendLog(id, chunk) {
  const s = sessions.get(id);
  if (!s) return;
  let buf = s.logBuf + chunk;
  if (buf.length > MAX_LOG_BYTES) buf = buf.slice(buf.length - MAX_LOG_BYTES);
  s.logBuf = buf;
  // Periodically persist tail to disk so we can resume the view across restarts
  if (Date.now() - s._lastPersist > 1000) {
    s._lastPersist = Date.now();
    try { fs.writeFileSync(logFile(id), tailString(buf, LOG_TAIL_KEEP)); } catch (e) {}
  }
  hub.publish(topicFor(id), { event: 'log', chunk });
  // Heuristic: detect "asks for input"
  detectIntent(s, chunk);
}

function detectIntent(s, chunk) {
  const t = chunk.toLowerCase();
  if (!s.meta._lastNotify) s.meta._lastNotify = 0;
  // Very rough detection — Claude prompts often contain '?' or 'input'.
  if ((t.includes('do you want') || /\?\s*(\(y\/n\)|\(yes\/no\))/.test(t)) && Date.now() - s.meta._lastNotify > 5_000) {
    s.meta._lastNotify = Date.now();
    fireNotification('asked', s);
  }
}

function fireNotification(kind, s) {
  hub.publish('notify', {
    kind,                                       // 'finished' | 'asked' | 'error'
    sessionId: s.meta.id,
    folder: s.meta.folder,
    name: s.meta.name || null,
    status: s.meta.status,
    when: Date.now(),
  });
}

function listMeta() {
  return [...sessions.values()].map(s => ({
    id: s.meta.id,
    folder: s.meta.folder,
    args: s.meta.args,
    name: s.meta.name || null,
    tag: s.meta.tag || null,
    status: s.meta.status,
    startedAt: s.meta.startedAt,
    exitedAt: s.meta.exitedAt || null,
    exitCode: s.meta.exitCode != null ? s.meta.exitCode : null,
    pid: s.meta.pid || null,
    model: s.meta.model || null,
    lastLog: tailString(s.logBuf || '', 200),
  }));
}

function get(id) {
  const s = sessions.get(id);
  if (!s) return null;
  return {
    ...s.meta,
    log: s.logBuf,
    proc: undefined,
  };
}

async function start({ folder, args, env, prePrompt, name, tag, command }) {
  ensureSafe(folder);
  if (!fs.existsSync(folder)) { const e = new Error('Folder does not exist'); e.code = 'ENOENT'; throw e; }
  const running = [...sessions.values()].filter(s => s.meta.status === 'running' || s.meta.status === 'killing').length;
  if (running >= MAX_SESSIONS) {
    const e = new Error('Session limit reached (' + MAX_SESSIONS + '). Stop a session or raise SUPERVISOR_MAX_SESSIONS.');
    e.code = 'ELIMIT';
    throw e;
  }

  // Pre-accept Claude Code's workspace trust dialog. `claude rc` requires this
  // to be done interactively in a real PTY — pre-writing ~/.claude.json is not
  // honoured. So we briefly run interactive `claude` via node-pty, send Enter
  // (the default option is "Yes, I trust this folder"), then kill it. Cached
  // per-folder so we only pay the ~1.5 s cost on first launch in a folder.
  if (settings.get().autoTrustClaudeFolders !== false) {
    try { await claudeConfig.trustFolderInteractive(folder); } catch (e) {}
  }

  const id = newId();
  // Resolve command: default 'claude rc' (matches the original behaviour).
  const cmd = command || 'claude';
  let cmdArgs = Array.isArray(args) && args.length ? args : ['rc'];
  // Allow caller to pass a single command string with embedded args
  if (Array.isArray(args)) cmdArgs = args;

  const procEnv = { ...process.env, ...(env || {}) };
  let proc;
  try {
    // Platform adapter picks shell:true (Windows, for claude.cmd) vs a detached
    // process group (POSIX, so killTree reaches `claude`, not just a sh wrapper).
    proc = platform.spawnManaged(cmd, cmdArgs, { cwd: folder, windowsHide: false, env: procEnv });
  } catch (e) {
    const err = new Error('Failed to spawn: ' + e.message); err.code = 'ESPAWN'; throw err;
  }

  const meta = {
    id, folder, args: cmdArgs, env: env || null, prePrompt: prePrompt || null,
    name: name || null, tag: tag || null, model: null,
    status: 'running', startedAt: new Date().toISOString(),
    exitedAt: null, exitCode: null, pid: proc.pid,
    command: cmd,
  };
  const session = { meta, proc, logBuf: '', _lastPersist: 0 };
  sessions.set(id, session);

  proc.stdout && proc.stdout.on('data', (chunk) => appendLog(id, chunk.toString()));
  proc.stderr && proc.stderr.on('data', (chunk) => appendLog(id, chunk.toString()));

  proc.on('exit', (code, signal) => {
    meta.status = signal === 'SIGTERM' ? 'killed' : ('exited (' + (code != null ? 'code ' + code : signal) + ')');
    meta.exitedAt = new Date().toISOString();
    meta.exitCode = code != null ? code : null;
    appendLog(id, '\n[supervisor] process exited: ' + meta.status + '\n');
    hub.publish(topicFor(id), { event: 'status', status: meta.status });
    hub.publish('sessions', { event: 'changed', id });
    fireNotification(meta.exitCode === 0 ? 'finished' : 'error', session);
    persistMeta();
  });
  proc.on('error', (err) => {
    meta.status = 'error: ' + err.message;
    appendLog(id, '\n[supervisor] error: ' + err.message + '\n');
    hub.publish(topicFor(id), { event: 'status', status: meta.status });
    fireNotification('error', session);
    persistMeta();
  });

  // Send the optional pre-prompt to stdin.
  if (prePrompt && proc.stdin) {
    setTimeout(() => {
      try {
        proc.stdin.write(prePrompt + '\n');
      } catch (e) {}
    }, 800);
  }

  hub.publish('sessions', { event: 'created', id });
  persistMeta();
  return get(id);
}

function sendInput(id, text) {
  const s = sessions.get(id);
  if (!s) throw new Error('Session not found');
  if (!s.proc || s.proc.killed) throw new Error('Process is not running');
  s.proc.stdin.write(text);
}

function kill(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    if (s.proc && s.proc.pid) platform.killTree(s.proc.pid, 'SIGTERM');
    s.meta.status = 'killing';
    hub.publish(topicFor(id), { event: 'status', status: s.meta.status });
    hub.publish('sessions', { event: 'changed', id });
    // Safety net: if the exit event doesn't propagate within 5 s (can happen
    // when shell:true wraps cmd.exe and the child detaches), force-mark dead
    // so the session isn't stuck in 'killing' forever.
    setTimeout(() => {
      if (sessions.get(id) === s && s.meta.status === 'killing') {
        s.meta.status = 'killed';
        s.meta.exitedAt = new Date().toISOString();
        hub.publish(topicFor(id), { event: 'status', status: s.meta.status });
        hub.publish('sessions', { event: 'changed', id });
        persistMeta();
      }
    }, 5000).unref();
    return true;
  } catch (e) { return false; }
}

async function restart(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('Not found');
  const meta = s.meta;
  if (s.proc && !s.proc.killed && (meta.status === 'running' || meta.status === 'killing')) kill(id);
  // Spawn a new session reusing folder/args/env/prePrompt
  return start({
    folder: meta.folder,
    args: meta.args,
    env: meta.env,
    prePrompt: meta.prePrompt,
    name: meta.name,
    tag: meta.tag,
    command: meta.command,
  });
}

// Always succeeds. If the underlying process is still alive, fire taskkill /f /t
// in the background and drop the session record immediately — the OS finishes
// reaping while the UI moves on.
function clear(id) {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.meta.status === 'running' || s.meta.status === 'killing') {
    try { if (s.proc && s.proc.pid) platform.killTree(s.proc.pid, 'SIGKILL'); } catch (e) {}
  }
  sessions.delete(id);
  try { fs.unlinkSync(logFile(id)); } catch (e) {}
  hub.publish('sessions', { event: 'removed', id });
  persistMeta();
  return true;
}

function clearAllExited() {
  let n = 0;
  for (const id of [...sessions.keys()]) {
    const s = sessions.get(id);
    if (s.meta.status !== 'running' && s.meta.status !== 'killing') {
      sessions.delete(id);
      try { fs.unlinkSync(logFile(id)); } catch (e) {}
      n++;
    }
  }
  hub.publish('sessions', { event: 'cleared' });
  persistMeta();
  return n;
}

function setName(id, name, tag) {
  const s = sessions.get(id);
  if (!s) return false;
  if (typeof name === 'string') s.meta.name = name;
  if (typeof tag === 'string') s.meta.tag = tag;
  persistMeta();
  hub.publish('sessions', { event: 'changed', id });
  return true;
}

function bootRestore() {
  // Restore prior session metadata as 'exited' shells (we can't reattach).
  ensureLogDir();
  const saved = loadAll();
  for (const m of saved) {
    if (m.status === 'running' || m.status === 'killing') m.status = 'exited (supervisor restarted)';
    const s = {
      meta: { ...m, pid: null },
      proc: { killed: true, stdin: null },  // no real proc
      logBuf: (() => {
        try { return fs.readFileSync(logFile(m.id), 'utf8'); } catch (e) { return m.lastLog || ''; }
      })(),
      _lastPersist: 0,
    };
    sessions.set(m.id, s);
  }
}

function closeAll() {
  for (const s of sessions.values()) {
    try {
      if (s.proc && !s.proc.killed && s.proc.pid) platform.killTree(s.proc.pid, 'SIGTERM');
    } catch (e) {}
  }
  persistMeta();
}

bootRestore();

module.exports = {
  start, kill, restart, clear, clearAllExited, sendInput, setName,
  list: listMeta, get, closeAll,
};
