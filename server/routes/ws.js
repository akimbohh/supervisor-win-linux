// WebSocket hub: clients connect once and receive all events relevant to them.
// Server sends { topic, payload, t }. Client can also send { type, ... } messages.

const { WebSocketServer } = require('ws');
const auth = require('../lib/auth');
const hub = require('../lib/hub');

function setup(server, { onMessage } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const token = auth.readToken(req, { allowQuery: true });
    if (!auth.verify(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // Topics every authenticated client receives without an explicit subscribe:
  // connection control + app-wide settings (theme/accent) sync.
  const GLOBAL_TOPICS = new Set(['hello', 'pong', 'server', 'settings']);
  // High-frequency topics we drop for a client whose send buffer is backed up,
  // rather than growing an unbounded queue on a slow link.
  const LOSSY_PREFIXES = ['system', 'shell:', 'session:', 'claude:'];
  const MAX_BUFFERED = 1 << 20; // 1 MB

  function isLossy(topic) {
    return LOSSY_PREFIXES.some(p => topic === p || topic.startsWith(p));
  }

  // HIGH-3: deliver each event only to clients subscribed to its topic (plus
  // the global set). Previously every event went to every socket, leaking every
  // shell's bytes and every watched path to every open tab and wasting bandwidth.
  function deliver(msg) {
    const topic = msg && msg.topic;
    if (topic == null) return;
    const data = JSON.stringify(msg);
    const global = GLOBAL_TOPICS.has(topic);
    for (const c of wss.clients) {
      if (c.readyState !== 1) continue;
      if (!global && !(c.subs && c.subs.has(topic))) continue;
      if (isLossy(topic) && c.bufferedAmount > MAX_BUFFERED) continue; // backpressure
      c.send(data);
    }
  }

  // Send to every connected client regardless of subscription (rare; control use).
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) {
      if (c.readyState === 1) c.send(data);
    }
  }

  // Pipe hub events to subscribed clients.
  hub.on('msg', deliver);

  // Heartbeat: ws-level ping every 30s; terminate a socket that missed the
  // previous round. Reaping a half-open socket (phone slept, Tailscale dropped)
  // triggers its 'close' handler, which frees its file watchers.
  const heartbeat = setInterval(() => {
    for (const c of wss.clients) {
      if (c.isAlive === false) { try { c.terminate(); } catch (e) {} continue; }
      c.isAlive = false;
      try { c.ping(); } catch (e) {}
    }
  }, 30000);
  heartbeat.unref && heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  // Lazy-required to avoid a circular dependency at boot.
  let watchers = null;
  function getWatchers() { if (!watchers) watchers = require('../lib/watchers'); return watchers; }
  let shells = null;
  function getShells() { if (!shells) shells = require('../lib/shells'); return shells; }

  wss.on('connection', (ws, req) => {
    ws.subs = new Set();
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ topic: 'hello', payload: { t: Date.now() } }));

    function handleSub(topic) {
      if (!topic) return;
      ws.subs.add(topic);
      if (topic.startsWith('files:')) {
        try { getWatchers().addSubscriber(topic.slice('files:'.length), ws); } catch (e) {}
      }
    }
    function handleUnsub(topic) {
      if (!topic) return;
      ws.subs.delete(topic);
      if (topic.startsWith('files:')) {
        try { getWatchers().removeSubscriber(topic.slice('files:'.length), ws); } catch (e) {}
      }
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch (e) { return; }
      if (!msg) return;
      if (msg.type === 'sub' && typeof msg.topic === 'string') return handleSub(msg.topic);
      if (msg.type === 'unsub' && typeof msg.topic === 'string') return handleUnsub(msg.topic);
      if (msg.type === 'ping') return ws.send(JSON.stringify({ topic: 'pong', payload: { t: Date.now() } }));
      // Hot-path: shell I/O (avoid HTTP roundtrips for keystrokes).
      if (msg.type === 'shell:write' && typeof msg.id === 'string' && typeof msg.data === 'string') {
        try { getShells().write(msg.id, msg.data); } catch (e) {}
        return;
      }
      if (msg.type === 'shell:resize' && typeof msg.id === 'string') {
        try { getShells().resize(msg.id, msg.cols | 0, msg.rows | 0); } catch (e) {}
        return;
      }
      if (typeof onMessage === 'function') onMessage(ws, msg);
    });

    ws.on('close', () => {
      try { getWatchers().removeAllForWs(ws); } catch (e) {}
      // Other modules can listen to 'ws:close' if needed.
      hub.emit('ws:close', ws);
    });
  });

  return { wss, broadcast };
}

module.exports = { setup };
