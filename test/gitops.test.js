const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDataDir } = require('./helpers');

process.env.SUPERVISOR_DATA_DIR = tmpDataDir();
delete process.env.SUPERVISOR_GITHUB_TOKEN;
const git = require('../server/lib/gitops');

test('injectToken adds x-access-token auth to an https GitHub URL', () => {
  assert.equal(git.injectToken('https://github.com/o/r.git', 'TOK'), 'https://x-access-token:TOK@github.com/o/r.git');
  // replaces an existing embedded credential
  assert.equal(git.injectToken('https://old@github.com/o/r', 'TOK'), 'https://x-access-token:TOK@github.com/o/r');
  // leaves ssh/other URLs alone
  assert.equal(git.injectToken('git@github.com:o/r.git', 'TOK'), 'git@github.com:o/r.git');
  assert.equal(git.injectToken('https://github.com/o/r', ''), 'https://github.com/o/r');
});

test('scrub removes the token and any embedded credential from output', () => {
  assert.ok(!git.scrub('pushing to https://x-access-token:SECRET@github.com', 'SECRET').includes('SECRET'));
  assert.ok(!git.scrub('remote: https://x-access-token:abc123@github.com/o/r', null).includes('abc123'));
});

test('token is write-only and round-trips via the data dir', () => {
  assert.equal(git.hasToken(), false);
  git.setToken('ghp_test_123');
  assert.equal(git.hasToken(), true);
  assert.equal(git.getToken(), 'ghp_test_123');
});
