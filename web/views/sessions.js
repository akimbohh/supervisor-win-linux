// Sessions view — Claude Code session manager.
window.SessionsView = async function (root, { rest, app }) {
  let list = [];
  let presets = [];
  let filter = 'all'; // 'all' | 'running' | 'exited'
  let search = '';
  let groupBy = localStorage.getItem('sessions.group') || 'none';   // 'none' | 'folder' | 'tag'
  let unsubMsg = null;
  let openId = null;
  let logSubscribed = null;

  // Header actions
  const a1 = document.getElementById('header-action-1');
  a1.hidden = false;
  a1.title = 'New session';
  a1.innerHTML = window.icon('plus');
  a1.onclick = () => openNewSession();

  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-3' });

  // Filter row
  const tools = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
  const searchWrap = el('div', { style: { flex: '1 1 200px' } });
  const searchEl = el('input', { class: 'input', placeholder: 'Search folder, tag, log…' });
  searchEl.addEventListener('input', window.debounce(() => { search = searchEl.value; render(); }, 80));
  searchWrap.appendChild(searchEl);
  tools.appendChild(searchWrap);

  for (const [k, lbl] of [['all','All'],['running','Running'],['exited','Exited']]) {
    const b = el('button', { class: 'btn ' + (filter === k ? 'primary' : 'ghost') + ' sm' }, lbl);
    b.addEventListener('click', () => { filter = k; renderTools(); render(); });
    tools.appendChild(b);
  }
  const groupBtn = el('button', { class: 'btn ghost sm' });
  function refreshGroupLabel() { groupBtn.innerHTML = window.icon('layers', { size: 14 }) + ' ' + ({ none:'No group', folder:'By folder', tag:'By tag' })[groupBy]; }
  refreshGroupLabel();
  groupBtn.addEventListener('click', () => {
    groupBy = groupBy === 'none' ? 'folder' : groupBy === 'folder' ? 'tag' : 'none';
    localStorage.setItem('sessions.group', groupBy);
    refreshGroupLabel();
    render();
  });
  tools.appendChild(groupBtn);

  function renderTools() {
    // refresh active state
    [...tools.querySelectorAll('button')].forEach(b => {
      const text = b.textContent.trim();
      if (['All','Running','Exited'].includes(text)) {
        b.className = 'btn ' + (filter === text.toLowerCase() ? 'primary' : 'ghost') + ' sm';
      }
    });
  }
  wrap.appendChild(tools);

  // Presets bar
  const presetBar = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', minHeight: '0' } });
  wrap.appendChild(presetBar);

  // Sessions container
  const main = el('div', { class: 'col gap-3' });
  wrap.appendChild(main);

  root.appendChild(wrap);

  // ── Render ──
  function applyFilters(items) {
    let out = items.slice();
    if (filter === 'running') out = out.filter(s => s.status === 'running');
    else if (filter === 'exited') out = out.filter(s => s.status !== 'running' && s.status !== 'killing');
    if (search) {
      const f = search.toLowerCase();
      out = out.filter(s =>
        (s.folder || '').toLowerCase().includes(f) ||
        (s.name || '').toLowerCase().includes(f) ||
        (s.tag || '').toLowerCase().includes(f) ||
        (s.lastLog || '').toLowerCase().includes(f)
      );
    }
    return out;
  }

  function render() {
    main.innerHTML = '';

    // Presets
    presetBar.innerHTML = '';
    if (presets.length) {
      presetBar.appendChild(el('span', { class: 'section-title', style: { margin:'0 8px 0 0' } }, 'Presets'));
      for (const p of presets) {
        const b = el('button', { class: 'btn ghost sm' });
        b.innerHTML = window.icon('zap', { size: 14 }) + ' ' + window.escapeHtml(p.name || window.basename(p.folder));
        b.title = p.folder;
        b.addEventListener('click', () => launchPreset(p));
        // long-press: edit/delete
        window.attachLongPress(b, () => editPreset(p));
        presetBar.appendChild(b);
      }
      const add = el('button', { class: 'btn ghost sm' });
      add.innerHTML = window.icon('plus', { size: 12 }) + ' Add preset';
      add.addEventListener('click', () => editPreset({}));
      presetBar.appendChild(add);
    }

    const visible = applyFilters(list);
    if (!visible.length) {
      const action = el('button', { class: 'btn primary' });
      action.innerHTML = window.icon('plus', { size: 14 }) + ' New session';
      action.addEventListener('click', openNewSession);
      main.appendChild(window.emptyState({
        icon: 'rocket',
        title: list.length ? 'No sessions match' : 'No sessions yet',
        body: list.length ? 'Try a different filter or search.' : 'Spawn Claude Code in a folder.',
        action,
      }));
      return;
    }

    // Group
    let groups;
    if (groupBy === 'folder') {
      groups = new Map();
      for (const s of visible) {
        const k = s.folder || '(unknown)';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      }
    } else if (groupBy === 'tag') {
      groups = new Map();
      for (const s of visible) {
        const k = s.tag || '(no tag)';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      }
    } else {
      groups = new Map([['', visible]]);
    }

    for (const [g, items] of groups) {
      if (g) main.appendChild(el('div', { class: 'section-title' }, g));
      const list = el('div', { class: 'col gap-2' });
      for (const s of items) list.appendChild(makeCard(s));
      main.appendChild(list);
    }

    // Bottom: clear-exited
    if (visible.some(s => s.status !== 'running')) {
      const c = el('button', { class: 'btn ghost sm', style: { alignSelf: 'flex-start' } });
      c.innerHTML = window.icon('trash', { size: 12 }) + ' Clear exited';
      c.addEventListener('click', async () => {
        if (!await window.confirmModal({ title: 'Clear exited sessions?', body: 'Removes finished sessions and their logs.', confirmText: 'Clear', danger: true })) return;
        try { await window.api('/api/sessions/clear-exited', { method: 'POST' }); window.toast.success('Cleared'); }
        catch (e) { window.toast.error(e.message); }
      });
      main.appendChild(c);
    }
  }

  function makeCard(s) {
    const card = el('div', { class: 'card hover', style: { padding: '12px 14px', cursor: 'pointer' } });
    const head = el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } });
    const dot = el('span', { class: 'badge dot ' + (s.status === 'running' ? 'success' : (s.status.startsWith('error') || s.status.startsWith('exited (code 1') ? 'danger' : '')) }, s.status === 'running' ? 'live' : 'done');
    head.appendChild(dot);
    const titleCol = el('div', { class: 'col', style: { flex: '1 1 auto', minWidth: '0', gap: '2px' } });
    titleCol.appendChild(el('div', { class: 'truncate', style: { fontWeight: '500' } }, s.name || window.basename(s.folder) || s.id));
    titleCol.appendChild(el('div', { class: 'muted truncate', style: { fontSize: '12px' } }, s.folder));
    head.appendChild(titleCol);
    if (s.tag) head.appendChild(el('span', { class: 'badge' }, '#' + s.tag));
    head.appendChild(el('span', { class: 'muted text-sm tabular' }, s.status === 'running' ? window.fmtDur(Date.now() - Date.parse(s.startedAt)) : (s.status || '')));
    card.appendChild(head);

    if (s.lastLog) {
      const log = el('pre', { class: 'mono', style: { fontSize: '11px', color: 'var(--text-2)', background: 'var(--surface-2)', padding: '8px 10px', borderRadius: '6px', margin: '8px 0 0', maxHeight: '64px', overflow: 'hidden', whiteSpace: 'pre-wrap' } });
      log.textContent = s.lastLog.split(/\r?\n/).slice(-3).join('\n');
      card.appendChild(log);
    }

    const ctrls = el('div', { class: 'row gap-2', style: { marginTop: '10px' } });
    const open = el('button', { class: 'btn sm ghost' });
    open.innerHTML = window.icon('log', { size: 14 }) + ' Open log';
    open.addEventListener('click', (e) => { e.stopPropagation(); openSession(s.id); });
    ctrls.appendChild(open);

    if (s.status === 'running') {
      const k = el('button', { class: 'btn sm ghost danger' });
      k.innerHTML = window.icon('stop', { size: 14 }) + ' Kill';
      k.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await window.confirmModal({ title: 'Kill session?', body: 'Terminate ' + (s.name || s.id), confirmText: 'Kill', danger: true })) return;
        try { await window.api('/api/sessions/' + s.id + '/kill', { method: 'POST' }); window.toast.success('Kill signal sent'); }
        catch (e) { window.toast.error(e.message); }
      });
      ctrls.appendChild(k);
    } else {
      const r = el('button', { class: 'btn sm ghost' });
      r.innerHTML = window.icon('rotate-ccw', { size: 14 }) + ' Restart';
      r.addEventListener('click', async (e) => { e.stopPropagation(); try { await window.api('/api/sessions/' + s.id + '/restart', { method: 'POST' }); window.toast.success('Restarted'); } catch (e) { window.toast.error(e.message); } });
      ctrls.appendChild(r);
    }

    // Delete is always available — for live sessions it force-kills first.
    const d = el('button', { class: 'btn sm ghost danger' });
    d.innerHTML = window.icon('trash', { size: 14 });
    d.title = 'Remove';
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      const live = s.status === 'running' || s.status === 'killing';
      const ok = await window.confirmModal({
        title: live ? 'Force-kill and remove?' : 'Remove?',
        body: live
          ? 'This will force-kill the process (taskkill /f /t) and delete the session record + log immediately.'
          : 'Delete this session\'s record and log?',
        confirmText: live ? 'Force-kill & remove' : 'Remove',
        danger: true,
      });
      if (!ok) return;
      try { await window.api('/api/sessions/' + s.id, { method: 'DELETE' }); window.toast.success('Removed'); }
      catch (e) { window.toast.error(e.message); }
    });
    ctrls.appendChild(d);

    const tagBtn = el('button', { class: 'btn sm ghost' });
    tagBtn.innerHTML = window.icon('tag', { size: 14 });
    tagBtn.title = 'Rename / tag';
    tagBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = await window.promptModal({ title: 'Name session', label: 'Name', initial: s.name || '' });
      if (name == null) return;
      const tag = await window.promptModal({ title: 'Tag (optional)', label: 'Tag', initial: s.tag || '' });
      try { await window.api('/api/sessions/' + s.id, { method: 'PATCH', body: { name, tag } }); }
      catch (e) { window.toast.error(e.message); }
    });
    ctrls.appendChild(tagBtn);

    card.appendChild(ctrls);
    card.addEventListener('click', () => openSession(s.id));
    return card;
  }

  // ── Detail (live log) view ──
  async function openSession(id) {
    openId = id;
    let s;
    try { s = await window.api('/api/sessions/' + id); }
    catch (e) { window.toast.error(e.message); return; }

    const body = el('div', { class: 'col gap-2', style: { minHeight: '0', flex: '1 1 auto' } });
    const head = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', alignItems: 'center' } }, [
      el('span', { class: 'badge ' + (s.status === 'running' ? 'success' : '') }, s.status),
      el('div', { class: 'muted truncate', style: { flex: '1' } }, s.folder),
      el('span', { class: 'muted text-sm' }, 'started ' + window.fmtRelative(s.startedAt)),
    ]);
    body.appendChild(head);

    const searchRow = el('div', { class: 'row gap-2' });
    const sIn = el('input', { class: 'input', placeholder: 'Search log…' });
    const findInfo = el('span', { class: 'muted text-sm tabular' }, '');
    const prevB = el('button', { class: 'btn sm ghost icon' }, [el('span', { html: window.icon('chevron-up', { size: 14 }) })]);
    const nextB = el('button', { class: 'btn sm ghost icon' }, [el('span', { html: window.icon('chevron-down', { size: 14 }) })]);
    searchRow.appendChild(sIn); searchRow.appendChild(findInfo); searchRow.appendChild(prevB); searchRow.appendChild(nextB);
    body.appendChild(searchRow);

    const logHost = el('div', {
      style: {
        background: '#000', color: '#dfe1e3', borderRadius: '6px',
        fontFamily: 'var(--mono)', fontSize: '12px',
        padding: '12px', overflow: 'auto', height: '52vh', minHeight: '240px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
    });
    body.appendChild(logHost);

    let autoScroll = true;
    let buffer = s.log || '';
    function applyContent() {
      logHost.innerHTML = '';
      const text = buffer;
      const f = sIn.value;
      if (!f) {
        logHost.appendChild(document.createTextNode(text));
      } else {
        // Highlight matches
        const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const parts = text.split(re);
        const matches = text.match(re) || [];
        parts.forEach((p, i) => {
          if (p) logHost.appendChild(document.createTextNode(p));
          if (matches[i]) {
            const span = el('span', { style: { background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: '2px' } }, matches[i]);
            logHost.appendChild(span);
          }
        });
        findInfo.textContent = matches.length + ' match';
      }
      if (autoScroll) logHost.scrollTop = logHost.scrollHeight;
    }
    sIn.addEventListener('input', applyContent);
    function findStep(dir) {
      const f = sIn.value; if (!f) return;
      const els = logHost.querySelectorAll('span');
      if (!els.length) return;
      let idx = parseInt(logHost.dataset.findIdx || '-1', 10) + dir;
      if (idx < 0) idx = els.length - 1; if (idx >= els.length) idx = 0;
      logHost.dataset.findIdx = idx;
      els[idx].scrollIntoView({ block: 'center' });
    }
    prevB.addEventListener('click', () => findStep(-1));
    nextB.addEventListener('click', () => findStep(1));

    logHost.addEventListener('scroll', () => {
      const atBottom = (logHost.scrollHeight - logHost.scrollTop - logHost.clientHeight) < 30;
      autoScroll = atBottom;
    });

    applyContent();

    // Send-input row
    const inputRow = el('div', { class: 'row gap-2', style: { display: s.status === 'running' ? 'flex' : 'none' } });
    const inp = el('input', { class: 'input mono', placeholder: 'Type and press Enter to send to stdin…' });
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const t = inp.value;
      inp.value = '';
      try { await window.api('/api/sessions/' + id + '/input', { method: 'POST', body: { text: t + '\n' } }); }
      catch (err) { window.toast.error(err.message); }
    });
    inputRow.appendChild(inp);
    body.appendChild(inputRow);

    // Action row
    const actions = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
    const copy = el('button', { class: 'btn sm ghost' });
    copy.innerHTML = window.icon('copy', { size: 14 }) + ' Copy log';
    copy.addEventListener('click', () => { window.copyToClipboard(buffer); window.toast.success('Log copied'); });
    actions.appendChild(copy);

    const sendCC = el('button', { class: 'btn sm ghost' });
    sendCC.innerHTML = window.icon('send', { size: 14 }) + ' Send to Claude';
    sendCC.addEventListener('click', async () => {
      const sel = window.getSelection().toString() || buffer.slice(-2000);
      window.modal.close();
      openNewSession({ prePrompt: sel, folder: s.folder });
    });
    actions.appendChild(sendCC);

    body.appendChild(actions);

    // Subscribe to live updates
    if (logSubscribed) app.unsubscribe('session:' + logSubscribed);
    logSubscribed = id;
    app.subscribe('session:' + id);

    if (unsubMsg) unsubMsg();
    unsubMsg = app.onMessage((msg) => {
      if (!msg) return;
      if (msg.topic === 'session:' + id) {
        if (msg.payload.event === 'log') {
          buffer += msg.payload.chunk;
          if (buffer.length > 10 * 1024 * 1024) buffer = buffer.slice(-10 * 1024 * 1024);
          applyContent();
        } else if (msg.payload.event === 'status') {
          head.children[0].textContent = msg.payload.status;
          head.children[0].className = 'badge ' + (msg.payload.status === 'running' ? 'success' : 'danger');
          inputRow.style.display = msg.payload.status === 'running' ? 'flex' : 'none';
        }
      }
      if (msg.topic === 'sessions') reload();
    });

    window.modal.open({
      title: s.name || s.folder,
      content: body,
      size: 'xl',
      onClose: () => {
        if (logSubscribed) { app.unsubscribe('session:' + logSubscribed); logSubscribed = null; }
        openId = null;
      },
      actions: [
        { label: s.status === 'running' ? 'Kill' : 'Restart', kind: s.status === 'running' ? 'ghost danger' : 'primary', onClick: async () => {
            if (s.status === 'running') {
              if (!await window.confirmModal({ title: 'Kill?', danger: true, confirmText: 'Kill' })) return;
              try { await window.api('/api/sessions/' + id + '/kill', { method: 'POST' }); }
              catch (e) { window.toast.error(e.message); }
            } else {
              try { await window.api('/api/sessions/' + id + '/restart', { method: 'POST' }); window.modal.close(); window.toast.success('Restarted'); }
              catch (e) { window.toast.error(e.message); }
            }
          } },
        { label: 'Close', kind: 'ghost', onClick: () => window.modal.close() },
      ],
    });
  }

  // ── New session flow ──
  async function openNewSession(initial = {}) {
    let folder = initial.folder || '';
    let prePrompt = initial.prePrompt || '';
    let mode = 'rc'; // 'rc' | 'plain' | 'custom'
    let custom = 'claude';
    let envText = '';
    let name = initial.name || '';
    let tag = '';

    const body = el('div', { class: 'col gap-3' });
    const folderRow = el('div', { class: 'field' }, [
      el('label', null, 'Folder'),
      el('div', { class: 'row gap-2' }),
    ]);
    const folderInp = el('input', { class: 'input mono', value: folder, placeholder: 'Absolute path to the project' });
    folderInp.addEventListener('input', () => { folder = folderInp.value; });
    const browse = el('button', { class: 'btn ghost' });
    browse.innerHTML = window.icon('folder', { size: 14 }) + ' Browse';
    browse.addEventListener('click', async () => {
      const picked = await pickFolder(folder);
      if (picked) { folder = picked; folderInp.value = picked; }
    });
    folderRow.children[1].appendChild(folderInp);
    folderRow.children[1].appendChild(browse);
    body.appendChild(folderRow);

    // Mode chooser
    const modeRow = el('div', { class: 'field' }, [
      el('label', null, 'Command'),
      el('div', { class: 'row gap-2' }),
    ]);
    const modes = [
      ['rc', 'claude rc'],
      ['plain', 'claude (then /rc)'],
      ['custom', 'Custom args…'],
    ];
    for (const [k, l] of modes) {
      const b = el('button', { class: 'btn sm ' + (mode === k ? 'primary' : 'ghost') }, l);
      b.addEventListener('click', () => { mode = k; modeRow.children[1].querySelectorAll('button').forEach((bb, i) => { bb.className = 'btn sm ' + (modes[i][0] === mode ? 'primary' : 'ghost'); }); customInp.style.display = mode === 'custom' ? '' : 'none'; });
      modeRow.children[1].appendChild(b);
    }
    body.appendChild(modeRow);
    const customInp = el('input', { class: 'input mono', placeholder: 'extra args, space separated' });
    customInp.style.display = 'none';
    customInp.addEventListener('input', () => { custom = customInp.value; });
    body.appendChild(customInp);

    const ppField = el('div', { class: 'field' }, [
      el('label', null, 'Pre-prompt (optional)'),
      el('div', { class: 'help' }, 'Sent as the first message after Claude starts.'),
    ]);
    const pp = el('textarea', { class: 'textarea', placeholder: 'e.g. "Read README.md, then propose three improvements."' });
    pp.value = prePrompt;
    pp.addEventListener('input', () => { prePrompt = pp.value; });
    ppField.appendChild(pp);
    body.appendChild(ppField);

    // env vars
    const envField = el('div', { class: 'field' }, [
      el('label', null, 'Env vars (optional)'),
      el('div', { class: 'help' }, 'KEY=value per line. e.g. ANTHROPIC_MODEL=claude-opus-4-7'),
    ]);
    const env = el('textarea', { class: 'textarea', placeholder: 'ANTHROPIC_MODEL=claude-opus-4-7' });
    env.addEventListener('input', () => { envText = env.value; });
    envField.appendChild(env);
    body.appendChild(envField);

    // Save preset
    const saveRow = el('div', { class: 'field' }, [
      el('label', null, 'Save as preset (optional)'),
    ]);
    const presetName = el('input', { class: 'input', placeholder: 'preset name' });
    saveRow.appendChild(presetName);
    body.appendChild(saveRow);

    function parseEnv(text) {
      const out = {};
      for (const line of (text || '').split(/\r?\n/)) {
        const t = line.trim(); if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('='); if (i < 0) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
      return out;
    }
    function buildArgs() {
      if (mode === 'rc') return ['rc'];
      if (mode === 'plain') return [];
      return (custom || '').split(/\s+/).filter(Boolean);
    }

    window.modal.open({
      title: 'New session',
      content: body,
      size: 'lg',
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => window.modal.close() },
        { label: 'Launch', kind: 'primary', onClick: async () => {
            if (!folder) return window.toast.error('Folder is required');
            const cfg = { folder, args: buildArgs(), env: parseEnv(envText), prePrompt, name };
            try {
              const s = await window.api('/api/sessions', { method: 'POST', body: cfg });
              if (presetName.value.trim()) {
                await window.api('/api/sessions/presets', { method: 'POST', body: { name: presetName.value.trim(), folder, args: cfg.args, env: cfg.env, prePrompt } });
                presets = (await window.api('/api/sessions/presets')).presets;
              }
              window.modal.close();
              window.toast.success('Session started');
              openSession(s.id);
            } catch (e) { window.toast.error(e.message); }
          } },
      ],
    });
  }

  // ── Folder picker ──
  // Layered modal: opens on top of any existing modal (e.g. New-Session form),
  // returning to it when dismissed. Resolution is idempotent.
  async function pickFolder(initial) {
    let locs = null;
    try { locs = await window.api('/api/files/locations'); } catch (e) {}

    // If no initial path given, default to home so the picker has something
    // to load on first render (avoids /api/files/list with empty path).
    let cwd = initial && initial.trim() ? initial.trim() : (locs && locs.home) || '';

    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };

      const body = el('div', { class: 'col gap-2', style: { minHeight: '0' } });
      const head = el('div', { class: 'row gap-2' });
      const path = el('input', { class: 'input mono', value: cwd, placeholder: 'Path' });
      const goB = el('button', { class: 'btn ghost' }, 'Go');
      goB.addEventListener('click', () => { cwd = path.value.trim(); load(); });
      path.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cwd = path.value.trim(); load(); } });
      head.appendChild(path); head.appendChild(goB);
      body.appendChild(head);

      if (locs && locs.quick && locs.quick.length) {
        const quickRow = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
        for (const l of locs.quick.slice(0, 8)) {
          const b = el('button', { class: 'btn sm ghost' }, l.name);
          b.addEventListener('click', () => { cwd = l.path; path.value = cwd; load(); });
          quickRow.appendChild(b);
        }
        body.appendChild(quickRow);
      }

      const list = el('div', { class: 'list', style: { overflow: 'auto', maxHeight: '50vh', border: '1px solid var(--border)', borderRadius: '6px' } });
      body.appendChild(list);

      async function load() {
        list.innerHTML = ''; list.appendChild(window.skeleton(5));
        if (!cwd) {
          list.innerHTML = '';
          list.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, 'Pick a quick location above, or type a path.'));
          return;
        }
        try {
          const r = await window.api('/api/files/list?path=' + encodeURIComponent(cwd));
          list.innerHTML = '';
          if (r.parent) {
            const up = el('div', { class: 'list-item' }, [
              el('span', { html: window.icon('arrow-up', { size: 14 }) }),
              el('span', null, '..'),
            ]);
            up.addEventListener('click', () => { cwd = r.parent; path.value = cwd; load(); });
            list.appendChild(up);
          }
          const folders = r.items.filter(i => i.dir);
          if (!folders.length) {
            list.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, 'No subfolders here. Tap "Choose this folder" to use this path.'));
          }
          for (const it of folders) {
            const row = el('div', { class: 'list-item' }, [
              el('span', { html: window.icon('folder', { size: 14 }), style: { color: 'var(--accent)' } }),
              el('span', { class: 'truncate' }, it.name),
            ]);
            row.addEventListener('click', () => { cwd = it.path; path.value = cwd; load(); });
            list.appendChild(row);
          }
        } catch (e) {
          list.innerHTML = '';
          list.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, e.message));
        }
      }

      load();

      const handle = window.modal.open({
        title: 'Choose folder',
        content: body, size: 'lg',
        onClose: () => settle(null),
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: () => { settle(null); handle.close(); } },
          { label: 'Choose this folder', kind: 'primary', onClick: () => { settle((path.value || cwd || '').trim() || null); handle.close(); } },
        ],
      });
    });
  }

  // ── Presets ──
  async function launchPreset(p) {
    try {
      const s = await window.api('/api/sessions', { method: 'POST', body: { folder: p.folder, args: p.args, env: p.env, prePrompt: p.prePrompt, name: p.name } });
      window.toast.success('Session started');
      openSession(s.id);
    } catch (e) { window.toast.error(e.message); }
  }

  async function editPreset(p) {
    let name = p.name || '';
    let folder = p.folder || '';
    let argsTxt = (p.args || []).join(' ');
    let prePrompt = p.prePrompt || '';
    const body = el('div', { class: 'col gap-3' });
    function addField(label, value, type = 'text') {
      const f = el('div', { class: 'field' }, [el('label', null, label)]);
      const inp = type === 'textarea' ? el('textarea', { class: 'textarea' }) : el('input', { class: 'input' + (type === 'mono' ? ' mono' : '') });
      inp.value = value;
      f.appendChild(inp);
      body.appendChild(f);
      return inp;
    }
    const nameI = addField('Name', name);
    const folderI = addField('Folder', folder, 'mono');
    const argsI = addField('Args (space separated)', argsTxt, 'mono');
    const ppI = addField('Pre-prompt', prePrompt, 'textarea');

    window.modal.open({
      title: p.id ? 'Edit preset' : 'New preset',
      content: body,
      actions: [
        p.id ? { label: 'Delete', kind: 'ghost danger', onClick: async () => {
          await window.api('/api/sessions/presets/' + p.id, { method: 'DELETE' });
          presets = (await window.api('/api/sessions/presets')).presets;
          window.modal.close(); render();
        } } : null,
        { label: 'Cancel', kind: 'ghost', onClick: () => window.modal.close() },
        { label: 'Save', kind: 'primary', onClick: async () => {
          const args = argsI.value.split(/\s+/).filter(Boolean);
          const next = { id: p.id, name: nameI.value, folder: folderI.value, args, prePrompt: ppI.value };
          await window.api('/api/sessions/presets', { method: 'POST', body: next });
          presets = (await window.api('/api/sessions/presets')).presets;
          window.modal.close(); render();
        } },
      ].filter(Boolean),
    });
  }

  // ── Data ──
  async function reload() {
    try {
      [list, { presets: presets }] = await Promise.all([
        window.api('/api/sessions'),
        window.api('/api/sessions/presets'),
      ]);
      render();
    } catch (e) { window.toast.error(e.message); }
  }

  // Subscribe to high-level session change events
  app.subscribe('sessions');
  const offMsg = app.onMessage((msg) => {
    if (msg.topic === 'sessions') reload();
  });

  // Tick once a second to refresh "uptime" labels for running sessions
  const tick = setInterval(() => {
    if (groupBy !== 'none' || filter !== 'all') return; // simple optimisation
    const cards = main.querySelectorAll('.card .tabular');
    let i = 0;
    for (const s of list.filter(s => s.status === 'running')) {
      if (cards[i]) cards[i].textContent = window.fmtDur(Date.now() - Date.parse(s.startedAt));
      i++;
    }
  }, 1000);

  // Honour deep-link: #sessions/new/<folder>
  if (rest && rest[0] === 'new') {
    const folder = decodeURIComponent(rest.slice(1).join('/'));
    setTimeout(() => openNewSession({ folder }), 50);
  }

  await reload();

  return {
    destroy() {
      clearInterval(tick);
      app.unsubscribe('sessions');
      if (logSubscribed) app.unsubscribe('session:' + logSubscribed);
      if (offMsg) offMsg();
      a1.hidden = true; a1.onclick = null;
    },
  };
};
