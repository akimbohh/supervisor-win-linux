const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tmpDataDir, writeSettings } = require('./helpers');

const DATA = tmpDataDir();
process.env.SUPERVISOR_DATA_DIR = DATA;

const paths = require('../server/lib/paths');
const REPO = paths.REPO_ROOT;

function blocked(p) {
  try { paths.ensureSafe(p); return false; } catch (e) { return e.code === 'EBLOCKED'; }
}

test('hard-blocks the app data dir and .env unconditionally', () => {
  assert.ok(blocked(path.join(REPO, 'data')), 'data dir');
  assert.ok(blocked(path.join(REPO, 'data', 'secret.bin')), 'secret.bin');
  assert.ok(blocked(path.join(REPO, 'data', 'sub', 'x.txt')), 'nested write under data');
  assert.ok(blocked(path.join(REPO, '.env')), '.env');
});

test('allows an ordinary path outside the blocklist', () => {
  assert.ok(!blocked(path.join(REPO, 'README.md')));
});

test('resolves symlinks before checking (no escape into blocked dir)', () => {
  const link = path.join(os.tmpdir(), 'sup-link-' + process.pid);
  try { fs.rmSync(link, { force: true }); } catch (e) {}
  fs.symlinkSync(path.join(REPO, 'data'), link);
  assert.ok(blocked(path.join(link, 'secret.bin')), 'symlink -> data must be blocked');
  fs.rmSync(link, { force: true });
});

test('empty blocklist falls back to defaults, does NOT allow everything', () => {
  writeSettings(DATA, { blocklist: [] });
  if (process.platform !== 'win32') {
    assert.ok(blocked('/etc/shadow'), '/etc/shadow still blocked with empty blocklist');
  }
});

test('blocklistAllowAll disables the default blocklist (but not the hard block)', () => {
  writeSettings(DATA, { blocklist: [], blocklistAllowAll: true });
  if (process.platform !== 'win32') {
    assert.ok(!blocked('/etc/hostname'), 'ordinary system path allowed under allowAll');
  }
  // Hard block survives even allowAll.
  assert.ok(blocked(path.join(REPO, 'data', 'passwd.json')), 'data still hard-blocked under allowAll');
  writeSettings(DATA, {});
});
