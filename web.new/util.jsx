/* DOM/HTTP utilities — ported from web/components/util.js.
 * Exposed as globals (window.fmtBytes, window.api, window.confirmModal, etc.)
 * so imperative helpers (modal, toast, view code) can call them.
 *
 * Lives in a .jsx file purely so Babel-standalone picks it up alongside the
 * rest of the app; the contents are plain JS.
 */

(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class' || k === 'className') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) e.setAttribute(k, '');
        else if (v === false || v === null || v === undefined) {/* skip */}
        else e.setAttribute(k, v);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null || c === false) continue;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c instanceof Node) e.appendChild(c);
      }
    }
    return e;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return n + ' B';
    const u = ['KB','MB','GB','TB','PB']; let i = -1; let v = n;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)) + ' ' + u[i];
  }

  function fmtDur(ms) {
    if (ms == null) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    if (s < 86400) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h + 'h ' + m + 'm'; }
    const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); return d + 'd ' + h + 'h';
  }

  function fmtRelative(when) {
    if (!when) return '';
    const t = typeof when === 'string' ? Date.parse(when) : when;
    const diff = Date.now() - t;
    if (diff < 5_000) return 'just now';
    if (diff < 60_000) return Math.floor(diff / 1000) + 's ago';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
    if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  function fmtAbs(when) {
    if (!when) return '';
    const t = typeof when === 'string' ? Date.parse(when) : when;
    return new Date(t).toLocaleString();
  }

  async function api(path, opts = {}) {
    const init = { headers: {}, credentials: 'same-origin', ...opts };
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const r = await fetch(path, init);
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
      throw new Error('Unauthorized');
    }
    let body;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) body = await r.json();
    else body = await r.text();
    if (!r.ok) {
      const msg = (body && body.error) || ('HTTP ' + r.status);
      const err = new Error(msg); err.status = r.status; err.body = body; throw err;
    }
    return body;
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function throttle(fn, ms) {
    let last = 0; let queued = null;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(this, args); }
      else {
        clearTimeout(queued);
        queued = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, ms - (now - last));
      }
    };
  }

  function vibrate(pattern) {
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {}
  }

  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    } catch (e) {}
    return new Promise((resolve, reject) => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.left = '-9999px';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
      finally { document.body.removeChild(t); }
    });
  }

  /* Path helpers — handle both / and \ separators; defensive against non-string. */
  function basename(p) {
    if (p == null || typeof p !== 'string') return '';
    return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  }
  function dirname(p) {
    if (p == null || typeof p !== 'string') return '';
    p = p.replace(/[\\/]+$/, '');
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (i <= 0) return p.startsWith('/') ? '/' : (p.length === 2 && p.endsWith(':') ? p + (p[0] === p[0].toUpperCase() ? '\\' : '/') : '');
    return p.slice(0, i) || (p[0] === '/' ? '/' : '');
  }
  function joinPath(a, b) {
    if (a == null || a === '') return typeof b === 'string' ? b : '';
    if (typeof a !== 'string') return typeof b === 'string' ? b : '';
    const sep = a.includes('\\') ? '\\' : '/';
    return a.replace(/[\\/]+$/, '') + sep + (typeof b === 'string' ? b : '');
  }

  function getExt(name) {
    if (!name) return '';
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return '';
    return name.slice(i + 1).toLowerCase();
  }

  function fileKind(name) {
    const e = getExt(name);
    if (['png','jpg','jpeg','gif','webp','avif','svg','bmp','ico'].includes(e)) return 'image';
    if (['mp3','wav','ogg','flac','m4a','aac'].includes(e)) return 'audio';
    if (['mp4','webm','mov','mkv','avi','m4v'].includes(e)) return 'video';
    if (['pdf'].includes(e)) return 'pdf';
    if (['zip'].includes(e)) return 'archive';
    if (['md','markdown'].includes(e)) return 'markdown';
    if (['html','htm','xml','svg','xhtml','json','jsonc','yaml','yml','toml','ini','cfg','conf','log','txt','sh','bash','zsh','fish','ps1','bat','cmd','env','gitignore','dockerfile','makefile'].includes(e)) return 'text';
    if (['js','jsx','ts','tsx','mjs','cjs','vue','svelte','astro'].includes(e)) return 'text';
    if (['py','pyw','rb','php','go','rs','java','kt','scala','c','cc','cpp','cxx','h','hpp','hh','m','mm','swift','cs','dart','lua','sql','nim','zig','ex','exs','elm','clj','cljs','hs','ml','mli','r','jl','f','f90','perl','pl','pm','tex','vim','el','lisp'].includes(e)) return 'text';
    return 'binary';
  }

  function modeForExt(ext) {
    const m = (ext || '').toLowerCase();
    return ({
      js:'javascript', jsx:'javascript', mjs:'javascript', cjs:'javascript', ts:'javascript', tsx:'javascript',
      json:'application/json', jsonc:'application/json',
      html:'htmlmixed', htm:'htmlmixed', xml:'xml', svg:'xml', xhtml:'htmlmixed',
      css:'css', scss:'css', sass:'css', less:'css',
      md:'markdown', markdown:'markdown', txt:'null',
      py:'python', pyw:'python',
      rs:'rust', go:'go', java:'text/x-java', c:'text/x-csrc', h:'text/x-csrc', cpp:'text/x-c++src', cc:'text/x-c++src', hpp:'text/x-c++src', cs:'text/x-csharp',
      sh:'shell', bash:'shell', zsh:'shell', ps1:'shell', bat:'shell', cmd:'shell',
      yml:'yaml', yaml:'yaml',
      sql:'sql',
    })[m] || 'null';
  }

  function emptyState({ icon: ic, title, body, action }) {
    const root = el('div', { class: 'empty' });
    if (ic) { const wrap = el('div'); wrap.innerHTML = window.icon(ic, { size: 36 }); root.appendChild(wrap); }
    if (title) root.appendChild(el('h3', null, title));
    if (body) {
      const p = el('p', null);
      p.style.whiteSpace = 'pre-wrap';
      p.style.fontFamily = String(body).includes('\n') ? 'var(--mono)' : '';
      p.style.fontSize = String(body).includes('\n') ? '11px' : '';
      p.style.textAlign = String(body).includes('\n') ? 'left' : '';
      p.style.maxWidth = '480px';
      p.textContent = body;
      root.appendChild(p);
    }
    if (action) root.appendChild(action);
    return root;
  }

  function skeleton(rows = 6) {
    const root = el('div', { class: 'col gap-2' });
    for (let i = 0; i < rows; i++) {
      root.appendChild(el('div', { class: 'sk', style: { height: '36px', borderRadius: '8px' } }));
    }
    return root;
  }

  /* Idempotent settle pattern races: action handler and onClose can both fire. */
  async function confirm({ title = 'Are you sure?', body = '', danger = false, confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };
      const handle = window.modal.open({
        title,
        content: typeof body === 'string' ? el('div', null, body) : body,
        actions: [
          { label: cancelText, kind: 'ghost', onClick: () => { settle(false); handle.close(); } },
          { label: confirmText, kind: danger ? 'danger primary' : 'primary', onClick: () => { settle(true); handle.close(); } },
        ],
        onClose: () => settle(false),
      });
    });
  }

  async function prompt({ title = 'Enter value', label = '', initial = '', placeholder = '', confirmText = 'OK', type = 'text' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };
      const inputWrap = el('div', { class: 'input' });
      const inputNode = el('input', { value: initial, placeholder, type });
      inputWrap.appendChild(inputNode);
      setTimeout(() => { inputNode.focus(); inputNode.select && inputNode.select(); }, 50);
      const field = el('div', { class: 'field col gap-2' }, [
        label ? el('label', null, label) : null,
        inputWrap,
      ]);
      let handle = null;
      const submit = () => { const v = inputNode.value; settle(v); handle && handle.close(); };
      inputNode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { settle(null); handle && handle.close(); }
      });
      handle = window.modal.open({
        title,
        content: field,
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: () => { settle(null); handle.close(); } },
          { label: confirmText, kind: 'primary', onClick: submit },
        ],
        onClose: () => settle(null),
      });
    });
  }

  /* 500ms hold without movement; 8px movement cancels; vibrates 20ms on fire. */
  function attachLongPress(elNode, onLongPress) {
    let timer = null; let startX = 0, startY = 0;
    function start(e) {
      const t = e.touches ? e.touches[0] : e;
      startX = t.clientX; startY = t.clientY;
      timer = setTimeout(() => { vibrate(20); onLongPress(e); }, 500);
    }
    function move(e) {
      const t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) clear();
    }
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    elNode.addEventListener('touchstart', start, { passive: true });
    elNode.addEventListener('touchmove', move, { passive: true });
    elNode.addEventListener('touchend', clear);
    elNode.addEventListener('touchcancel', clear);
    elNode.addEventListener('mousedown', start);
    elNode.addEventListener('mousemove', move);
    elNode.addEventListener('mouseup', clear);
    elNode.addEventListener('mouseleave', clear);
    return () => {
      elNode.removeEventListener('touchstart', start);
      elNode.removeEventListener('touchmove', move);
      elNode.removeEventListener('touchend', clear);
      elNode.removeEventListener('touchcancel', clear);
      elNode.removeEventListener('mousedown', start);
      elNode.removeEventListener('mousemove', move);
      elNode.removeEventListener('mouseup', clear);
      elNode.removeEventListener('mouseleave', clear);
    };
  }

  function attachPullToRefresh(scroller, onRefresh) {
    let startY = 0; let pulling = false; let dist = 0;
    const indicator = el('div', { class: 'row', style: { justifyContent:'center', height:'0px', overflow:'hidden', transition:'height 150ms', color:'var(--text-3)', fontSize:'12px' } }, '↓ Pull to refresh');
    scroller.prepend(indicator);
    function s(e) { if (scroller.scrollTop > 0) return; startY = e.touches[0].clientY; pulling = true; }
    function m(e) {
      if (!pulling) return;
      dist = Math.max(0, e.touches[0].clientY - startY);
      if (dist > 0) e.preventDefault();
      indicator.style.height = Math.min(dist / 1.5, 60) + 'px';
      indicator.textContent = dist > 80 ? '↑ Release to refresh' : '↓ Pull to refresh';
    }
    async function en() {
      if (!pulling) return; pulling = false;
      if (dist > 80) {
        indicator.textContent = 'Refreshing…';
        try { await onRefresh(); } finally { indicator.style.height = '0px'; }
      } else {
        indicator.style.height = '0px';
      }
      dist = 0;
    }
    scroller.addEventListener('touchstart', s, { passive: true });
    scroller.addEventListener('touchmove', m, { passive: false });
    scroller.addEventListener('touchend', en);
  }

  /* Tiny SVG sparkline. Fill area + stroke line. */
  function sparkline(values, opts = {}) {
    const w = opts.width || 180;
    const h = opts.height || 32;
    const xmlns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(xmlns, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    const v = (values || []).filter(n => typeof n === 'number' && !isNaN(n));
    if (!v.length) return svg;
    const max = opts.max != null ? opts.max : Math.max(...v, 1);
    const min = opts.min != null ? opts.min : Math.min(...v, 0);
    const span = Math.max(max - min, 0.0001);
    const n = v.length;
    function pt(i, val) {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = h - ((val - min) / span) * (h - 2) - 1;
      return [x, y];
    }
    let line = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, v[i]);
      line += (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    }
    const area = line + 'L ' + w + ' ' + h + ' L 0 ' + h + ' Z';
    const a = document.createElementNS(xmlns, 'path');
    a.setAttribute('class', 'area'); a.setAttribute('d', area);
    const l = document.createElementNS(xmlns, 'path');
    l.setAttribute('class', 'line'); l.setAttribute('d', line);
    svg.appendChild(a); svg.appendChild(l);
    return svg;
  }

  window.$ = $; window.$$ = $$; window.el = el;
  window.escapeHtml = escapeHtml;
  window.fmtBytes = fmtBytes;
  window.fmtDur = fmtDur;
  window.fmtRelative = fmtRelative;
  window.fmtAbs = fmtAbs;
  window.api = api;
  window.debounce = debounce;
  window.throttle = throttle;
  window.vibrate = vibrate;
  window.copyToClipboard = copyToClipboard;
  window.basename = basename;
  window.dirname = dirname;
  window.joinPath = joinPath;
  window.getExt = getExt;
  window.fileKind = fileKind;
  window.modeForExt = modeForExt;
  window.emptyState = emptyState;
  window.skeleton = skeleton;
  window.confirmModal = confirm;
  window.promptModal = prompt;
  window.attachLongPress = attachLongPress;
  window.attachPullToRefresh = attachPullToRefresh;
  window.sparkline = sparkline;
  console.info('[supervisor] util loaded');
})();
