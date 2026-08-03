// Safe path handling with a configurable blocklist plus a hard, non-overridable
// blocklist protecting the app's own secrets.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { readJSON } = require('./store');
const platform = require('../platform');

const isWin = platform.isWin;

// Repo root and the app's own state dir / env file. These are ALWAYS protected
// (MED-1): the Files API must never read data/secret.bin (cookie signing key),
// data/passwd.json (password hash), data/vapid.json, or .env, and must never
// overwrite or delete them.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HARD_BLOCK = [
  path.join(REPO_ROOT, 'data'),
  path.join(REPO_ROOT, '.env'),
];

// Default blocklist. Stored prefixes are normalized lowercase on Windows.
const DEFAULT_BLOCKLIST_WIN = [
  'C:\\Windows',
  'C:\\Program Files\\Windows Defender',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
  'C:\\PerfLogs',
];
const DEFAULT_BLOCKLIST_NIX = [
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/boot',
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/ssh',
];
// /root is sensitive unless we ARE root (then it's the home dir and browsing it
// is legitimate).
if (!isWin && typeof process.getuid === 'function' && process.getuid() !== 0) {
  DEFAULT_BLOCKLIST_NIX.push('/root');
}

function defaultBlocklist() {
  return isWin ? DEFAULT_BLOCKLIST_WIN.slice() : DEFAULT_BLOCKLIST_NIX.slice();
}

// Returns the effective user blocklist. An empty/absent list means "use
// defaults", NOT "allow everything" (MED-2) — disabling protection requires an
// explicit settings.blocklistAllowAll flag (surfaced in the UI behind a typed
// confirmation). The hard blocklist is applied on top of whatever this returns.
function getBlocklist() {
  const settings = readJSON('settings.json', {}) || {};
  if (settings.blocklistAllowAll === true) {
    return Array.isArray(settings.blocklist) ? settings.blocklist : [];
  }
  if (Array.isArray(settings.blocklist) && settings.blocklist.length > 0) {
    return settings.blocklist;
  }
  return defaultBlocklist();
}

// Resolve to a real filesystem path, defeating symlink escapes (MED-3). For a
// path that doesn't exist yet (write/mkdir targets), resolve the nearest
// existing ancestor and re-append the remaining segments — so a symlinked
// parent still can't smuggle a write into a blocked location.
function realish(p) {
  let abs = path.resolve(p);
  let suffix = '';
  for (let i = 0; i < 4096; i++) {
    try {
      const real = fs.realpathSync.native(abs);
      return suffix ? path.join(real, suffix) : real;
    } catch (e) {
      const parent = path.dirname(abs);
      if (parent === abs) return path.resolve(p); // reached root; nothing existed
      suffix = suffix ? path.join(path.basename(abs), suffix) : path.basename(abs);
      abs = parent;
    }
  }
  return path.resolve(p);
}

function normalize(p) {
  if (!p) return p;
  return realish(p);
}

function underPrefix(target, prefix) {
  const t = isWin ? target.toLowerCase() : target;
  const e = isWin ? path.resolve(prefix).toLowerCase() : path.resolve(prefix);
  return t === e || t.startsWith(e + path.sep);
}

function isBlocked(p) {
  const norm = normalize(p);
  // Hard blocks first — never overridable.
  for (const h of HARD_BLOCK) {
    if (underPrefix(norm, h)) return true;
  }
  for (const entry of getBlocklist()) {
    if (underPrefix(norm, entry)) return true;
  }
  return false;
}

function ensureSafe(p) {
  const norm = normalize(p);
  if (isBlocked(norm)) {
    const err = new Error('Path is blocked: ' + norm);
    err.code = 'EBLOCKED';
    throw err;
  }
  return norm;
}

// Pinned/quick locations
function getQuickLocations() {
  const home = os.homedir();
  const candidates = [
    { name: 'Home', path: home, icon: 'home' },
    { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'monitor' },
    { name: 'Documents', path: path.join(home, 'Documents'), icon: 'file-text' },
    { name: 'Downloads', path: path.join(home, 'Downloads'), icon: 'download' },
  ];
  // Only surface locations that actually exist (P-5): headless Linux boxes
  // usually lack the XDG dirs, and dead entries 404 when tapped.
  const locs = candidates.filter(l => { try { fs.accessSync(l.path); return true; } catch (e) { return false; } });
  if (isWin) {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = letter + ':\\';
      try { fs.accessSync(root); locs.push({ name: letter + ':', path: root, icon: 'hard-drive' }); }
      catch (e) {}
    }
  } else {
    locs.push({ name: 'Root', path: '/', icon: 'hard-drive' });
    // Real mountpoints from /proc/mounts (physical volumes get one-tap access
    // the way drive letters do on Windows). P-5.
    for (const m of listRealMounts()) {
      locs.push({ name: path.basename(m) || m, path: m, icon: 'hard-drive', mount: true });
    }
  }
  // User pinned
  const settings = readJSON('settings.json', {}) || {};
  if (Array.isArray(settings.pinnedFolders)) {
    for (const pin of settings.pinnedFolders) {
      if (typeof pin === 'string') locs.push({ name: path.basename(pin) || pin, path: pin, icon: 'star', user: true });
      else if (pin && pin.path) locs.push({ ...pin, icon: pin.icon || 'star', user: true });
    }
  }
  return locs;
}

// Parse /proc/mounts and keep only real, user-relevant mountpoints (skip pseudo
// filesystems and system mounts). Best-effort; returns [] off Linux.
function listRealMounts() {
  if (isWin) return [];
  let data;
  try { data = fs.readFileSync('/proc/mounts', 'utf8'); } catch (e) { return []; }
  const PSEUDO = new Set(['proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'overlay', 'squashfs', 'autofs', 'mqueue', 'debugfs', 'tracefs', 'securityfs', 'pstore', 'bpf', 'configfs', 'fusectl', 'hugetlbfs', 'binfmt_misc', 'rpc_pipefs', 'nsfs', 'ramfs']);
  const seen = new Set();
  const out = [];
  for (const line of data.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const mnt = parts[1], fstype = parts[2];
    if (PSEUDO.has(fstype)) continue;
    if (mnt === '/') continue; // already added as Root
    if (!mnt.startsWith('/media') && !mnt.startsWith('/mnt') && !mnt.startsWith('/run/media') && mnt !== '/home') continue;
    if (seen.has(mnt)) continue;
    try { fs.accessSync(mnt); } catch (e) { continue; }
    seen.add(mnt); out.push(mnt);
  }
  return out;
}

function trashDir() {
  return path.join(REPO_ROOT, 'data', 'trash');
}

module.exports = {
  isWin,
  normalize,
  isBlocked,
  ensureSafe,
  getBlocklist,
  defaultBlocklist,
  getQuickLocations,
  trashDir,
  HARD_BLOCK,
  REPO_ROOT,
};
