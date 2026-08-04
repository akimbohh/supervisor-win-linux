// Supervisor app — router, state, WebSocket client.
// Tabs: sessions, files, console, processes, system, settings.

(function () {
  // ── Persistent app state ──
  const App = window.App = {
    settings: {},
    me: null,
    ws: null,
    wsConnected: false,
    wsTopics: new Set(),
    wsHandlers: new Set(),
    currentTab: null,
    currentView: null,
    viewCache: {},   // tab -> { host, view } for views that persist across navigation
  };

  // ── Global error handlers (so we see what's actually failing) ──
  window.addEventListener('error', (e) => {
    try { window.toast && window.toast.error((e.error && e.error.message) || e.message || 'Script error'); } catch (_) {}
    console.error('[window.error]', e.error || e.message, e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { window.toast && window.toast.error('Unhandled: ' + ((e.reason && e.reason.message) || String(e.reason))); } catch (_) {}
    console.error('[unhandledrejection]', e.reason);
  });

  // ── iOS overscroll guard ──
  // In home-screen (standalone) mode WebKit pans the whole viewport whenever a
  // touch drag finds nothing to scroll — a drag on the header/tab bar/composer,
  // or in a pane whose content doesn't overflow yet. overscroll-behavior in
  // styles.css contains panes that DO overflow; this blocks everything else.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    for (let n = e.target instanceof Element ? e.target : null; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth) {
        const o = getComputedStyle(n);
        if (/auto|scroll/.test(o.overflowY + o.overflowX)) return;
      }
    }
    e.preventDefault();
  }, { passive: false });

  // ── Service worker ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Periodic update check so an open tab gets the latest SW within ~5 min.
      setInterval(() => { try { reg.update(); } catch (e) {} }, 5 * 60 * 1000);
      // When a new SW is installed and waiting, ask it to take over now.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage('skipWaiting');
          }
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
    }).catch(() => {});
  }

  // ── Tab bar render ──
  function renderTabs() {
    const bar = document.getElementById('tabbar');
    for (const a of bar.querySelectorAll('a')) {
      const ic = a.dataset.icon, label = a.dataset.label;
      a.innerHTML = window.icon(ic, { size: 20 }) + '<span>' + label + '</span>';
    }
    document.getElementById('brand-logo').innerHTML = window.icon('layers', { size: 16 });
    const help = document.getElementById('help-btn');
    if (help) { help.innerHTML = window.icon('help', { size: 18 }); help.onclick = showMaintenanceModal; }
  }

  // ── Hash routing ──
  function parseHash() {
    const h = location.hash.slice(1) || 'claude';
    const [tab, ...rest] = h.split('/');
    return { tab: tab || 'claude', rest, raw: h };
  }

  function setActiveTab(tab) {
    for (const a of document.querySelectorAll('#tabbar a')) {
      a.classList.toggle('active', a.dataset.tab === tab);
    }
  }

  // sessions/processes have no tab-bar slot anymore (merged into Claude and
  // System respectively) but stay directly routable so deep links, shortcuts
  // and old bookmarks keep working.
  const VIEWS = {
    claude:    () => window.InteractiveView,
    sessions:  () => window.SessionsView,
    files:     () => window.FilesView,
    console:   () => window.ConsoleView,
    processes: () => window.ProcessesView,
    system:    () => window.SystemCombinedView,
    settings:  () => window.SettingsView,
  };

  async function navigate() {
    const { tab, rest } = parseHash();
    setActiveTab(tab);
    document.getElementById('page-title').textContent = ({
      claude:'Claude', sessions:'Sessions', files:'Files', console:'Console', processes:'Processes', system:'System', settings:'Settings'
    })[tab] || 'Supervisor';

    // Same tab + view supports incremental routing → no re-mount.
    if (App.currentTab === tab && App.currentView && typeof App.currentView.route === 'function') {
      try { App.currentView.route(rest); } catch (e) {}
      return;
    }

    const factory = VIEWS[tab] && VIEWS[tab]();

    // Header actions reset
    const a1 = document.getElementById('header-action-1');
    const a2 = document.getElementById('header-action-2');
    a1.hidden = true; a2.hidden = true;
    a1.innerHTML = ''; a2.innerHTML = '';
    a1.onclick = null; a2.onclick = null;

    const main = document.getElementById('main');
    const enter = async () => {
      // Tear down — or, for a view that returned persist:true, suspend — the
      // previous view. A persistent view keeps its DOM and closures alive
      // detached from the document; its WS handlers keep rendering into the
      // off-screen tree, so nothing is lost while another tab is showing.
      const prev = App.currentView, prevTab = App.currentTab;
      if (prev) {
        if (prev.persist && App.viewCache[prevTab]) {
          try { if (typeof prev.suspend === 'function') prev.suspend(); } catch (e) {}
        } else if (typeof prev.destroy === 'function') {
          try { prev.destroy(); } catch (e) {}
        }
      }
      App.currentTab = tab;
      App.currentView = null;
      main.innerHTML = ''; // detaches a persistent host without destroying it
      if (!factory) {
        main.appendChild(window.emptyState({ icon: 'help', title: 'Unknown tab', body: tab }));
        return;
      }
      const cached = App.viewCache[tab];
      if (cached) {
        main.appendChild(cached.host);
        App.currentView = cached.view;
        try { if (typeof cached.view.resume === 'function') cached.view.resume(rest); } catch (e) {}
        return;
      }
      // Views mount into a layout-neutral host (display:contents) so a
      // persistent view can be re-parented later without touching siblings.
      const host = document.createElement('div');
      host.className = 'view-host';
      main.appendChild(host);
      try {
        const v = await factory(host, { rest, app: App });
        App.currentView = v || {};
        if (v && v.persist) App.viewCache[tab] = { host, view: v };
      } catch (e) {
        console.error('[view ' + tab + ']', e);
        main.innerHTML = '';
        const where = (e && e.stack) ? e.stack.split('\n').slice(0, 4).join('\n') : '';
        main.appendChild(window.emptyState({ icon: 'alert', title: 'Failed to load', body: (e.message || String(e)) + (where ? '\n\n' + where : '') }));
        // Toast with short reason so it's visible even if the empty state is missed.
        try { window.toast.error(tab + ': ' + (e.message || String(e))); } catch (_) {}
      }
    };
    if (document.startViewTransition) {
      try { await document.startViewTransition(enter).finished; }
      catch (e) { await enter(); }
    } else {
      await enter();
    }
  }

  window.addEventListener('hashchange', navigate);

  // ── WebSocket ──
  // Views receive a synthetic local message { topic:'_conn', payload:{state} }
  // on connect/disconnect so they can show a reconnecting state and replay
  // whatever they missed (it never comes from the server).
  function notifyConn(state) {
    for (const h of App.wsHandlers) { try { h({ topic: '_conn', payload: { state } }); } catch (e) {} }
  }
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = proto + '://' + location.host + '/ws';
    let backoff = 500;
    let reconnectTimer = null;
    function open() {
      if (App.ws && (App.ws.readyState === 0 || App.ws.readyState === 1)) return;
      try { App.ws = new WebSocket(url); }
      catch (e) { reconnectTimer = setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000); return; }
      App.ws.addEventListener('open', () => {
        App.wsConnected = true; backoff = 500;
        setConnDot('online');
        // Re-subscribe topics
        for (const t of App.wsTopics) safeSend({ type: 'sub', topic: t });
        startPingLoop();
        checkRestartFlagOnReconnect();
        notifyConn('online');
      });
      App.ws.addEventListener('close', () => {
        App.wsConnected = false;
        setConnDot('offline');
        stopPingLoop();
        notifyConn('offline');
        reconnectTimer = setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000);
      });
      App.ws.addEventListener('message', (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg && msg.topic === 'pong') { handlePong(); return; }
        for (const h of App.wsHandlers) { try { h(msg); } catch (e) {} }
      });
    }
    // iOS home-screen PWA: backgrounding kills the socket. Reconnect the moment
    // we're foregrounded again instead of waiting out the backoff timer.
    function poke() {
      if (App.ws && (App.ws.readyState === 0 || App.ws.readyState === 1)) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      backoff = 500;
      open();
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poke(); });
    window.addEventListener('pageshow', poke);
    open();
  }

  // ── Latency ping ──
  // Send {type:'ping'} every 5s; server replies {topic:'pong'}. Track RTT and
  // update the header badge. If a pong is overdue, show "…" until it arrives.
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
    setLatencyBadge(null);
  }
  function sendPing() {
    if (!App.ws || App.ws.readyState !== 1) return;
    pingSentAt = performance.now();
    pingPending = true;
    safeSend({ type: 'ping' });
    // If no pong in 4s, mark stale.
    setTimeout(() => { if (pingPending) setLatencyBadge('stale'); }, 4000);
  }
  function handlePong() {
    if (!pingPending) return;
    pingPending = false;
    const rtt = Math.max(0, Math.round(performance.now() - pingSentAt));
    setLatencyBadge(rtt);
  }
  function setLatencyBadge(rtt) {
    const b = document.getElementById('latency-badge');
    if (!b) return;
    if (rtt === null) { b.hidden = true; b.className = 'badge mono'; b.textContent = '—'; return; }
    b.hidden = false;
    if (rtt === 'stale') {
      b.className = 'badge mono warn';
      b.textContent = '…';
      b.title = 'Waiting for pong';
      return;
    }
    let cls = 'success';
    if (rtt > 300) cls = 'danger';
    else if (rtt > 100) cls = 'warn';
    b.className = 'badge mono ' + cls;
    b.textContent = rtt + 'ms';
    b.title = 'WebSocket round-trip: ' + rtt + 'ms';
  }
  function safeSend(obj) {
    if (App.ws && App.ws.readyState === 1) { App.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }
  function subscribe(topic) {
    App.wsTopics.add(topic);
    safeSend({ type: 'sub', topic });
  }
  function unsubscribe(topic) {
    App.wsTopics.delete(topic);
    safeSend({ type: 'unsub', topic });
  }
  function onMessage(handler) {
    App.wsHandlers.add(handler);
    return () => App.wsHandlers.delete(handler);
  }
  function setConnDot(state) {
    const d = document.getElementById('connection-dot');
    if (state === 'online') {
      d.className = 'badge dot success';
      d.textContent = 'live';
    } else {
      d.className = 'badge dot';
      d.style.color = 'var(--text-3)';
      d.textContent = 'offline';
    }
  }

  App.subscribe = subscribe;
  App.unsubscribe = unsubscribe;
  App.onMessage = onMessage;
  App.send = safeSend;

  // ── Settings application (theme + accent) ──
  function applySettings(s) {
    App.settings = s || {};
    const theme = (s && s.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const accent = (s && s.accent) || 'amber';
    document.documentElement.setAttribute('data-accent', accent);
    // Theme color meta to match
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', theme === 'light' ? '#fafaf7' : '#0a0a0b');
  }
  App.applySettings = applySettings;

  // ── Keyboard shortcuts (desktop) ──
  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore in inputs/textareas
      const tag = (e.target && e.target.tagName) || '';
      const inEditor = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      if (e.key === '?' && !inEditor) { e.preventDefault(); showMaintenanceModal(); }
      if (e.key.toLowerCase() === 'g' && !inEditor && !App.gPressed) {
        App.gPressed = true; setTimeout(() => App.gPressed = false, 800); return;
      }
      if (App.gPressed && !inEditor) {
        const map = { s: 'sessions', f: 'files', c: 'console', p: 'processes', y: 'system', t: 'settings' };
        const target = map[e.key.toLowerCase()];
        if (target) { e.preventDefault(); App.gPressed = false; location.hash = '#' + target; return; }
      }
    });
  }

  // ── Maintenance modal ──
  // Single action: hand off to an interactive Claude shell. The prompt is
  // also copied to the clipboard so the user can paste it manually if the
  // auto-paste misses (e.g. trust dialog races, slow network).
  async function showMaintenanceModal() {
    const el = window.el;

    const ta = el('textarea', { class: 'textarea', placeholder: 'e.g. "The login button on mobile is too small — make it bigger."', style: { minHeight: '110px' } });
    const help = el('div', { class: 'help muted text-sm' }, 'Opens a Console shell with `claude` running and auto-pastes your prompt. The request is also copied to your clipboard.');

    const field = el('div', { class: 'col gap-2' }, [
      el('label', null, 'Describe the change or bug'),
      help,
      ta,
    ]);

    let handle = null;

    async function openInteractive() {
      const text = ta.value.trim();
      if (!text) { window.toast.error('Enter a description first'); return; }
      try { await window.copyToClipboard(text); } catch (e) {}
      try {
        const r = await window.api('/api/maintenance/interactive', { method: 'POST', body: { text } });
        if (r && r.shellId) {
          try { localStorage.setItem('consoleActivateShell', r.shellId); } catch (e) {}
        }
        window.toast.info('Request copied — opening Claude.');
        handle.close();
        location.hash = '#console';
      } catch (e) { window.toast.error(e.message); }
    }

    // Primary path: open the Interactive Claude tab pre-filled (the default
    // interactive-Claude experience). The Console hand-off remains as a
    // secondary option for a raw terminal.
    function openInteractiveClaude() {
      const text = ta.value.trim();
      if (!text) { window.toast.error('Enter a description first'); return; }
      try { localStorage.setItem('claude.pendingMessage', text); } catch (e) {}
      handle.close();
      location.hash = '#claude';
    }
    const claudeBtn = el('button', { class: 'btn primary' }, 'Ask Interactive Claude');
    claudeBtn.title = 'Opens the Claude tab with your prompt ready to send.';
    claudeBtn.addEventListener('click', openInteractiveClaude);

    const interactiveBtn = el('button', { class: 'btn ghost' }, 'Open in terminal');
    interactiveBtn.title = 'Opens a Console shell with `claude` running and pastes your prompt.';
    interactiveBtn.addEventListener('click', openInteractive);

    handle = window.modal.open({
      title: 'Request a change',
      content: field,
      actions: [
        { label: 'Close', kind: 'ghost', onClick: () => handle.close() },
      ],
      size: 'lg',
    });

    const footer = handle.el.querySelector('.modal-footer');
    if (footer) { footer.appendChild(interactiveBtn); footer.appendChild(claudeBtn); }

    setTimeout(() => ta.focus(), 50);
  }
  window.showMaintenanceModal = showMaintenanceModal;

  // ── Restart banner ──
  // Set sessionStorage.supervisorRestarting = Date.now() right before posting
  // /api/maintenance/restart. While the WS is offline, show "Server is
  // restarting…". When the WS reconnects within 60 s, swap to "Reload now".
  function showRestartingBanner() {
    const b = document.getElementById('restart-banner');
    if (!b) return;
    b.hidden = false;
    b.className = 'restart-banner pending';
    b.innerHTML = '';
    b.appendChild(window.el('span', null, 'Server is restarting…'));
  }
  function showReloadBanner() {
    const b = document.getElementById('restart-banner');
    if (!b) return;
    b.hidden = false;
    b.className = 'restart-banner ready';
    b.innerHTML = '';
    b.appendChild(window.el('span', null, 'Server restarted'));
    const reload = window.el('button', { class: 'btn sm primary' }, 'Reload now');
    reload.addEventListener('click', () => location.reload());
    b.appendChild(reload);
  }
  function hideRestartBanner() {
    const b = document.getElementById('restart-banner');
    if (!b) return;
    b.hidden = true;
    b.className = 'restart-banner';
    b.innerHTML = '';
  }
  function checkRestartFlagOnReconnect() {
    const ts = parseInt(sessionStorage.getItem('supervisorRestarting') || '0', 10);
    if (!ts) return;
    if (Date.now() - ts > 5 * 60 * 1000) {
      // Flag is stale (>5 min) — drop it.
      sessionStorage.removeItem('supervisorRestarting');
      hideRestartBanner();
      return;
    }
    sessionStorage.removeItem('supervisorRestarting');
    showReloadBanner();
  }
  function checkRestartFlagOnBoot() {
    const ts = parseInt(sessionStorage.getItem('supervisorRestarting') || '0', 10);
    if (ts && Date.now() - ts < 5 * 60 * 1000) showRestartingBanner();
  }
  App.markRestarting = function () {
    sessionStorage.setItem('supervisorRestarting', String(Date.now()));
    showRestartingBanner();
  };

  // ── Boot ──
  async function boot() {
    renderTabs();

    try {
      const me = await window.api('/api/auth/me');
      App.me = me;
    } catch (e) {
      // api() already redirected to /login on 401.
      return;
    }

    try {
      const s = await window.api('/api/settings');
      applySettings(s);
    } catch (e) {
      console.warn('Failed to load settings', e);
      applySettings({});
    }

    // Listen for live settings updates
    onMessage((msg) => {
      if (msg.topic === 'settings') applySettings(msg.payload);
    });

    if (!location.hash) location.replace('#claude');
    checkRestartFlagOnBoot();
    connectWS();
    setupShortcuts();
    navigate();
  }

  boot();
})();
