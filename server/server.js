// Supervisor — entry point.
// Run with: node server/server.js
// Override port:        SUPERVISOR_PORT=7778
// Initial password:     SUPERVISOR_PASSWORD=...   (only used on first run)
// Bind address:         SUPERVISOR_BIND=0.0.0.0   (default: all interfaces)

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

// Tiny .env loader — sets process.env entries from a .env file at the project
// root. .env values OVERRIDE any pre-existing real env vars: the checked-in
// local config is authoritative. Comment out a line in .env to fall back to
// the real env (useful for one-off `SUPERVISOR_PORT=8080 npm start`).
(function loadDotEnv() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
})();

const express = require('express');

const auth = require('./lib/auth');
const hub = require('./lib/hub');
const settings = require('./lib/settings');
const { ensureDataDir } = require('./lib/store');

// Lazy: only require feature modules after data dir exists.
ensureDataDir();
const initial = auth.ensureInitialPassword();
settings.get(); // touch to materialise defaults
settings.sanitizePaths(); // P-10: drop stale/cross-platform paths, reseed selfRepoPath

// PID file — written on boot, removed on graceful shutdown. start.bat reads
// this on next launch to taskkill any stale process before binding the port.
const pidPath = path.join(__dirname, '..', 'data', 'supervisor.pid');
try { fs.writeFileSync(pidPath, String(process.pid)); } catch (e) {}

const app = express();
app.disable('x-powered-by');

// --- Security headers (CRIT-2) ---
// A strict CSP is the backstop that keeps a content-injection bug (e.g. a
// regression in the Markdown renderer) from escalating to code execution in
// the authenticated origin. script-src 'self' blocks inline scripts AND inline
// event handlers (onerror=, onclick=), which is the actual XSS defense; that is
// why login.html's script was externalized and index.html's inline onerror
// handlers were removed. style-src keeps 'unsafe-inline' because the vanilla UI
// sets element styles pervasively and inline styles cannot execute code.
// connect-src 'self' covers same-origin fetch + ws/wss. Multi-machine peers are
// reached by navigating to their own origin, so this stays 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Trust proxy only when explicitly enabled (HIGH-1). Blanket trust lets a
// client spoof X-Forwarded-For and rotate the login-rate-limit bucket per
// request. Default: trust nothing; req.ip is the raw socket address.
app.set('trust proxy', process.env.SUPERVISOR_TRUST_PROXY === '1' ? true : false);

// --- Static assets ---
// Override which UI directory to serve via SUPERVISOR_WEB_DIR (e.g. "web.new"
// for the redesign). Defaults to "web". Resolved relative to the repo root.
const WEB_DIR = path.join(__dirname, '..', process.env.SUPERVISOR_WEB_DIR || 'web');
console.log('[supervisor] serving UI from', WEB_DIR);

// Cache-control for vendor assets (long-lived) vs. app assets (revalidate).
app.use('/vendor', express.static(path.join(WEB_DIR, 'vendor'), {
  maxAge: '7d',
  immutable: false,
  fallthrough: true,
}));

// Serve PWA assets at root (manifest, service worker) without auth check.
app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(WEB_DIR, 'manifest.webmanifest')));
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(WEB_DIR, 'sw.js'));
});
app.get('/icons/:name', (req, res, next) => {
  const f = path.join(WEB_DIR, 'icons', req.params.name);
  if (!f.startsWith(path.join(WEB_DIR, 'icons'))) return next();
  res.sendFile(f, (err) => err && next());
});

// Login page (always reachable)
app.get('/login', (req, res) => res.sendFile(path.join(WEB_DIR, 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(WEB_DIR, 'login.html')));

// Public app shell (auth happens in-app on API calls).
app.get('/', (req, res, next) => {
  // If unauthenticated, redirect to /login. Cookie-based check.
  const token = auth.readToken(req);
  if (!auth.verify(token)) return res.redirect('/login');
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// Serve other static web/ files (CSS, JS, etc.) — these are not secrets.
app.use(express.static(WEB_DIR, {
  maxAge: '1h',
  setHeaders(res, p) {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    if (p.endsWith('.js') || p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  },
}));

// --- API routes ---

// Unauthenticated health/identity endpoint (§4 multi-machine): the phone's
// machine switcher polls this to show a reachability + identity dot per
// registered instance without being signed in to each. Exposes no secrets.
const APP_VERSION = (() => { try { return require('../package.json').version; } catch (e) { return '0'; } })();
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, app: 'supervisor', version: APP_VERSION, platform: process.platform, hostname: os.hostname() });
});

app.use('/api/auth', require('./routes/auth'));

// Forced first-login password change (CRIT-3): while the credential is still
// the built-in default, block every API except /api/auth/* so the app is inert
// until a real password is set. The frontend surfaces the change-password flow.
app.use('/api', (req, res, next) => {
  if (!auth.isDefaultPassword()) return next();
  return res.status(403).json({ error: 'Set a password before using Supervisor.', mustChangePassword: true });
});

// Optional feature routes — require their files to exist; skip cleanly if missing.
// (Real require() errors inside an existing route file still surface — only ENOENT skips.)
function tryMount(prefix, modPath) {
  const abs = path.join(__dirname, modPath + '.js');
  if (!fs.existsSync(abs)) {
    console.warn('[server] route not yet available: ' + prefix);
    return false;
  }
  app.use(prefix, require(modPath));
  return true;
}

tryMount('/api/settings', './routes/settings');
tryMount('/api/files', './routes/files');
tryMount('/api/sessions', './routes/sessions');
tryMount('/api/console', './routes/console');
tryMount('/api/system', './routes/system');
tryMount('/api/processes', './routes/processes');
tryMount('/api/push', './routes/push');
tryMount('/api/maintenance', './routes/maintenance');
tryMount('/api/claude', './routes/claude');

// 404 for unknown API
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback: any other path → app shell (with auth redirect).
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const token = auth.readToken(req);
  if (!auth.verify(token)) return res.redirect('/login');
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// --- HTTP + WS server ---

const server = http.createServer(app);
require('./routes/ws').setup(server);

const PORT = parseInt(process.env.SUPERVISOR_PORT || '7778', 10);
let BIND = process.env.SUPERVISOR_BIND || '0.0.0.0';

// CRIT-3: refuse to expose a default-password instance to the network. If the
// credential is still the built-in default, force the bind to loopback so the
// only way in is from the same host until a real password is set. Override
// intentionally with SUPERVISOR_ALLOW_DEFAULT_BIND=1 (not recommended).
function isLoopbackBind(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost';
}
if (auth.isDefaultPassword() && !isLoopbackBind(BIND) && process.env.SUPERVISOR_ALLOW_DEFAULT_BIND !== '1') {
  console.warn('');
  console.warn('  ⚠  Password is still the default — binding to 127.0.0.1 only.');
  console.warn('     Set a password (Settings → Account), then restart to expose on ' + BIND + '.');
  console.warn('     Override with SUPERVISOR_ALLOW_DEFAULT_BIND=1 (NOT recommended).');
  BIND = '127.0.0.1';
}

server.listen(PORT, BIND, () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) ips.push({ name, ip: i.address });
    }
  }
  console.log('');
  console.log('  Supervisor');
  console.log('  ──────────');
  console.log('  Local:    http://localhost:' + PORT);
  for (const { name, ip } of ips) console.log('  ' + name.padEnd(8).slice(0, 8) + '  http://' + ip + ':' + PORT);
  if (initial.created) {
    if (initial.source === 'env') {
      console.log('  Password set from $SUPERVISOR_PASSWORD env var.');
    } else {
      console.log('');
      console.log('  Default password is "supervisor" — change it in Settings ASAP.');
    }
  }
  console.log('');
});

// Graceful shutdown
function shutdown(sig) {
  console.log('\n[' + sig + '] shutting down…');
  try { fs.unlinkSync(pidPath); } catch (e) {}
  hub.publish('server', { event: 'shutdown' });
  // Tell feature modules to clean up if they exposed a closer.
  try { require('./lib/sessions').closeAll && require('./lib/sessions').closeAll(); } catch (e) {}
  try { require('./lib/shells').closeAll && require('./lib/shells').closeAll(); } catch (e) {}
  try { require('./lib/interactive').closeAll && require('./lib/interactive').closeAll(); } catch (e) {}
  try { require('./lib/metrics').close && require('./lib/metrics').close(); } catch (e) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

