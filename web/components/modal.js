// Stack-aware modal dialog. Multiple modals can be open at once; close()
// always closes the topmost. onClose fires whenever a modal closes.
//
// To race-proof callers (e.g. promise-returning helpers), use an idempotent
// "settle" pattern in your callbacks — onClose may fire even when an action
// handler also resolves your promise.

(function () {
  const stack = [];   // [{ backdrop, modal, body, onClose, dismissible }]

  function topmost() { return stack[stack.length - 1] || null; }

  function popTop() {
    const m = stack.pop();
    if (!m) return null;
    m.backdrop.style.transition = 'opacity 150ms';
    m.backdrop.style.opacity = '0';
    setTimeout(() => { try { m.backdrop.remove(); } catch (e) {} }, 150);
    if (!stack.length) document.removeEventListener('keydown', onKey);
    if (typeof m.onClose === 'function') {
      try { m.onClose(); } catch (e) {}
    }
    return m;
  }

  function close() {
    if (!stack.length) return;
    popTop();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    const t = topmost();
    if (t && t.dismissible) close();
  }

  function open({ title = '', content, actions = [], onClose = null, size = 'md', dismissible = true } = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = String(50 + stack.length * 2);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop && dismissible) close(); });

    const m = document.createElement('div');
    m.className = 'modal';
    if (size === 'lg') m.style.width = 'min(800px, 100%)';
    if (size === 'xl') m.style.width = 'min(1100px, 100%)';

    const head = document.createElement('div');
    head.className = 'modal-header';
    const h = document.createElement('h2');
    h.textContent = title;
    head.appendChild(h);
    if (dismissible) {
      const x = document.createElement('button');
      x.className = 'btn ghost icon';
      x.style.marginLeft = 'auto';
      x.innerHTML = window.icon('x', { size: 18 });
      x.addEventListener('click', close);
      head.appendChild(x);
    }
    m.appendChild(head);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (content instanceof Node) body.appendChild(content);
    else if (typeof content === 'string') body.innerHTML = content;
    m.appendChild(body);

    const entry = { backdrop, modal: m, body, onClose, dismissible };

    if (actions && actions.length) {
      const foot = document.createElement('div');
      foot.className = 'modal-footer';
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.kind || '');
        b.textContent = a.label;
        if (a.disabled) b.disabled = true;
        b.addEventListener('click', () => {
          try { a.onClick && a.onClick(); } catch (e) { console.error(e); }
        });
        foot.appendChild(b);
      }
      m.appendChild(foot);
    }

    backdrop.appendChild(m);
    document.getElementById('modal-root').appendChild(backdrop);
    if (!stack.length) document.addEventListener('keydown', onKey);
    stack.push(entry);

    return {
      el: m,
      body,
      close() {
        // Close THIS specific modal — pops everything above it first.
        const idx = stack.indexOf(entry);
        if (idx === -1) return;
        while (stack.length > idx + 1) popTop();
        popTop();
      },
    };
  }

  window.modal = { open, close, get current() { return topmost(); } };
})();
