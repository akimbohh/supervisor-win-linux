const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDataDir } = require('./helpers');

process.env.SUPERVISOR_DATA_DIR = tmpDataDir();

const store = require('../server/lib/store');
const { withLock } = require('../server/lib/mutex');

test('store round-trips JSON and returns fallback when missing', () => {
  store.writeJSON('t.json', { a: 1, b: [2, 3] });
  assert.deepEqual(store.readJSON('t.json', null), { a: 1, b: [2, 3] });
  assert.deepEqual(store.readJSON('nope.json', { d: true }), { d: true });
});

test('store leaves no .tmp files behind (atomic rename)', () => {
  const fs = require('fs');
  store.writeJSON('atomic.json', { ok: 1 });
  const leftovers = fs.readdirSync(process.env.SUPERVISOR_DATA_DIR).filter(f => f.includes('.tmp'));
  assert.equal(leftovers.length, 0);
});

test('mutex serializes overlapping critical sections in FIFO order', async () => {
  const order = [];
  const a = withLock('k', async () => { await new Promise(r => setTimeout(r, 20)); order.push('a'); return 'A'; });
  const b = withLock('k', async () => { order.push('b'); return 'B'; });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, 'A'); assert.equal(rb, 'B');
  assert.deepEqual(order, ['a', 'b']);
});

test('mutex does not stall the queue when a holder throws', async () => {
  await assert.rejects(withLock('e', async () => { throw new Error('boom'); }));
  const r = await withLock('e', async () => 'recovered');
  assert.equal(r, 'recovered');
});
