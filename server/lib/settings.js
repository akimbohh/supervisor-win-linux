// Settings persistence. Read-through cache, write-through to disk.
const path = require('path');
const fs = require('fs');
const { readJSON, writeJSON } = require('./store');

const DEFAULTS = {
  theme: 'dark',                  // 'dark' | 'light' | 'auto'
  accent: 'amber',                // 'amber' | 'teal' | 'purple' | 'blue' | 'rose'
  pinnedFolders: [],              // [{ name, path, icon? }]
  recentFolders: [],              // [path], capped
  blocklist: null,                // null = use defaults; or array of paths
  blocklistAllowAll: false,       // explicit "allow everything" (UI-confirmed) — else defaults apply (MED-2)
  watchUsePolling: false,         // chokidar polling for network/overlay mounts + inotify-exhaustion fallback (P-6)
  presets: [],                    // [{ id, name, folder, args, env, prePrompt }]
  notifications: {
    sessionFinished: true,
    sessionAskedForInput: true,
    consoleCommandFinished: false,
    diskLow: true,
    diskLowThresholdPct: 10,
  },
  hiddenFiles: false,
  fileSort: {},                   // { [folder]: { key, dir } }
  quickKeys: [],                  // [{ id, kind, label, ...payload }] — console bottom-row buttons
  selfRepoPath: path.resolve(__dirname, '..', '..'), // supervisor's own repo — target for maintenance sessions
  maintenanceSkipPermissions: true, // pass --dangerously-skip-permissions to headless `claude -p` (§6)
  maintenanceTimeoutMs: 600000,     // hard timeout for a headless maintenance run
  trustedDevices: {},             // { devId: name } (informational; cookie carries the real trust)
  autoTrustClaudeFolders: true,   // pre-accept ~/.claude.json hasTrustDialogAccepted before spawn
};

let cache = null;

function load() {
  if (cache) return cache;
  const stored = readJSON('settings.json', {}) || {};
  cache = mergeDefaults(stored);
  return cache;
}

function mergeDefaults(s) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const [k, v] of Object.entries(s || {})) {
    if (k === 'notifications' && v && typeof v === 'object') out.notifications = { ...out.notifications, ...v };
    else out[k] = v;
  }
  return out;
}

function get() {
  return load();
}

function update(patch) {
  const cur = load();
  const next = { ...cur, ...patch };
  if (patch.notifications) next.notifications = { ...cur.notifications, ...patch.notifications };
  cache = next;
  writeJSON('settings.json', next);
  return next;
}

function reset() {
  cache = JSON.parse(JSON.stringify(DEFAULTS));
  writeJSON('settings.json', cache);
  return cache;
}

function pushRecent(folder) {
  const cur = load();
  const list = (cur.recentFolders || []).filter(f => f !== folder);
  list.unshift(folder);
  if (list.length > 20) list.length = 20;
  return update({ recentFolders: list });
}

// First-run/cross-platform migration (P-10): drop path entries that don't
// exist on the current host (e.g. C:\Users\... carried onto Linux), and reseed
// selfRepoPath from the actual repo location when it's missing/stale.
function sanitizePaths() {
  const cur = load();
  const exists = (p) => { try { return typeof p === 'string' && fs.existsSync(p); } catch (e) { return false; } };
  const patch = {};

  const recent = (cur.recentFolders || []).filter(exists);
  if (recent.length !== (cur.recentFolders || []).length) patch.recentFolders = recent;

  if (Array.isArray(cur.pinnedFolders)) {
    const pins = cur.pinnedFolders.filter(pin => exists(typeof pin === 'string' ? pin : pin && pin.path));
    if (pins.length !== cur.pinnedFolders.length) patch.pinnedFolders = pins;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  if (!exists(cur.selfRepoPath)) patch.selfRepoPath = repoRoot;

  if (Object.keys(patch).length) update(patch);
  return patch;
}

module.exports = { get, update, reset, pushRecent, sanitizePaths, DEFAULTS };
