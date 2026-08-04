// Interactive Claude — a streaming chat UI over /api/claude, rendered in the
// vanilla-JS view pattern. Streams SDKMessages over the WS topic claude:<reqId>.
// Interchangeable with Console: "Open in terminal" resumes the same session_id
// in a shell (claude --resume <id>).
//
// Deliberately chat-app-like (see .chat-* in styles.css): folder + mode chips
// up top, an edge-to-edge transcript with markdown-rendered replies and
// human-readable tool activity, and a pinned pill composer. Power features
// (raw path input, permission modes, terminal hand-off) live in bottom sheets.
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
  // The chat's source of truth lives server-side (a chat = stable id + cwd +
  // Claude session_id + seq-numbered event ring). This view only mirrors it:
  // lastSeq is how much of the ring we've rendered; on any reconnect we replay
  // events > lastSeq. The view itself persists across tab switches (persist:
  // true below) so the DOM/state here also survive navigation.
  let cwd = localStorage.getItem('claude.cwd') || (app.settings && app.settings.selfRepoPath) || '';
  let sessionId = null;
  let chatId = null;
  let requestId = null;
  let lastSeq = 0;
  let curTopic = null;
  let permissionMode = localStorage.getItem('claude.permMode') || 'default';
  let model = localStorage.getItem('claude.model') || ''; // '' = CLI default
  let unsub = null;
  let streaming = false;
  let replayBusy = false;
  let pendingLive = [];        // live events queued while a replay fetch runs
  let pendingUserEcho = false; // our optimistic user bubble vs the server echo
  let chatName = null;         // server-side chat name (session switcher)
  let restartHint = false;     // this turn's reply suggested a server restart
  let restartPromptOpen = false;
  let hydrating = false;       // rendering an old transcript — never prompt from it
  let addDirs = [];            // --add-dir repo references for this chat
  let attachments = [];        // uploaded file paths waiting to be sent
  let homeDir = null;          // lazy: upload destination when cwd is Home

  // Per-transcript render state
  let toolCard = null;          // current ToolCard underlay (reset when text arrives)
  let cardById = {};            // tool_use id -> ToolCard (for attaching results)
  let lastCard = null;          // fallback for results that arrive without an id
  const viewCards = new Set();  // every card this transcript created (turn-end settle)
  let lastAssistantText = '';
  let welcome = null;

  const MODES = [
    { id: 'default',     t: 'Do it for me',      d: 'Claude works on its own and can make changes.' },
    { id: 'plan',        t: 'Plan only',          d: 'Claude only reads and proposes a plan — no changes.' },
    { id: 'acceptEdits', t: 'Auto-accept edits',  d: 'File edits are applied without asking.' },
  ];
  if (!MODES.some(m => m.id === permissionMode)) permissionMode = 'default';
  const modeInfo = () => MODES.find(m => m.id === permissionMode) || MODES[0];

  // --model aliases the Claude CLI resolves itself; '' = its configured default.
  const MODELS = [
    { id: '',       t: 'Default', d: 'Whatever the Claude CLI is configured to use' },
    { id: 'fable',  t: 'Fable',   d: 'Most capable — the Claude 5 flagship' },
    { id: 'opus',   t: 'Opus',    d: 'Latest Opus — deep, complex work' },
    { id: 'sonnet', t: 'Sonnet',  d: 'Fast and capable' },
    { id: 'haiku',  t: 'Haiku',   d: 'Fastest and lightest' },
  ];
  if (!MODELS.some(m => m.id === model)) model = '';
  const modelInfo = () => MODELS.find(m => m.id === model) || MODELS[0];

  // Deep link #claude/<encoded-cwd> or #claude/resume/<sessionId>
  let resumeOnMount = null;
  if (Array.isArray(rest) && rest.length) {
    if (rest[0] === 'resume' && rest[1]) { sessionId = rest[1]; resumeOnMount = rest[1]; }
    else { try { cwd = decodeURIComponent(rest[0]); } catch (e) {} }
  }

  function recents() {
    try {
      const r = JSON.parse(localStorage.getItem('claude.recentCwds') || '[]');
      return Array.isArray(r) ? r.filter(x => typeof x === 'string' && x) : [];
    } catch (e) { return []; }
  }
  function rememberCwd(p) {
    if (!p) return;
    try { localStorage.setItem('claude.recentCwds', JSON.stringify([p, ...recents().filter(x => x !== p)].slice(0, 8))); } catch (e) {}
  }
  function folderLabel() { return cwd ? (window.basename(cwd) || cwd) : 'Home'; }
  function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ── Layout ──
  const wrap = el('div', { class: 'chat' });
  root.appendChild(wrap);

  // Context strip
  function setChip(chip, ic, label) {
    chip.innerHTML = window.icon(ic, { size: 14 }) + '<span class="lbl"></span>';
    chip.querySelector('.lbl').textContent = label;
  }
  // The folder chip is the session switcher: shows the current session,
  // taps into the sessions sheet (switch / new / rename / kill).
  const folderChip = el('button', { class: 'chat-chip', title: 'Sessions' });
  function chipLabel() { return chatName || folderLabel(); }
  function updateChips() { setChip(folderChip, 'folder', chipLabel()); }
  setChip(folderChip, 'folder', chipLabel());
  folderChip.addEventListener('click', showSessionsSheet);

  const modeChip = el('button', { class: 'chat-chip', title: 'How Claude behaves' });
  function updateModeChip() { setChip(modeChip, 'zap', modeInfo().t + (model ? ' · ' + modelInfo().t : '')); }
  updateModeChip();
  modeChip.addEventListener('click', showModeSheet);

  const histBtn = el('button', { class: 'btn ghost icon', title: 'Past conversations' });
  histBtn.innerHTML = window.icon('message', { size: 18 });
  histBtn.addEventListener('click', showHistory);

  const newBtn = el('button', { class: 'btn ghost icon', title: 'New conversation' });
  newBtn.innerHTML = window.icon('plus', { size: 18 });
  newBtn.addEventListener('click', () => newChat());

  wrap.appendChild(el('div', { class: 'chat-top' }, [folderChip, modeChip, el('div', { class: 'spacer' }), histBtn, newBtn]));

  // Reconnecting pill — shown instead of silently freezing/clearing the log
  // when the WS drops (iOS backgrounding) or while we replay missed events.
  const recon = el('div', { class: 'chat-reconnect hidden' });
  recon.innerHTML = '<span class="livebars"><i></i><i></i><i></i></span><span class="txt"></span>';
  function setRecon(text) {
    recon.classList.toggle('hidden', !text);
    if (text) recon.querySelector('.txt').textContent = text;
  }
  wrap.appendChild(recon);

  // Transcript
  const scroller = el('div', { class: 'chat-scroll' });
  const inner = el('div', { class: 'chat-inner' });
  scroller.appendChild(inner);
  const jump = el('button', { class: 'chat-jump hidden' });
  jump.innerHTML = window.icon('arrow-down', { size: 14 }) + '<span>Latest</span>';
  jump.addEventListener('click', () => { forceScroll(); jump.classList.add('hidden'); });
  scroller.appendChild(jump);
  scroller.addEventListener('scroll', () => { if (atBottom()) jump.classList.add('hidden'); });
  wrap.appendChild(scroller);

  // Thinking indicator (moved to the end of the transcript while streaming)
  const thinking = el('div', { class: 'chat-thinking' });
  thinking.innerHTML = '<span class="livebars"><i></i><i></i><i></i></span>';
  thinking.appendChild(el('span', null, 'Claude is working…'));

  // Composer
  const ta = el('textarea', { class: 'chat-input', rows: '1', placeholder: 'Message Claude…', enterkeyhint: 'send' });
  function autoGrow() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; }
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
  // Prefill from the "?" / Request-a-change flow.
  try {
    const pending = localStorage.getItem('claude.pendingMessage');
    if (pending) { ta.value = pending; localStorage.removeItem('claude.pendingMessage'); setTimeout(autoGrow, 0); }
  } catch (e) {}

  const sendBtn = el('button', { class: 'chat-send', title: 'Send' });
  sendBtn.innerHTML = window.icon('send', { size: 18 });
  // Keep focus (and the mobile keyboard) in the textarea when tapping send.
  sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  sendBtn.addEventListener('click', () => { if (streaming) stop(); else send(); });

  // "+" menu: photo / file upload (into the session cwd) + repo references.
  const plusBtn = el('button', { class: 'chat-plus', title: 'Add photos, files or folders' });
  plusBtn.innerHTML = window.icon('plus', { size: 18 });
  plusBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  plusBtn.addEventListener('click', showPlusSheet);

  const imgInput = el('input', { type: 'file', accept: 'image/*', multiple: '' });
  const fileInput = el('input', { type: 'file', multiple: '' });
  imgInput.style.display = fileInput.style.display = 'none';
  imgInput.addEventListener('change', () => { uploadFiles([...imgInput.files]); imgInput.value = ''; });
  fileInput.addEventListener('change', () => { uploadFiles([...fileInput.files]); fileInput.value = ''; });
  wrap.appendChild(imgInput);
  wrap.appendChild(fileInput);

  // Chip row above the composer: repo references (removable) + pending
  // attachments + upload progress.
  const attachRow = el('div', { class: 'chat-attach hidden' });
  wrap.appendChild(attachRow);

  // Both buttons live INSIDE the pill so their alignment is intrinsic to it —
  // they share the pill's box and stay put however tall it renders.
  const inputwrap = el('div', { class: 'chat-inputwrap' }, [plusBtn, ta, sendBtn]);
  wrap.appendChild(el('div', { class: 'chat-composer' }, [inputwrap]));

  // ── Transcript rendering ──
  function atBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60; }
  function forceScroll() { scroller.scrollTop = scroller.scrollHeight; }
  function addNode(n) {
    if (welcome) { welcome.remove(); welcome = null; }
    const stick = atBottom();
    inner.appendChild(n);
    if (thinking.parentNode) inner.appendChild(thinking); // keep the indicator last
    if (stick) forceScroll();
    else if (streaming) jump.classList.remove('hidden');
  }

  function clearChat() {
    if (window.ToolCard) window.ToolCard.closeAll(); // tear down overlays + timers
    inner.innerHTML = '';
    toolCard = null; cardById = {}; lastCard = null; viewCards.clear(); lastAssistantText = ''; welcome = null;
    jump.classList.add('hidden');
    if (jump.parentNode !== scroller) scroller.appendChild(jump);
  }
  function newChat() {
    // Detach only — a run still streaming server-side keeps running and stays
    // resumable from history; we never kill it from a UI action like this.
    setTopic(null);
    chatId = null; sessionId = null; requestId = null; chatName = null;
    lastSeq = 0; pendingLive = []; pendingUserEcho = false;
    addDirs = []; attachments = [];
    if (streaming) setStreamingUI(false);
    saveActive();
    updateChips();
    renderAttach();
    clearChat(); showWelcome();
  }

  function showWelcome() {
    welcome = el('div', { class: 'chat-welcome' });
    welcome.innerHTML = window.icon('sparkles', { size: 32 });
    welcome.appendChild(el('h3', null, 'Ask Claude anything'));
    welcome.appendChild(el('p', null, 'Claude can read files, run commands and make changes in ' + (cwd ? ('“' + folderLabel() + '”') : 'your home folder') + '. Just describe what you want in plain words.'));
    const sug = el('div', { class: 'chat-suggest' });
    for (const s of [
      'What’s in this folder? Give me a quick tour.',
      'Is this computer healthy? Check disk space and memory.',
      'Find anything in this folder that looks broken and explain it simply.',
    ]) {
      const b = el('button', null, s);
      b.addEventListener('click', () => { ta.value = s; autoGrow(); ta.focus(); });
      sug.appendChild(b);
    }
    welcome.appendChild(sug);
    inner.appendChild(welcome);
  }

  function addUser(text) {
    toolCard = null;
    addNode(el('div', { class: 'chat-msg user' }, text));
  }
  // Does a reply read like "the server needs a restart"? Fuel for the
  // restart questionnaire that pops after the turn finishes. Matches preceded
  // by a negation ("no restart needed", "doesn't need a restart") don't count.
  const RESTART_RE = /\b(?:restart|reboot)\b[^.\n]{0,60}\b(?:server|supervisor|pm2|backend)\b|\b(?:server|supervisor|pm2|backend)\b[^.\n]{0,60}\b(?:restart|reboot)\b|\brestart (?:is )?(?:required|needed)\b|\bneeds? (?:a )?restart\b/gi;
  function suggestsRestart(text) {
    for (const m of String(text).matchAll(RESTART_RE)) {
      const before = text.slice(Math.max(0, m.index - 28), m.index);
      if (/\b(?:no|not|without|never|none|isn'?t|doesn'?t|don'?t|won'?t)\s+(?:\w+\s+){0,2}$/i.test(before)) continue;
      return true;
    }
    return false;
  }

  function addAssistantText(text) {
    toolCard = null;
    const d = el('div', { class: 'chat-md' });
    if (window.renderMarkdown) d.innerHTML = window.renderMarkdown(text);
    else { d.style.whiteSpace = 'pre-wrap'; d.textContent = text; }
    addNode(d);
    lastAssistantText = text;
    if (!hydrating && suggestsRestart(text)) restartHint = true;
  }
  function addError(text) { addNode(el('div', { class: 'chat-error' }, text)); }
  function addMeta(text) { addNode(el('div', { class: 'chat-meta' }, text)); }

  // Tool calls render through the ToolCard underlay (components/toolcard.js):
  // one card per contiguous run of calls, each new call feeding a single
  // fixed slot instead of stacking rows. Labels/detail live in the component.
  function addTool(id, name, input) {
    if (!toolCard) {
      toolCard = window.ToolCard.create();
      viewCards.add(toolCard);
      addNode(toolCard.el);
    }
    toolCard.addCall(id, name, input, !hydrating);
    if (id) cardById[id] = toolCard;
    lastCard = toolCard;
  }
  function addToolResult(id, text, isError) {
    const card = (id && cardById[id]) || lastCard;
    if (card) card.addResult(id, text, isError);
  }
  // Turn over — freeze any still-"running" calls (failed=true on error/abort).
  function settleCards(failed) {
    for (const c of viewCards) c.settle(failed);
  }

  function renderClaude(data) {
    if (!data || typeof data !== 'object') return;
    const t = data.type;
    if (t === 'assistant' && data.message && Array.isArray(data.message.content)) {
      for (const block of data.message.content) {
        if (block.type === 'text' && block.text && block.text.trim()) addAssistantText(block.text);
        else if (block.type === 'tool_use') addTool(block.id, block.name, block.input);
      }
    } else if (t === 'user' && data.message && Array.isArray(data.message.content)) {
      for (const block of data.message.content) {
        if (block.type === 'tool_result') {
          const c = Array.isArray(block.content) ? block.content.map(x => x.text || '').join('') : (block.content || '');
          addToolResult(block.tool_use_id, String(c), block.is_error === true);
        }
      }
    } else if (t === 'result') {
      const txt = typeof data.result === 'string' ? data.result : '';
      // The final result usually repeats the last assistant message — dedupe.
      if (txt && txt.trim() !== (lastAssistantText || '').trim()) addAssistantText(txt);
      if (data.is_error) addError(txt || 'Claude reported an error.');
      else if (data.duration_ms) addMeta('Done in ' + window.fmtDur(data.duration_ms));
    }
  }

  // ── Streaming ──
  function setStreamingUI(on) {
    streaming = on;
    sendBtn.classList.toggle('stop', on);
    sendBtn.innerHTML = window.icon(on ? 'stop' : 'send', { size: 18 });
    sendBtn.title = on ? 'Stop' : 'Send';
    if (on) { addNode(thinking); forceScroll(); }
    else thinking.remove();
  }

  // Remember which server chat this view mirrors, so a page reload (or PWA
  // relaunch) re-attaches to it instead of starting a blank conversation.
  function saveActive() {
    try {
      if (chatId || sessionId) localStorage.setItem('claude.activeChat', JSON.stringify({ chatId, sessionId, cwd }));
      else localStorage.removeItem('claude.activeChat');
    } catch (e) {}
  }

  // One WS subscription per chat, swapped when the chat changes. The message
  // handler itself is registered once at mount and lives as long as the view.
  function setTopic(t) {
    if (curTopic === t) return;
    if (curTopic) app.unsubscribe(curTopic);
    curTopic = t;
    if (t) app.subscribe(t);
  }

  // Pure rendering of one buffered/live StreamResponse event (no seq logic).
  function applyEvent(p) {
    if (!p || typeof p !== 'object') return;
    if (p.type === 'user') { if (typeof p.text === 'string' && p.text.trim()) addUser(p.text); }
    else if (p.type === 'session') { if (p.sessionId) { sessionId = p.sessionId; saveActive(); } }
    else if (p.type === 'claude_json') renderClaude(p.data);
    else if (p.type === 'stderr') { /* ignore chatty stderr; surface on error only */ }
    else if (p.type === 'error') { addError(p.error || 'Claude error'); settleCards(true); finalize(); }
    else if (p.type === 'aborted') { addMeta('Stopped'); settleCards(true); finalize(); }
    else if (p.type === 'done') { if (p.sessionId) sessionId = p.sessionId; saveActive(); settleCards(false); finalize(); maybeOfferRestart(); }
  }

  // The turn's reply said the server needs a restart → ask instead of assuming.
  function maybeOfferRestart() {
    if (!restartHint || restartPromptOpen || hydrating) return;
    restartHint = false;
    restartPromptOpen = true;
    const body = el('div', { class: 'col gap-2' }, [
      el('div', null, 'Claude’s reply suggests the Supervisor server needs a restart for the changes to take effect.'),
      el('div', { class: 'muted text-sm' }, 'Restarting drops this page for a few seconds; the app reconnects and shows a “Reload now” banner. Claude sessions live server-side and are re-attached afterwards.'),
    ]);
    let handle = null;
    handle = window.modal.open({
      title: 'Restart the server?',
      content: body,
      onClose: () => { restartPromptOpen = false; }, // fires on any dismissal
      actions: [
        { label: 'Not now', kind: 'ghost', onClick: () => handle.close() },
        { label: 'Restart server', kind: 'danger primary', onClick: async () => {
          handle.close();
          try {
            if (app.markRestarting) app.markRestarting();
            await window.api('/api/maintenance/restart', { method: 'POST' });
            window.toast.info('Restarting Supervisor…');
          } catch (e) { window.toast.error(e.message); }
        } },
      ],
    });
  }

  // Live event entry point: dedupe/order by seq, detect gaps (lossy WS under
  // backpressure) and fall back to a replay fetch that fills them.
  function onChatEvent(p) {
    if (replayBusy) { pendingLive.push(p); return; }
    if (p.seq != null) {
      if (p.seq <= lastSeq) { if (p.type === 'user') pendingUserEcho = false; return; }
      if (p.seq > lastSeq + 1) { fetchReplay(); return; }
      lastSeq = p.seq;
      if (p.type === 'user' && pendingUserEcho) { pendingUserEcho = false; return; } // already rendered optimistically
    }
    applyEvent(p);
  }

  // Pull everything after lastSeq from the server ring and render it. Also
  // trues up the streaming indicator against the chat's real status.
  async function fetchReplay() {
    if (!chatId || replayBusy) return;
    replayBusy = true;
    try {
      const snap = await window.api('/api/claude/chats/' + encodeURIComponent(chatId) + '?since=' + lastSeq);
      for (const ev of (snap.events || [])) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.type === 'user' && pendingUserEcho) { pendingUserEcho = false; continue; }
        applyEvent(ev);
      }
      if (snap.sessionId) sessionId = snap.sessionId;
      if (snap.status === 'running' && !streaming) setStreamingUI(true);
      else if (snap.status !== 'running' && streaming) setStreamingUI(false);
      saveActive();
    } catch (e) {
      if (e && e.status === 404) {
        // Server restarted; the live chat and its ring are gone. Keep the
        // transcript — the next send starts a fresh chat that resumes the
        // same Claude session_id.
        chatId = null;
        setTopic(null);
        if (streaming) setStreamingUI(false);
        saveActive();
      }
    } finally {
      replayBusy = false;
      const q = pendingLive; pendingLive = [];
      for (const p of q) onChatEvent(p);
    }
  }

  function onConn(state) {
    if (state === 'offline') { if (chatId) setRecon('Reconnecting…'); return; }
    if (chatId) {
      setRecon('Catching up…');
      Promise.resolve(fetchReplay()).finally(() => setRecon(null));
    } else setRecon(null);
  }

  function send() {
    let message = ta.value.trim();
    if ((!message && !attachments.length) || streaming) return;
    // Hand uploaded files to Claude as plain file paths appended to the turn.
    if (attachments.length) {
      message += (message ? '\n\n' : '') + attachments.map(p => 'Attached file: ' + p).join('\n');
      attachments = [];
      renderAttach();
    }
    addUser(message);
    ta.value = ''; autoGrow();
    forceScroll();
    startStream(message);
  }

  async function startStream(message) {
    setStreamingUI(true);
    restartHint = false; // fresh turn, fresh verdict
    pendingUserEcho = true; // the server echoes our user turn into the ring
    try {
      const r = await window.api('/api/claude/chat', { method: 'POST', body: {
        message, chatId: chatId || undefined, cwd: cwd || undefined,
        sessionId: sessionId || undefined, permissionMode,
        addDirs: addDirs.length ? addDirs : undefined,
        model: model || null, // null clears an earlier override back to the CLI default
      } });
      requestId = r.requestId;
      chatId = r.chatId;
      if (r.sessionId) sessionId = r.sessionId;
      // r.seq includes our user event; only fast-forward when contiguous —
      // otherwise the replay below fills whatever we haven't seen.
      if (typeof r.seq === 'number' && r.seq === lastSeq + 1) { lastSeq = r.seq; pendingUserEcho = false; }
      if (cwd) rememberCwd(cwd);
      setTopic(r.topic);
      saveActive();
      fetchReplay(); // catch anything published before the subscription landed
    } catch (e) {
      pendingUserEcho = false;
      addError(e.message);
      finalize();
    }
  }

  function finalize() {
    setStreamingUI(false);
    jump.classList.add('hidden');
    // Re-focusing on mobile would pop the keyboard back open — desktop only.
    if (window.matchMedia('(min-width: 768px)').matches) ta.focus();
  }

  async function stop() {
    if (!chatId && !requestId) return;
    // chatId works even after a re-attach that never saw the requestId.
    try { await window.api('/api/claude/abort', { method: 'POST', body: chatId ? { chatId } : { requestId } }); } catch (e) {}
  }

  // ── History (resume with a real transcript) ──
  function renderHistoryEntry(o) {
    if (!o || o.isMeta) return;
    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      if (typeof c === 'string') { if (c.trim()) addUser(c); }
      else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'text' && b.text && b.text.trim()) addUser(b.text);
          else if (b.type === 'tool_result') {
            const txt = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : (b.content || '');
            addToolResult(b.tool_use_id, String(txt), b.is_error === true);
          }
        }
      }
    } else if (o.type === 'assistant' && o.message) {
      renderClaude({ type: 'assistant', message: o.message });
    }
  }

  async function loadHistory(sid) {
    setTopic(null);
    chatId = null; requestId = null; chatName = null;
    lastSeq = 0; pendingLive = []; pendingUserEcho = false;
    addDirs = []; attachments = [];
    if (streaming) setStreamingUI(false);
    sessionId = sid;
    saveActive();
    updateChips();
    renderAttach();
    clearChat();
    const loading = el('div', { class: 'chat-meta' }, 'Loading conversation…');
    inner.appendChild(loading);
    try {
      const r = await window.api('/api/claude/conversation?cwd=' + encodeURIComponent(cwd || '') + '&sessionId=' + encodeURIComponent(sid));
      loading.remove();
      hydrating = true;
      try { for (const m of (r.messages || [])) { try { renderHistoryEntry(m); } catch (e) {} } }
      finally { hydrating = false; restartHint = false; }
      addMeta('Resumed — new messages continue this conversation.');
    } catch (e) {
      loading.textContent = 'Resumed conversation ' + sid.slice(0, 8) + '… — send a message to continue.';
    }
    forceScroll();
  }

  // ── Sheets: folder / mode / history ──
  function optRow({ ic, t, d, on, mark }, onClick) {
    const row = el('div', { class: 'chat-opt' + (on ? ' on' : '') }, [
      el('div', { class: 'ic', html: window.icon(ic, { size: 18 }) }),
      el('div', { class: 'tx' }, [
        el('div', { class: 't' }, t),
        d ? el('div', { class: 'd' }, d) : null,
      ]),
      mark ? el('div', { class: 'mark', html: window.icon('check', { size: 18 }) }) : null,
    ]);
    row.addEventListener('click', onClick);
    return row;
  }

  // ── Sessions: switch / create / rename / kill (the former Sessions tab) ──

  // Attach this view to a server-side chat and render its ring from scratch.
  async function attachChat(id) {
    const snap = await window.api('/api/claude/chats/' + encodeURIComponent(id) + '?since=0'); // throws on 404
    setTopic(null);
    chatId = snap.chatId;
    requestId = null;
    lastSeq = 0; pendingLive = []; pendingUserEcho = false;
    sessionId = snap.sessionId || null;
    chatName = snap.name || null;
    addDirs = Array.isArray(snap.addDirs) ? snap.addDirs.slice() : [];
    attachments = [];
    // Adopt the chat's model override so the chip reflects what actually runs.
    if (snap.model !== undefined) { model = snap.model || ''; updateModeChip(); }
    if (snap.cwd) { cwd = snap.cwd; try { localStorage.setItem('claude.cwd', cwd); } catch (e) {} }
    clearChat();
    hydrating = true; // old transcript — render it, but never prompt from it
    try {
      for (const ev of (snap.events || [])) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        applyEvent(ev);
      }
    } finally { hydrating = false; restartHint = false; }
    if (snap.seq > lastSeq) lastSeq = snap.seq;
    if (!inner.childNodes.length) showWelcome();
    setTopic('claude:' + chatId);
    if (snap.status === 'running') { if (!streaming) setStreamingUI(true); }
    else if (streaming) setStreamingUI(false);
    updateChips();
    renderAttach();
    saveActive();
    forceScroll();
  }

  async function createSession(path) {
    try {
      const snap = await window.api('/api/claude/chats', { method: 'POST', body: { cwd: path || undefined } });
      if (path) rememberCwd(path);
      await attachChat(snap.chatId);
    } catch (e) { window.toast.error(e.message); }
  }

  async function showSessionsSheet() {
    const body = el('div');
    body.appendChild(el('div', { class: 'muted text-sm', style: { padding: '8px 4px' } }, 'Loading…'));
    window.sheet.open({ title: 'Sessions', content: body });
    let data = { chats: [] };
    try { data = await window.api('/api/claude/chats'); } catch (e) {}
    body.innerHTML = '';

    for (const c of (data.chats || [])) {
      const on = chatId === c.chatId;
      const running = c.status === 'running';
      const row = el('div', { class: 'chat-opt session' + (on ? ' on' : '') });
      row.appendChild(el('div', { class: 'ic', html: window.icon(running ? 'zap' : 'message', { size: 18 }) }));
      const tx = el('div', { class: 'tx' });
      tx.appendChild(el('div', { class: 't' }, [
        el('span', { class: 'sdot' + (running ? ' run' : '') }),
        el('span', null, c.name || window.basename(c.cwd || '') || 'Session'),
      ]));
      tx.appendChild(el('div', { class: 'd' }, (running ? 'Running · ' : 'Idle · ') + (c.cwd || 'Home') + (c.preview ? ' — ' + trunc(c.preview, 50) : '')));
      row.appendChild(tx);
      const acts = el('div', { class: 'acts' });
      const rn = el('button', { class: 'btn ghost icon sm', title: 'Rename' });
      rn.innerHTML = window.icon('edit', { size: 14 });
      rn.addEventListener('click', async (e) => {
        e.stopPropagation();
        window.sheet.close();
        const v = await window.promptModal({ title: 'Rename session', label: 'Name', initial: c.name || '' });
        if (v == null) return;
        try {
          await window.api('/api/claude/chats/' + encodeURIComponent(c.chatId) + '/rename', { method: 'POST', body: { name: v.trim() } });
          if (chatId === c.chatId) { chatName = v.trim() || null; updateChips(); }
        } catch (err) { window.toast.error(err.message); }
        showSessionsSheet();
      });
      const kl = el('button', { class: 'btn ghost icon sm danger', title: 'Kill session' });
      kl.innerHTML = window.icon('x', { size: 14 });
      kl.addEventListener('click', async (e) => {
        e.stopPropagation();
        window.sheet.close();
        const ok = await window.confirmModal({
          title: 'Kill this session?',
          body: (running ? 'It is still running — the in-flight reply will be aborted. ' : '')
            + 'The conversation stays in history and can be resumed later.',
          danger: true, confirmText: 'Kill',
        });
        if (!ok) return;
        try {
          await window.api('/api/claude/chats/' + encodeURIComponent(c.chatId), { method: 'DELETE' });
          if (chatId === c.chatId) newChat();
          window.toast.success('Session killed');
        } catch (err) { window.toast.error(err.message); }
      });
      acts.appendChild(rn); acts.appendChild(kl);
      row.appendChild(acts);
      row.addEventListener('click', () => {
        window.sheet.close();
        if (!on) attachChat(c.chatId).catch(err => window.toast.error(err.message));
      });
      body.appendChild(row);
    }
    if (!(data.chats || []).length) {
      body.appendChild(el('div', { class: 'muted text-sm', style: { padding: '8px 4px 12px' } }, 'No live sessions. Start one below — or just send a message.'));
    }

    body.appendChild(optRow({ ic: 'plus', t: 'New session…', d: 'Pick a folder for Claude to work in' }, async () => {
      const p = await window.pickDirectory({ title: 'Where should Claude work?', initial: cwd || '' });
      if (p != null) createSession(p);
    }));
    body.appendChild(optRow({ ic: 'message', t: 'Past conversations', d: 'Resume an older conversation in “' + folderLabel() + '”' }, () => {
      showHistory();
    }));
  }

  // ── Attachments: uploads into the session cwd + --add-dir references ──

  function renderAttach() {
    attachRow.innerHTML = '';
    const chips = [];
    for (const d of addDirs) {
      const chip = el('span', { class: 'chat-attach-chip repo', title: d }, [
        el('span', { class: 'ic', html: window.icon('layers', { size: 13 }) }),
        el('span', { class: 'lbl' }, window.basename(d) || d),
      ]);
      const x = el('button', { class: 'x', title: 'Remove repo reference' });
      x.innerHTML = window.icon('x', { size: 12 });
      x.addEventListener('click', () => { addDirs = addDirs.filter(v => v !== d); syncDirs(); renderAttach(); });
      chip.appendChild(x);
      chips.push(chip);
    }
    for (const p of attachments) {
      const chip = el('span', { class: 'chat-attach-chip', title: p }, [
        el('span', { class: 'ic', html: window.icon('file', { size: 13 }) }),
        el('span', { class: 'lbl' }, window.basename(p) || p),
      ]);
      const x = el('button', { class: 'x', title: 'Remove attachment' });
      x.innerHTML = window.icon('x', { size: 12 });
      x.addEventListener('click', () => { attachments = attachments.filter(v => v !== p); renderAttach(); });
      chip.appendChild(x);
      chips.push(chip);
    }
    for (const c of chips) attachRow.appendChild(c);
    attachRow.classList.toggle('hidden', !chips.length);
  }

  async function ensureUploadDest() {
    if (cwd) return cwd;
    if (!homeDir) {
      const loc = await window.api('/api/files/locations');
      homeDir = loc.home;
    }
    return homeDir;
  }

  function uploadFiles(files) {
    if (!files || !files.length) return;
    ensureUploadDest().then((dest) => {
      const prog = el('span', { class: 'chat-attach-chip prog' }, [
        el('span', { class: 'ic', html: window.icon('file', { size: 13 }) }),
        el('span', { class: 'lbl' }, 'Uploading ' + (files.length === 1 ? files[0].name : files.length + ' files') + '… 0%'),
      ]);
      attachRow.appendChild(prog);
      attachRow.classList.remove('hidden');
      const lbl = prog.querySelector('.lbl');

      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      // XHR instead of fetch: upload progress events for large files.
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload?dest=' + encodeURIComponent(dest));
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) lbl.textContent = lbl.textContent.replace(/\d+%$/, Math.round(100 * e.loaded / e.total) + '%');
      });
      xhr.addEventListener('load', () => {
        prog.remove();
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && body) {
          for (const u of (body.uploaded || [])) if (!attachments.includes(u.path)) attachments.push(u.path);
          renderAttach();
          window.toast.success((body.uploaded || []).length + ' file(s) ready — send a message to hand them to Claude');
        } else {
          renderAttach();
          window.toast.error((body && body.error) || ('Upload failed (HTTP ' + xhr.status + ')'));
        }
      });
      xhr.addEventListener('error', () => { prog.remove(); renderAttach(); window.toast.error('Upload failed'); });
      xhr.send(fd);
    }).catch(e => window.toast.error(e.message));
  }

  async function syncDirs() {
    if (!chatId) return; // no server chat yet — sent with the first message
    try { await window.api('/api/claude/chats/' + encodeURIComponent(chatId) + '/dirs', { method: 'POST', body: { dirs: addDirs } }); }
    catch (e) { window.toast.error(e.message); }
  }

  function showPlusSheet() {
    const body = el('div');
    body.appendChild(optRow({ ic: 'image', t: 'Photo', d: 'From camera roll or camera — saved into the session folder' }, () => {
      window.sheet.close();
      imgInput.click();
    }));
    body.appendChild(optRow({ ic: 'file', t: 'File', d: 'Upload any file into the session folder' }, () => {
      window.sheet.close();
      fileInput.click();
    }));
    body.appendChild(optRow({ ic: 'layers', t: 'Add repo reference', d: 'Give Claude access to another folder (--add-dir)' }, async () => {
      const p = await window.pickDirectory({ title: 'Add a folder to the session', initial: cwd || '' });
      if (p == null) return;
      if (!addDirs.includes(p)) { addDirs.push(p); syncDirs(); renderAttach(); }
    }));
    window.sheet.open({ title: 'Add to this session', content: body });
  }

  function showModeSheet() {
    const body = el('div');
    for (const m of MODES) {
      const on = permissionMode === m.id;
      body.appendChild(optRow({ ic: 'zap', t: m.t, d: m.d, on, mark: on }, () => {
        permissionMode = m.id;
        try { localStorage.setItem('claude.permMode', m.id); } catch (e) {}
        updateModeChip();
        window.sheet.close();
      }));
    }
    body.appendChild(el('div', { class: 'section-title', style: { margin: '14px 4px 4px' } }, 'Model'));
    for (const mo of MODELS) {
      const on = (model || '') === mo.id;
      body.appendChild(optRow({ ic: 'sparkles', t: mo.t, d: mo.d, on, mark: on }, () => {
        model = mo.id;
        try { localStorage.setItem('claude.model', model); } catch (e) {}
        updateModeChip();
        window.sheet.close();
      }));
    }
    body.appendChild(el('div', { class: 'section-title', style: { margin: '14px 4px 4px' } }, 'Power tools'));
    body.appendChild(optRow({ ic: 'terminal', t: 'Open in terminal', d: 'Continue this conversation in a raw Console shell' }, () => {
      window.sheet.close();
      openInTerminal();
    }));
    window.sheet.open({ title: 'How should Claude behave?', content: body });
  }

  async function showHistory() {
    const body = el('div');
    body.appendChild(el('div', { class: 'muted text-sm', style: { padding: '8px 4px' } }, 'Loading…'));
    window.sheet.open({ title: 'Past conversations', content: body });
    let data = { conversations: [] };
    try { data = await window.api('/api/claude/conversations?cwd=' + encodeURIComponent(cwd || '')); } catch (e) {}
    body.innerHTML = '';
    const convs = data.conversations || [];
    if (!convs.length) {
      body.appendChild(el('div', { class: 'muted', style: { padding: '12px 4px' } }, 'No past conversations in “' + folderLabel() + '” yet.'));
      return;
    }
    for (const c of convs.slice(0, 50)) {
      const when = window.fmtRelative(new Date(c.lastTime || c.startTime).getTime());
      body.appendChild(optRow({
        ic: 'message',
        t: trunc(c.lastMessagePreview || 'Conversation ' + c.sessionId.slice(0, 8), 70),
        d: when + ' · ' + (c.messageCount || 0) + ' messages',
        on: sessionId === c.sessionId,
        mark: sessionId === c.sessionId,
      }, () => {
        window.sheet.close();
        loadHistory(c.sessionId);
      }));
    }
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

  // ── Boot ──
  // Single WS handler for the view's whole lifetime (the view persists across
  // tab switches, so this keeps rendering into the detached DOM while another
  // tab is showing).
  unsub = app.onMessage((msg) => {
    if (msg.topic === '_conn') { onConn(msg.payload && msg.payload.state); return; }
    if (!curTopic || msg.topic !== curTopic) return;
    onChatEvent(msg.payload || {});
  });

  // Safety net: whenever the PWA is foregrounded with the socket still up,
  // true up against the server ring (backpressure may have dropped events).
  function onForeground() { if (!document.hidden && chatId && app.wsConnected) fetchReplay(); }
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('pageshow', onForeground);

  // Re-attach to the chat this client was last driving (page reload / PWA
  // relaunch). Never auto-creates anything: unknown chat falls back to the
  // on-disk transcript, no state at all falls back to the welcome screen.
  async function rehydrate() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('claude.activeChat') || 'null'); } catch (e) {}
    if (!saved || (!saved.chatId && !saved.sessionId)) { showWelcome(); return; }
    if (saved.cwd) { cwd = saved.cwd; updateChips(); }
    if (saved.chatId) {
      try { await attachChat(saved.chatId); return; }
      catch (e) { /* unknown chat (server restarted) — fall through */ }
    }
    if (saved.sessionId) { loadHistory(saved.sessionId); return; }
    showWelcome();
  }

  if (resumeOnMount) loadHistory(resumeOnMount);
  else rehydrate();

  let savedScrollTop = 0, wasAtBottom = true;
  return {
    persist: true,
    route(rest2) {
      if (Array.isArray(rest2) && rest2[0] === 'resume' && rest2[1]) loadHistory(rest2[1]);
    },
    suspend() {
      wasAtBottom = atBottom();
      savedScrollTop = scroller.scrollTop;
    },
    resume(rest2) {
      if (Array.isArray(rest2) && rest2[0] === 'resume' && rest2[1] && rest2[1] !== sessionId) { loadHistory(rest2[1]); return; }
      // Re-appending can reset scroll positions; restore what the user saw.
      if (wasAtBottom) forceScroll(); else scroller.scrollTop = savedScrollTop;
      if (chatId && app.wsConnected) fetchReplay();
    },
    // With persist:true this only runs if the view is ever truly torn down.
    // It must NOT abort the run — server chats outlive their clients.
    destroy() {
      setTopic(null);
      if (window.ToolCard) window.ToolCard.closeAll();
      if (unsub) unsub();
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('pageshow', onForeground);
    },
  };
};
