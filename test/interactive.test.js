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

test('chat replay ring: seq is monotonic and snapshot filters by since', () => {
  const chat = it.createChat({ cwd: '/tmp' });
  it.pushEvent(chat, { type: 'user', text: 'hi' });
  it.pushEvent(chat, { type: 'claude_json', data: { type: 'assistant' } });
  it.pushEvent(chat, { type: 'done' });
  const full = it.snapshot(chat.chatId, 0);
  assert.equal(full.seq, 3);
  assert.deepEqual(full.events.map(e => e.seq), [1, 2, 3]);
  const partial = it.snapshot(chat.chatId, 2);
  assert.deepEqual(partial.events.map(e => e.seq), [3]);
  assert.equal(partial.events[0].type, 'done');
  assert.equal(it.snapshot('nope', 0), null, 'unknown chat → null (client falls back to jsonl history)');
});

test('chat replay ring caps its length but keeps seq counting', () => {
  const chat = it.createChat({ cwd: '/tmp' });
  for (let i = 0; i < 2100; i++) it.pushEvent(chat, { type: 'claude_json', data: { i } });
  const snap = it.snapshot(chat.chatId, 0);
  assert.equal(snap.seq, 2100);
  assert.equal(snap.events.length, 2000);
  assert.equal(snap.events[0].seq, 101);
  assert.equal(snap.oldestSeq, 101);
});

test('chat rename / kill / add-dir management', () => {
  const chat = it.createChat({ cwd: '/tmp', name: '  My session  ' });
  assert.equal(chat.name, 'My session', 'name is trimmed');
  assert.ok(it.renameChat(chat.chatId, 'renamed'));
  assert.equal(it.snapshot(chat.chatId, 0).name, 'renamed');
  const dirs = it.setChatDirs(chat.chatId, [__dirname, __dirname]);
  assert.equal(dirs.length, 1, 'add-dirs are deduped');
  assert.throws(() => it.setChatDirs(chat.chatId, ['/no/such/dir-xyz']), (e) => e.code === 'ENOENT');
  assert.equal(it.snapshot(chat.chatId, 0).addDirs.length, 1, 'failed update leaves dirs unchanged');
  assert.ok(it.deleteChat(chat.chatId));
  assert.equal(it.snapshot(chat.chatId, 0), null, 'killed chat is gone');
  assert.equal(it.deleteChat(chat.chatId), false);
});

test('start validates its message', () => {
  const caps = require('../server/platform/capabilities');
  if (caps.get().claude) {
    assert.throws(() => it.start({ message: '' }), (e) => e.code === 'EINVAL' || e.code === 'ENOCLAUDE');
  }
});
