// ToolCard — the "underlay" tool-activity card for Interactive Claude.
//
// One card per contiguous run of tool calls (the run breaks when assistant
// text arrives). Instead of stacking a row per call, the card occupies ONE
// fixed 48px slot in the transcript and feeds each new call through it:
// the incoming face rises in from below while the outgoing face rises out,
// overlapping mid-flight so it reads as a continuous feed.
//
// Stages (per card):
//   0 collapsed  — one face: icon + label + status dot + timer, "N steps" badge
//   1 inline     — panel overlays the transcript at ~40vh; chat behind dims
//   2 sheet      — full-screen payload (diff / scrollback / file content)
// plus follow (auto-track newest call) vs pinned (expanded on one call — new
// calls only bump the "N new" pill; collapsing fully resumes follow).
//
// Feed queue: at most one swap animates at a time; arrivals during a swap
// overwrite a single pending slot, so intermediate frames are dropped and the
// card always lands on the newest call. Only transform/opacity animate; the
// slot never changes height while collapsed, so the message list never jumps.
//
// Usage:
//   const card = window.ToolCard.create();
//   transcript.appendChild(card.el);
//   card.addCall(id, name, input, live);     // live=false when hydrating
//   card.addResult(id, text, isError);
//   card.settle(failed);                     // turn ended — freeze timers
//   window.ToolCard.closeAll();              // tear down overlays (view reset)

(function () {
  const MAX_RESULT = 262144;   // per-call result cap (chars)
  const SLOT_H = 48;           // collapsed slot height — keep in sync with CSS
  const cards = new Set();     // live handles, for closeAll()

  function E() { return window.el.apply(null, arguments); }
  function esc(s) { return window.escapeHtml(s); }
  function RM() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── Labels ──
  function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function toolIcon(name) {
    return ({ Read: 'eye', Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
      Bash: 'terminal', Grep: 'search', Glob: 'search', LS: 'folder',
      WebFetch: 'globe', WebSearch: 'globe', TodoWrite: 'check', Task: 'zap' })[name] || 'zap';
  }
  function toolLabel(name, input) {
    input = input || {};
    const base = (p) => window.basename(String(p || '')) || trunc(p, 40);
    switch (name) {
      case 'Read':      return 'Read ' + base(input.file_path || input.path || input.notebook_path);
      case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'Edit ' + base(input.file_path || input.notebook_path);
      case 'Write':     return 'Write ' + base(input.file_path);
      case 'Bash':      return trunc(input.command || 'Ran a command', 80);
      case 'Grep':      return 'Search ' + trunc(input.pattern || '…', 40);
      case 'Glob':      return 'Find files ' + trunc(input.pattern || '…', 40);
      case 'LS':        return 'List ' + base(input.path || 'folder');
      case 'WebFetch':  return 'Fetch ' + trunc(input.url || 'a page', 50);
      case 'WebSearch': return 'Web search ' + trunc(input.query || '…', 40);
      case 'TodoWrite': return 'Update to-do list';
      case 'Task':      return 'Run a helper agent';
      default:          return 'Use ' + name;
    }
  }
  function kindOf(name) {
    if (name === 'Bash') return 'bash';
    if (name === 'Read') return 'read';
    if (name === 'Write') return 'write';
    if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return 'edit';
    return 'other';
  }
  function callPath(c) {
    return String(c.input.file_path || c.input.path || c.input.notebook_path || '');
  }
  function elapsedText(c) {
    if (!c.t0) return '';
    const ms = (c.t1 || Date.now()) - c.t0;
    return ms < 10000 ? (ms / 1000).toFixed(1) + 's' : window.fmtDur(ms);
  }

  // ── Diff (Edit inputs are contiguous replacements — trim the common
  //    prefix/suffix lines and show the middle with a little context) ──
  function lineDiff(oldS, newS) {
    const a = String(oldS).split('\n'), b = String(newS).split('\n');
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    return {
      ctxPre: a.slice(Math.max(0, pre - 2), pre),
      del: a.slice(pre, a.length - suf),
      add: b.slice(pre, b.length - suf),
      ctxSuf: a.slice(a.length - suf, Math.min(a.length, a.length - suf + 2)),
    };
  }
  function diffHunks(c) {
    if (c.name === 'Write') return [{ ctxPre: [], del: [], add: String(c.input.content || '').split('\n'), ctxSuf: [] }];
    const edits = c.name === 'MultiEdit' ? (c.input.edits || []) : [c.input];
    return edits.map(e => lineDiff(e.old_string || '', e.new_string || ''));
  }
  function diffStats(c) {
    let add = 0, del = 0;
    for (const h of diffHunks(c)) { add += h.add.length; del += h.del.length; }
    return { add, del };
  }
  function langFor(path) {
    const ext = (String(path).split('.').pop() || '').toLowerCase();
    return (window.hljs && ext && window.hljs.getLanguage(ext)) ? ext : null;
  }
  function codeHtml(line, lang) {
    if (lang && window.hljs) {
      try { return window.hljs.highlight(line, { language: lang, ignoreIllegals: true }).value; } catch (e) {}
    }
    return esc(line);
  }
  function renderDiff(host, c, cap) {
    const lang = langFor(callPath(c));
    let n = 0, dropped = 0;
    for (const h of diffHunks(c)) {
      const seg = E('div', { class: 'tc-hunk' });
      const push = (cls, g, text) => {
        if (n >= cap) { dropped++; return; }
        n++;
        const d = E('div', { class: 'dl ' + cls });
        d.innerHTML = '<span class="g">' + g + '</span><span class="t">' + codeHtml(text, lang) + '</span>';
        seg.appendChild(d);
      };
      for (const t of h.ctxPre) push('ctx', '', t);
      for (const t of h.del) push('del', '−', t);
      for (const t of h.add) push('add', '+', t);
      for (const t of h.ctxSuf) push('ctx', '', t);
      if (seg.childNodes.length) host.appendChild(seg);
    }
    if (dropped) host.appendChild(E('div', { class: 'tc-more' }, '… ' + dropped + ' more lines'));
    return n;
  }
  function diffText(c) {
    const out = [];
    for (const h of diffHunks(c)) {
      for (const t of h.del) out.push('- ' + t);
      for (const t of h.add) out.push('+ ' + t);
    }
    return out.join('\n');
  }

  // ── Back-gesture plumbing for the stage-2 sheet (module-level: one sheet
  //    at a time). Opening pushes a history state; Android/iOS back pops it
  //    and we close the sheet instead of leaving the page. ──
  let sheetOwner = null;   // card handle whose sheet is open
  let pushedState = false;
  let popGuard = false;
  window.addEventListener('popstate', () => {
    if (popGuard) { popGuard = false; return; }
    if (pushedState && sheetOwner) { pushedState = false; sheetOwner._closeSheet(true); }
  });
  window.addEventListener('hashchange', () => {
    // User navigated tabs — never leave a payload sheet floating over them.
    if (sheetOwner) sheetOwner._closeSheet(true);
  });

  function create() {
    const calls = [];
    const byId = {};
    let stage = 0;          // 0 collapsed · 1 inline panel · 2 full sheet
    let follow = true;      // auto-track newest call (always true at stage 0)
    let shownCall = null;   // the call the face/panel displays
    let newCount = 0;       // calls landed while pinned
    let animating = false;  // a face swap is in flight
    let pendingCall = null; // newest call waiting for the current swap (coalesced)
    let sheetEl = null, sheetBody = null, sheetFace = null, sheetPill = null;
    let sheetReturnStage = 0;
    let dimEl = null;
    let tick = null;
    let collapseTimer = null;

    // DOM
    const root = E('div', { class: 'tc' });
    const slot = E('div', { class: 'tc-slot' });
    const head = E('div', { class: 'tc-head', role: 'button', tabindex: '0' });
    const faces = E('div', { class: 'tc-faces' });
    const countBtn = E('button', { class: 'tc-count', title: 'All steps' });
    const body = E('div', { class: 'tc-body' });
    const pill = E('button', { class: 'tc-newpill hidden' });
    head.appendChild(faces);
    head.appendChild(countBtn);
    slot.appendChild(head);
    slot.appendChild(body);
    root.appendChild(slot);
    root.appendChild(pill);
    let curFace = null;

    // ── Faces ──
    function faceEl(call) {
      const f = E('div', { class: 'tc-face' });
      f.innerHTML = window.icon(toolIcon(call.name), { size: 15 })
        + '<span class="tc-lbl"></span><span class="tc-dot"></span><span class="tc-time"></span>';
      f.querySelector('.tc-lbl').textContent = toolLabel(call.name, call.input);
      f._call = call;
      syncFace(f);
      return f;
    }
    function syncFace(f) {
      if (!f) return;
      const c = f._call;
      f.querySelector('.tc-dot').className = 'tc-dot ' + c.status;
      f.querySelector('.tc-time').textContent = elapsedText(c);
    }

    // The feed: swap the collapsed face to `call`. Never two swaps at once —
    // arrivals mid-swap overwrite `pendingCall` so we land on the newest.
    function setFace(call, animate) {
      shownCall = call;
      if (animating) { pendingCall = call; return; }
      const nf = faceEl(call);
      const of = curFace;
      faces.appendChild(nf);
      curFace = nf;
      if (!of) return;
      if (!animate) { of.remove(); return; }
      if (RM()) {
        // Reduced motion: cross-fade only, no travel.
        try { nf.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'backwards' }); } catch (e) {}
        of.remove();
        return;
      }
      animating = true;
      const ease = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
      let aIn, aOut;
      try {
        // Outgoing runs 0–230ms, incoming 50–280ms → ~180ms of overlap in a
        // ~280ms envelope: reads as a feed, not a swap.
        aIn = nf.animate([
          { transform: 'translateY(60%) scale(0.92)', opacity: 0 },
          { transform: 'translateY(0) scale(1)', opacity: 1 },
        ], { duration: 230, delay: 50, easing: ease, fill: 'backwards' });
        aOut = of.animate([
          { transform: 'translateY(0) scale(1)', opacity: 1 },
          { transform: 'translateY(-60%) scale(0.96)', opacity: 0 },
        ], { duration: 230, easing: ease, fill: 'forwards' });
      } catch (e) { animating = false; of.remove(); return; }
      Promise.allSettled([aIn.finished, aOut.finished]).then(() => {
        of.remove();
        animating = false;
        if (pendingCall && pendingCall !== curFace._call) {
          const c = pendingCall; pendingCall = null;
          setFace(c, true);
        } else pendingCall = null;
      });
    }

    // ── Timer ──
    function anyRunning() { return calls.some(c => c.status === 'running'); }
    function ensureTick() {
      if (tick || !anyRunning()) return;
      tick = setInterval(() => {
        if (!anyRunning()) { clearInterval(tick); tick = null; return; }
        if (document.hidden) return;
        syncFace(curFace);
        syncFace(sheetFace);
      }, 500);
    }
    function stopTickIfIdle() { if (tick && !anyRunning()) { clearInterval(tick); tick = null; } }

    // ── Badges / pills ──
    function syncCount() {
      countBtn.textContent = calls.length + (calls.length === 1 ? ' step' : ' steps');
    }
    function syncPill() {
      if (stage === 1 && !follow && newCount > 0) {
        pill.textContent = newCount + ' new';
        pill.classList.remove('hidden');
      } else pill.classList.add('hidden');
      if (sheetPill) {
        if (!follow && newCount > 0) {
          sheetPill.textContent = newCount + ' new — jump to latest';
          sheetPill.classList.remove('hidden');
        } else sheetPill.classList.add('hidden');
      }
    }

    // ── Stage-1 body ──
    function bodyContent(c) {
      const host = E('div', { class: 'tc-detail k-' + kindOf(c.name) });
      const kind = kindOf(c.name);
      if (kind === 'bash') {
        const cmd = E('div', { class: 'tc-cmd' });
        cmd.innerHTML = '<span class="ps">$</span><span class="t"></span>';
        cmd.querySelector('.t').textContent = String(c.input.command || '');
        host.appendChild(cmd);
        const out = E('pre', { class: 'tc-out' });
        out.textContent = c.result != null ? tail(c.result, 4000) : (c.status === 'running' ? 'Running…' : 'No output.');
        host.appendChild(out);
      } else if (kind === 'read') {
        host.appendChild(pathRow(c));
        const range = c.input.offset != null
          ? ('Lines ' + c.input.offset + (c.input.limit ? '–' + (Number(c.input.offset) + Number(c.input.limit)) : '+')) : null;
        if (range) host.appendChild(E('div', { class: 'tc-sub' }, range));
        const out = E('pre', { class: 'tc-out' });
        out.textContent = c.result != null ? firstLines(c.result, 40) : (c.status === 'running' ? 'Reading…' : '');
        host.appendChild(out);
      } else if (kind === 'edit' || kind === 'write') {
        host.appendChild(pathRow(c));
        const s = diffStats(c);
        const stats = E('div', { class: 'tc-stats' });
        if (s.add) stats.appendChild(E('span', { class: 'add' }, '+' + s.add));
        if (s.del) stats.appendChild(E('span', { class: 'del' }, '−' + s.del));
        if (!s.add && !s.del) stats.appendChild(E('span', { class: 'muted' }, 'no line changes'));
        host.appendChild(stats);
        const mini = E('div', { class: 'tc-diff' });
        renderDiff(mini, c, 14);
        host.appendChild(mini);
      } else {
        const pre = E('pre', { class: 'tc-out' });
        pre.textContent = trunc(JSON.stringify(c.input, null, 2), 2000);
        host.appendChild(E('div', { class: 'tc-sub' }, 'Input'));
        host.appendChild(pre);
        if (c.result != null) {
          host.appendChild(E('div', { class: 'tc-sub' }, 'Result'));
          const r = E('pre', { class: 'tc-out' });
          r.textContent = tail(c.result, 4000);
          host.appendChild(r);
        }
      }
      return host;
    }
    function pathRow(c) {
      const r = E('div', { class: 'tc-path' });
      r.textContent = callPath(c) || '(unknown file)';
      return r;
    }
    function tail(s, n) { s = String(s); return s.length > n ? '…' + s.slice(-n) : s; }
    function firstLines(s, n) {
      const lines = String(s).split('\n');
      return lines.slice(0, n).join('\n') + (lines.length > n ? '\n… ' + (lines.length - n) + ' more lines' : '');
    }
    function refreshBody() {
      if (stage !== 1 || !shownCall) return;
      const stick = kindOf(shownCall.name) === 'bash';
      body.innerHTML = '';
      body.appendChild(bodyContent(shownCall));
      if (stick) body.scrollTop = body.scrollHeight; // live tail follows output
    }

    // ── Stage transitions ──
    function slotTargetH() {
      return Math.min(Math.round(window.innerHeight * 0.4), 480);
    }
    function addDim() {
      const chat = root.closest('.chat');
      if (!chat || dimEl) return;
      dimEl = E('div', { class: 'tc-dim' });
      dimEl.addEventListener('click', () => collapse1());
      chat.appendChild(dimEl);
      requestAnimationFrame(() => { if (dimEl) dimEl.classList.add('on'); });
    }
    function removeDim() {
      if (!dimEl) return;
      const d = dimEl; dimEl = null;
      d.classList.remove('on');
      setTimeout(() => { try { d.remove(); } catch (e) {} }, 250);
    }
    function revealPanel(target) {
      const sc = root.closest('.chat-scroll');
      if (!sc) return;
      const r = root.getBoundingClientRect(), s = sc.getBoundingClientRect();
      const overflow = (r.top + target + 16) - (s.top + s.clientHeight);
      if (overflow > 0) {
        try { sc.scrollTo({ top: sc.scrollTop + overflow, behavior: RM() ? 'auto' : 'smooth' }); }
        catch (e) { sc.scrollTop += overflow; }
      }
    }
    function expand1() {
      if (stage !== 0 || !calls.length) return;
      closeOthers(handle);
      if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
      stage = 1;
      follow = false;
      newCount = 0;
      shownCall = curFace ? curFace._call : calls[calls.length - 1];
      // Measured height transition: explicit px → explicit px, never auto.
      const target = slotTargetH();
      root.classList.add('open1');
      slot.style.height = target + 'px';
      refreshBody();
      addDim();
      revealPanel(target);
      syncPill();
    }
    function collapse1() {
      if (stage !== 1) return;
      stage = 0;
      follow = true;
      newCount = 0;
      root.classList.remove('open1');
      slot.style.height = SLOT_H + 'px';
      removeDim();
      syncPill();
      // Land the face back on the newest call, then clear the panel DOM.
      const latest = calls[calls.length - 1];
      if (latest && curFace && curFace._call !== latest) setFace(latest, false);
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        if (stage === 0) { body.innerHTML = ''; slot.style.height = ''; }
      }, 320);
    }
    function jumpToLatest() {
      const latest = calls[calls.length - 1];
      if (!latest) return;
      follow = true;
      newCount = 0;
      shownCall = latest;
      if (curFace && curFace._call !== latest) setFace(latest, false);
      refreshBody();
      if (sheetEl) syncSheet();
      syncPill();
    }

    // ── Stage-2 sheet ──
    function copyTextFor(c) {
      const kind = kindOf(c.name);
      if (kind === 'bash') return c.result != null ? String(c.result) : String(c.input.command || '');
      if (kind === 'edit') return diffText(c);
      if (kind === 'write') return String(c.input.content || '');
      if (kind === 'read') return c.result != null ? String(c.result) : callPath(c);
      return JSON.stringify({ input: c.input, result: c.result }, null, 2);
    }
    function sheetContent(c) {
      const host = E('div', { class: 'tc-payload k-' + kindOf(c.name) });
      const kind = kindOf(c.name);
      if (kind === 'bash') {
        const cmd = E('div', { class: 'tc-cmd' });
        cmd.innerHTML = '<span class="ps">$</span><span class="t"></span>';
        cmd.querySelector('.t').textContent = String(c.input.command || '');
        host.appendChild(cmd);
        const out = E('pre', { class: 'tc-scrollback' });
        out.textContent = c.result != null ? String(c.result) : (c.status === 'running' ? 'Running…' : 'No output.');
        host.appendChild(out);
      } else if (kind === 'read') {
        host.appendChild(pathRow(c));
        const out = E('pre', { class: 'tc-scrollback' });
        out.textContent = c.result != null ? String(c.result) : (c.status === 'running' ? 'Reading…' : '');
        host.appendChild(out);
      } else if (kind === 'edit' || kind === 'write') {
        host.appendChild(pathRow(c));
        const s = diffStats(c);
        const stats = E('div', { class: 'tc-stats' });
        if (s.add) stats.appendChild(E('span', { class: 'add' }, '+' + s.add));
        if (s.del) stats.appendChild(E('span', { class: 'del' }, '−' + s.del));
        host.appendChild(stats);
        const diff = E('div', { class: 'tc-diff full' });
        renderDiff(diff, c, 2000);
        host.appendChild(diff);
      } else {
        host.appendChild(E('div', { class: 'tc-sub' }, 'Input'));
        const i = E('pre', { class: 'tc-scrollback' });
        i.textContent = JSON.stringify(c.input, null, 2);
        host.appendChild(i);
        if (c.result != null) {
          host.appendChild(E('div', { class: 'tc-sub' }, 'Result'));
          const r = E('pre', { class: 'tc-scrollback' });
          r.textContent = String(c.result);
          host.appendChild(r);
        }
      }
      return host;
    }
    function syncSheet() {
      if (!sheetEl || !shownCall) return;
      const nf = faceEl(shownCall);
      sheetFace.replaceWith(nf);
      sheetFace = nf;
      const stick = kindOf(shownCall.name) === 'bash';
      sheetBody.innerHTML = '';
      sheetBody.appendChild(sheetContent(shownCall));
      if (stick) sheetBody.scrollTop = sheetBody.scrollHeight;
    }
    function onSheetKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); handle._closeSheet(false); }
    }
    function openSheet(call, returnStage) {
      if (sheetOwner && sheetOwner !== handle) sheetOwner._closeSheet(true);
      closeOthers(handle);
      sheetReturnStage = returnStage;
      stage = 2;
      shownCall = call;
      if (!sheetEl) {
        sheetEl = E('div', { class: 'tc-sheet' });
        const shead = E('div', { class: 'tc-sheet-head', role: 'button', tabindex: '0' });
        shead.appendChild(E('div', { class: 'grab' }));
        const srow = E('div', { class: 'tc-sheet-row' });
        sheetFace = faceEl(call);
        srow.appendChild(sheetFace);
        const copyBtn = E('button', { class: 'btn ghost icon', title: 'Copy' });
        copyBtn.innerHTML = window.icon('copy', { size: 16 });
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.copyToClipboard(copyTextFor(shownCall));
          window.toast && window.toast.success('Copied');
        });
        const closeBtn = E('button', { class: 'btn ghost icon', title: 'Close' });
        closeBtn.innerHTML = window.icon('chevron-down', { size: 18 });
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); handle._closeSheet(false); });
        srow.appendChild(copyBtn);
        srow.appendChild(closeBtn);
        shead.appendChild(srow);
        // Tap header or swipe down → back one stage.
        shead.addEventListener('click', () => handle._closeSheet(false));
        attachSwipe(shead, {
          down: () => handle._closeSheet(false),
        });
        sheetBody = E('div', { class: 'tc-sheet-body' });
        sheetPill = E('button', { class: 'tc-newpill sheet hidden' });
        sheetPill.addEventListener('click', (e) => { e.stopPropagation(); jumpToLatest(); });
        sheetEl.appendChild(shead);
        sheetEl.appendChild(sheetPill);
        sheetEl.appendChild(sheetBody);
        document.body.appendChild(sheetEl);
        document.addEventListener('keydown', onSheetKey, true);
        if (RM()) sheetEl.classList.add('rm');
        requestAnimationFrame(() => { if (sheetEl) sheetEl.classList.add('on'); });
        sheetOwner = handle;
        try { history.pushState({ tcSheet: true }, ''); pushedState = true; } catch (e) {}
      }
      syncSheet();
      syncPill();
    }
    function closeSheet(silent) {
      if (!sheetEl) return;
      const s = sheetEl;
      sheetEl = null; sheetBody = null; sheetFace = null; sheetPill = null;
      document.removeEventListener('keydown', onSheetKey, true);
      s.classList.remove('on');
      setTimeout(() => { try { s.remove(); } catch (e) {} }, RM() ? 0 : 300);
      if (sheetOwner === handle) sheetOwner = null;
      if (pushedState && !silent) { popGuard = true; pushedState = false; try { history.back(); } catch (e) {} }
      else pushedState = false;
      // Reverse one stage at a time: sheet → inline panel (unless the sheet
      // was opened straight from the history list on a collapsed card).
      stage = sheetReturnStage;
      if (stage === 1) { refreshBody(); syncPill(); }
      else { stage = 0; follow = true; newCount = 0; const l = calls[calls.length - 1]; if (l && curFace && curFace._call !== l) setFace(l, false); syncPill(); }
    }

    // ── History list (step-counter badge) ──
    function showHistory() {
      if (!window.sheet) return;
      const bodyEl = E('div');
      calls.forEach((c, i) => {
        const row = E('div', { class: 'tc-hist' });
        row.innerHTML = '<span class="n"></span>' + window.icon(toolIcon(c.name), { size: 15 })
          + '<span class="lbl"></span><span class="tc-dot ' + c.status + '"></span><span class="tc-time"></span>';
        row.querySelector('.n').textContent = String(i + 1);
        row.querySelector('.lbl').textContent = toolLabel(c.name, c.input);
        row.querySelector('.tc-time').textContent = elapsedText(c);
        row.addEventListener('click', () => {
          window.sheet.close();
          follow = false;
          openSheet(c, stage === 2 ? sheetReturnStage : stage);
        });
        bodyEl.appendChild(row);
      });
      window.sheet.open({ title: calls.length + (calls.length === 1 ? ' step' : ' steps'), content: bodyEl });
    }

    // ── Gestures ──
    function attachSwipe(target, { up, down }) {
      let y0 = null, x0 = null;
      target.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { y0 = null; return; }
        y0 = e.touches[0].clientY; x0 = e.touches[0].clientX;
      }, { passive: true });
      target.addEventListener('touchend', (e) => {
        if (y0 == null || !e.changedTouches.length) return;
        const dy = e.changedTouches[0].clientY - y0;
        const dx = Math.abs(e.changedTouches[0].clientX - x0);
        y0 = null;
        if (dx > 60) return; // mostly-horizontal — ignore
        if (dy > 50 && down) down();
        else if (dy < -50 && up) up();
      }, { passive: true });
    }

    // ── Wiring ──
    countBtn.addEventListener('click', (e) => { e.stopPropagation(); showHistory(); });
    pill.addEventListener('click', (e) => { e.stopPropagation(); jumpToLatest(); });
    head.addEventListener('click', () => { if (stage === 0) expand1(); else if (stage === 1) collapse1(); });
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (stage === 0) expand1(); else if (stage === 1) collapse1(); }
    });
    attachSwipe(head, {
      down: () => { if (stage === 1) collapse1(); },
      up: () => { if (stage === 1) openSheet(shownCall, 1); },
    });
    // Tap the open panel's content → full-screen payload.
    body.addEventListener('click', () => { if (stage === 1 && shownCall) openSheet(shownCall, 1); });

    // ── Public API ──
    const handle = {
      el: root,
      get count() { return calls.length; },
      addCall(id, name, input, live) {
        const call = {
          id: id || ('t' + calls.length), name: String(name || ''), input: input || {},
          status: live ? 'running' : 'done',
          t0: live ? Date.now() : null, t1: null,
          result: null,
        };
        calls.push(call);
        if (id) byId[id] = call;
        syncCount();
        if (follow) {
          if (stage === 0) setFace(call, calls.length > 1 && !!live);
          else { shownCall = call; if (stage === 1) { syncFace(curFace); setFace(call, false); refreshBody(); } if (stage === 2) syncSheet(); }
        } else { newCount++; syncPill(); }
        ensureTick();
      },
      addResult(id, text, isError) {
        let call = id ? byId[id] : null;
        if (!call) { for (let i = calls.length - 1; i >= 0; i--) if (calls[i].result == null) { call = calls[i]; break; } }
        if (!call) return;
        call.result = String(text == null ? '' : text).slice(0, MAX_RESULT);
        if (call.status === 'running') call.t1 = Date.now();
        call.status = (isError || /^<tool_use_error>/.test(call.result)) ? 'failed' : (call.status === 'running' ? 'done' : call.status);
        if (curFace && curFace._call === call) syncFace(curFace);
        if (sheetFace && sheetFace._call === call) syncFace(sheetFace);
        if (stage === 1 && shownCall === call) refreshBody();
        if (stage === 2 && shownCall === call) syncSheet();
        stopTickIfIdle();
      },
      settle(failed) {
        for (const c of calls) {
          if (c.status !== 'running') continue;
          c.status = failed ? 'failed' : 'done';
          c.t1 = c.t1 || Date.now();
        }
        syncFace(curFace);
        syncFace(sheetFace);
        stopTickIfIdle();
      },
      _closeSheet: closeSheet,
      _collapseAll() {
        if (sheetEl) closeSheet(true);
        if (stage === 1) collapse1();
        removeDim();
      },
      _destroy() {
        this._collapseAll();
        if (tick) { clearInterval(tick); tick = null; }
        if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
        cards.delete(handle);
      },
    };
    cards.add(handle);
    return handle;
  }

  function closeOthers(except) {
    for (const c of cards) if (c !== except) c._collapseAll();
  }
  function closeAll() {
    for (const c of Array.from(cards)) c._destroy();
  }

  window.ToolCard = { create, closeAll };
})();
