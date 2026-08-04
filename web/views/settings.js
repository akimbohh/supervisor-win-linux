// Settings view — all configuration in one place.
window.SettingsView = async function (root, { app }) {
  let s = await window.api('/api/settings');
  let pushSubs = [];
  let pushKey = null;
  let presets = [];

  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-4', style: { maxWidth: '720px' } });
  root.appendChild(wrap);

  // Helpers
  const sec = (title) => { const e = el('div', { class: 'section-title' }, title); return e; };
  const card = (...children) => el('div', { class: 'card padded col gap-3' }, children);

  function patch(p) {
    return window.api('/api/settings', { method: 'PATCH', body: p }).then(next => { s = next; app.applySettings(next); });
  }

  // ── Appearance ──
  wrap.appendChild(sec('Appearance'));
  const appearance = card();
  // Theme
  const themeRow = el('div', { class: 'row gap-2' });
  for (const [k, label, ic] of [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['auto', 'Auto', 'monitor']]) {
    const b = el('button', { class: 'btn ' + (s.theme === k ? 'primary' : 'ghost') });
    b.innerHTML = window.icon(ic, { size: 14 }) + ' ' + label;
    b.addEventListener('click', async () => { await patch({ theme: k }); reload(); });
    themeRow.appendChild(b);
  }
  appearance.appendChild(el('div', { class: 'field' }, [el('label', null, 'Theme'), themeRow]));

  // Accent
  const accentRow = el('div', { class: 'row gap-2' });
  for (const [k, color] of [['amber','#f5a623'],['teal','#2dd4bf'],['purple','#a78bfa'],['blue','#5ea8ff'],['rose','#fb7185']]) {
    const b = el('button', {
      class: 'btn icon',
      style: { background: color, borderColor: color, width: '36px', height: '36px', boxShadow: s.accent === k ? '0 0 0 2px var(--bg), 0 0 0 4px ' + color : 'none' },
      title: k,
    });
    b.addEventListener('click', async () => { await patch({ accent: k }); reload(); });
    accentRow.appendChild(b);
  }
  appearance.appendChild(el('div', { class: 'field' }, [el('label', null, 'Accent'), accentRow]));
  wrap.appendChild(appearance);

  // ── Notifications ──
  wrap.appendChild(sec('Notifications'));
  const notif = card();
  const notifFields = [
    ['sessionFinished', 'Session finished', 'When a Claude Code session exits.'],
    ['sessionAskedForInput', 'Session asks for input', 'When Claude appears to wait on a prompt.'],
    ['consoleCommandFinished', 'Long-running console command finished', '(coming soon)'],
    ['diskLow', 'Disk space low', 'Threshold below.'],
  ];
  function makeToggle(key, label, help) {
    const row = el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } });
    const left = el('div', { class: 'col', style: { flex: '1', minWidth: '0' } }, [
      el('div', null, label),
      el('div', { class: 'muted text-sm' }, help),
    ]);
    const lbl = el('label', { class: 'toggle' });
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!(s.notifications && s.notifications[key]);
    inp.addEventListener('change', () => patch({ notifications: { [key]: inp.checked } }));
    const knob = el('span', { class: 'knob' });
    lbl.appendChild(inp); lbl.appendChild(knob);
    row.appendChild(left); row.appendChild(lbl);
    return row;
  }
  for (const [k, l, h] of notifFields) notif.appendChild(makeToggle(k, l, h));
  // Disk threshold input
  const thr = el('div', { class: 'field row gap-2' }, [
    el('label', { style: { flex: '1' } }, 'Disk-low threshold (% free remaining)'),
    el('input', { type: 'number', class: 'input', style: { width: '80px' }, min: '1', max: '50' }),
  ]);
  thr.querySelector('input').value = s.notifications.diskLowThresholdPct || 10;
  thr.querySelector('input').addEventListener('change', (e) => patch({ notifications: { diskLowThresholdPct: parseInt(e.target.value, 10) } }));
  notif.appendChild(thr);

  // Push enrolment
  const pushBox = el('div', { class: 'col gap-2' });
  pushBox.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'Push notifications'));
  const pushStatus = el('div', { class: 'muted text-sm' });
  pushBox.appendChild(pushStatus);
  const pushBtns = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
  const enableBtn = el('button', { class: 'btn primary' }); enableBtn.innerHTML = window.icon('bell', { size: 14 }) + ' Enable on this device';
  const testBtn = el('button', { class: 'btn ghost' }); testBtn.innerHTML = window.icon('send', { size: 14 }) + ' Test';
  pushBtns.appendChild(enableBtn); pushBtns.appendChild(testBtn);
  pushBox.appendChild(pushBtns);
  const subList = el('div', { class: 'col gap-2' });
  pushBox.appendChild(subList);
  notif.appendChild(pushBox);
  wrap.appendChild(notif);

  enableBtn.addEventListener('click', enablePush);
  testBtn.addEventListener('click', async () => {
    try { const r = await window.api('/api/push/test', { method: 'POST' }); window.toast.success('Sent to ' + r.sent + ' device(s)'); }
    catch (e) { window.toast.error(e.message); }
  });

  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { window.toast.error('Push not supported in this browser'); return; }
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { window.toast.error('Permission denied'); return; }
      if (!pushKey) pushKey = (await window.api('/api/push/vapid-key')).publicKey;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushKey),
      });
      const label = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'Device';
      await window.api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label } });
      window.toast.success('Push enabled');
      loadSubs();
    } catch (e) { window.toast.error(e.message); }
  }
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function loadSubs() {
    try {
      const r = await window.api('/api/push/subscriptions');
      pushSubs = r.subscriptions || [];
      subList.innerHTML = '';
      if (!pushSubs.length) { pushStatus.textContent = 'No devices subscribed yet.'; return; }
      pushStatus.textContent = pushSubs.length + ' device(s) subscribed.';
      for (const sub of pushSubs) {
        const r = el('div', { class: 'list-item', style: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' } });
        r.appendChild(el('div', { class: 'col', style: { flex: '1', minWidth: '0' } }, [
          el('div', null, sub.label || 'Device'),
          el('div', { class: 'muted text-sm truncate' }, new URL(sub.endpoint).hostname),
        ]));
        const del = el('button', { class: 'btn sm ghost danger' }); del.innerHTML = window.icon('x', { size: 12 });
        del.addEventListener('click', async () => { await window.api('/api/push/unsubscribe', { method: 'POST', body: { id: sub.id } }); loadSubs(); });
        r.appendChild(del);
        subList.appendChild(r);
      }
    } catch (e) { /* silent */ }
  }

  // ── Pinned folders ──
  wrap.appendChild(sec('Pinned folders'));
  const pinCard = card();
  const pinList = el('div', { class: 'col gap-2' });
  function renderPins() {
    pinList.innerHTML = '';
    // Drop empty/invalid pins (legacy data: { name: '', path: '' } accidents).
    const raw = (s.pinnedFolders || []);
    const list = raw.filter(p => p && (typeof p === 'string' ? p : (p.path && String(p.path).trim())));
    if (list.length !== raw.length) {
      // Clean up persisted state.
      patch({ pinnedFolders: list }).catch(() => {});
    }
    if (!list.length) pinList.appendChild(el('div', { class: 'muted text-sm' }, 'No pins yet — add folders here for quick access.'));
    list.forEach((p, idx) => {
      const pathStr = typeof p === 'string' ? p : String(p.path || '');
      const nameStr = (typeof p === 'object' && p && p.name) ? p.name : window.basename(pathStr) || pathStr;
      const r = el('div', { class: 'row gap-2', style: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' } });
      r.appendChild(el('span', { html: window.icon('pin', { size: 14 }) }));
      r.appendChild(el('span', { class: 'truncate', style: { flex: '1' } }, nameStr));
      r.appendChild(el('span', { class: 'muted text-sm truncate', style: { flex: '2', minWidth: 0 } }, pathStr));
      const up = el('button', { class: 'btn sm ghost icon' }); up.innerHTML = window.icon('chevron-up', { size: 12 });
      up.disabled = idx === 0;
      up.addEventListener('click', async () => { const next = (s.pinnedFolders || []).slice(); [next[idx-1], next[idx]] = [next[idx], next[idx-1]]; await patch({ pinnedFolders: next }); renderPins(); });
      const dn = el('button', { class: 'btn sm ghost icon' }); dn.innerHTML = window.icon('chevron-down', { size: 12 });
      dn.disabled = idx === list.length - 1;
      dn.addEventListener('click', async () => { const next = (s.pinnedFolders || []).slice(); [next[idx+1], next[idx]] = [next[idx], next[idx+1]]; await patch({ pinnedFolders: next }); renderPins(); });
      const x = el('button', { class: 'btn sm ghost danger icon' }); x.innerHTML = window.icon('x', { size: 12 });
      x.addEventListener('click', async () => { const next = (s.pinnedFolders || []).filter((_, i) => i !== idx); await patch({ pinnedFolders: next }); renderPins(); });
      r.appendChild(up); r.appendChild(dn); r.appendChild(x);
      pinList.appendChild(r);
    });
  }
  renderPins();
  pinCard.appendChild(pinList);
  const addPinRow = el('div', { class: 'row gap-2' });
  const pinPath = el('input', { class: 'input mono', placeholder: 'Absolute path to the folder' });
  const pinName = el('input', { class: 'input', placeholder: 'Display name (optional)' });
  const addPin = el('button', { class: 'btn primary' }); addPin.innerHTML = window.icon('plus', { size: 14 }) + ' Add';
  addPin.addEventListener('click', async () => {
    if (!pinPath.value) return;
    const next = ((s.pinnedFolders || []).slice());
    next.push({ name: pinName.value || window.basename(pinPath.value), path: pinPath.value });
    await patch({ pinnedFolders: next });
    pinPath.value = ''; pinName.value = '';
    renderPins();
  });
  addPinRow.appendChild(pinPath); addPinRow.appendChild(pinName); addPinRow.appendChild(addPin);
  pinCard.appendChild(addPinRow);
  wrap.appendChild(pinCard);

  // ── Sessions ──
  wrap.appendChild(sec('Sessions'));
  const sessionsCard = card();
  sessionsCard.appendChild(makeToggle('autoTrustClaudeFolders',
    'Auto-trust folders for Claude Code',
    'Pre-accept the workspace-trust dialog by writing ~/.claude.json before launch. Required because the prompt needs PTY input we don\'t pipe through.'));
  wrap.appendChild(sessionsCard);

  // ── Session presets ──
  wrap.appendChild(sec('Session presets'));
  const presetCard = card();
  const presetList = el('div', { class: 'col gap-2' });
  presetCard.appendChild(presetList);
  wrap.appendChild(presetCard);
  async function renderPresets() {
    presetList.innerHTML = '';
    presets = (await window.api('/api/sessions/presets')).presets;
    if (!presets.length) presetList.appendChild(el('div', { class: 'muted text-sm' }, 'No presets — save one from the Sessions tab when you launch.'));
    for (const p of presets) {
      const r = el('div', { class: 'row gap-2', style: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' } }, [
        el('span', { html: window.icon('zap', { size: 14 }), style: { color: 'var(--accent)' } }),
        el('div', { class: 'col', style: { flex: '1', minWidth: '0' } }, [
          el('div', null, p.name || '(unnamed)'),
          el('div', { class: 'muted text-sm truncate' }, p.folder + (p.args && p.args.length ? ' • ' + p.args.join(' ') : '')),
        ]),
      ]);
      const del = el('button', { class: 'btn sm ghost danger' }); del.innerHTML = window.icon('trash', { size: 12 });
      del.addEventListener('click', async () => { await window.api('/api/sessions/presets/' + p.id, { method: 'DELETE' }); renderPresets(); });
      r.appendChild(del);
      presetList.appendChild(r);
    }
  }

  // ── Files / blocklist ──
  wrap.appendChild(sec('Files'));
  const filesCard = card();
  filesCard.appendChild(makeToggle('hiddenFiles', 'Show hidden files', 'Files starting with "."'));
  filesCard.appendChild(el('div', { class: 'field' }, [
    el('label', null, 'Path blocklist'),
    el('div', { class: 'help' }, 'One path per line. Files inside these will be unreachable. Default Windows: system folders.'),
  ]));
  const blockArea = el('textarea', { class: 'textarea mono', style: { minHeight: '120px' } });
  blockArea.value = (s.blocklist || []).join('\n');
  const saveBlock = el('button', { class: 'btn primary' }); saveBlock.innerHTML = window.icon('save', { size: 14 }) + ' Save blocklist';
  saveBlock.addEventListener('click', async () => {
    const lines = blockArea.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    await patch({ blocklist: lines });
    window.toast.success('Blocklist saved');
  });
  filesCard.appendChild(blockArea); filesCard.appendChild(saveBlock);
  wrap.appendChild(filesCard);

  // ── Account ──
  wrap.appendChild(sec('Account'));
  const accCard = card();
  const cur = el('input', { class: 'input', type: 'password', placeholder: 'Current password' });
  const next1 = el('input', { class: 'input', type: 'password', placeholder: 'New password' });
  const next2 = el('input', { class: 'input', type: 'password', placeholder: 'Repeat' });
  const cpw = el('button', { class: 'btn primary', style: { alignSelf: 'flex-start' } }); cpw.innerHTML = window.icon('lock', { size: 14 }) + ' Change password';
  cpw.addEventListener('click', async () => {
    if (next1.value !== next2.value) return window.toast.error('New passwords do not match');
    if (next1.value.length < 4) return window.toast.error('Password too short');
    try {
      await window.api('/api/auth/change-password', { method: 'POST', body: { current: cur.value, next: next1.value } });
      cur.value = next1.value = next2.value = '';
      window.toast.success('Password changed');
    } catch (e) { window.toast.error(e.message); }
  });
  accCard.appendChild(el('div', { class: 'field' }, [el('label', null, 'Change password'), cur, next1, next2, cpw]));
  const logoutBtn = el('button', { class: 'btn ghost danger', style: { alignSelf: 'flex-start' } });
  logoutBtn.innerHTML = window.icon('power', { size: 14 }) + ' Logout';
  logoutBtn.addEventListener('click', async () => {
    if (!await window.confirmModal({ title: 'Sign out?', confirmText: 'Sign out', danger: true })) return;
    await window.api('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });
  accCard.appendChild(logoutBtn);
  wrap.appendChild(accCard);

  // ── Maintenance ──
  wrap.appendChild(sec('Maintenance'));
  const mtCard = card();
  mtCard.appendChild(el('div', { class: 'muted text-sm' },
    'The "?" button in the header opens a "Request a change" modal. Submitting starts a Claude session in the repo below; click "Apply & restart" on that session when ready.'
  ));
  const mtRepo = el('input', { class: 'input mono', value: s.selfRepoPath || '', placeholder: 'Absolute path to the supervisor repo' });
  const mtSave = el('button', { class: 'btn primary' }, 'Save');
  mtSave.addEventListener('click', async () => {
    const v = mtRepo.value.trim();
    if (!v) { window.toast.error('Path required'); return; }
    try { await patch({ selfRepoPath: v }); window.toast.success('Saved'); }
    catch (e) { window.toast.error(e.message); }
  });
  mtCard.appendChild(el('div', { class: 'field' }, [
    el('label', null, 'Supervisor repo path'),
    el('div', { class: 'row gap-2' }, [mtRepo, mtSave]),
  ]));

  // Restart supervisor — wires App.markRestarting() (previously dead, §6) to the
  // restart flow so the pending→ready banner sequence actually triggers.
  const restartBtn = el('button', { class: 'btn ghost danger', style: { alignSelf: 'flex-start', marginTop: '8px' } });
  restartBtn.innerHTML = window.icon('rotate-ccw', { size: 14 }) + ' Restart supervisor';
  restartBtn.addEventListener('click', async () => {
    const ok = await window.confirmModal({ title: 'Restart supervisor?', body: 'The server process restarts. The page reconnects automatically.' });
    if (!ok) return;
    try {
      if (window.App && window.App.markRestarting) window.App.markRestarting();
      await window.api('/api/maintenance/restart', { method: 'POST' });
    } catch (e) { /* the connection drops as the server exits — expected */ }
  });
  mtCard.appendChild(restartBtn);
  wrap.appendChild(mtCard);

  // ── Sync (GitHub) ──
  // Commit + push the supervisor repo so Claude's self-edits never sit
  // uncommitted (which is what blocks a later pull), and pull updates back.
  wrap.appendChild(sec('Sync (GitHub)'));
  const syncCard = card();
  const syncStatus = el('div', { class: 'muted text-sm mono' }, 'Checking…');
  syncCard.appendChild(syncStatus);

  const commitMsg = el('input', { class: 'input', placeholder: 'Commit message (optional)' });
  const pushBtn = el('button', { class: 'btn primary' });
  pushBtn.innerHTML = window.icon('upload', { size: 14 }) + ' Commit & Push';
  const pullBtn = el('button', { class: 'btn ghost' });
  pullBtn.innerHTML = window.icon('download', { size: 14 }) + ' Update from GitHub';
  syncCard.appendChild(el('div', { class: 'field' }, [el('label', null, 'Push Claude’s changes to GitHub'), commitMsg]));
  syncCard.appendChild(el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } }, [pushBtn, pullBtn]));

  // Write-only token entry.
  const tokTitle = el('div', { class: 'section-title', style: { margin: '4px 0 0' } }, 'GitHub token');
  const tokInp = el('input', { class: 'input mono', type: 'password', placeholder: 'ghp_… (Contents: read/write)' });
  const tokBtn = el('button', { class: 'btn ghost' }, 'Save token');
  const tokHelp = el('div', { class: 'muted text-sm' }, 'Stored server-side only, never shown again. Needed to push.');
  syncCard.appendChild(tokTitle);
  syncCard.appendChild(el('div', { class: 'row gap-2' }, [tokInp, tokBtn]));
  syncCard.appendChild(tokHelp);
  wrap.appendChild(syncCard);

  async function refreshGit() {
    try {
      const g = await window.api('/api/git/status');
      if (!g.isRepo) { syncStatus.textContent = 'Not a git repo (' + g.repo + ')'; return; }
      const bits = [
        'branch ' + g.branch,
        g.dirty ? (g.changeCount + ' uncommitted') : 'clean',
        g.ahead ? ('↑' + g.ahead) : '',
        g.behind ? ('↓' + g.behind) : '',
        g.hasToken ? '' : 'no token',
      ].filter(Boolean);
      syncStatus.textContent = bits.join(' · ');
      pushBtn.disabled = !g.hasToken;
      tokBtn.textContent = g.hasToken ? 'Replace token' : 'Save token';
    } catch (e) { syncStatus.textContent = 'Git status unavailable'; }
  }
  refreshGit();

  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    try {
      const r = await window.api('/api/git/push', { method: 'POST', body: { message: commitMsg.value } });
      if (r.push && r.push.ok) window.toast.success('Pushed to ' + r.push.branch);
      else window.toast.error((r.push && r.push.error) || (r.commit && r.commit.error) || 'Push failed');
      commitMsg.value = '';
    } catch (e) { window.toast.error(e.message); }
    finally { pushBtn.disabled = false; refreshGit(); }
  });

  pullBtn.addEventListener('click', async () => {
    const ok = await window.confirmModal({
      title: 'Update from GitHub?',
      body: 'Fetches the latest and hard-resets this server to match GitHub. Any un-pushed local change is discarded — push first if you want to keep it.',
      confirmText: 'Update', danger: true,
    });
    if (!ok) return;
    try {
      const r = await window.api('/api/git/pull', { method: 'POST', body: { hard: true } });
      if (r.ok) { window.toast.success('Updated — restart to apply'); } else window.toast.error(r.error || r.out || 'Update failed');
    } catch (e) { window.toast.error(e.message); }
    finally { refreshGit(); }
  });

  tokBtn.addEventListener('click', async () => {
    if (!tokInp.value.trim()) { window.toast.error('Paste a token first'); return; }
    try { await window.api('/api/git/token', { method: 'POST', body: { token: tokInp.value.trim() } }); tokInp.value = ''; window.toast.success('Token saved'); refreshGit(); }
    catch (e) { window.toast.error(e.message); }
  });

  // ── Keyboard shortcuts ──
  wrap.appendChild(sec('Keyboard shortcuts'));
  const ksCard = card();
  const ksItems = [
    ['?',       'Open "Request a change"'],
    ['g s',     'Sessions'],
    ['g f',     'Files'],
    ['g c',     'Console'],
    ['g p',     'Processes'],
    ['g y',     'System'],
    ['g t',     'Settings'],
    ['Esc',     'Close modal/sheet'],
    ['Ctrl+S',  'Save (in file editor)'],
  ];
  for (const [k, d] of ksItems) {
    ksCard.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('span', { class: 'muted text-sm' }, d),
      el('span', null, k.split(' ').map(p => el('span', { class: 'kbd' }, p))),
    ]));
  }
  wrap.appendChild(ksCard);

  // ── Backup ──
  wrap.appendChild(sec('Backup'));
  const backCard = card();
  const dl = el('button', { class: 'btn ghost' }); dl.innerHTML = window.icon('download', { size: 14 }) + ' Export settings';
  dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = '/api/settings/export'; a.download = 'supervisor-settings.json'; a.click(); });
  const up = el('button', { class: 'btn ghost' }); up.innerHTML = window.icon('upload', { size: 14 }) + ' Import settings';
  up.addEventListener('click', () => {
    const inp = el('input', { type: 'file', accept: '.json' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      try { const json = JSON.parse(text); await window.api('/api/settings/import', { method: 'POST', body: json }); window.toast.success('Imported'); reload(); }
      catch (e) { window.toast.error(e.message); }
    });
    inp.click();
  });
  const reset = el('button', { class: 'btn ghost danger' }); reset.innerHTML = window.icon('rotate-ccw', { size: 14 }) + ' Reset to defaults';
  reset.addEventListener('click', async () => {
    if (!await window.confirmModal({ title: 'Reset settings?', body: 'Theme, accent, pins, presets, notifications — all back to defaults.', danger: true, confirmText: 'Reset' })) return;
    await window.api('/api/settings/reset', { method: 'POST' });
    window.toast.success('Reset'); reload();
  });
  backCard.appendChild(el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } }, [dl, up, reset]));
  wrap.appendChild(backCard);

  // ── About ──
  wrap.appendChild(sec('About'));
  const about = card();
  const sysSnap = await window.api('/api/system').catch(() => null);
  about.appendChild(el('div', { class: 'col gap-2' }, [
    row('Server uptime', window.fmtDur((sysSnap && sysSnap.snap.uptime || 0) * 1000)),
    row('Hostname', sysSnap && sysSnap.snap.host.hostname || ''),
    row('Platform', sysSnap && (sysSnap.snap.host.platform + ' ' + sysSnap.snap.host.release) || navigator.platform),
    row('App version', '1.0.0'),
  ]));

  const forceRefresh = el('button', { class: 'btn ghost', style: { alignSelf: 'flex-start' } });
  forceRefresh.innerHTML = window.icon('refresh', { size: 14 }) + ' Force refresh (clear cache)';
  forceRefresh.title = 'Wipes the service-worker cache and reloads — use if the UI seems stuck on old behaviour after an update.';
  forceRefresh.addEventListener('click', async () => {
    if (!await window.confirmModal({
      title: 'Force refresh?',
      body: 'Clears all cached app assets and reloads. Useful when an update seems stuck.',
      confirmText: 'Refresh',
    })) return;
    try {
      // Ask SW to purge, then unregister, then hard-reload.
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        if (reg && reg.active) {
          await new Promise((r) => {
            const ch = new MessageChannel();
            ch.port1.onmessage = r;
            reg.active.postMessage('purgeCache');
            setTimeout(r, 1500);
          });
        }
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(regs.map(r => r.unregister().catch(() => {})));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) {}
    location.reload();
  });
  about.appendChild(forceRefresh);
  wrap.appendChild(about);

  function row(k, v) {
    return el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('span', { class: 'muted' }, k),
      el('span', { class: 'tabular' }, v),
    ]);
  }

  function reload() {
    location.reload();
  }

  loadSubs();
  renderPresets();
};
