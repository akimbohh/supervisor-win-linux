// Safe path handling with a configurable blocklist.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { readJSON } = require('./store');

const isWin = process.platform === 'win32';

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
];

function getBlocklist() {
  const settings = readJSON('settings.json', {}) || {};
  if (Array.isArray(settings.blocklist)) return settings.blocklist;
  return isWin ? DEFAULT_BLOCKLIST_WIN : DEFAULT_BLOCKLIST_NIX;
}

function normalize(p) {
  if (!p) return p;
  let n = path.resolve(p);
  return n;
}

function isBlocked(p) {
  const norm = normalize(p);
  const cmp = isWin ? norm.toLowerCase() : norm;
  for (const entry of getBlocklist()) {
    const e = isWin ? path.resolve(entry).toLowerCase() : path.resolve(entry);
    if (cmp === e || cmp.startsWith(e + path.sep)) return true;
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
  const locs = [
    { name: 'Home', path: home, icon: 'home' },
    { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'monitor' },
    { name: 'Documents', path: path.join(home, 'Documents'), icon: 'file-text' },
    { name: 'Downloads', path: path.join(home, 'Downloads'), icon: 'download' },
  ];
  if (isWin) {
    // List drives
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = letter + ':\\';
      try { fs.accessSync(root); locs.push({ name: letter + ':', path: root, icon: 'hard-drive' }); }
      catch (e) {}
    }
  } else {
    locs.push({ name: 'Root', path: '/', icon: 'hard-drive' });
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

function trashDir() {
  return path.join(__dirname, '..', '..', 'data', 'trash');
}

module.exports = {
  isWin,
  normalize,
  isBlocked,
  ensureSafe,
  getBlocklist,
  getQuickLocations,
  trashDir,
};
