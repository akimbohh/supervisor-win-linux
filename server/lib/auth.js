// Auth: scrypt password hashing, HMAC-signed session cookies, rate limiting.
const crypto = require('crypto');
const cookie = require('cookie');
const { readJSON, writeJSON, readBuf, writeBuf } = require('./store');

const COOKIE_NAME = 'sup_sess';
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;

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

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const salt = Buffer.from(stored.salt, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return crypto.timingSafeEqual(expected, actual);
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
  return payload;
}

function issueToken({ trusted = false } = {}) {
  const ttl = trusted ? TRUSTED_TTL_MS : DEFAULT_TTL_MS;
  return {
    token: sign({ sub: 'admin', iat: Date.now(), exp: Date.now() + ttl, trusted }),
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

// --- Rate limiting (in-memory, per IP) ---

const failures = new Map(); // ip -> { count, lockedUntil }

function isLocked(ip) {
  const f = failures.get(ip);
  if (!f) return 0;
  if (f.lockedUntil && f.lockedUntil > Date.now()) return f.lockedUntil - Date.now();
  return 0;
}

function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
  f.count++;
  // Exponential backoff after 3 failures: 5s, 15s, 60s, 5min, 30min
  const delays = [0, 0, 0, 5_000, 15_000, 60_000, 5 * 60_000, 30 * 60_000];
  const idx = Math.min(f.count, delays.length - 1);
  if (delays[idx] > 0) f.lockedUntil = Date.now() + delays[idx];
  failures.set(ip, f);
}

function recordSuccess(ip) {
  failures.delete(ip);
}

// --- Express middleware ---

function readToken(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  // Allow Authorization: Bearer for API clients
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  // WS: token in query string
  if (req.url) {
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
  sign,
  verify,
  issueToken,
  getCreds,
  setPassword,
  ensureInitialPassword,
  isLocked,
  recordFailure,
  recordSuccess,
  readToken,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
};
