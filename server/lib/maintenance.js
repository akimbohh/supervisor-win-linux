// Headless Claude maintenance run. Singleton: only one run at a time.
// Spawns `claude -p` (non-interactive print mode) in the supervisor repo with
// the user's prompt on stdin, captures output, broadcasts to clients via the
// 'maintenance' WS topic.
const hub = require('./hub');
const platform = require('../platform');
const settings = require('./settings');

const MAX_LOG_BYTES = 2 * 1024 * 1024;
// Hard ceiling so a stalled run can never lock maintenance permanently (§6).
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

let state = {
  status: 'idle',          // 'idle' | 'running' | 'done' | 'error'
  prompt: '',
  startedAt: null,
  exitedAt: null,
  exitCode: null,
  log: '',
  proc: null,
};

function snapshot() {
  return {
    status: state.status,
    prompt: state.prompt,
    startedAt: state.startedAt,
    exitedAt: state.exitedAt,
    exitCode: state.exitCode,
    log: state.log,
  };
}

function broadcast(event, extra) {
  hub.publish('maintenance', { event, ...(extra || {}), state: snapshot() });
}

function appendLog(chunk) {
  let buf = state.log + chunk;
  if (buf.length > MAX_LOG_BYTES) buf = buf.slice(buf.length - MAX_LOG_BYTES);
  state.log = buf;
  hub.publish('maintenance', { event: 'log', chunk });
}

function isBusy() { return state.status === 'running'; }

function start({ prompt, cwd }) {
  if (isBusy()) {
    const e = new Error('A maintenance run is already in progress'); e.code = 'EBUSY'; throw e;
  }
  state = {
    status: 'running',
    prompt,
    startedAt: new Date().toISOString(),
    exitedAt: null,
    exitCode: null,
    log: '',
    proc: null,
  };

  // Wrap the user's request in a directive preamble so claude makes file
  // changes instead of replying conversationally. `-p` (print mode) plus
  // `--dangerously-skip-permissions` lets it use Edit/Write tools without
  // interactive permission prompts.
  const wrapped =
    'You are a coding agent operating on the Supervisor repository at ' + cwd + '. ' +
    'Make the user\'s requested change directly by editing files. ' +
    'Do not ask clarifying questions — make reasonable assumptions and apply the change. ' +
    'When finished, list the files you modified.\n\n' +
    'User request:\n' + prompt;

  // Build args. The comment used to claim --dangerously-skip-permissions was
  // passed but it wasn't (§6): with piped stdio and no TTY, a tool-permission
  // prompt could never be answered and the run hung forever, locking isBusy().
  // The flag IS the intended behavior for a self-editing agent; it is on by
  // default but can be turned off (settings.maintenanceSkipPermissions=false),
  // in which case a run that needs a permission will simply exit rather than
  // hang, because of the hard timeout below.
  const cfg = settings.get();
  const args = ['-p'];
  if (cfg.maintenanceSkipPermissions !== false) args.push('--dangerously-skip-permissions');

  // Pipe the prompt via stdin (not as an arg) — avoids shell-quoting issues
  // with newlines, quotes, $, etc. in the user's text. Then end stdin so
  // claude doesn't print "no stdin data received in 3s".
  let proc;
  try {
    proc = platform.spawnManaged('claude', args, {
      cwd,
      windowsHide: false,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    state.status = 'error';
    state.log = '[supervisor] failed to spawn claude: ' + e.message + '\n';
    state.exitedAt = new Date().toISOString();
    broadcast('exit');
    throw e;
  }
  state.proc = proc;
  appendLog('[supervisor] running: claude ' + args.join(' ') + '  (cwd: ' + cwd + ')\n');
  appendLog('[supervisor] piping prompt to stdin (' + wrapped.length + ' chars)\n\n');

  // Hard timeout: kill and unlock if the run overruns, so isBusy() can never
  // wedge maintenance permanently (§6).
  const timeoutMs = Number(cfg.maintenanceTimeoutMs) || DEFAULT_TIMEOUT_MS;
  state.timer = setTimeout(() => {
    if (state.proc) {
      appendLog('\n[supervisor] maintenance timed out after ' + Math.round(timeoutMs / 1000) + 's — killing.\n');
      try { platform.killTree(state.proc.pid, 'SIGTERM'); } catch (e) {}
    }
  }, timeoutMs);
  state.timer.unref && state.timer.unref();
  try {
    if (proc.stdin) {
      proc.stdin.write(wrapped);
      proc.stdin.end();
    }
  } catch (e) {
    appendLog('[supervisor] stdin write failed: ' + e.message + '\n');
  }

  proc.stdout && proc.stdout.on('data', (b) => appendLog(b.toString()));
  proc.stderr && proc.stderr.on('data', (b) => appendLog(b.toString()));
  proc.on('error', (err) => {
    appendLog('\n[supervisor] error: ' + err.message + '\n');
  });
  proc.on('exit', (code) => {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    state.exitedAt = new Date().toISOString();
    state.exitCode = code;
    state.status = code === 0 ? 'done' : 'error';
    state.proc = null;
    appendLog('\n[supervisor] claude exited with code ' + code + '\n');
    broadcast('exit');
  });

  broadcast('started');
  return snapshot();
}

function cancel() {
  if (!isBusy() || !state.proc || !state.proc.pid) return false;
  try {
    platform.killTree(state.proc.pid, 'SIGTERM');
    return true;
  } catch (e) { return false; }
}

function reset() {
  if (isBusy()) return false;
  state = {
    status: 'idle',
    prompt: '',
    startedAt: null,
    exitedAt: null,
    exitCode: null,
    log: '',
    proc: null,
  };
  broadcast('reset');
  return true;
}

module.exports = { start, cancel, reset, snapshot, isBusy };
