// System metrics: CPU, memory, disks, network, uptime, GPU. Cross-platform with
// Windows-first. To avoid spawning a fresh PowerShell every tick (~500 ms each),
// we keep one PS process alive and pipe queries to it, delimited by a marker.

const os = require('os');
const fs = require('fs');
const cp = require('child_process');
const hub = require('./hub');

const isWin = process.platform === 'win32';

// ────────────────────────────────────────────────────────────────────
// Persistent PowerShell host (Windows only)
// ────────────────────────────────────────────────────────────────────

let psHost = null;

class PSHost {
  constructor() {
    this.queue = [];
    this.current = null;
    this.outBuf = '';
    this.errBuf = '';
    this.dead = false;
    try {
      // -NoExit keeps it alive after a piped command; -Command - reads from stdin.
      // Using single OutputEncoding=UTF8 avoids Windows-CP-1252 mangling.
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
      if (this.current) {
        try { this.current.reject(new Error('PowerShell host exited')); } catch (e) {}
        this.current = null;
      }
      // Reject anything queued.
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
      // The PS host is in an unknown state — kill and reset.
      try { this.proc.kill(); } catch (e) {}
      this.dead = true;
      cur.reject(new Error('PowerShell exec timeout'));
    }, this.current.timeoutMs).unref();
    try {
      this.proc.stdin.write(this.current.script + '\nWrite-Output "' + marker + '"\n');
    } catch (e) {
      const cur = this.current; this.current = null;
      cur.reject(e);
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

  close() {
    try { this.proc && this.proc.stdin.end(); } catch (e) {}
  }
}

function ps() {
  if (!isWin) return null;
  if (psHost && !psHost.dead) return psHost;
  psHost = new PSHost();
  return psHost.dead ? null : psHost;
}

// ────────────────────────────────────────────────────────────────────
// CPU
// ────────────────────────────────────────────────────────────────────

let prevCpu = null;
function cpuUsage() {
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const c of cpus) { user += c.times.user; nice += c.times.nice; sys += c.times.sys; idle += c.times.idle; irq += c.times.irq; }
  const total = user + nice + sys + idle + irq;
  const cur = { total, idle, perCpu: cpus.map(c => c.times) };
  if (!prevCpu) { prevCpu = cur; return { pct: 0, perCpu: cpus.map(() => 0) }; }
  const dTotal = total - prevCpu.total;
  const dIdle = idle - prevCpu.idle;
  const pct = dTotal > 0 ? Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal))) : 0;
  const perCpu = cpus.map((c, i) => {
    const p = prevCpu.perCpu[i];
    if (!p) return 0;
    const tt = (c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq)
             - (p.user + p.nice + p.sys + p.idle + p.irq);
    const ti = c.times.idle - p.idle;
    return tt > 0 ? Math.max(0, Math.min(100, 100 * (1 - ti / tt))) : 0;
  });
  prevCpu = cur;
  return { pct, perCpu };
}

function memInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  return { total, free, used: total - free, pct: total ? (100 * (total - free) / total) : 0 };
}

function uptime() { return os.uptime(); }

// ────────────────────────────────────────────────────────────────────
// Disks (cached — they barely change second-to-second)
// ────────────────────────────────────────────────────────────────────

let disksCache = null, disksCacheT = 0;
const DISKS_TTL = 30_000;

async function disks() {
  if (disksCache && Date.now() - disksCacheT < DISKS_TTL) return disksCache;
  try { disksCache = isWin ? await disksWin() : await disksUnix(); }
  catch (e) { disksCache = disksCache || []; }
  disksCacheT = Date.now();
  return disksCache;
}

async function disksWin() {
  const host = ps();
  if (!host) return [];
  // PowerShell version of the wmic logicaldisk query.
  const out = await host.exec(
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType | ConvertTo-Json -Compress'
  );
  let arr;
  try { arr = JSON.parse(out); } catch (e) { return []; }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.filter(a => a && a.Size).map(a => ({
    mount: a.DeviceID,
    label: a.VolumeName || '',
    total: Number(a.Size),
    free: Number(a.FreeSpace || 0),
    used: Number(a.Size) - Number(a.FreeSpace || 0),
    pct: a.Size ? 100 * (Number(a.Size) - Number(a.FreeSpace || 0)) / Number(a.Size) : 0,
  }));
}

function disksUnix() {
  return new Promise((resolve) => {
    cp.exec('df -kP', { timeout: 3000 }, (err, out) => {
      if (err) return resolve([]);
      const lines = out.trim().split(/\r?\n/);
      const out2 = [];
      for (const ln of lines.slice(1)) {
        const m = ln.split(/\s+/);
        if (m.length < 6) continue;
        const total = parseInt(m[1], 10) * 1024;
        const used = parseInt(m[2], 10) * 1024;
        const free = parseInt(m[3], 10) * 1024;
        const mount = m.slice(5).join(' ');
        if (!mount.startsWith('/') && !/^[A-Za-z]:/.test(mount)) continue;
        out2.push({ mount, label: m[0], total, used, free, pct: total ? (100 * used / total) : 0 });
      }
      resolve(out2);
    });
  });
}

// ────────────────────────────────────────────────────────────────────
// Network
// ────────────────────────────────────────────────────────────────────

let lastNet = null;
async function netSample() {
  if (!isWin) {
    try {
      const data = fs.readFileSync('/proc/net/dev', 'utf8');
      let rx = 0, tx = 0;
      for (const ln of data.split('\n').slice(2)) {
        const parts = ln.trim().split(/[:\s]+/);
        if (parts.length < 10) continue;
        if (parts[0] === 'lo') continue;
        rx += parseInt(parts[1] || '0', 10);
        tx += parseInt(parts[9] || '0', 10);
      }
      const t = Date.now();
      const rate = lastNet ? { rxBps: (rx - lastNet.rx) * 1000 / Math.max(1, t - lastNet.t), txBps: (tx - lastNet.tx) * 1000 / Math.max(1, t - lastNet.t) } : { rxBps: 0, txBps: 0 };
      lastNet = { rx, tx, t };
      return { totalRx: rx, totalTx: tx, ...rate };
    } catch (e) { return { totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 }; }
  }
  const host = ps();
  if (!host) return { totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 };
  let arr;
  try {
    const out = await host.exec('Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress');
    arr = JSON.parse(out);
  } catch (e) { return lastNet ? { totalRx: lastNet.rx, totalTx: lastNet.tx, rxBps: 0, txBps: 0 } : { totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 }; }
  if (!Array.isArray(arr)) arr = [arr];
  let rx = 0, tx = 0;
  for (const a of arr) {
    if (/loopback/i.test(a.Name || '')) continue;
    rx += Number(a.ReceivedBytes || 0);
    tx += Number(a.SentBytes || 0);
  }
  const t = Date.now();
  const rate = lastNet ? { rxBps: (rx - lastNet.rx) * 1000 / Math.max(1, t - lastNet.t), txBps: (tx - lastNet.tx) * 1000 / Math.max(1, t - lastNet.t) } : { rxBps: 0, txBps: 0 };
  lastNet = { rx, tx, t };
  return { totalRx: rx, totalTx: tx, ...rate };
}

// ────────────────────────────────────────────────────────────────────
// GPU (Nvidia only; cached + skipped after persistent failure)
// ────────────────────────────────────────────────────────────────────

let gpuCache = null, gpuCacheT = 0, gpuMissing = false;
const GPU_TTL = 30_000;

function gpu() {
  if (gpuMissing) return Promise.resolve(null);
  if (gpuCache != null && Date.now() - gpuCacheT < GPU_TTL) return Promise.resolve(gpuCache);
  return new Promise((resolve) => {
    const cmd = 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits';
    cp.exec(cmd, { timeout: 2000, windowsHide: true }, (err, out) => {
      if (err) { gpuMissing = true; gpuCache = null; gpuCacheT = Date.now(); return resolve(null); }
      const cards = out.trim().split('\n').filter(Boolean).map((ln) => {
        const [name, util, memUsed, memTotal, temp] = ln.split(',').map(s => s.trim());
        return { name, util: parseFloat(util), memUsed: parseFloat(memUsed) * 1024 * 1024, memTotal: parseFloat(memTotal) * 1024 * 1024, temp: parseFloat(temp) };
      });
      gpuCache = cards; gpuCacheT = Date.now(); resolve(cards);
    });
  });
}

// ────────────────────────────────────────────────────────────────────
// Top processes
// ────────────────────────────────────────────────────────────────────

async function topProcsWin() {
  const host = ps();
  if (!host) return [];
  try {
    const out = await host.exec(
      'Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 -Property Id,ProcessName,@{n=\'CPU\';e={[math]::Round($_.CPU,1)}},@{n=\'Memory\';e={$_.WorkingSet64}} | ConvertTo-Json -Compress'
    );
    let arr; try { arr = JSON.parse(out); } catch (e) { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(a => ({ pid: a.Id, name: a.ProcessName, cpu: a.CPU, mem: a.Memory }));
  } catch (e) { return []; }
}
function topProcsUnix() {
  return new Promise((resolve) => {
    cp.exec('ps -eo pid,comm,%cpu,rss --sort=-%cpu | head -n 13', { timeout: 3000 }, (err, out) => {
      if (err) return resolve([]);
      const lines = out.trim().split('\n').slice(1);
      resolve(lines.map(l => {
        const m = l.trim().split(/\s+/);
        return { pid: parseInt(m[0], 10), name: m[1], cpu: parseFloat(m[2]), mem: parseInt(m[3], 10) * 1024 };
      }));
    });
  });
}
async function topProcs() { return isWin ? topProcsWin() : topProcsUnix(); }

// ────────────────────────────────────────────────────────────────────
// Snapshot
// ────────────────────────────────────────────────────────────────────

async function snapshot() {
  // CPU + mem are local syscalls — instant. Disks + GPU come from cache most ticks.
  // Net + topProcs go through the persistent PowerShell host — sub-millisecond IPC.
  const [d, n, g, top] = await Promise.all([disks(), netSample(), gpu(), topProcs()]);
  return {
    t: Date.now(),
    cpu: cpuUsage(),
    mem: memInfo(),
    disks: d,
    net: n,
    gpu: g,
    uptime: uptime(),
    topProcs: top,
    host: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: (os.cpus()[0] || {}).model || 'unknown', cpuCount: os.cpus().length },
  };
}

// ────────────────────────────────────────────────────────────────────
// Process list (full)
// ────────────────────────────────────────────────────────────────────

async function listProcsWin() {
  const host = ps();
  if (!host) return [];
  try {
    // Path is intentionally omitted — accessing it requires opening each
    // process handle, which throws access-denied for system processes and
    // adds ~2 s on a typical Windows box for ~400 processes. CPU+memory
    // access doesn't have that problem.
    const out = await host.exec(
      'Get-Process | Select-Object Id,ProcessName,@{n=\'CPU\';e={[math]::Round($_.CPU,1)}},@{n=\'Memory\';e={$_.WorkingSet64}} | ConvertTo-Json -Compress',
      8000
    );
    let arr; try { arr = JSON.parse(out); } catch (e) { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(a => ({ pid: a.Id, name: a.ProcessName, cpu: a.CPU || 0, mem: a.Memory || 0 }));
  } catch (e) { return []; }
}
function listProcsUnix() {
  return new Promise((resolve, reject) => {
    cp.exec('ps -eo pid,comm,%cpu,rss', { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(err);
      const lines = out.trim().split('\n').slice(1);
      resolve(lines.map(l => {
        const m = l.trim().split(/\s+/);
        return { pid: parseInt(m[0], 10), name: m[1], cpu: parseFloat(m[2]), mem: parseInt(m[3], 10) * 1024 };
      }));
    });
  });
}
async function listProcs() { return isWin ? listProcsWin() : listProcsUnix(); }

function killPid(pid) {
  return new Promise((resolve) => {
    if (isWin) {
      cp.exec('taskkill /pid ' + pid + ' /f /t', { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
    } else {
      try { process.kill(pid, 'SIGTERM'); resolve(true); }
      catch (e) { resolve(false); }
    }
  });
}

// ────────────────────────────────────────────────────────────────────
// Live broadcaster
// ────────────────────────────────────────────────────────────────────

let timer = null;
let history = { cpu: [], mem: [], rx: [], tx: [], t: [] };
const HIST_MAX = 60;
const TICK_MS = 2500;        // was 1500 — slower tick is gentler on the CPU
let snapshotInFlight = false;

function startLive() {
  if (timer) return;
  cpuUsage(); // prime so first delta is meaningful
  timer = setInterval(async () => {
    if (snapshotInFlight) return;        // avoid stacking if a tick takes longer than the interval
    snapshotInFlight = true;
    try {
      const snap = await snapshot();
      history.cpu.push(snap.cpu.pct); if (history.cpu.length > HIST_MAX) history.cpu.shift();
      history.mem.push(snap.mem.pct); if (history.mem.length > HIST_MAX) history.mem.shift();
      history.rx.push(snap.net.rxBps); if (history.rx.length > HIST_MAX) history.rx.shift();
      history.tx.push(snap.net.txBps); if (history.tx.length > HIST_MAX) history.tx.shift();
      history.t.push(snap.t); if (history.t.length > HIST_MAX) history.t.shift();
      hub.publish('system', { snap, history });
      for (const d of snap.disks) {
        if (d.pct >= 95) hub.publish('notify', { kind: 'disk-low', mount: d.mount, pct: d.pct, total: d.total });
      }
    } catch (e) {} finally { snapshotInFlight = false; }
  }, TICK_MS);
  timer.unref && timer.unref();
}

function stopLive() { if (timer) { clearInterval(timer); timer = null; } }
function getHistory() { return history; }

function close() {
  stopLive();
  if (psHost) try { psHost.close(); } catch (e) {}
}

module.exports = { snapshot, listProcs, killPid, startLive, stopLive, getHistory, close };
