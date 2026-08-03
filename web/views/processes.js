// Processes view — system-wide process list, filter/sort, kill.
window.ProcessesView = async function (root, { app }) {
  let procs = [];
  let filter = '';
  let sortKey = 'cpu';   // 'cpu' | 'mem' | 'name' | 'pid'
  let sortDir = 'desc';
  let loading = false;

  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-3' });
  root.appendChild(wrap);

  const tools = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });
  const search = el('input', { class: 'input', placeholder: 'Filter by name or PID…', style: { flex: '1 1 240px' } });
  search.addEventListener('input', window.debounce(() => { filter = search.value; render(); }, 80));
  tools.appendChild(search);

  const refresh = el('button', { class: 'btn ghost icon', title: 'Refresh' });
  refresh.innerHTML = window.icon('refresh');
  refresh.addEventListener('click', () => load(true));
  tools.appendChild(refresh);
  wrap.appendChild(tools);

  const meta = el('div', { class: 'muted text-sm tabular' }, '');
  wrap.appendChild(meta);

  const tbl = el('div', { class: 'card', style: { overflow: 'hidden' } });
  wrap.appendChild(tbl);

  function header(label, key) {
    const h = el('div', { style: { padding: '8px 12px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' } });
    h.appendChild(el('span', null, label));
    if (sortKey === key) h.appendChild(el('span', { class: 'muted text-sm' }, sortDir === 'asc' ? '↑' : '↓'));
    h.addEventListener('click', () => {
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = (key === 'name' || key === 'pid') ? 'asc' : 'desc'; }
      render();
    });
    return h;
  }

  function render() {
    tbl.innerHTML = '';
    const grid = { display: 'grid', gridTemplateColumns: '90px 1fr 90px 100px 80px', alignItems: 'center', borderBottom: '1px solid var(--border-soft)' };

    const head = el('div', { style: { ...grid, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: '500', color: 'var(--text-2)' } });
    head.appendChild(header('PID', 'pid'));
    head.appendChild(header('Name', 'name'));
    head.appendChild(header('CPU', 'cpu'));
    head.appendChild(header('Memory', 'mem'));
    head.appendChild(el('span', { style: { textAlign: 'right', padding: '8px 12px' } }, ''));
    tbl.appendChild(head);

    let visible = procs.slice();
    if (filter) {
      const f = filter.toLowerCase();
      visible = visible.filter(p => (p.name || '').toLowerCase().includes(f) || String(p.pid).includes(f));
    }
    visible.sort((a, b) => {
      const av = a[sortKey] || 0, bv = b[sortKey] || 0;
      if (typeof av === 'string' || typeof bv === 'string') {
        const r = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? r : -r;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    if (loading && !visible.length) {
      tbl.appendChild(window.skeleton(8)); return;
    }
    if (!visible.length) {
      tbl.appendChild(window.emptyState({ icon: 'layers', title: 'No matches', body: filter ? 'No processes match "' + filter + '".' : 'No processes reported.' }));
      return;
    }

    meta.textContent = visible.length + ' / ' + procs.length + ' processes';

    // Show first 200 to keep DOM small
    for (const p of visible.slice(0, 200)) {
      const row = el('div', { style: grid });
      row.appendChild(el('div', { class: 'tabular muted text-sm', style: { padding: '8px 12px' } }, String(p.pid)));
      row.appendChild(el('div', { class: 'truncate', style: { padding: '8px 12px' }, title: p.path || p.name }, p.name));
      row.appendChild(el('div', { class: 'tabular text-sm', style: { padding: '8px 12px' } }, p.cpu != null ? p.cpu.toFixed(1) : '—'));
      row.appendChild(el('div', { class: 'tabular text-sm', style: { padding: '8px 12px' } }, window.fmtBytes(p.mem || 0)));
      const k = el('button', { class: 'btn sm ghost danger', style: { margin: '4px 12px', justifySelf: 'end' } });
      k.innerHTML = window.icon('x', { size: 12 }) + ' Kill';
      k.addEventListener('click', async () => {
        if (!await window.confirmModal({ title: 'Kill ' + p.name + '?', body: 'PID ' + p.pid + ' — this is irreversible.', danger: true, confirmText: 'Kill' })) return;
        try { await window.api('/api/processes/' + p.pid + '/kill', { method: 'POST' }); window.toast.success('Killed ' + p.name); load(true); }
        catch (e) { window.toast.error(e.message); }
      });
      row.appendChild(k);
      tbl.appendChild(row);
    }
    if (visible.length > 200) tbl.appendChild(el('div', { class: 'muted text-sm', style: { padding: '10px 12px', textAlign: 'center' } }, 'Showing first 200 of ' + visible.length + ' — narrow with filter.'));
  }

  async function load(force) {
    loading = true;
    if (!procs.length) render();
    try {
      const r = await window.api('/api/processes');
      procs = r.procs || [];
      loading = false;
      render();
    } catch (e) {
      loading = false;
      tbl.innerHTML = '';
      tbl.appendChild(window.emptyState({ icon: 'alert', title: 'Cannot read processes', body: e.message }));
    }
  }

  // Render the skeleton synchronously so the tab swap is instant; fetch async.
  render();
  load();
  // Auto-refresh every 8 s. Process listing is expensive on Windows
  // (PowerShell spawn) so keeping it slow is intentional — pull-to-refresh /
  // the refresh button cover the "I want it now" case.
  const tick = setInterval(load, 8000);
  return { destroy() { clearInterval(tick); } };
};
