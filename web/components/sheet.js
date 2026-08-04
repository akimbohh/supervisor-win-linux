// Bottom sheet (mobile-friendly drawer from the bottom).
// Usage: window.sheet.open({ title, content, onClose })

(function () {
  let current = null;
  function close() {
    if (!current) return;
    const { backdrop, sheet, onClose } = current;
    current = null;
    sheet.style.transition = 'transform 200ms';
    sheet.style.transform = 'translateY(100%)';
    backdrop.style.transition = 'opacity 200ms';
    backdrop.style.opacity = '0';
    setTimeout(() => { try { backdrop.remove(); sheet.remove(); } catch (e) {} }, 200);
    document.removeEventListener('keydown', onKey);
    if (typeof onClose === 'function') try { onClose(); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open({ title = '', content, onClose = null }) {
    if (current) close();
    const backdrop = document.createElement('div'); backdrop.className = 'sheet-backdrop';
    backdrop.addEventListener('click', close);
    const sheet = document.createElement('div'); sheet.className = 'sheet';
    const grab = document.createElement('div'); grab.className = 'grab'; sheet.appendChild(grab);
    if (title) {
      const h = document.createElement('div');
      h.style.padding = '0 16px 8px'; h.style.fontWeight = '600'; h.style.fontSize = '14px';
      h.textContent = title; sheet.appendChild(h);
    }
    const body = document.createElement('div');
    body.style.padding = '8px 16px 16px'; body.style.overflow = 'auto'; body.style.flex = '1 1 auto'; body.style.minHeight = '0'; body.style.overscrollBehavior = 'contain';
    if (content instanceof Node) body.appendChild(content);
    else if (typeof content === 'string') body.innerHTML = content;
    sheet.appendChild(body);
    document.getElementById('sheet-root').appendChild(backdrop);
    document.getElementById('sheet-root').appendChild(sheet);
    document.addEventListener('keydown', onKey);
    current = { backdrop, sheet, body, onClose };
    return { el: sheet, body, close };
  }
  window.sheet = { open, close, get current() { return current; } };
})();
