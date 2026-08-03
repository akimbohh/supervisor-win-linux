// File-system operations: list, read, write, copy, move, trash, zip listing.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { trashDir, ensureSafe } = require('./paths');
const { dataPath, readJSON, writeJSON } = require('./store');
const { withLock } = require('./mutex');
const yauzl = require('yauzl');

// All trash-manifest read-modify-write sequences serialize on this key so
// concurrent delete/restore/empty requests can't clobber the manifest (MED-6).
const TRASH_LOCK = 'trash-manifest';

function ensureTrash() {
  fs.mkdirSync(trashDir(), { recursive: true });
  return trashDir();
}

async function statSafe(p) {
  try { return await fsp.lstat(p); } catch (e) { return null; }
}

function isDirSync(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

async function listDir(dirPath, { hidden = false } = {}) {
  ensureSafe(dirPath);
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!hidden && ent.name.startsWith('.')) continue;
    const full = path.join(dirPath, ent.name);
    let st = null;
    try { st = await fsp.lstat(full); } catch (e) { continue; }
    let dir = false, link = false, size = 0, mtime = 0, broken = false;
    if (st.isSymbolicLink()) {
      link = true;
      // A symlink whose target stat fails is broken — surface it distinctly
      // instead of rendering as a 0-byte file (P-14). Common on Linux.
      try { const real = await fsp.stat(full); dir = real.isDirectory(); size = real.size; mtime = real.mtimeMs; }
      catch (e) { broken = true; mtime = st.mtimeMs; }
    } else {
      dir = st.isDirectory();
      size = st.size;
      mtime = st.mtimeMs;
    }
    out.push({
      name: ent.name,
      path: full,
      dir,
      link,
      broken,
      size: dir ? null : size,
      mtime: Math.floor(mtime),
      mode: st.mode,
      hidden: ent.name.startsWith('.'),
    });
  }
  return out;
}

async function statFile(p) {
  ensureSafe(p);
  const st = await fsp.lstat(p);
  return {
    path: p,
    name: path.basename(p),
    dir: st.isDirectory(),
    link: st.isSymbolicLink(),
    size: st.size,
    mtime: Math.floor(st.mtimeMs),
    ctime: Math.floor(st.ctimeMs),
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
  };
}

async function readText(p, { maxBytes = 5 * 1024 * 1024 } = {}) {
  ensureSafe(p);
  const st = await fsp.stat(p);
  if (st.size > maxBytes) {
    const buf = Buffer.alloc(maxBytes);
    const fh = await fsp.open(p, 'r');
    try { await fh.read(buf, 0, maxBytes, 0); }
    finally { await fh.close(); }
    return { content: buf.toString('utf8'), truncated: true, size: st.size };
  }
  const content = await fsp.readFile(p, 'utf8');
  return { content, truncated: false, size: st.size };
}

async function writeText(p, content) {
  ensureSafe(p);
  const dir = path.dirname(p);
  await fsp.mkdir(dir, { recursive: true });
  // Atomic write via temp file
  const tmp = p + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, p);
  const st = await fsp.stat(p);
  return { size: st.size, mtime: Math.floor(st.mtimeMs) };
}

async function mkdir(p) {
  ensureSafe(p);
  await fsp.mkdir(p, { recursive: true });
  return statFile(p);
}

// chmod (POSIX permission edit — P-13). mode is an octal string like "755" or a
// number. On Windows this is a near-no-op; the route gates it on the
// fsPermissions capability so the UI shows it as N/A there.
async function chmod(p, mode) {
  ensureSafe(p);
  let m = mode;
  if (typeof mode === 'string') m = parseInt(mode, 8);
  if (!Number.isInteger(m) || m < 0 || m > 0o7777) { const e = new Error('Invalid mode'); e.code = 'EINVAL'; throw e; }
  await fsp.chmod(p, m);
  return statFile(p);
}

async function touch(p) {
  ensureSafe(p);
  if (fs.existsSync(p)) {
    const err = new Error('File already exists'); err.code = 'EEXIST'; throw err;
  }
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, '');
  return statFile(p);
}

async function rename(from, to) {
  ensureSafe(from); ensureSafe(to);
  if (fs.existsSync(to)) { const err = new Error('Destination exists'); err.code = 'EEXIST'; throw err; }
  await fsp.rename(from, to);
  return statFile(to);
}

// Recursive copy that handles files and directories.
async function copyAny(src, dest) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const name of entries) await copyAny(path.join(src, name), path.join(dest, name));
  } else {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

function uniqueDest(targetDir, name) {
  let candidate = path.join(targetDir, name);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    candidate = path.join(targetDir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(targetDir, base + '-' + Date.now() + ext);
}

async function copyMany(paths, destDir) {
  ensureSafe(destDir);
  const results = [];
  for (const p of paths) {
    ensureSafe(p);
    const dest = uniqueDest(destDir, path.basename(p));
    await copyAny(p, dest);
    results.push({ from: p, to: dest });
  }
  return results;
}

async function moveMany(paths, destDir) {
  ensureSafe(destDir);
  const results = [];
  for (const p of paths) {
    ensureSafe(p);
    const dest = uniqueDest(destDir, path.basename(p));
    try {
      await fsp.rename(p, dest);
    } catch (e) {
      // Cross-device or other rename failures: copy + remove
      await copyAny(p, dest);
      await rmAny(p);
    }
    results.push({ from: p, to: dest });
  }
  return results;
}

async function rmAny(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

// --- Trash ---

function trashManifest() {
  return readJSON(path.join('trash', 'manifest.json'), { items: [] });
}
function saveTrashManifest(m) {
  writeJSON(path.join('trash', 'manifest.json'), m);
}

async function moveToTrash(paths) {
  // Validate + move files OUTSIDE the lock (slow I/O), then mutate the manifest
  // under the lock so concurrent callers serialize on the read-modify-write.
  ensureTrash();
  const staged = [];
  for (const p of paths) {
    ensureSafe(p);
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    const target = path.join(trashDir(), id + '__' + path.basename(p));
    try {
      await fsp.rename(p, target);
    } catch (e) {
      await copyAny(p, target);
      await rmAny(p);
    }
    staged.push({ id, originalPath: p, trashedPath: target, name: path.basename(p), when: Date.now() });
  }
  return withLock(TRASH_LOCK, async () => {
    const m = trashManifest();
    for (const item of staged) m.items.unshift(item);
    // Cap trash to 500 items, oldest evicted (and removed from disk)
    while (m.items.length > 500) {
      const old = m.items.pop();
      try { await rmAny(old.trashedPath); } catch (e) {}
    }
    saveTrashManifest(m);
    return staged;
  });
}

async function listTrash() {
  ensureTrash();
  return trashManifest().items;
}

async function restoreFromTrash(id) {
  return withLock(TRASH_LOCK, async () => {
    const m = trashManifest();
    const idx = m.items.findIndex(it => it.id === id);
    if (idx === -1) throw new Error('Trash item not found');
    const it = m.items[idx];
    let dest = it.originalPath;
    if (fs.existsSync(dest)) dest = uniqueDest(path.dirname(dest), path.basename(dest));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(it.trashedPath, dest);
    m.items.splice(idx, 1);
    saveTrashManifest(m);
    return { restored: dest };
  });
}

async function emptyTrash() {
  return withLock(TRASH_LOCK, async () => {
    const m = trashManifest();
    for (const it of m.items) {
      try { await rmAny(it.trashedPath); } catch (e) {}
    }
    m.items = [];
    saveTrashManifest(m);
    return { ok: true };
  });
}

async function deleteForever(id) {
  return withLock(TRASH_LOCK, async () => {
    const m = trashManifest();
    const idx = m.items.findIndex(it => it.id === id);
    if (idx === -1) return false;
    try { await rmAny(m.items[idx].trashedPath); } catch (e) {}
    m.items.splice(idx, 1);
    saveTrashManifest(m);
    return true;
  });
}

// --- Zip listing (no extraction) ---
function listZip(zipPath) {
  ensureSafe(zipPath);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('entry', (e) => {
        entries.push({
          name: e.fileName,
          size: e.uncompressedSize,
          compressed: e.compressedSize,
          isDir: /\/$/.test(e.fileName),
          mtime: e.getLastModDate ? e.getLastModDate().getTime() : null,
        });
        if (entries.length > 5000) { zip.close(); resolve({ entries, truncated: true }); return; }
        zip.readEntry();
      });
      zip.on('end', () => resolve({ entries, truncated: false }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

module.exports = {
  listDir, statFile, readText, writeText, mkdir, touch, rename, chmod, copyMany, moveMany,
  moveToTrash, listTrash, restoreFromTrash, emptyTrash, deleteForever, listZip,
  uniqueDest, statSafe, isDirSync, copyAny, rmAny,
};
