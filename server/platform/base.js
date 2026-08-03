// POSIX platform adapter (Linux + macOS best-effort). win32.js overrides the
// pieces that differ. All process.platform-specific behavior for non-Windows
// hosts lives here or in linux.js — never in server/lib or server/routes.
const fs = require('fs');
const cp = require('child_process');
const capabilities = require('./capabilities');

const isWin = false;

function defaultShell() {
  return process.env.SHELL || '/bin/bash';
}

// How to run a single command line through the platform shell (used by the
// Claude trust-dialog helper). POSIX: sh -c "<line>".
function shellRunCommand(commandLine) {
  return { cmd: 'sh', args: ['-c', commandLine] };
}

// Spawn a managed child. On POSIX we do NOT use shell:true (argv arrays are
// already used everywhere, so the /bin/sh wrapper is pointless) and we start a
// new process group with detached:true so the whole tree can be signalled via
// killTree (fixes P-2 / P-12 — SIGTERM previously hit only the sh wrapper,
// leaving `claude` and shell children as orphans).
function spawnManaged(cmd, args, opts = {}) {
  return cp.spawn(cmd, args || [], { ...opts, shell: false, detached: true });
}

// Kill an entire process group. The child was started detached, so its PID is
// also its PGID; negating the PID signals the group.
function killTree(pid, signal = 'SIGTERM') {
  if (!pid) return false;
  try { process.kill(-pid, signal); return true; }
  catch (e) {
    // Group may already be gone, or the child wasn't detached — fall back.
    try { process.kill(pid, signal); return true; } catch (e2) { return false; }
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────

function disks() {
  return new Promise((resolve) => {
    cp.exec('df -kP', { timeout: 4000 }, (err, out) => {
      if (err) return resolve([]);
      const lines = out.trim().split(/\r?\n/).slice(1);
      const rows = [];
      for (const ln of lines) {
        // Anchor the four numeric columns so spaces in the device OR the
        // mountpoint don't corrupt the parse (fixes P-7).
        const m = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(ln);
        if (!m) continue;
        const total = parseInt(m[2], 10) * 1024;
        const used = parseInt(m[3], 10) * 1024;
        const free = parseInt(m[4], 10) * 1024;
        const mount = m[6];
        if (!mount.startsWith('/')) continue;
        rows.push({ mount, label: m[1], total, used, free, pct: total ? (100 * used / total) : 0 });
      }
      resolve(rows);
    });
  });
}

// Interfaces that are not the real uplink and would double-count throughput on
// a VPS (fixes P-8). Overridable via SUPERVISOR_NET_IFACES (comma list = allow).
const VIRTUAL_IFACE = /^(lo|docker|veth|br-|virbr|tailscale|tun|tap|wg|zt|cni|flannel|kube|vnet|ifb|dummy|bond|sit)/i;
let _lastNet = null;
function netSample() {
  return new Promise((resolve) => {
    const allow = (process.env.SUPERVISOR_NET_IFACES || '').split(',').map(s => s.trim()).filter(Boolean);
    let rx = 0, tx = 0;
    try {
      const data = fs.readFileSync('/proc/net/dev', 'utf8');
      for (const ln of data.split('\n').slice(2)) {
        const [nameRaw, rest] = ln.split(':');
        if (!rest) continue;
        const name = nameRaw.trim();
        if (allow.length ? !allow.includes(name) : VIRTUAL_IFACE.test(name)) continue;
        const cols = rest.trim().split(/\s+/);
        rx += parseInt(cols[0] || '0', 10);
        tx += parseInt(cols[8] || '0', 10);
      }
    } catch (e) { return resolve({ totalRx: 0, totalTx: 0, rxBps: 0, txBps: 0 }); }
    const t = Date.now();
    const rate = _lastNet
      ? { rxBps: (rx - _lastNet.rx) * 1000 / Math.max(1, t - _lastNet.t), txBps: (tx - _lastNet.tx) * 1000 / Math.max(1, t - _lastNet.t) }
      : { rxBps: 0, txBps: 0 };
    _lastNet = { rx, tx, t };
    resolve({ totalRx: rx, totalTx: tx, ...rate });
  });
}

let _gpuMissing = false;
function gpu() {
  if (_gpuMissing) return Promise.resolve(null);
  return new Promise((resolve) => {
    const cmd = 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits';
    cp.exec(cmd, { timeout: 2000 }, (err, out) => {
      if (!err && out.trim()) {
        return resolve(out.trim().split('\n').filter(Boolean).map((ln) => {
          const [name, util, memUsed, memTotal, temp] = ln.split(',').map(s => s.trim());
          return { name, util: parseFloat(util), memUsed: parseFloat(memUsed) * 1048576, memTotal: parseFloat(memTotal) * 1048576, temp: parseFloat(temp), vendor: 'nvidia' };
        }));
      }
      // AMD fallback.
      cp.exec('rocm-smi --showuse --showmemuse --json 2>/dev/null', { timeout: 2000 }, (e2, o2) => {
        if (!e2 && o2 && o2.trim().startsWith('{')) {
          try {
            const j = JSON.parse(o2);
            const cards = Object.keys(j).filter(k => /card/i.test(k)).map(k => ({
              name: 'AMD ' + k, util: parseFloat(j[k]['GPU use (%)'] || 0), memUsed: 0, memTotal: 0,
              temp: parseFloat(j[k]['Temperature (Sensor edge) (C)'] || 0), vendor: 'amd',
            }));
            if (cards.length) return resolve(cards);
          } catch (er) {}
        }
        _gpuMissing = true;
        resolve(null);
      });
    });
  });
}

function listProcesses() {
  return new Promise((resolve, reject) => {
    cp.exec('ps -eo pid,comm,%cpu,rss', { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(err);
      resolve(parsePs(out));
    });
  });
}
function topProcesses() {
  return new Promise((resolve) => {
    cp.exec('ps -eo pid,comm,%cpu,rss --sort=-%cpu 2>/dev/null | head -n 13', { timeout: 3000 }, (err, out) => {
      if (err) return resolve([]);
      resolve(parsePs(out));
    });
  });
}
function parsePs(out) {
  return out.trim().split('\n').slice(1).map(l => {
    const m = l.trim().split(/\s+/);
    return { pid: parseInt(m[0], 10), name: m[1], cpu: parseFloat(m[2]), mem: parseInt(m[3], 10) * 1024 };
  }).filter(p => p.pid);
}

function killPid(pid) {
  return new Promise((resolve) => {
    // Escalate: SIGTERM, then SIGKILL after a grace period (matches Windows
    // taskkill /f force semantics — P-4.4).
    try { process.kill(pid, 'SIGTERM'); }
    catch (e) { return resolve(false); }
    setTimeout(() => {
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (e) { /* already gone */ }
      resolve(true);
    }, 2000).unref?.();
    resolve(true);
  });
}

// ── Power ───────────────────────────────────────────────────────────────

function powerAction(action) {
  const caps = capabilities.get();
  const map = {
    shutdown: caps.serviceManager === 'systemd' ? 'systemctl poweroff' : 'shutdown -h now',
    restart: caps.serviceManager === 'systemd' ? 'systemctl reboot' : 'shutdown -r now',
    sleep: caps.serviceManager === 'systemd' ? 'systemctl suspend' : null,
    cancel: 'shutdown -c',
  };
  const cmd = map[action];
  if (!cmd) return Promise.resolve({ ok: false, error: 'Action "' + action + '" not supported on this host' });
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        // Surface the real reason (permission is the common one) instead of
        // silently returning ok (fixes P-3).
        const msg = (stderr || err.message || '').trim();
        const perm = /not authorized|permission denied|must be root|interactive authentication/i.test(msg);
        resolve({ ok: false, error: perm ? (msg + ' — see deploy/README for the sudoers/polkit rule') : msg });
      } else {
        resolve({ ok: true, scheduled: cmd });
      }
    });
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

function serviceStatus() {
  return { manager: capabilities.get().serviceManager };
}

function selfRestart() {
  const caps = capabilities.get();
  // Supervised (systemd Restart=always / pm2): just exit and let the manager
  // bring us back (fixes P-1 — no .bat dance on Linux).
  if (caps.serviceManager === 'systemd' || process.env.INVOCATION_ID || process.env.pm_id) {
    setTimeout(() => process.exit(0), 300);
    return { method: 'supervised-exit' };
  }
  // Unsupervised: re-exec after this process releases the port. The wrapper
  // sleeps so the listener is freed before the new instance binds.
  const args = [process.argv[1], ...process.argv.slice(2)];
  try {
    const child = cp.spawn('sh', ['-c', 'sleep 1; exec "$0" "$@"', process.execPath, ...args], {
      detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env,
    });
    child.unref();
  } catch (e) {
    throw new Error('Re-exec failed: ' + e.message);
  }
  setTimeout(() => process.exit(0), 300);
  return { method: 're-exec' };
}

module.exports = {
  isWin,
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
  capabilities: capabilities.get,
};
