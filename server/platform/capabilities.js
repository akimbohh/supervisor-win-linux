// Capability detection. Declares what THIS host can actually do, so the
// frontend can render unsupported features as explained disabled states rather
// than as absences (§3.2). Detection is best-effort and cached for the process
// lifetime; the values are cheap booleans, no long-running probes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const platform = process.platform; // the platform layer is the ONE place this is read

let _cache = null;

// Synchronous "is this executable on PATH?" — used only at first capability
// computation, never on a hot path.
function commandExists(cmd) {
  const exts = platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    for (const ext of exts) {
      try { fs.accessSync(path.join(d, cmd + ext), fs.constants.X_OK); return true; } catch (e) {}
      // On Windows accessSync X_OK is unreliable; fall back to existence.
      try { fs.accessSync(path.join(d, cmd + ext)); return true; } catch (e) {}
    }
  }
  return false;
}

function ptyAvailable() {
  try { require('node-pty'); return true; } catch (e) { return false; }
}

function detectVirt() {
  if (platform !== 'linux') return null;
  try {
    const out = cp.execSync('systemd-detect-virt 2>/dev/null', { encoding: 'utf8', timeout: 1500 }).trim();
    return out || 'none';
  } catch (e) { return null; } // command missing or bare metal → unknown
}

function detectServiceManager() {
  if (platform === 'linux') {
    try { if (fs.existsSync('/run/systemd/system')) return 'systemd'; } catch (e) {}
    if (commandExists('systemctl')) return 'systemd';
    return 'none';
  }
  if (platform === 'win32') return 'sc';
  return 'none';
}

function containerRuntime() {
  if (platform === 'win32') {
    // Docker Desktop exposes a named pipe; detection is unreliable without a
    // probe, so report false unless the CLI is present.
    return commandExists('docker');
  }
  for (const sock of ['/var/run/docker.sock', '/run/docker.sock', '/run/podman/podman.sock', '/var/run/podman/podman.sock']) {
    try { fs.accessSync(sock); return true; } catch (e) {}
  }
  return commandExists('docker') || commandExists('podman');
}

function compute() {
  const isWin = platform === 'win32';
  const isLinux = platform === 'linux';
  const headless = isLinux ? (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) : false;
  const virt = detectVirt();
  const serviceManager = detectServiceManager();

  // Sleep/suspend is meaningless on virtualized/headless hosts.
  const canSleep = isWin ? true : (isLinux && !headless && (virt === 'none' || virt === null));

  return {
    platform,                            // 'win32' | 'linux' | 'darwin'
    hostname: os.hostname(),
    headless,
    virt,                                // 'none' | 'kvm' | 'docker' | ... | null(unknown)
    pty: ptyAvailable(),
    claude: commandExists('claude'),    // Claude Code CLI present → Interactive Claude usable
    gpu: commandExists('nvidia-smi') || commandExists('rocm-smi'),
    power: {
      shutdown: true,
      restart: true,
      sleep: !!canSleep,
      cancel: isWin || isLinux,
    },
    windowCapture: isWin,                // Windows Graphics Capture API only
    serviceManager,                      // 'systemd' | 'sc' | 'none'
    containers: containerRuntime(),
    fsPermissions: !isWin,               // POSIX chmod/chown meaningful
    drives: isWin,                       // drive-letter enumeration
    listeningPorts: isLinux ? commandExists('ss') : isWin,
    journal: serviceManager === 'systemd' && commandExists('journalctl'),
    packages: isLinux && commandExists('apt-get'),
    firewall: isLinux && (commandExists('ufw') || commandExists('nft')),
  };
}

function get() {
  if (!_cache) _cache = compute();
  return _cache;
}

// Some capabilities (pty) can change after boot only via reinstall+restart, so
// caching for the process lifetime is correct. Exposed for tests.
function _reset() { _cache = null; }

module.exports = { get, commandExists, _reset };
