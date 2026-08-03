const express = require('express');
const auth = require('../lib/auth');

const router = express.Router();

function getIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

router.get('/me', (req, res) => {
  const token = auth.readToken(req);
  const payload = auth.verify(token);
  if (!payload) return res.status(401).json({ ok: false });
  // mustChangePassword drives the forced first-login rotation (CRIT-3).
  res.json({ ok: true, sub: payload.sub, exp: payload.exp, trusted: !!payload.trusted, mustChangePassword: auth.isDefaultPassword() });
});

router.post('/login', express.json(), (req, res) => {
  const ip = getIp(req);
  const lock = auth.isLocked(ip);
  if (lock > 0) {
    return res.status(429).json({ error: 'Too many attempts. Try again in ' + Math.ceil(lock / 1000) + 's.' });
  }
  const { password, trusted } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Password required' });
  }
  const creds = auth.getCreds();
  if (!creds || !auth.verifyPassword(password, creds)) {
    auth.recordFailure(ip);
    return res.status(401).json({ error: 'Invalid password' });
  }
  auth.recordSuccess(ip);
  const { token, maxAge } = auth.issueToken({ trusted: !!trusted });
  auth.setSessionCookie(res, token, maxAge);
  res.json({ ok: true, trusted: !!trusted, mustChangePassword: auth.isDefaultPassword() });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// Sign out every device: rotate the signing key + bump the token epoch so all
// outstanding cookies (including trusted-device 60-day ones) stop verifying.
router.post('/logout-all', auth.requireAuth, (req, res) => {
  auth.rotateAuth();
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/change-password', express.json(), auth.requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || typeof next !== 'string' || next.length < 4) {
    return res.status(400).json({ error: 'Need current and next (>=4 chars) passwords' });
  }
  const creds = auth.getCreds();
  if (!auth.verifyPassword(current, creds)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  auth.setPassword(next);
  // HIGH-2: rotating credentials on password change kills any stolen cookie —
  // the very thing a password change is meant to accomplish. This invalidates
  // the acting session too, so immediately re-issue a fresh cookie for it.
  auth.rotateAuth();
  const { token, maxAge } = auth.issueToken({ trusted: false });
  auth.setSessionCookie(res, token, maxAge);
  res.json({ ok: true });
});

module.exports = router;
