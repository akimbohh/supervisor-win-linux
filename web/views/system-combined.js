// System tab — the full System dashboard with the full Processes table below
// it, in one scrolling page. Both underlying views are mounted unchanged so
// every metric and control from the two former tabs survives; this file only
// stacks and sections them.
window.SystemCombinedView = async function (root, { rest, app }) {
  const el = window.el;
  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-3' });
  root.appendChild(wrap);

  const sysHost = el('div', { class: 'col gap-3' });
  const procTitle = el('div', { class: 'section-title', style: { marginTop: '8px' } }, 'Processes');
  const procHost = el('div', { class: 'col gap-3' });
  wrap.appendChild(sysHost);
  wrap.appendChild(procTitle);
  wrap.appendChild(procHost);

  // The System card's "Open Processes →" link now points at the table below;
  // delegate because SystemView re-renders its cards on every live tick.
  sysHost.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href="#processes"]');
    if (!a) return;
    e.preventDefault();
    procTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const sys = await window.SystemView(sysHost, { rest, app });
  const proc = await window.ProcessesView(procHost, { rest, app });

  return {
    destroy() {
      try { if (sys && sys.destroy) sys.destroy(); } catch (e) {}
      try { if (proc && proc.destroy) proc.destroy(); } catch (e) {}
    },
  };
};
