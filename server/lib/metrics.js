// System metrics orchestration. CPU + memory + uptime are computed here from
// os.* (cross-platform, no branching). Everything platform-specific — disks,
// network, GPU, process list, kill — is delegated to the platform adapter
// (server/platform), which also owns the persistent PowerShell host on Windows.
const os = require('os');
const hub = require('./hub');
const settings = require('./settings');
const platform = require('../platform');

// ── CPU ──────────────────────────────────────────────────────────────────
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
    const tt = (c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq) - (p.user + p.nice + p.sys + p.idle + p.irq);
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

// ── Disks (cached — they barely change second-to-second) ───────────────────
let disksCache = null, disksCacheT = 0;
const DISKS_TTL = 30_000;
async function disks() {
  if (disksCache && Date.now() - disksCacheT < DISKS_TTL) return disksCache;
  try { disksCache = await platform.disks(); }
  catch (e) { disksCache = disksCache || []; }
  disksCacheT = Date.now();
  return disksCache;
}

// ── GPU (cached) ───────────────────────────────────────────────────────────
let gpuCache = null, gpuCacheT = 0;
const GPU_TTL = 30_000;
async function gpu() {
  if (gpuCache != null && Date.now() - gpuCacheT < GPU_TTL) return gpuCache;
  try { gpuCache = await platform.gpu(); } catch (e) { gpuCache = null; }
  gpuCacheT = Date.now();
  return gpuCache;
}

// ── Snapshot ───────────────────────────────────────────────────────────────
async function snapshot() {
  const [d, n, g, top] = await Promise.all([
    disks(),
    platform.netSample().catch(() => ({ totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 })),
    gpu(),
    platform.topProcesses().catch(() => []),
  ]);
  return {
    t: Date.now(),
    cpu: cpuUsage(),
    mem: memInfo(),
    disks: d,
    net: n,
    gpu: g,
    uptime: uptime(),
    topProcs: top,
    caps: platform.capabilities(),
    host: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: (os.cpus()[0] || {}).model || 'unknown', cpuCount: os.cpus().length },
  };
}

async function listProcs() { return platform.listProcesses(); }
function killPid(pid) { return platform.killPid(pid); }

// ── Live broadcaster ───────────────────────────────────────────────────────
let timer = null;
let history = { cpu: [], mem: [], rx: [], tx: [], t: [] };
const HIST_MAX = 60;
const TICK_MS = 2500;
let snapshotInFlight = false;

function startLive() {
  if (timer) return;
  cpuUsage(); // prime so first delta is meaningful
  timer = setInterval(async () => {
    if (snapshotInFlight) return;
    snapshotInFlight = true;
    try {
      const snap = await snapshot();
      history.cpu.push(snap.cpu.pct); if (history.cpu.length > HIST_MAX) history.cpu.shift();
      history.mem.push(snap.mem.pct); if (history.mem.length > HIST_MAX) history.mem.shift();
      history.rx.push(snap.net.rxBps); if (history.rx.length > HIST_MAX) history.rx.shift();
      history.tx.push(snap.net.txBps); if (history.tx.length > HIST_MAX) history.tx.shift();
      history.t.push(snap.t); if (history.t.length > HIST_MAX) history.t.shift();
      hub.publish('system', { snap, history });
      // Disk-low: emit when FREE space crosses the user's threshold. Previously
      // the emitter hardcoded a used>=95% floor, so any threshold below 5% free
      // never fired (§6). The threshold lives with the emitter now.
      const thresh = (settings.get().notifications || {}).diskLowThresholdPct || 10;
      for (const d of snap.disks) {
        const freePct = 100 - d.pct;
        if (freePct <= thresh) hub.publish('notify', { kind: 'disk-low', mount: d.mount, pct: d.pct, freePct, total: d.total });
      }
    } catch (e) {} finally { snapshotInFlight = false; }
  }, TICK_MS);
  timer.unref && timer.unref();
}

function stopLive() { if (timer) { clearInterval(timer); timer = null; } }
function getHistory() { return history; }

function close() {
  stopLive();
  try { platform.close && platform.close(); } catch (e) {}
}

module.exports = { snapshot, listProcs, killPid, startLive, stopLive, getHistory, close };
