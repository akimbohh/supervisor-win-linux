const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDataDir } = require('./helpers');

process.env.SUPERVISOR_DATA_DIR = tmpDataDir();
const it = require('../server/lib/interactive');

test('splitLines yields complete lines and carries the partial', () => {
  let s = it.splitLines('', 'a\nb\nc');
  assert.deepEqual(s.lines, ['a', 'b']);
  assert.equal(s.rest, 'c');
  s = it.splitLines(s.rest, 'd\n{"x":1}\n');
  assert.deepEqual(s.lines, ['cd', '{"x":1}']);
  assert.equal(s.rest, '');
});

test('splitLines strips CR and drops empty lines', () => {
  const s = it.splitLines('', 'one\r\n\r\ntwo\r\n');
  assert.deepEqual(s.lines, ['one', 'two']);
  assert.equal(s.rest, '');
});

test('sessionIdOf extracts the resumable id (the interchange bridge)', () => {
  assert.equal(it.sessionIdOf({ session_id: 'abc' }), 'abc');
  assert.equal(it.sessionIdOf({ data: { session_id: 'xyz' } }), 'xyz');
  assert.equal(it.sessionIdOf({ type: 'result', foo: 1 }), null);
  assert.equal(it.sessionIdOf(null), null);
});

test('previewOf reads text from string or content blocks', () => {
  assert.equal(it.previewOf({ message: { content: 'hi' } }), 'hi');
  assert.equal(it.previewOf({ message: { content: [{ type: 'text', text: 'hello world' }] } }), 'hello world');
  assert.equal(it.previewOf({ message: { content: [{ type: 'tool_use' }] } }), '');
});

test('encodeCwd matches Claude on-disk project layout', () => {
  assert.equal(it.encodeCwd('/home/user/proj'), '-home-user-proj');
  // idempotent-ish: no double separators, absolute
  assert.ok(!it.encodeCwd('/a/b').includes('/'));
});

test('start refuses without the claude capability', () => {
  // On a host without `claude`, start must throw ENOCLAUDE rather than spawn.
  const caps = require('../server/platform/capabilities');
  if (!caps.get().claude) {
    assert.throws(() => it.start({ message: 'hi' }), (e) => e.code === 'ENOCLAUDE');
  }
});

test('start validates its message', () => {
  const caps = require('../server/platform/capabilities');
  if (caps.get().claude) {
    assert.throws(() => it.start({ message: '' }), (e) => e.code === 'EINVAL' || e.code === 'ENOCLAUDE');
  }
});
