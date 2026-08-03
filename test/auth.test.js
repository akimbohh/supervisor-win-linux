const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDataDir } = require('./helpers');

process.env.SUPERVISOR_DATA_DIR = tmpDataDir();
const auth = require('../server/lib/auth');

test('password hash verifies and stores scrypt params', () => {
  const creds = auth.hashPassword('correct horse');
  assert.equal(creds.N, 32768);
  assert.ok(auth.verifyPassword('correct horse', creds));
  assert.ok(!auth.verifyPassword('wrong', creds));
});

test('old-parameter hashes still verify (backward compat)', () => {
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync('legacy', salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  const stored = { salt: salt.toString('hex'), hash }; // no N/r/p → defaults 16384
  assert.ok(auth.verifyPassword('legacy', stored));
});

test('token sign/verify roundtrips; tamper and expiry rejected', () => {
  const { token } = auth.issueToken({});
  assert.ok(auth.verify(token), 'valid token verifies');
  assert.equal(auth.verify(token + 'x'), null, 'tampered sig rejected');
  const expired = auth.sign({ sub: 'admin', exp: Date.now() - 1000, ver: auth.getEpoch() });
  assert.equal(auth.verify(expired), null, 'expired token rejected');
});

test('bumping the epoch invalidates previously-issued tokens', () => {
  const { token } = auth.issueToken({});
  assert.ok(auth.verify(token));
  auth.bumpEpoch();
  assert.equal(auth.verify(token), null, 'token from prior epoch rejected');
});

test('rate limit locks after repeated failures and resets on success', () => {
  const ip = '203.0.113.' + (process.pid % 200);
  assert.equal(auth.isLocked(ip), 0);
  auth.recordFailure(ip); auth.recordFailure(ip); auth.recordFailure(ip); auth.recordFailure(ip);
  assert.ok(auth.isLocked(ip) > 0, 'locked after 4 failures');
  auth.recordSuccess(ip);
  assert.equal(auth.isLocked(ip), 0, 'reset on success');
});

test('isDefaultPassword tracks the stored credential', () => {
  auth.setPassword('supervisor');
  assert.equal(auth.isDefaultPassword(), true);
  auth.setPassword('something-else');
  assert.equal(auth.isDefaultPassword(), false);
});
