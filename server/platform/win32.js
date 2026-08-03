// Windows platform adapter. Owns the persistent PowerShell host (avoids paying
// ~500ms to spawn a fresh powershell.exe every metrics tick) and all Windows
// spawn/kill/power/restart semantics. This is the only file that should contain
// Windows-specific process logic.
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const capabilities = require('./capabilities');

const isWin = true;

// ── Persistent PowerShell host ──────────────────────────────────────────────
let psHost = null;

class PSHost {
  constructor() {
    this.queue = [];
    this.current = null;
    this.outBuf = '';
    this.errBuf = '';
    this.dead = false;
    try {
      this.proc = cp.spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-NoLogo',
        '-OutputFormat', 'Text',
        '-Command', '-',
      ], { windowsHide: true });
      this.proc.stdin.write('$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n');
    } catch (e) {
      this.dead = true; return;
    }
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => { this.outBuf += d; this.deliver(); });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { this.errBuf += d; });
    this.proc.on('exit', () => {
      this.dead = true;
      if (this.current) { try { this.current.reject(new Error('PowerShell host exited')); } catch (e) {} this.current = null; }
      for (const q of this.queue) try { q.reject(new Error('PowerShell host exited')); } catch (e) {}
      this.queue = [];
    });
    this.proc.on('error', () => { this.dead = true; });
  }

  exec(script, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('PowerShell host is dead'));
      this.queue.push({ script, resolve, reject, timeoutMs });
      this.tryRun();
    });
  }

  tryRun() {
    if (this.dead || this.current || !this.queue.length) return;
    this.current = this.queue.shift();
    const marker = '__SUP_END_' + Math.random().toString(36).slice(2, 10) + '__';
    this.current.marker = marker;
    this.outBuf = '';
    this.current.timer = setTimeout(() => {
      if (!this.current) return;
      const cur = this.current;
      this.current = null;
      try { this.proc.kill(); } catch (e) {}
      this.dead = true;
      cur.reject(new Error('PowerShell exec timeout'));
    }, this.current.timeoutMs);
    this.current.timer.unref && this.current.timer.unref();
    try {
      this.proc.stdin.write(this.current.script + '\nWrite-Output "' + marker + '"\n');
    } catch (e) {
      const cur = this.current; this.current = null; cur.reject(e);
    }
  }

  deliver() {
    if (!this.current) return;
    const idx = this.outBuf.indexOf(this.current.marker);
    if (idx < 0) return;
    const out = this.outBuf.slice(0, idx);
    this.outBuf = this.outBuf.slice(idx + this.current.marker.length);
    if (this.current.timer) clearTimeout(this.current.timer);
    const cur = this.current;
    this.current = null;
    cur.resolve(out);
    this.tryRun();
  }

  close() { try { this.proc && this.proc.stdin.end(); } catch (e) {} }
}

function ps() {
  if (psHost && !psHost.dead) return psHost;
  psHost = new PSHost();
  return psHost.dead ? null : psHost;
}

// ── Process spawn / kill ────────────────────────────────────────────────────

function defaultShell() { return process.env.COMSPEC || 'cmd.exe'; }

function shellRunCommand(commandLine) {
  return { cmd: process.env.COMSPEC || 'cmd.exe', args: ['/c', commandLine] };
}

// On Windows `claude` is `claude.cmd`, so shell:true is required to resolve it.
function spawnManaged(cmd, args, opts = {}) {
  return cp.spawn(cmd, args || [], { ...opts, shell: true, windowsHide: opts.windowsHide !== false });
}

// taskkill /t kills the whole process tree; /f forces it.
function killTree(pid, signal) {
  if (!pid) return false;
  try { cp.spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { shell: true, windowsHide: true }); return true; }
  catch (e) { return false; }
}

// ── Metrics ──────────────────────────────────────────────────────────────

async function disks() {
  const host = ps();
  if (!host) return [];
  let out;
  try { out = await host.exec('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType | ConvertTo-Json -Compress'); }
  catch (e) { return []; }
  let arr; try { arr = JSON.parse(out); } catch (e) { return []; }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.filter(a => a && a.Size).map(a => ({
    mount: a.DeviceID, label: a.VolumeName || '',
    total: Number(a.Size), free: Number(a.FreeSpace || 0),
    used: Number(a.Size) - Number(a.FreeSpace || 0),
    pct: a.Size ? 100 * (Number(a.Size) - Number(a.FreeSpace || 0)) / Number(a.Size) : 0,
  }));
}

let _lastNet = null;
async function netSample() {
  const host = ps();
  if (!host) return { totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 };
  let arr;
  try {
    const out = await host.exec('Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress');
    arr = JSON.parse(out);
  } catch (e) {
    return _lastNet ? { totalRx: _lastNet.rx, totalTx: _lastNet.tx, rxBps: 0, txBps: 0 } : { totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 };
  }
  if (!Array.isArray(arr)) arr = [arr];
  let rx = 0, tx = 0;
  for (const a of arr) {
    if (/loopback/i.test(a.Name || '')) continue;
    rx += Number(a.ReceivedBytes || 0); tx += Number(a.SentBytes || 0);
  }
  const t = Date.now();
  const rate = _lastNet ? { rxBps: (rx - _lastNet.rx) * 1000 / Math.max(1, t - _lastNet.t), txBps: (tx - _lastNet.tx) * 1000 / Math.max(1, t - _lastNet.t) } : { rxBps: 0, txBps: 0 };
  _lastNet = { rx, tx, t };
  return { totalRx: rx, totalTx: tx, ...rate };
}

let _gpuMissing = false;
function gpu() {
  if (_gpuMissing) return Promise.resolve(null);
  return new Promise((resolve) => {
    const cmd = 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits';
    cp.exec(cmd, { timeout: 2000, windowsHide: true }, (err, out) => {
      if (err) { _gpuMissing = true; return resolve(null); }
      resolve(out.trim().split('\n').filter(Boolean).map((ln) => {
        const [name, util, memUsed, memTotal, temp] = ln.split(',').map(s => s.trim());
        return { name, util: parseFloat(util), memUsed: parseFloat(memUsed) * 1048576, memTotal: parseFloat(memTotal) * 1048576, temp: parseFloat(temp), vendor: 'nvidia' };
      }));
    });
  });
}

async function listProcesses() {
  const host = ps();
  if (!host) return [];
  try {
    const out = await host.exec("Get-Process | Select-Object Id,ProcessName,@{n='CPU';e={[math]::Round($_.CPU,1)}},@{n='Memory';e={$_.WorkingSet64}} | ConvertTo-Json -Compress", 8000);
    let arr; try { arr = JSON.parse(out); } catch (e) { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(a => ({ pid: a.Id, name: a.ProcessName, cpu: a.CPU || 0, mem: a.Memory || 0 }));
  } catch (e) { return []; }
}

async function topProcesses() {
  const host = ps();
  if (!host) return [];
  try {
    const out = await host.exec("Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 -Property Id,ProcessName,@{n='CPU';e={[math]::Round($_.CPU,1)}},@{n='Memory';e={$_.WorkingSet64}} | ConvertTo-Json -Compress");
    let arr; try { arr = JSON.parse(out); } catch (e) { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(a => ({ pid: a.Id, name: a.ProcessName, cpu: a.CPU, mem: a.Memory }));
  } catch (e) { return []; }
}

function killPid(pid) {
  return new Promise((resolve) => {
    cp.exec('taskkill /pid ' + pid + ' /f /t', { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

// ── Power ───────────────────────────────────────────────────────────────

function powerAction(action) {
  const map = {
    shutdown: 'shutdown /s /t 5',
    restart: 'shutdown /r /t 5',
    sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
    cancel: 'shutdown /a',
  };
  const cmd = map[action];
  if (!cmd) return Promise.resolve({ ok: false, error: 'Unknown action' });
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr || err.message || '').trim() });
      else resolve({ ok: true, scheduled: cmd });
    });
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

function serviceStatus() { return { manager: 'sc' }; }

function selfRestart() {
  const repoRoot = path.join(__dirname, '..', '..');
  const startBat = path.join(repoRoot, 'start.bat');
  if (!fs.existsSync(startBat)) throw new Error('start.bat not found at ' + startBat);
  cp.spawn('cmd', ['/c', 'start', '""', '/D', repoRoot, startBat], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  setTimeout(() => {
    try { fs.unlinkSync(path.join(repoRoot, 'data', 'supervisor.pid')); } catch (e) {}
    process.exit(0);
  }, 500);
  return { method: 'start.bat' };
}

function close() { if (psHost) { try { psHost.close(); } catch (e) {} } }

module.exports = {
  isWin,
  _ps: ps,          // exposed for any windows-only feature that needs the host
  defaultShell,
  shellRunCommand,
  spawnManaged,
  killTree,
  disks,
  netSample,
  gpu,
  listProcesses,
  topProcesses,
  killPid,
  powerAction,
  serviceStatus,
  selfRestart,
  close,
  capabilities: capabilities.get,
};
