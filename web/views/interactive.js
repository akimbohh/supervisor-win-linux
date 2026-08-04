// Interactive Claude — a streaming chat UI over /api/claude, rendered in the
// vanilla-JS view pattern. Streams SDKMessages over the WS topic claude:<reqId>.
// Interchangeable with Console: "Open in terminal" resumes the same session_id
// in a shell (claude --resume <id>).
window.InteractiveView = async function (root, { rest, app }) {
  const el = window.el;
  root.innerHTML = '';

  let status = { available: false };
  try { status = await window.api('/api/claude/status'); } catch (e) {}

  if (!status.available) {
    root.appendChild(window.emptyState({
      icon: 'sparkles',
      title: 'Claude Code isn’t installed here',
      body: 'Interactive Claude needs the `claude` CLI on this host’s PATH (and a logged-in Claude). Install it, then reload. Console and Sessions still work.',
    }));
    return { destroy() {} };
  }

  // ── State ──
  let cwd = localStorage.getItem('claude.cwd') || (app.settings && app.settings.selfRepoPath) || '';
  let sessionId = null;
  let requestId = null;
  let permissionMode = localStorage.getItem('claude.permMode') || 'default';
  let unsub = null;
  let streaming = false;

  // Deep link #claude/<encoded-cwd> or #claude/resume/<sessionId>
  if (Array.isArray(rest) && rest.length) {
    if (rest[0] === 'resume' && rest[1]) sessionId = rest[1];
    else { try { cwd = decodeURIComponent(rest[0]); } catch (e) {} }
  }

  // ── Layout ──
  const wrap = el('div', { class: 'col gap-2', style: { height: '100%', minHeight: '0' } });
  root.appendChild(wrap);

  // Top bar: cwd + permission mode + conversation menu
  const cwdInp = el('input', { class: 'input mono', value: cwd, placeholder: 'Working directory (absolute path)', style: { flex: '1' } });
  cwdInp.addEventListener('change', () => {
    cwd = cwdInp.value.trim(); localStorage.setItem('claude.cwd', cwd);
    // A resumed session belongs to its folder — changing folders starts fresh,
    // otherwise --resume runs in the wrong project and claude exits 1.
    sessionId = null;
    hint.textContent = 'New conversation in ' + (cwd || 'the home folder') + '.';
    loadConversations();
  });

  const permSeg = el('div', { class: 'seg' });
  for (const m of ['default', 'plan', 'acceptEdits']) {
    const b = el('button', { class: permissionMode === m ? 'active' : '' }, m);
    b.addEventListener('click', () => {
      permissionMode = m; localStorage.setItem('claude.permMode', m);
      for (const c of permSeg.children) c.classList.toggle('active', c.textContent === m);
    });
    permSeg.appendChild(b);
  }

  const convBtn = el('button', { class: 'btn sm ghost icon', title: 'Conversations' });
  convBtn.innerHTML = window.icon('layers', { size: 16 });
  convBtn.addEventListener('click', showConversations);

  const termBtn = el('button', { class: 'btn sm ghost', title: 'Open this conversation in a terminal' });
  termBtn.innerHTML = window.icon('terminal', { size: 14 }) + ' Terminal';
  termBtn.addEventListener('click', openInTerminal);

  wrap.appendChild(el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } }, [cwdInp, permSeg, convBtn, termBtn]));

  // Message list
  const list = el('div', { class: 'card', style: { flex: '1', minHeight: '0', overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } });
  wrap.appendChild(list);

  const hint = el('div', { class: 'muted text-sm' }, sessionId ? ('Resuming session ' + sessionId.slice(0, 8) + '…') : 'New conversation. Ask Claude anything about ' + (cwd || 'the home folder') + '.');
  list.appendChild(hint);

  // Composer
  const ta = el('textarea', { class: 'textarea', placeholder: 'Message Claude…  (⌘/Ctrl+Enter to send)', style: { minHeight: '64px' } });
  // Prefill from the "?" / Request-a-change flow.
  try { const pending = localStorage.getItem('claude.pendingMessage'); if (pending) { ta.value = pending; localStorage.removeItem('claude.pendingMessage'); } } catch (e) {}
  const sendBtn = el('button', { class: 'btn primary' }); sendBtn.innerHTML = window.icon('send', { size: 14 }) + ' Send';
  const stopBtn = el('button', { class: 'btn danger', hidden: true }); stopBtn.innerHTML = window.icon('stop', { size: 14 }) + ' Stop';
  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', stop);
  ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
  wrap.appendChild(el('div', { class: 'row gap-2', style: { alignItems: 'flex-end' } }, [ta, el('div', { class: 'col gap-2' }, [sendBtn, stopBtn])]));

  // ── Rendering ──
  function atBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 40; }
  function scroll() { if (atBottom()) list.scrollTop = list.scrollHeight; }

  function bubble(role, node) {
    const b = el('div', { class: 'card padded', style: {
      alignSelf: role === 'user' ? 'flex-end' : 'stretch',
      maxWidth: role === 'user' ? '80%' : '100%',
      background: role === 'user' ? 'var(--accent-soft)' : 'var(--surface-1)',
    } }, [node]);
    list.appendChild(b); scroll(); return b;
  }
  function textNode(s) { return el('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, s); }
  function toolLine(label, detail) {
    return el('details', { class: 'card', style: { background: 'var(--surface-2)', padding: '6px 10px' } }, [
      el('summary', { class: 'mono text-sm', style: { cursor: 'pointer', color: 'var(--accent-text)' } }, label),
      el('pre', { class: 'mono text-sm', style: { whiteSpace: 'pre-wrap', margin: '6px 0 0', color: 'var(--text-2)' } }, detail || ''),
    ]);
  }

  function renderClaude(data) {
    if (!data || typeof data !== 'object') return;
    const t = data.type;
    if (t === 'assistant' && data.message && Array.isArray(data.message.content)) {
      for (const block of data.message.content) {
        if (block.type === 'text' && block.text) bubble('assistant', textNode(block.text));
        else if (block.type === 'tool_use') bubble('assistant', toolLine('⚙ ' + block.name, JSON.stringify(block.input, null, 2)));
      }
    } else if (t === 'user' && data.message && Array.isArray(data.message.content)) {
      for (const block of data.message.content) {
        if (block.type === 'tool_result') {
          const c = Array.isArray(block.content) ? block.content.map(x => x.text || '').join('') : (block.content || '');
          bubble('assistant', toolLine('↳ result', String(c).slice(0, 4000)));
        }
      }
    } else if (t === 'result') {
      if (data.result) bubble('assistant', textNode(data.result));
    }
  }

  // ── Streaming ──
  function send() {
    const message = ta.value.trim();
    if (!message || streaming) return;
    bubble('user', textNode(message));
    ta.value = '';
    startStream(message);
  }

  async function startStream(message) {
    streaming = true; sendBtn.hidden = true; stopBtn.hidden = false;
    try {
      const r = await window.api('/api/claude/chat', { method: 'POST', body: { message, cwd: cwd || undefined, sessionId: sessionId || undefined, permissionMode } });
      requestId = r.requestId;
      if (r.sessionId) sessionId = r.sessionId;
      subscribe(r.topic);
    } catch (e) {
      window.toast.error(e.message); finalize();
    }
  }

  function subscribe(topic) {
    if (unsub) unsub();
    app.subscribe(topic);
    unsub = app.onMessage((msg) => {
      if (msg.topic !== topic) return;
      const p = msg.payload || {};
      if (p.type === 'session' && p.sessionId) { sessionId = p.sessionId; }
      else if (p.type === 'claude_json') renderClaude(p.data);
      else if (p.type === 'stderr') { /* ignore chatty stderr; surface on error only */ }
      else if (p.type === 'error') {
        const msg = p.error || 'Claude error';
        bubble('assistant', el('div', { class: 'mono text-sm', style: { color: 'var(--danger)', whiteSpace: 'pre-wrap' } }, msg));
        window.toast.error(msg.length > 120 ? msg.slice(0, 120) + '…' : msg);
        finalize(topic);
      }
      else if (p.type === 'aborted') { bubble('assistant', el('div', { class: 'muted text-sm' }, '— stopped —')); finalize(topic); }
      else if (p.type === 'done') { if (p.sessionId) sessionId = p.sessionId; finalize(topic); }
    });
  }

  function finalize(topic) {
    streaming = false; sendBtn.hidden = false; stopBtn.hidden = true;
    if (unsub) { unsub(); unsub = null; }
    if (topic) app.unsubscribe(topic);
    ta.focus();
  }

  async function stop() {
    if (!requestId) return;
    try { await window.api('/api/claude/abort', { method: 'POST', body: { requestId } }); } catch (e) {}
  }

  // ── Conversations (resume) ──
  async function loadConversations() { /* lazy: only when the sheet opens */ }
  async function showConversations() {
    let data = { conversations: [] };
    try { data = await window.api('/api/claude/conversations?cwd=' + encodeURIComponent(cwd || '')); } catch (e) {}
    const body = el('div', { class: 'col gap-2' });
    if (!data.conversations || !data.conversations.length) body.appendChild(el('div', { class: 'muted' }, 'No past conversations for this folder.'));
    for (const c of (data.conversations || [])) {
      const row = el('div', { class: 'list-item tap' }, [
        el('div', { class: 'col', style: { flex: '1', minWidth: '0' } }, [
          el('div', { class: 'truncate' }, c.lastMessagePreview || c.sessionId),
          el('div', { class: 'muted text-sm mono' }, c.sessionId.slice(0, 8) + ' · ' + (c.messageCount || 0) + ' msgs · ' + window.fmtRelative(new Date(c.lastTime || c.startTime).getTime())),
        ]),
      ]);
      row.addEventListener('click', () => {
        sessionId = c.sessionId;
        list.innerHTML = ''; list.appendChild(el('div', { class: 'muted text-sm' }, 'Resuming ' + c.sessionId.slice(0, 8) + '… send a message to continue.'));
        window.sheet && window.sheet.close && window.sheet.close();
        window.modal && window.modal.close && window.modal.close();
      });
      body.appendChild(row);
    }
    window.modal.open({ title: 'Conversations', content: body, actions: [{ label: 'Close', kind: 'ghost', onClick: () => window.modal.close() }] });
  }

  // ── Interchange: open this conversation in a Console terminal ──
  async function openInTerminal() {
    if (!sessionId) { window.toast.error('Start or resume a conversation first'); return; }
    const ok = await window.confirmModal({
      title: 'Open in terminal?',
      body: 'This opens a Console shell running `claude --resume ' + sessionId.slice(0, 8) + '…` in ' + (cwd || 'home') + '. A conversation has one live driver at a time — continue there instead of here.',
    });
    if (!ok) return;
    try {
      const meta = await window.api('/api/console', { method: 'POST', body: { cwd: cwd || undefined, name: 'Claude ' + sessionId.slice(0, 6) } });
      const cmd = 'claude --resume ' + sessionId + '\r';
      setTimeout(() => { window.api('/api/console/' + meta.id + '/write', { method: 'POST', body: { data: cmd } }).catch(() => {}); }, 700);
      try { localStorage.setItem('consoleActivateShell', meta.id); } catch (e) {}
      window.toast.info('Opening in Console…');
      location.hash = '#console';
    } catch (e) { window.toast.error(e.message); }
  }

  return {
    route(rest) {
      if (Array.isArray(rest) && rest[0] === 'resume' && rest[1]) { sessionId = rest[1]; }
    },
    destroy() { if (streaming) stop(); if (unsub) unsub(); },
  };
};
