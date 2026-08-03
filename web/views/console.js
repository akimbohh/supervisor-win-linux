// Console view — multi-tab persistent shells, xterm.js, mobile keyboard helper.
window.ConsoleView = async function (root, { rest, app }) {
  let shells = [];
  let activeId = null;
  const terms = new Map();          // id -> { term, fit, host, history, historyIdx }
  let unsub = null;

  // Header action: + new shell
  const a1 = document.getElementById('header-action-1');
  a1.hidden = false;
  a1.title = 'New shell';
  a1.innerHTML = window.icon('plus');
  a1.onclick = () => createShell();

  // Layout
  root.innerHTML = '';
  const wrap = el('div', { class: 'col', style: { height: '100%', minHeight: '0', gap: '0' } });
  const tabsBar = el('div', { class: 'term-bar' });
  wrap.appendChild(tabsBar);
  const termHost = el('div', { class: 'term-host', style: { flex: '1 1 auto' } });
  wrap.appendChild(termHost);
  const kbdRow = el('div', { class: 'kbd-row' });
  wrap.appendChild(kbdRow);
  root.appendChild(wrap);

  // ── Vendor loading (xterm + fit) ──
  if (!window.Terminal) {
    await loadScript('/vendor/xterm/xterm.js');
    await loadScript('/vendor/xterm/xterm-addon-fit.js');
  }
  function loadScript(src) {
    return new Promise(r => {
      const s = document.createElement('script'); s.src = src; s.async = true; s.onload = r; s.onerror = r;
      document.head.appendChild(s);
    });
  }

  // ── Tabs ──
  function renderTabs() {
    tabsBar.innerHTML = '';
    for (const s of shells) {
      const t = el('div', { class: 'term-tab' + (s.id === activeId ? ' active' : '') });
      const dot = el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: s.alive ? 'var(--success)' : 'var(--text-3)' } });
      const name = el('span', null, s.name + (s.usingPty ? '' : ' (pipe)'));
      const x = el('span', { class: 'x', html: window.icon('x', { size: 12 }) });
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await window.confirmModal({ title: 'Close shell?', body: s.name, danger: true, confirmText: 'Close' })) return;
        try { await window.api('/api/console/' + s.id, { method: 'DELETE' }); }
        catch (err) { window.toast.error(err.message); }
      });
      t.appendChild(dot); t.appendChild(name); t.appendChild(x);
      t.addEventListener('click', () => activate(s.id));
      window.attachLongPress(t, async () => {
        const next = await window.promptModal({ title: 'Rename shell', initial: s.name });
        if (next == null || next === s.name) return;
        try { await window.api('/api/console/' + s.id, { method: 'PATCH', body: { name: next } }); }
        catch (e) { window.toast.error(e.message); }
      });
      tabsBar.appendChild(t);
    }
    if (!shells.length) {
      const empty = el('div', { class: 'muted text-sm', style: { padding: '6px 10px' } }, 'No shells. Tap + to start one.');
      tabsBar.appendChild(empty);
    }
    const newB = el('div', { class: 'term-tab', html: window.icon('plus', { size: 14 }) + ' New' });
    newB.addEventListener('click', () => createShell());
    tabsBar.appendChild(newB);
  }

  // Quick-key presets — the menu offered when binding a "+" slot.
  const PRESETS = [
    { kind: 'key', label: 'Esc', data: '\x1b' },
    { kind: 'key', label: 'Tab', data: '\t' },
    { kind: 'ctrl-toggle', label: 'Ctrl' },
    { kind: 'key', label: '↑', data: '\x1b[A' },
    { kind: 'key', label: '↓', data: '\x1b[B' },
    { kind: 'key', label: '←', data: '\x1b[D' },
    { kind: 'key', label: '→', data: '\x1b[C' },
    { kind: 'key', label: '|', data: '|' },
    { kind: 'key', label: '~', data: '~' },
    { kind: 'key', label: '/', data: '/' },
    { kind: 'key', label: '\\', data: '\\' },
    { kind: 'key', label: '"', data: '"' },
    { kind: 'key', label: "'", data: "'" },
    { kind: 'key', label: '$', data: '$' },
    { kind: 'key', label: '&', data: '&' },
    { kind: 'key', label: '*', data: '*' },
    { kind: 'key', label: '#', data: '#' },
    { kind: 'key', label: 'Ctrl+C', data: '\x03' },
    { kind: 'key', label: 'Ctrl+D', data: '\x04' },
    { kind: 'key', label: 'Ctrl+L', data: '\x0c' },
    { kind: 'key', label: 'Ctrl+R', data: '\x12' },
    { kind: 'send-claude', label: 'Send to Claude' },
    { kind: 'paste', label: 'Paste' },
  ];

  let ctrlOn = false;
  let ctrlBtn = null;

  function setCtrlOn(v) {
    ctrlOn = v;
    if (ctrlBtn) {
      ctrlBtn.style.background = ctrlOn ? 'var(--accent)' : '';
      ctrlBtn.style.color = ctrlOn ? 'var(--accent-on)' : '';
    }
  }

  function executeEntry(entry, btn) {
    if (entry.kind === 'ctrl-toggle') { setCtrlOn(!ctrlOn); return; }
    if (entry.kind === 'send-claude') return sendSelectionToClaude();
    if (entry.kind === 'paste') return pasteFromClipboard();
    if (entry.kind === 'cd') {
      const p = (entry.path || '').replace(/"/g, '\\"');
      sendInput('cd "' + p + '"\r');
      return;
    }
    if (entry.kind === 'script') {
      const text = (entry.text || '').replace(/\r\n?|\n/g, '\r');
      sendInput(text + (text.endsWith('\r') ? '' : '\r'));
      return;
    }
    // 'key'
    let payload = entry.data || '';
    if (ctrlOn && payload && payload.length === 1) {
      const c = payload.toLowerCase().charCodeAt(0);
      if (c >= 97 && c <= 122) payload = String.fromCharCode(c - 96);
      setCtrlOn(false);
    }
    sendInput(payload);
  }

  function getQuickKeys() {
    const list = (app.settings && app.settings.quickKeys) || [];
    return Array.isArray(list) ? list : [];
  }

  async function saveQuickKeys(list) {
    try {
      const next = await window.api('/api/settings', { method: 'PATCH', body: { quickKeys: list } });
      app.applySettings(next);
    } catch (e) {
      window.toast.error(e.message);
    }
  }

  function renderKbdRow() {
    kbdRow.innerHTML = '';
    ctrlBtn = null;
    if (!activeId) { kbdRow.style.display = 'none'; return; }
    kbdRow.style.display = '';

    const list = getQuickKeys();
    list.forEach((entry) => {
      const b = el('div', { class: 'key' }, entry.label || '?');
      if (entry.kind === 'ctrl-toggle') ctrlBtn = b;
      let suppressClick = false;
      // Capture-phase guard runs before the bubble-phase fire handler on the
      // same element; stopImmediatePropagation prevents the click that follows
      // a long-press release.
      b.addEventListener('click', (e) => { if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
      b.addEventListener('click', () => executeEntry(entry, b));
      window.attachLongPress(b, async () => {
        suppressClick = true;
        const action = await openEntryActionMenu(entry);
        setTimeout(() => { suppressClick = false; }, 50);
        if (action === 'edit') {
          const updated = await openKeyPicker(entry);
          if (!updated) return;
          const cur = getQuickKeys();
          const next = cur.map(e => e.id === entry.id ? { ...updated, id: entry.id } : e);
          saveQuickKeys(next);
        } else if (action === 'remove') {
          const next = getQuickKeys().filter(e => e.id !== entry.id);
          saveQuickKeys(next);
        }
      });
      kbdRow.appendChild(b);
    });

    // Trailing "+" slot — opens the picker to add a new entry
    const plus = el('div', { class: 'key', style: { color: 'var(--text-3)', fontWeight: '600' } }, '+');
    plus.title = 'Add quick key';
    plus.addEventListener('click', async () => {
      const picked = await openKeyPicker(null);
      if (!picked) return;
      const next = getQuickKeys().slice();
      next.push({ ...picked, id: 'qk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6) });
      saveQuickKeys(next);
    });
    kbdRow.appendChild(plus);
  }

  // Long-press menu on a configured key: edit or remove.
  function openEntryActionMenu(entry) {
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };
      const body = el('div', { class: 'col gap-2' }, [
        el('div', { class: 'muted text-sm' }, entry.label || ''),
      ]);
      const handle = window.modal.open({
        title: 'Quick key',
        content: body,
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: () => { settle(null); handle.close(); } },
          { label: 'Remove', kind: 'ghost danger', onClick: () => { settle('remove'); handle.close(); } },
          { label: 'Edit', kind: 'primary', onClick: () => { settle('edit'); handle.close(); } },
        ],
        onClose: () => settle(null),
      });
    });
  }

  // Picker — returns the chosen entry (without `id`) or null.
  function openKeyPicker(existing) {
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };

      const body = el('div', { class: 'col gap-3', style: { minWidth: '280px' } });

      // Tabs
      const tabsRow = el('div', { class: 'row gap-2' });
      const panes = {};
      const tabs = [
        ['preset', 'Preset'],
        ['cd', 'cd path'],
        ['script', 'Script'],
      ];
      let activeTab = existing
        ? (existing.kind === 'cd' ? 'cd' : existing.kind === 'script' ? 'script' : 'preset')
        : 'preset';
      const tabBtns = {};
      function setActive(name) {
        activeTab = name;
        for (const [n] of tabs) {
          tabBtns[n].className = 'btn sm ' + (n === name ? 'primary' : 'ghost');
          panes[n].style.display = n === name ? '' : 'none';
        }
      }
      for (const [n, label] of tabs) {
        const b = el('button', { class: 'btn sm ghost' }, label);
        b.addEventListener('click', () => setActive(n));
        tabBtns[n] = b;
        tabsRow.appendChild(b);
      }
      body.appendChild(tabsRow);

      // ── Preset pane ──
      const presetPane = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
      for (const p of PRESETS) {
        const b = el('button', { class: 'btn sm ghost mono' }, p.label);
        b.addEventListener('click', () => {
          settle({ kind: p.kind, label: p.label, data: p.data });
          handle.close();
        });
        presetPane.appendChild(b);
      }
      panes.preset = presetPane;
      body.appendChild(presetPane);

      // ── cd pane ──
      const cdPane = el('div', { class: 'col gap-2' });
      const cdLabel = el('input', { class: 'input', placeholder: 'Button label (e.g. ~/projects)', value: existing && existing.kind === 'cd' ? (existing.label || '') : '' });
      const cdPath = el('input', { class: 'input mono', placeholder: 'Folder path', value: existing && existing.kind === 'cd' ? (existing.path || '') : '' });
      cdPath.addEventListener('input', () => {
        if (!cdLabel.value && cdPath.value) {
          const parts = cdPath.value.replace(/\\/g, '/').split('/').filter(Boolean);
          cdLabel.placeholder = 'Button label (e.g. ' + (parts[parts.length - 1] || 'cd') + ')';
        }
      });
      const cdSave = el('button', { class: 'btn primary' }, 'Add');
      cdSave.addEventListener('click', () => {
        const path = cdPath.value.trim();
        if (!path) { window.toast.error('Path required'); return; }
        const label = cdLabel.value.trim() || (path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'cd');
        settle({ kind: 'cd', label, path });
        handle.close();
      });
      cdPane.appendChild(el('label', { class: 'muted text-sm' }, 'Sends `cd "<path>"` to the active shell.'));
      cdPane.appendChild(cdLabel);
      cdPane.appendChild(cdPath);
      cdPane.appendChild(cdSave);
      cdPane.style.display = 'none';
      panes.cd = cdPane;
      body.appendChild(cdPane);

      // ── Script pane ──
      const scriptPane = el('div', { class: 'col gap-2' });
      const scLabel = el('input', { class: 'input', placeholder: 'Button label', value: existing && existing.kind === 'script' ? (existing.label || '') : '' });
      const scText = el('textarea', { class: 'input mono', rows: 6, placeholder: 'Commands to run (newline = enter)' });
      if (existing && existing.kind === 'script') scText.value = existing.text || '';
      const scSave = el('button', { class: 'btn primary' }, 'Add');
      scSave.addEventListener('click', () => {
        const text = scText.value;
        if (!text.trim()) { window.toast.error('Script text required'); return; }
        const label = scLabel.value.trim() || 'Script';
        settle({ kind: 'script', label, text });
        handle.close();
      });
      scriptPane.appendChild(el('label', { class: 'muted text-sm' }, 'Typed into the active shell. Each newline becomes Enter.'));
      scriptPane.appendChild(scLabel);
      scriptPane.appendChild(scText);
      scriptPane.appendChild(scSave);
      scriptPane.style.display = 'none';
      panes.script = scriptPane;
      body.appendChild(scriptPane);

      const handle = window.modal.open({
        title: existing ? 'Edit quick key' : 'Add quick key',
        content: body,
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: () => { settle(null); handle.close(); } },
        ],
        onClose: () => settle(null),
      });

      setActive(activeTab);
    });
  }

  function sendInput(data) {
    if (!activeId) return;
    if (app.send({ type: 'shell:write', id: activeId, data })) return;
    // fallback over HTTP
    window.api('/api/console/' + activeId + '/write', { method: 'POST', body: { data } }).catch(() => {});
  }

  async function pasteFromClipboard() {
    if (!activeId) return;
    let text = '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('Clipboard API unavailable');
      text = await navigator.clipboard.readText();
    } catch (e) {
      const entered = await window.promptModal({ title: 'Paste', label: 'Clipboard read blocked — paste here', confirmText: 'Send' });
      if (entered == null) return;
      text = entered;
    }
    if (!text) return;
    sendInput(text.replace(/\r\n?|\n/g, '\r'));
  }

  function sendSelectionToClaude() {
    const t = terms.get(activeId);
    if (!t) return;
    const sel = t.term.getSelection();
    const folder = t.cwd || shells.find(s => s.id === activeId).cwd;
    const text = sel || '';
    location.hash = '#sessions/new/' + encodeURIComponent(folder);
    setTimeout(() => {
      // Sessions view will pick up the hash and open new-session modal
      // We can't easily inject the prePrompt across views; instead, copy to clipboard.
      if (text) window.copyToClipboard(text);
      window.toast.info('Folder set; selected text copied to clipboard.');
    }, 200);
  }

  function activate(id) {
    activeId = id;
    for (const [tid, t] of terms) t.host.style.display = tid === id ? 'block' : 'none';
    if (!terms.has(id)) attach(id);
    renderTabs(); renderKbdRow();
    setTimeout(() => fitTerm(id), 60);
  }

  async function attach(id) {
    const host = el('div', { style: { width: '100%', height: '100%' } });
    termHost.appendChild(host);
    let info;
    try { info = await window.api('/api/console/' + id); }
    catch (e) { window.toast.error(e.message); return; }

    const term = new window.Terminal({
      fontFamily: 'ui-monospace, SF Mono, Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: '#000000',
        foreground: '#dfe1e3',
        cursor: '#f59e0b',
        cursorAccent: '#1a1206',
        selectionBackground: '#f59e0b55',
        black: '#0a0a0b', red: '#c53d3d', green: '#4ade80', yellow: '#fbbf24',
        blue: '#60a5fa', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e8e8ea',
        brightBlack: '#5f5f68', brightRed: '#f87171', brightGreen: '#86efac', brightYellow: '#fde68a',
        brightBlue: '#93c5fd', brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff',
      },
    });
    let fit = null;
    try { fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); } catch (e) {}
    term.open(host);
    if (info.scrollback) term.write(info.scrollback);

    // Send keystrokes
    term.onData((data) => sendInput(data));

    // Local command-history (Ctrl+R style)
    const ctx = { term, fit, host, cwd: info.cwd, history: [], historyIdx: -1 };
    terms.set(id, ctx);
    fitTerm(id);
  }

  function fitTerm(id) {
    const t = terms.get(id); if (!t) return;
    try {
      if (t.fit) {
        t.fit.fit();
        const cols = t.term.cols, rows = t.term.rows;
        if (app.send({ type: 'shell:resize', id, cols, rows })) {
          // sent
        } else {
          window.api('/api/console/' + id + '/resize', { method: 'POST', body: { cols, rows } }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  function fitAll() { for (const id of terms.keys()) fitTerm(id); }

  // ── Data ──
  async function reload(silent) {
    try {
      shells = await window.api('/api/console');
      if (!silent) renderTabs();
      // Auto-create one if empty
      if (!shells.length) {
        // honour ?cwd param via deep link
        const cwd = (rest && rest.length) ? decodeURIComponent(rest.join('/')) : null;
        await createShell({ cwd });
        return;
      }
      // Honour a one-shot localStorage hint set by the maintenance hand-off:
      // if the requested shell exists, activate it. Otherwise fall back.
      let preferred = null;
      try {
        const hint = localStorage.getItem('consoleActivateShell');
        if (hint) {
          localStorage.removeItem('consoleActivateShell');
          if (shells.find(s => s.id === hint)) preferred = hint;
        }
      } catch (e) {}
      if (preferred) activate(preferred);
      else if (!activeId || !shells.find(s => s.id === activeId)) activate(shells[0].id);
      renderTabs();
      renderKbdRow();
    } catch (e) { window.toast.error(e.message); }
  }

  async function createShell(opts = {}) {
    try {
      const newShell = await window.api('/api/console', { method: 'POST', body: { cwd: opts.cwd } });
      activeId = newShell.id;
      await reload(true);
      activate(activeId);
    } catch (e) { window.toast.error(e.message); }
  }

  // ── WS ──
  app.subscribe('shells');
  unsub = app.onMessage((msg) => {
    if (!msg) return;
    if (msg.topic === 'shells') return reload(true);
    if (msg.topic === 'settings') { renderKbdRow(); return; }
    if (msg.topic && msg.topic.startsWith('shell:')) {
      const id = msg.topic.slice('shell:'.length);
      const t = terms.get(id);
      if (!t) return;
      if (msg.payload.event === 'data') t.term.write(msg.payload.data);
      else if (msg.payload.event === 'exit') t.term.write('\r\n[exited]\r\n');
    }
  });

  // Subscribe to active shell's output
  function ensureShellSub(id) {
    app.subscribe('shell:' + id);
  }
  // Listen for activations to ensure subscription
  const origActivate = activate;
  // (Already subscribed in attach via app.subscribe; do it explicitly when shell appears.)

  // Re-subscribe on reload
  const origReload = reload;
  reload = async function (silent) {
    await origReload(silent);
    for (const s of shells) ensureShellSub(s.id);
  };

  // Resize observer for terminal fit
  const ro = new ResizeObserver(window.debounce(fitAll, 80));
  ro.observe(termHost);
  window.addEventListener('orientationchange', fitAll);

  await reload();

  return {
    destroy() {
      ro.disconnect();
      a1.hidden = true; a1.onclick = null;
      app.unsubscribe('shells');
      for (const s of shells) app.unsubscribe('shell:' + s.id);
      if (unsub) unsub();
      // Dispose xterm instances
      for (const [, t] of terms) { try { t.term.dispose(); } catch (e) {} }
      terms.clear();
    },
  };
};
