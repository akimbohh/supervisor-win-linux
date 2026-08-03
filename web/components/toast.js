// Lightweight toast system.
// Usage: window.toast.success('Saved') / .error('Oops') / .info('Heads up') / .show({ kind, title, body })

(function () {
  let root = null;
  function ensureRoot() { if (!root) root = document.getElementById('toasts'); return root; }

  const ICONS = {
    success: 'check',
    error: 'alert',
    info: 'info',
    warn: 'warning',
  };

  function make(opts) {
    const r = ensureRoot();
    const kind = opts.kind || 'info';
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    const ic = document.createElement('div');
    ic.innerHTML = window.icon(ICONS[kind] || 'info', { size: 16 });
    const body = document.createElement('div');
    body.style.flex = '1';
    body.style.minWidth = '0';
    if (opts.title) {
      const h = document.createElement('div');
      h.style.fontWeight = '600'; h.textContent = opts.title;
      body.appendChild(h);
    }
    if (opts.body) {
      const b = document.createElement('div');
      b.style.color = 'var(--text-2)'; b.style.fontSize = '12px'; b.textContent = opts.body;
      body.appendChild(b);
    }
    if (!opts.title && !opts.body && opts.text) body.textContent = opts.text;

    const close = document.createElement('div');
    close.className = 'close';
    close.innerHTML = window.icon('x', { size: 14 });
    close.addEventListener('click', () => dismiss());

    t.appendChild(ic); t.appendChild(body); t.appendChild(close);
    r.appendChild(t);

    let timer = null;
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      t.style.transition = 'opacity 200ms, transform 200ms';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 200);
    }
    if (opts.duration !== 0) {
      timer = setTimeout(dismiss, opts.duration || 3500);
    }
    return { el: t, dismiss };
  }

  window.toast = {
    show: make,
    success: (text, opts = {}) => make({ kind: 'success', text, ...opts }),
    error: (text, opts = {}) => make({ kind: 'error', text, duration: 6000, ...opts }),
    info: (text, opts = {}) => make({ kind: 'info', text, ...opts }),
    warn: (text, opts = {}) => make({ kind: 'warn', text, ...opts }),
  };
})();
