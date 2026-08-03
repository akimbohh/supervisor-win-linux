// Files API.
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const mime = require('mime-types');
const multer = require('multer');
const archiver = require('archiver');

const auth = require('../lib/auth');
const ops = require('../lib/fs-ops');
const { getQuickLocations, ensureSafe, isWin } = require('../lib/paths');
const settings = require('../lib/settings');
const watchers = require('../lib/watchers');

const router = express.Router();
router.use(auth.requireAuth);

router.use(express.json({ limit: '50mb' }));

// Body errors → JSON
router.use((err, req, res, next) => {
  if (err) return res.status(err.status || 400).json({ error: err.message });
  next();
});

function asPath(v) { if (typeof v !== 'string' || !v.length) throw httpErr(400, 'path required'); return v; }
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (e.code === 'EBLOCKED') return res.status(403).json({ error: e.message });
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      if (e.code === 'EACCES' || e.code === 'EPERM') return res.status(403).json({ error: 'Permission denied' });
      if (e.code === 'EEXIST') return res.status(409).json({ error: e.message || 'Already exists' });
      const status = e.status || 500;
      // Only log server-side problems with a stack; client errors (4xx) are
      // expected and would just spam the console.
      if (status >= 500) console.warn('[files] ' + (e.stack || e.message));
      res.status(status).json({ error: e.message || 'Server error' });
    }
  };
}

// --- Locations & navigation ---

router.get('/locations', handle(async (req, res) => {
  res.json({
    quick: getQuickLocations(),
    recent: settings.get().recentFolders || [],
    sep: path.sep,
    home: require('os').homedir(),
    isWin,
  });
}));

router.get('/list', handle(async (req, res) => {
  const p = asPath(req.query.path);
  const safe = ensureSafe(p);
  const hidden = req.query.hidden === '1' || settings.get().hiddenFiles === true;
  const items = await ops.listDir(safe, { hidden });
  res.json({
    path: safe,
    parent: path.dirname(safe) === safe ? null : path.dirname(safe),
    sep: path.sep,
    items,
  });
}));

router.post('/recent', handle(async (req, res) => {
  const { path: p } = req.body || {};
  if (!p) throw httpErr(400, 'path required');
  ensureSafe(p);
  settings.pushRecent(p);
  res.json({ ok: true });
}));

// --- Stat ---
router.get('/stat', handle(async (req, res) => {
  const p = asPath(req.query.path);
  res.json(await ops.statFile(p));
}));

// --- Read ---
router.get('/read', handle(async (req, res) => {
  const p = asPath(req.query.path);
  const max = parseInt(req.query.max || '5242880', 10);
  res.json(await ops.readText(p, { maxBytes: max }));
}));

// Raw stream — used for images, video, audio, downloads, hex preview.
router.get('/raw', handle(async (req, res) => {
  const p = asPath(req.query.path);
  const safe = ensureSafe(p);
  const st = await fsp.stat(safe);
  if (st.isDirectory()) throw httpErr(400, 'Cannot stream a directory; use /download-zip');

  const ct = mime.contentType(path.basename(safe)) || 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.setHeader('Last-Modified', new Date(st.mtime).toUTCString());
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(path.basename(safe)) + '"');
  } else {
    res.setHeader('Cache-Control', 'private, max-age=300');
  }

  // Range support (videos/audio)
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= st.size) {
      res.setHeader('Content-Range', 'bytes */' + st.size);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + st.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(safe, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', st.size);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(safe).pipe(res);
}));

// Hex preview of first N bytes.
router.get('/hex', handle(async (req, res) => {
  const p = asPath(req.query.path);
  const safe = ensureSafe(p);
  const max = Math.min(parseInt(req.query.bytes || '1024', 10), 65536);
  const fh = await fsp.open(safe, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    res.json({ size: (await fsp.stat(safe)).size, bytesRead, hex: buf.subarray(0, bytesRead).toString('hex') });
  } finally { await fh.close(); }
}));

// --- Mutations ---

router.post('/write', handle(async (req, res) => {
  const { path: p, content } = req.body || {};
  if (!p || typeof content !== 'string') throw httpErr(400, 'path & content required');
  res.json(await ops.writeText(p, content));
}));

router.post('/mkdir', handle(async (req, res) => {
  const { path: p } = req.body || {};
  res.json(await ops.mkdir(asPath(p)));
}));

router.post('/touch', handle(async (req, res) => {
  const { path: p } = req.body || {};
  res.json(await ops.touch(asPath(p)));
}));

router.post('/rename', handle(async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) throw httpErr(400, 'from & to required');
  res.json(await ops.rename(from, to));
}));

router.post('/chmod', handle(async (req, res) => {
  const { path: p, mode } = req.body || {};
  if (!p || mode == null) throw httpErr(400, 'path & mode required');
  if (!require('../platform').capabilities().fsPermissions) throw httpErr(400, 'File permissions are not editable on this host');
  res.json(await ops.chmod(p, mode));
}));

router.post('/delete', handle(async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || !paths.length) throw httpErr(400, 'paths required');
  res.json(await ops.moveToTrash(paths));
}));

router.post('/copy', handle(async (req, res) => {
  const { paths, dest } = req.body || {};
  if (!Array.isArray(paths) || !dest) throw httpErr(400, 'paths & dest required');
  res.json(await ops.copyMany(paths, dest));
}));

router.post('/move', handle(async (req, res) => {
  const { paths, dest } = req.body || {};
  if (!Array.isArray(paths) || !dest) throw httpErr(400, 'paths & dest required');
  res.json(await ops.moveMany(paths, dest));
}));

router.post('/duplicate', handle(async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || !paths.length) throw httpErr(400, 'paths required');
  const out = [];
  for (const p of paths) {
    const dest = ops.uniqueDest(path.dirname(p), path.basename(p));
    await ops.copyAny(p, dest);
    out.push({ from: p, to: dest });
  }
  res.json(out);
}));

// --- Trash ---
router.get('/trash', handle(async (req, res) => res.json({ items: await ops.listTrash() })));
router.post('/trash/restore', handle(async (req, res) => res.json(await ops.restoreFromTrash(req.body && req.body.id))));
router.post('/trash/delete', handle(async (req, res) => res.json({ ok: await ops.deleteForever(req.body && req.body.id) })));
router.post('/trash/empty', handle(async (req, res) => res.json(await ops.emptyTrash())));

// --- Zip ---
router.get('/zip-list', handle(async (req, res) => {
  const p = asPath(req.query.path);
  res.json(await ops.listZip(p));
}));

router.get('/download-zip', handle(async (req, res) => {
  // ?paths=p1&paths=p2&name=archive.zip
  let paths = req.query.paths;
  if (!paths) throw httpErr(400, 'paths required');
  if (!Array.isArray(paths)) paths = [paths];
  const name = req.query.name || ('archive-' + Date.now() + '.zip');
  for (const p of paths) ensureSafe(p);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"');
  const arch = archiver('zip', { zlib: { level: 6 } });
  arch.on('error', err => { console.warn('[zip] ' + err.message); try { res.end(); } catch (e) {} });
  arch.pipe(res);
  for (const p of paths) {
    const st = await fsp.stat(p);
    if (st.isDirectory()) arch.directory(p, path.basename(p));
    else arch.file(p, { name: path.basename(p) });
  }
  await arch.finalize();
}));

// --- Upload ---
// Sane, configurable caps (HIGH-4). The old config allowed 10 GB/file x 200
// files with no total ceiling. Override via env.
const MB = 1024 * 1024;
const MAX_FILE_MB = parseInt(process.env.SUPERVISOR_UPLOAD_MAX_FILE_MB || '1024', 10);   // 1 GB/file
const MAX_FILES = parseInt(process.env.SUPERVISOR_UPLOAD_MAX_FILES || '50', 10);
const MAX_TOTAL_MB = parseInt(process.env.SUPERVISOR_UPLOAD_MAX_TOTAL_MB || '4096', 10); // 4 GB/request

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dest = req.query.dest;
        if (!dest) return cb(new Error('dest query required'));
        ensureSafe(dest);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      try {
        // Honour client-supplied relative path from webkitRelativePath
        const relRaw = (file.originalname || 'upload').replace(/^[\\/]+/, '');
        const safeName = relRaw.split(/[\\/]/).pop();
        const dest = req.query.dest;
        const finalName = ops.isDirSync(path.join(dest, safeName))
          ? safeName + '-' + Date.now()
          : safeName;
        // Avoid collision
        let candidate = path.join(dest, finalName);
        if (fs.existsSync(candidate)) candidate = ops.uniqueDest(dest, finalName);
        cb(null, path.basename(candidate));
      } catch (e) { cb(e); }
    },
  }),
  limits: { fileSize: MAX_FILE_MB * MB, files: MAX_FILES },
});

router.post('/upload', (req, res, next) => {
  // Total-request ceiling via Content-Length (multer caps per-file + count only).
  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (len && len > MAX_TOTAL_MB * MB) {
    return res.status(413).json({ error: 'Upload exceeds the ' + MAX_TOTAL_MB + ' MB per-request limit' });
  }
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.code === 'LIMIT_FILE_COUNT' ? 413 : 400);
      return res.status(code).json({ error: err.message });
    }
    res.json({ uploaded: (req.files || []).map(f => ({ name: f.filename, size: f.size, path: f.path })) });
  });
});

// --- Watcher (debug) ---
router.get('/watchers', handle(async (req, res) => {
  res.json(watchers.stats());
}));

module.exports = router;
