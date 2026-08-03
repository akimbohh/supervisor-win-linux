// Auth: scrypt password hashing, HMAC-signed session cookies, rate limiting.
const crypto = require('crypto');
const cookie = require('cookie');
const { readJSON, writeJSON, readBuf, writeBuf } = require('./store');

const COOKIE_NAME = 'sup_sess';
// Cost raised from N=16384 (LOW finding): this endpoint is hit a handful of
// times a day, so a stronger KDF is essentially free. The parameters are stored
// alongside each hash so existing passwords (hashed at 16384) still verify and
// only get upgraded when the password is next changed.
const SCRYPT_N = 32768;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_r * 2; // headroom over 128*N*r

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const TRUSTED_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 days

let _secret = null;
function secret() {
  if (_secret) return _secret;
  let buf = readBuf('secret.bin');
  if (!buf || buf.length < 32) {
    buf = crypto.randomBytes(64);
    writeBuf('secret.bin', buf);
  }
  _secret = buf;
  return _secret;
}

// Rotate the HMAC signing key. Every previously-issued cookie instantly becomes
// unverifiable (HIGH-2). Used on password change and "sign out all devices".
function rotateSecret() {
  const buf = crypto.randomBytes(64);
  writeBuf('secret.bin', buf);
  _secret = buf;
}

// Token epoch: a monotonically increasing counter embedded in every token as
// `ver`. Bumping it invalidates all outstanding tokens without necessarily
// touching the signing key. Old cookies (no `ver`) read as epoch 0.
function getEpoch() {
  const s = readJSON('auth-state.json', null);
  return (s && Number.isFinite(s.epoch)) ? s.epoch : 0;
}
function bumpEpoch() {
  const next = getEpoch() + 1;
  writeJSON('auth-state.json', { epoch: next });
  return next;
}

// Full credential rotation: new signing key + new epoch. Boots every session.
function rotateAuth() {
  rotateSecret();
  bumpEpoch();
}

function scryptParams(stored) {
  return {
    N: (stored && stored.N) || 16384,
    r: (stored && stored.r) || 8,
    p: (stored && stored.p) || 1,
    keylen: (stored && stored.keylen) || 64,
    maxmem: 128 * ((stored && stored.N) || 16384) * ((stored && stored.r) || 8) * 2,
  };
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: SCRYPT_MAXMEM });
  return { salt: salt.toString('hex'), hash: key.toString('hex'), N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, keylen: SCRYPT_KEYLEN };
}

function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const salt = Buffer.from(stored.salt, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  const p = scryptParams(stored);
  const actual = crypto.scryptSync(password, salt, expected.length, { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Is the currently-stored password the built-in default? Used to force a
// first-login rotation and to refuse binding to non-loopback (CRIT-3).
// Cached because it runs scrypt and is consulted on every request; invalidated
// whenever the password is written.
let _defaultCache = null;
function isDefaultPassword() {
  if (_defaultCache !== null) return _defaultCache;
  const creds = getCreds();
  _defaultCache = !!creds && verifyPassword('supervisor', creds);
  return _defaultCache;
}

// Token: base64url(JSON payload) + '.' + base64url(HMAC-SHA256)
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  // Token epoch check (HIGH-2): a bumped epoch invalidates all prior tokens.
  if ((payload.ver || 0) !== getEpoch()) return null;
  return payload;
}

function issueToken({ trusted = false } = {}) {
  const ttl = trusted ? TRUSTED_TTL_MS : DEFAULT_TTL_MS;
  return {
    token: sign({ sub: 'admin', iat: Date.now(), exp: Date.now() + ttl, trusted, ver: getEpoch() }),
    maxAge: Math.floor(ttl / 1000),
  };
}

// --- Password storage ---

function getCreds() {
  return readJSON('passwd.json', null);
}

function setPassword(plain) {
  const creds = hashPassword(plain);
  writeJSON('passwd.json', creds);
  _defaultCache = null; // recompute default-password status after any write
}

function ensureInitialPassword() {
  if (getCreds()) return { created: false };
  const env = process.env.SUPERVISOR_PASSWORD;
  if (env && env.length >= 4) {
    setPassword(env);
    return { created: true, source: 'env' };
  }
  // Fallback default — log loudly.
  setPassword('supervisor');
  return { created: true, source: 'default' };
}

// --- Rate limiting (in-memory) ---
//
// Two layers (HIGH-1): a per-IP exponential backoff, PLUS a global ceiling that
// cannot be bypassed by rotating the source IP (e.g. via X-Forwarded-For if a
// proxy is ever configured, or simply many hosts). The global layer caps total
// failed attempts in a sliding window across all IPs.

const failures = new Map(); // ip -> { count, lockedUntil, seen }

// Global sliding window.
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_FAILS = 30;          // failures per window across all IPs
const GLOBAL_LOCK_MS = 60_000;        // lockout applied when the ceiling trips
let globalFails = [];                 // timestamps of recent global failures
let globalLockedUntil = 0;

function pruneFailures() {
  const now = Date.now();
  for (const [ip, f] of failures) {
    // Drop entries that are neither locked nor recently active.
    if ((!f.lockedUntil || f.lockedUntil <= now) && (now - (f.seen || 0)) > 60 * 60_000) {
      failures.delete(ip);
    }
  }
}

function globalLockRemaining() {
  return globalLockedUntil > Date.now() ? globalLockedUntil - Date.now() : 0;
}

function isLocked(ip) {
  const g = globalLockRemaining();
  const f = failures.get(ip);
  const perIp = (f && f.lockedUntil && f.lockedUntil > Date.now()) ? f.lockedUntil - Date.now() : 0;
  return Math.max(g, perIp);
}

function recordFailure(ip) {
  const now = Date.now();
  const f = failures.get(ip) || { count: 0, lockedUntil: 0, seen: now };
  f.count++;
  f.seen = now;
  // Exponential backoff after 3 failures: 5s, 15s, 60s, 5min, 30min
  const delays = [0, 0, 0, 5_000, 15_000, 60_000, 5 * 60_000, 30 * 60_000];
  const idx = Math.min(f.count, delays.length - 1);
  if (delays[idx] > 0) f.lockedUntil = now + delays[idx];
  failures.set(ip, f);

  // Global ceiling.
  globalFails = globalFails.filter(t => now - t < GLOBAL_WINDOW_MS);
  globalFails.push(now);
  if (globalFails.length >= GLOBAL_MAX_FAILS) {
    globalLockedUntil = now + GLOBAL_LOCK_MS;
  }
  pruneFailures();
}

function recordSuccess(ip) {
  failures.delete(ip);
}

// --- Express middleware ---

// allowQuery must be set ONLY for the WebSocket upgrade (MED-4). Accepting
// ?token= on ordinary routes leaks the credential into access logs, proxy
// logs, and browser history.
function readToken(req, { allowQuery = false } = {}) {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  // Allow Authorization: Bearer for API clients
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  // WS upgrade only: token in query string (browsers can't set headers on the
  // WebSocket handshake).
  if (allowQuery && req.url) {
    try {
      const u = new URL(req.url, 'http://x');
      const t = u.searchParams.get('token');
      if (t) return t;
    } catch (e) {}
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = readToken(req);
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.session = payload;
  next();
}

function setSessionCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    // secure: false — Tailscale is HTTP, no TLS by default
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }));
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  isDefaultPassword,
  sign,
  verify,
  issueToken,
  getCreds,
  setPassword,
  ensureInitialPassword,
  rotateSecret,
  rotateAuth,
  getEpoch,
  bumpEpoch,
  isLocked,
  recordFailure,
  recordSuccess,
  readToken,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
};
