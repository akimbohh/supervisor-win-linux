// Persistent shell sessions. Uses node-pty if available, else child_process.spawn fallback.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const hub = require('./hub');
const { dataPath, ensureDataDir } = require('./store');
const { ensureSafe } = require('./paths');

let pty = null;
try { pty = require('node-pty'); } catch (e) { /* fallback below */ }

const SCROLLBACK_MAX = 10 * 1024 * 1024; // 10 MB on disk per shell
const SCROLLBACK_DIR = 'shells';
const META_FILE = 'shells.json';
// Resource ceiling (MED-5): cap concurrent PTYs/child processes per instance.
const MAX_SHELLS = parseInt(process.env.SUPERVISOR_MAX_SHELLS || '24', 10);

const shells = new Map(); // id -> Shell
let nextNum = 1;

function ensureShellDir() {
  ensureDataDir();
  fs.mkdirSync(dataPath(SCROLLBACK_DIR), { recursive: true });
}
function scrollbackFile(id) { return path.join(dataPath(SCROLLBACK_DIR), id + '.log'); }

function topic(id) { return 'shell:' + id; }
function newId() { return 'sh' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex'); }

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}
function defaultArgs() {
  return [];
}

class Shell {
  constructor({ id, name, cwd, shellPath, shellArgs, cols = 100, rows = 30 }) {
    this.id = id;
    this.name = name;
    this.cwd = cwd || os.homedir();
    this.shellPath = shellPath || defaultShell();
    this.shellArgs = Array.isArray(shellArgs) ? shellArgs : defaultArgs();
    this.cols = cols; this.rows = rows;
    this.alive = false;
    this.usingPty = !!pty;
    this.scrollback = '';     // bytes added since last persist
    this.size = 0;             // total file size on disk
    this.history = [];
    this.lastActivity = Date.now();

    this._spawn();
  }

  _spawn() {
    try { ensureSafe(this.cwd); } catch (e) { this.cwd = os.homedir(); }
    if (!fs.existsSync(this.cwd)) this.cwd = os.homedir();

    if (this.usingPty) {
      this.proc = pty.spawn(this.shellPath, this.shellArgs, {
        name: 'xterm-256color',
        cols: this.cols, rows: this.rows,
        cwd: this.cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      this.proc.onData((d) => this._onData(d));
      this.proc.onExit(({ exitCode, signal }) => this._onExit(exitCode, signal));
    } else {
      // Fallback: pipe stdio. No PTY semantics (no resize, no tty colours).
      this.proc = cp.spawn(this.shellPath, this.shellArgs, {
        cwd: this.cwd,
        windowsHide: true,
        env: { ...process.env, TERM: 'dumb' },
      });
      this.proc.stdout.on('data', (d) => this._onData(d.toString()));
      this.proc.stderr.on('data', (d) => this._onData(d.toString()));
      this.proc.on('exit', (code, signal) => this._onExit(code, signal));
      // Send a banner so the user knows this is the fallback.
      this._onData('[supervisor] node-pty unavailable — using piped fallback. No tty features.\r\n');
    }
    this.alive = true;
  }

  _onData(s) {
    this.lastActivity = Date.now();
    hub.publish(topic(this.id), { event: 'data', data: s });
    this._appendScrollback(s);
  }

  _onExit(code, signal) {
    this.alive = false;
    hub.publish(topic(this.id), { event: 'exit', code, signal });
    this._appendScrollback('\r\n[supervisor] shell exited (' + (code != null ? 'code ' + code : signal) + ')\r\n');
    persistMeta();
    hub.publish('shells', { event: 'changed', id: this.id });
  }

  _appendScrollback(s) {
    this.scrollback += s;
    if (this.scrollback.length > 64 * 1024) this._flushScrollback();
  }

  _flushScrollback() {
    if (!this.scrollback) return;
    ensureShellDir();
    try {
      fs.appendFileSync(scrollbackFile(this.id), this.scrollback);
      this.size += this.scrollback.length;
      this.scrollback = '';
      // Cap file size — rotate if too large
      if (this.size > SCROLLBACK_MAX) {
        const data = fs.readFileSync(scrollbackFile(this.id));
        const keep = data.subarray(data.length - SCROLLBACK_MAX);
        fs.writeFileSync(scrollbackFile(this.id), keep);
        this.size = keep.length;
      }
    } catch (e) {}
  }

  write(data) {
    if (!this.alive) return false;
    if (this.usingPty) this.proc.write(data);
    else this.proc.stdin.write(data);
    return true;
  }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    if (this.alive && this.usingPty) {
      try { this.proc.resize(cols, rows); } catch (e) {}
    }
  }

  kill() {
    try {
      if (this.alive) {
        if (this.usingPty) this.proc.kill();
        else if (process.platform === 'win32' && this.proc.pid) cp.spawn('taskkill', ['/pid', String(this.proc.pid), '/f', '/t'], { shell: true, windowsHide: true });
        else this.proc.kill('SIGTERM');
      }
    } catch (e) {}
    this.alive = false;
  }

  scrollbackText() {
    this._flushScrollback();
    try { return fs.readFileSync(scrollbackFile(this.id), 'utf8'); }
    catch (e) { return ''; }
  }
}

function meta(s) {
  return {
    id: s.id, name: s.name, cwd: s.cwd, shellPath: s.shellPath, shellArgs: s.shellArgs,
    cols: s.cols, rows: s.rows, alive: s.alive, usingPty: s.usingPty, lastActivity: s.lastActivity,
  };
}

function list() { return [...shells.values()].map(meta); }

function get(id) {
  const s = shells.get(id);
  if (!s) return null;
  return { ...meta(s), scrollback: s.scrollbackText() };
}

function create({ name, cwd, shellPath, shellArgs, cols, rows } = {}) {
  if (shells.size >= MAX_SHELLS) {
    const e = new Error('Shell limit reached (' + MAX_SHELLS + '). Close a shell or raise SUPERVISOR_MAX_SHELLS.');
    e.code = 'ELIMIT';
    throw e;
  }
  const id = newId();
  if (!name) name = 'Shell ' + (nextNum++);
  const s = new Shell({ id, name, cwd, shellPath, shellArgs, cols, rows });
  shells.set(id, s);
  hub.publish('shells', { event: 'created', id });
  persistMeta();
  return meta(s);
}

function write(id, data) {
  const s = shells.get(id); if (!s) return false;
  return s.write(data);
}

function resize(id, cols, rows) {
  const s = shells.get(id); if (!s) return false;
  s.resize(cols, rows);
  return true;
}

function kill(id) {
  const s = shells.get(id); if (!s) return false;
  s.kill();
  return true;
}

function rename(id, name) {
  const s = shells.get(id); if (!s) return false;
  s.name = name;
  persistMeta();
  hub.publish('shells', { event: 'changed', id });
  return true;
}

function destroy(id) {
  const s = shells.get(id); if (!s) return false;
  s.kill();
  shells.delete(id);
  try { fs.unlinkSync(scrollbackFile(id)); } catch (e) {}
  persistMeta();
  hub.publish('shells', { event: 'removed', id });
  return true;
}

function persistMeta() {
  const data = { shells: list() };
  try { fs.writeFileSync(dataPath(META_FILE), JSON.stringify(data, null, 2)); } catch (e) {}
}

function flushAll() {
  for (const s of shells.values()) s._flushScrollback();
}

function closeAll() {
  flushAll();
  for (const s of [...shells.values()]) {
    try { s.kill(); } catch (e) {}
  }
}

setInterval(flushAll, 5000).unref();

module.exports = { create, list, get, write, resize, kill, rename, destroy, closeAll };
