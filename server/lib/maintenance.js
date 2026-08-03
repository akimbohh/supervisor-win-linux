// Headless Claude maintenance run. Singleton: only one run at a time.
// Spawns `claude -p` (non-interactive print mode) in the supervisor repo with
// the user's prompt on stdin, captures output, broadcasts to clients via the
// 'maintenance' WS topic.
const { spawn } = require('child_process');
const hub = require('./hub');

const MAX_LOG_BYTES = 2 * 1024 * 1024;

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

  // Pipe the prompt via stdin (not as an arg) — avoids shell-quoting issues
  // with newlines, quotes, $, etc. in the user's text. Then end stdin so
  // claude doesn't print "no stdin data received in 3s".
  let proc;
  try {
    proc = spawn('claude', ['-p'], {
      cwd,
      shell: true,
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
  appendLog('[supervisor] running: claude -p  (cwd: ' + cwd + ')\n');
  appendLog('[supervisor] piping prompt to stdin (' + wrapped.length + ' chars)\n\n');
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
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(state.proc.pid), '/f', '/t'], { shell: true, windowsHide: true });
    } else {
      state.proc.kill('SIGTERM');
    }
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
