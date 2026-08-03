/* WebSocket client + pub/sub + ping/pong loop.
 *
 * Singleton on window.App that mirrors the API of the original web/app.js:
 *   App.subscribe(topic) / App.unsubscribe(topic)
 *   App.onMessage(handler) → returns unsub fn
 *   App.send(obj) — JSON-stringifies and sends if open; returns boolean
 *   App.applySettings(s)  — apply theme/accent + meta theme-color
 *   App.markRestarting()  — write sessionStorage flag and show banner
 *
 * The WS auto-connects on App.bootWS() with exponential backoff (500→15000ms),
 * re-subscribes all topics on reconnect, runs a 5s ping/pong RTT loop, and
 * pings update the latency badge with green/amber/red thresholds.
 *
 * IMPORTANT: every public method is attached to App at the TOP of the IIFE,
 * before any later code runs. This is robust against `<script type="text/babel">`
 * loading races on iOS Safari (where Babel-standalone fetches scripts in
 * parallel and may execute them out of document order). All state lives on
 * App itself (connHandlers, wsHandlers, latencyHandlers, restartHandlers) so
 * subscriptions made from app.jsx are durable regardless of which method
 * variant ran. connectWS() / bootWS() add the real network layer on top.
 */

(function () {
  const App = window.App = window.App || {};

  /* ── State buckets — all on App so methods share them. ─────────────── */
  if (!App.settings)         App.settings = {};
  if (!App.wsTopics)         App.wsTopics = new Set();
  if (!App.wsHandlers)       App.wsHandlers = new Set();
  if (!App.connHandlers)     App.connHandlers = new Set();
  if (!App.latencyHandlers)  App.latencyHandlers = new Set();
  if (!App.restartHandlers)  App.restartHandlers = new Set();
  if (App.wsConnected == null) App.wsConnected = false;
  if (App._restartState == null) App._restartState = 'none';
  if (App._latency == null) App._latency = null;

  /* ── Subscription methods — attached upfront. Idempotent on re-run. ── */

  App.send = function (obj) {
    if (App.ws && App.ws.readyState === 1) { App.ws.send(JSON.stringify(obj)); return true; }
    return false;
  };

  App.subscribe = function (topic) {
    App.wsTopics.add(topic);
    App.send({ type: 'sub', topic });
  };

  App.unsubscribe = function (topic) {
    App.wsTopics.delete(topic);
    App.send({ type: 'unsub', topic });
  };

  App.onMessage = function (handler) {
    App.wsHandlers.add(handler);
    return () => App.wsHandlers.delete(handler);
  };

  App.onConnChange = function (cb) {
    App.connHandlers.add(cb);
    try { cb(App.wsConnected ? 'online' : 'offline'); } catch (e) {}
    return () => App.connHandlers.delete(cb);
  };

  App.onLatency = function (cb) {
    App.latencyHandlers.add(cb);
    try { cb(App._latency); } catch (e) {}
    return () => App.latencyHandlers.delete(cb);
  };

  App.onRestartChange = function (cb) {
    App.restartHandlers.add(cb);
    try { cb(App._restartState); } catch (e) {}
    return () => App.restartHandlers.delete(cb);
  };

  /* ── State broadcast helpers ───────────────────────────────────────── */

  function broadcastConn(state) {
    App.wsConnected = (state === 'online');
    for (const cb of App.connHandlers) { try { cb(state); } catch (e) {} }
  }
  function broadcastLatency(rtt) {
    App._latency = rtt;
    for (const cb of App.latencyHandlers) { try { cb(rtt); } catch (e) {} }
  }
  function broadcastRestart(s) {
    App._restartState = s;
    for (const cb of App.restartHandlers) { try { cb(s); } catch (e) {} }
  }

  /* ── Theme/accent (driven by /api/settings + WS settings topic). ───── */
  App.applySettings = function (s) {
    App.settings = s || {};
    const theme = (s && s.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const accent = (s && s.accent) || 'amber';
    document.documentElement.setAttribute('data-accent', accent);
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', theme === 'light' ? '#fafaf7' : '#0a0a0b');
  };

  /* ── Restart banner state ──────────────────────────────────────────── */
  App.markRestarting = function () {
    sessionStorage.setItem('supervisorRestarting', String(Date.now()));
    broadcastRestart('pending');
  };
  App.dismissRestart = function () { broadcastRestart('none'); };

  function checkRestartFlagOnReconnect() {
    const ts = parseInt(sessionStorage.getItem('supervisorRestarting') || '0', 10);
    if (!ts) return;
    if (Date.now() - ts > 5 * 60 * 1000) {
      sessionStorage.removeItem('supervisorRestarting');
      broadcastRestart('none');
      return;
    }
    sessionStorage.removeItem('supervisorRestarting');
    broadcastRestart('ready');
  }
  function checkRestartFlagOnBoot() {
    const ts = parseInt(sessionStorage.getItem('supervisorRestarting') || '0', 10);
    if (ts && Date.now() - ts < 5 * 60 * 1000) broadcastRestart('pending');
  }

  /* ── Latency ping ───────────────────────────────────────────────────
   * 5s ping/pong measuring RTT. Fires "stale" badge when no pong in 4s.
   * Stops while disconnected. */
  let pingTimer = null;
  let pingSentAt = 0;
  let pingPending = false;

  function startPingLoop() {
    stopPingLoop();
    sendPing();
    pingTimer = setInterval(sendPing, 5000);
  }
  function stopPingLoop() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    pingPending = false;
    broadcastLatency(null);
  }
  function sendPing() {
    if (!App.ws || App.ws.readyState !== 1) return;
    pingSentAt = performance.now();
    pingPending = true;
    App.send({ type: 'ping' });
    setTimeout(() => { if (pingPending) broadcastLatency('stale'); }, 4000);
  }
  function handlePong() {
    if (!pingPending) return;
    pingPending = false;
    const rtt = Math.max(0, Math.round(performance.now() - pingSentAt));
    broadcastLatency(rtt);
  }

  /* ── Connection ────────────────────────────────────────────────────── */
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = proto + '://' + location.host + '/ws';
    let backoff = 500;
    function open() {
      try { App.ws = new WebSocket(url); }
      catch (e) { setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000); return; }
      App.ws.addEventListener('open', () => {
        backoff = 500;
        broadcastConn('online');
        for (const t of App.wsTopics) App.send({ type: 'sub', topic: t });
        startPingLoop();
        checkRestartFlagOnReconnect();
      });
      App.ws.addEventListener('close', () => {
        broadcastConn('offline');
        stopPingLoop();
        setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000);
      });
      App.ws.addEventListener('message', (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg && msg.topic === 'pong') { handlePong(); return; }
        for (const h of App.wsHandlers) { try { h(msg); } catch (e) {} }
      });
    }
    open();
  }

  /* ── Boot helper — call once from app.jsx ──────────────────────────── */
  App.bootWS = async function () {
    try {
      const me = await window.api('/api/auth/me');
      App.me = me;
    } catch (e) {
      // api() already redirected to /login on 401.
      return false;
    }
    try {
      const s = await window.api('/api/settings');
      App.applySettings(s);
    } catch (e) {
      console.warn('[boot] settings load failed', e);
      App.applySettings({});
    }
    App.onMessage((msg) => {
      if (msg && msg.topic === 'settings') App.applySettings(msg.payload);
    });
    checkRestartFlagOnBoot();
    connectWS();
    return true;
  };

  console.info('[supervisor] ws loaded');
})();
