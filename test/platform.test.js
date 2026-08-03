const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDataDir } = require('./helpers');

process.env.SUPERVISOR_DATA_DIR = tmpDataDir();

// Contract test: every adapter must expose the full interface, so a Windows-only
// change that breaks the Linux adapter's shape fails here regardless of host.
const REQUIRED = [
  'isWin', 'defaultShell', 'shellRunCommand', 'spawnManaged', 'killTree',
  'disks', 'netSample', 'gpu', 'listProcesses', 'topProcesses', 'killPid',
  'powerAction', 'serviceStatus', 'selfRestart', 'capabilities',
];

test('resolved adapter implements the platform contract', () => {
  const plat = require('../server/platform');
  for (const key of REQUIRED) {
    assert.ok(key in plat, 'missing adapter member: ' + key);
  }
  for (const fn of REQUIRED.filter(k => k !== 'isWin')) {
    assert.equal(typeof plat[fn], 'function', fn + ' must be a function');
  }
});

test('every adapter module satisfies the contract', () => {
  for (const mod of ['base', 'linux', 'win32']) {
    const a = require('../server/platform/' + mod);
    for (const key of REQUIRED) {
      assert.ok(key in a, mod + ' missing ' + key);
    }
  }
});

test('capabilities returns a well-formed map', () => {
  const caps = require('../server/platform').capabilities();
  assert.ok(['win32', 'linux', 'darwin'].includes(caps.platform));
  assert.equal(typeof caps.pty, 'boolean');
  assert.equal(typeof caps.power, 'object');
  for (const k of ['shutdown', 'restart', 'sleep', 'cancel']) assert.equal(typeof caps.power[k], 'boolean');
  assert.equal(typeof caps.fsPermissions, 'boolean');
});

test('shellRunCommand shapes a runnable command', () => {
  const plat = require('../server/platform');
  const { cmd, args } = plat.shellRunCommand('echo hi');
  assert.equal(typeof cmd, 'string');
  assert.ok(Array.isArray(args) && args.includes('echo hi'));
});
