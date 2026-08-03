// File-system watcher manager — wraps chokidar with reference counting.
// Topics published to hub:  'files:<resolved-path>'
// Payloads: { event: 'add'|'change'|'unlink'|'addDir'|'unlinkDir', name, path, parent, size?, mtime? }

const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const hub = require('./hub');
const settings = require('./settings');

const watchers = new Map(); // resolvedPath -> { watcher, subscribers: Set<ws> }

function topicFor(p) { return 'files:' + p; }

function startWatcher(resolved) {
  // usePolling is opt-in for network/overlay/bind mounts that don't deliver
  // inotify events, and as a fallback when inotify watches are exhausted (P-6).
  const usePolling = settings.get().watchUsePolling === true;
  const watcher = chokidar.watch(resolved, {
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    persistent: true,
    alwaysStat: true,
    usePolling,
    interval: 1000,
    binaryInterval: 1500,
  });
  function emit(event, p, st) {
    const parent = path.dirname(p);
    const payload = {
      event,
      name: path.basename(p),
      path: p,
      parent,
      size: st ? (st.isDirectory() ? null : st.size) : null,
      mtime: st ? Math.floor(st.mtimeMs) : null,
      isDir: st ? st.isDirectory() : (event === 'addDir' || event === 'unlinkDir'),
    };
    hub.publish(topicFor(resolved), payload);
  }
  watcher.on('add', (p, st) => emit('add', p, st));
  watcher.on('change', (p, st) => emit('change', p, st));
  watcher.on('unlink', (p) => emit('unlink', p, null));
  watcher.on('addDir', (p, st) => emit('addDir', p, st));
  watcher.on('unlinkDir', (p) => emit('unlinkDir', p, null));
  watcher.on('error', (err) => {
    console.warn('[watcher] error on ' + resolved + ': ' + err.message);
    // Surface inotify exhaustion to the client as a visible degraded state
    // instead of silently going dark (P-6). The Files view can prompt the user
    // to raise fs.inotify.max_user_watches or enable polling.
    const code = err && err.code;
    if (code === 'ENOSPC' || /ENOSPC|inotify/i.test(err.message || '')) {
      hub.publish(topicFor(resolved), {
        event: 'watch-degraded',
        code: 'ENOSPC',
        path: resolved,
        message: 'File watching hit the inotify limit — live updates paused. Raise fs.inotify.max_user_watches or enable polling in Settings.',
      });
    }
  });
  return watcher;
}

function addSubscriber(p, ws) {
  const resolved = path.resolve(p);
  let entry = watchers.get(resolved);
  if (!entry) {
    if (!fs.existsSync(resolved)) return false;
    entry = { watcher: startWatcher(resolved), subscribers: new Set() };
    watchers.set(resolved, entry);
  }
  entry.subscribers.add(ws);
  return true;
}

function removeSubscriber(p, ws) {
  const resolved = path.resolve(p);
  const entry = watchers.get(resolved);
  if (!entry) return;
  entry.subscribers.delete(ws);
  if (entry.subscribers.size === 0) {
    try { entry.watcher.close(); } catch (e) {}
    watchers.delete(resolved);
  }
}

function removeAllForWs(ws) {
  for (const [p, entry] of [...watchers.entries()]) {
    if (entry.subscribers.has(ws)) {
      entry.subscribers.delete(ws);
      if (entry.subscribers.size === 0) {
        try { entry.watcher.close(); } catch (e) {}
        watchers.delete(p);
      }
    }
  }
}

function topicForPath(p) { return topicFor(path.resolve(p)); }

function stats() {
  return {
    count: watchers.size,
    subscribers: [...watchers.values()].reduce((a, e) => a + e.subscribers.size, 0),
  };
}

module.exports = { addSubscriber, removeSubscriber, removeAllForWs, topicForPath, stats };
