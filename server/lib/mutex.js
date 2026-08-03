// Tiny keyed async mutex. Serializes read-modify-write sequences that would
// otherwise interleave across concurrent request handlers and clobber shared
// JSON state (MED-6). Single-process only; not a cross-process file lock.
const chains = new Map(); // key -> Promise (tail of the queue)

// Run `fn` with exclusive access to `key`. Returns fn's result/rejection.
function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  // Chain off the previous holder's settlement (success OR failure) so the
  // queue never stalls on an error.
  const run = prev.then(() => fn(), () => fn());
  // The tail others wait on must never reject.
  const tail = run.then(() => {}, () => {});
  chains.set(key, tail);
  // Drop the entry once this is the last waiter, to avoid unbounded growth.
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

module.exports = { withLock };
