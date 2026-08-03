// Linux platform adapter = POSIX base + Linux-native feature helpers (§5).
// Each helper is best-effort and reports unavailability instead of throwing so
// the frontend can render a disabled state with a reason.
const base = require('./base');
const cp = require('child_process');
const fs = require('fs');
const capabilities = require('./capabilities');

function run(cmd, timeout = 5000, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout, maxBuffer }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout || '', err: (stderr || (err && err.message) || '').trim() });
    });
  });
}

// systemd services list (§5).
async function listServices() {
  if (capabilities.get().serviceManager !== 'systemd') return { available: false, reason: 'systemd not present', services: [] };
  const r = await run('systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null');
  if (!r.ok && !r.out) return { available: false, reason: r.err || 'systemctl failed', services: [] };
  const services = [];
  for (const ln of r.out.split('\n')) {
    const parts = ln.trim().split(/\s+/);
    if (parts.length < 4 || !parts[0].endsWith('.service')) continue;
    const [unit, load, active, sub] = parts;
    services.push({ unit, load, active, sub, description: parts.slice(4).join(' ') });
  }
  return { available: true, services };
}

// start|stop|restart|enable|disable a unit. Needs privilege; the error is
// surfaced (systemctl exits non-zero with a polkit message otherwise).
async function serviceControl(unit, action) {
  if (!/^[\w@.-]+\.service$/.test(unit)) return { ok: false, error: 'Invalid unit name' };
  if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) return { ok: false, error: 'Invalid action' };
  const r = await run('systemctl ' + action + ' ' + unit + ' 2>&1');
  return r.ok ? { ok: true } : { ok: false, error: r.err || r.out || 'systemctl failed' };
}

// Listening TCP ports with owning process (§5).
async function listeningPorts() {
  if (!capabilities.get().listeningPorts) return { available: false, reason: 'ss not present', ports: [] };
  const r = await run('ss -tlnH 2>/dev/null');
  if (!r.ok && !r.out) return { available: false, reason: r.err || 'ss failed', ports: [] };
  const ports = [];
  for (const ln of r.out.split('\n')) {
    const cols = ln.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[3];
    const m = /:(\d+)$/.exec(local);
    if (!m) continue;
    let proc = null, pid = null;
    const pm = /users:\(\("([^"]+)",pid=(\d+)/.exec(ln);
    if (pm) { proc = pm[1]; pid = parseInt(pm[2], 10); }
    ports.push({ port: parseInt(m[1], 10), address: local.replace(/:\d+$/, ''), proc, pid });
  }
  ports.sort((a, b) => a.port - b.port);
  return { available: true, ports };
}

// Pending apt updates + reboot-required flag (read-only, §5).
async function packageStatus() {
  if (!capabilities.get().packages) return { available: false, reason: 'apt not present' };
  const rebootRequired = fs.existsSync('/var/run/reboot-required');
  let updates = null, security = null;
  // apt-check is fast and script-friendly when present.
  const chk = await run('/usr/lib/update-notifier/apt-check 2>&1', 4000);
  if (chk.out && /^\d+;\d+/.test(chk.out.trim())) {
    const [u, s] = chk.out.trim().split(';').map(n => parseInt(n, 10));
    updates = u; security = s;
  } else {
    const r = await run("apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -c '^Inst'", 8000);
    if (r.ok) updates = parseInt(r.out.trim(), 10) || 0;
  }
  return { available: true, updates, security, rebootRequired };
}

// ufw / nftables summary (read-only, §5).
async function firewallStatus() {
  if (!capabilities.get().firewall) return { available: false, reason: 'no ufw/nft' };
  let r = await run('ufw status 2>/dev/null');
  if (r.ok && r.out.trim()) return { available: true, backend: 'ufw', text: r.out.trim() };
  r = await run('nft list ruleset 2>/dev/null');
  if (r.ok && r.out.trim()) return { available: true, backend: 'nftables', text: r.out.trim().slice(0, 8000) };
  return { available: false, reason: r.err || 'requires privilege' };
}

function close() { /* no persistent host on Linux */ }

module.exports = Object.assign({}, base, {
  close,
  listServices,
  serviceControl,
  listeningPorts,
  packageStatus,
  firewallStatus,
});
