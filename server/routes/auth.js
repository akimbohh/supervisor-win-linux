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
  res.json({ ok: true, sub: payload.sub, exp: payload.exp, trusted: !!payload.trusted });
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
  res.json({ ok: true, trusted: !!trusted });
});

router.post('/logout', (req, res) => {
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
  res.json({ ok: true });
});

module.exports = router;
