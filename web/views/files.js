// Files view — full file manager.
window.FilesView = async function (root, { rest, app }) {
  // ── Local state ──
  let cwd = decodeURIComponent((rest && rest.join('/')) || '');
  let items = [];
  let filter = '';
  let sortKey = 'name';   // 'name' | 'size' | 'mtime' | 'type'
  let sortDir = 'asc';    // 'asc' | 'desc'
  let viewMode = localStorage.getItem('files.viewMode') || 'list';
  let selected = new Set();
  let selectMode = false;
  let watching = null;
  let unsub = null;
  let locations = { quick: [], recent: [] };
  let selectedPath = null;
  let clipboard = null;   // { mode: 'copy'|'cut', paths: [...] }

  // ── Layout ──
  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-3', style: { height: '100%', minHeight: '0' } });

  // Top: breadcrumb row + actions
  const topBar = el('div', { class: 'col gap-2' });
  wrap.appendChild(topBar);

  // Selection toolbar (hidden unless selectMode)
  const selBar = el('div', { class: 'row gap-2', style: { display: 'none', padding: '6px 4px' } });
  wrap.appendChild(selBar);

  // Body: sidebar + main + preview
  const body = el('div', { class: 'files-body', style: { display: 'grid', gridTemplateColumns: '1fr', gap: '12px', minHeight: '0', flex: '1 1 auto' } });
  wrap.appendChild(body);

  // Sidebar (drawer on mobile, column on desktop)
  const sideEl = el('div', { class: 'card', style: { padding: '8px', overflow: 'auto', minHeight: '0' } });
  const listEl = el('div', { class: 'card', style: { overflow: 'hidden', minHeight: '0', display: 'flex', flexDirection: 'column' } });
  const previewEl = el('div', { class: 'preview-pane', style: { display: 'none' } });

  body.appendChild(listEl);

  // Apply responsive layout
  function layout() {
    const wide = matchMedia('(min-width: 920px)').matches;
    body.style.gridTemplateColumns = wide
      ? (selectedPath ? '220px 1fr 1fr' : '220px 1fr')
      : (selectedPath ? '1fr' : '1fr');
    body.innerHTML = '';
    if (wide) body.appendChild(sideEl);
    body.appendChild(listEl);
    if (selectedPath && wide) body.appendChild(previewEl);
    if (selectedPath && !wide) {
      // mobile: open preview as bottom sheet
    }
  }
  layout();
  window.addEventListener('resize', layout);

  root.appendChild(wrap);

  // ── Helpers ──
  const sortFn = () => {
    const k = sortKey, dir = sortDir === 'asc' ? 1 : -1;
    return (a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1; // dirs first
      let av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'size') { av = a.size || 0; bv = b.size || 0; }
      else if (k === 'mtime') { av = a.mtime || 0; bv = b.mtime || 0; }
      else if (k === 'type') {
        const at = a.dir ? '' : (window.getExt(a.name) || '');
        const bt = b.dir ? '' : (window.getExt(b.name) || '');
        av = at; bv = bt;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    };
  };

  const matchesFilter = (it) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    // Fuzzy-ish: must contain all chars of filter in order
    const n = it.name.toLowerCase();
    let i = 0;
    for (const ch of f) { i = n.indexOf(ch, i); if (i < 0) return false; i++; }
    return true;
  };

  const fileIconFor = (it) => {
    if (it.dir) return 'folder';
    const k = window.fileKind(it.name);
    return ({
      image: 'image', audio: 'music', video: 'film', pdf: 'file-text',
      archive: 'archive', markdown: 'file-text', text: 'file-text',
    })[k] || 'file';
  };

  function persistFolderSort() {
    const cur = (app.settings.fileSort || {});
    cur[cwd] = { key: sortKey, dir: sortDir };
    window.api('/api/settings', { method: 'PATCH', body: { fileSort: cur } }).catch(() => {});
  }
  function loadFolderSort() {
    const sort = (app.settings.fileSort || {})[cwd];
    if (sort) { sortKey = sort.key; sortDir = sort.dir; }
  }

  // ── Top bar render ──
  function renderTopBar() {
    topBar.innerHTML = '';
    // Breadcrumb row + edit-as-text
    const crumbRow = el('div', { class: 'row gap-2', style: { alignItems: 'center', flexWrap: 'wrap' } });
    const crumbs = el('div', { class: 'crumbs' });

    if (cwd) {
      // Build crumbs
      const sep = cwd.includes('\\') ? '\\' : '/';
      const segs = [];
      // Windows drive root e.g. C:\\
      if (/^[a-zA-Z]:[\\/]?$/.test(cwd)) {
        segs.push({ name: cwd.slice(0, 2), path: cwd.slice(0, 2) + sep });
      } else if (cwd.startsWith('/')) {
        segs.push({ name: '/', path: '/' });
        let acc = '';
        for (const part of cwd.split('/').filter(Boolean)) { acc += '/' + part; segs.push({ name: part, path: acc }); }
      } else {
        // Windows: C:\\ + segments
        const parts = cwd.split(/[\\/]/).filter(Boolean);
        if (parts.length && /^[A-Za-z]:$/.test(parts[0])) {
          let acc = parts[0] + sep;
          segs.push({ name: parts[0], path: acc });
          for (let i = 1; i < parts.length; i++) { acc = window.joinPath(acc, parts[i]); segs.push({ name: parts[i], path: acc }); }
        } else {
          let acc = '';
          for (const part of parts) { acc = acc ? window.joinPath(acc, part) : part; segs.push({ name: part, path: acc }); }
        }
      }
      segs.forEach((s, i) => {
        if (i > 0) crumbs.appendChild(el('span', { class: 'sep' }, '/'));
        const c = el('span', { class: 'crumb truncate' }, s.name);
        c.addEventListener('click', () => navigateTo(s.path));
        crumbs.appendChild(c);
      });
    } else {
      crumbs.appendChild(el('span', { class: 'crumb' }, 'Choose a location'));
    }
    crumbRow.appendChild(crumbs);
    topBar.appendChild(crumbRow);

    // Search + sort + view + actions
    const tools = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } });

    const searchWrap = el('div', { class: 'row gap-2', style: { flex: '1 1 200px', position: 'relative' } });
    const search = el('input', { class: 'input', placeholder: 'Filter files…', value: filter });
    search.addEventListener('input', window.debounce(() => { filter = search.value; renderList(); }, 80));
    searchWrap.appendChild(search);
    tools.appendChild(searchWrap);

    const sortBtn = el('button', { class: 'btn ghost icon', title: 'Sort' });
    sortBtn.innerHTML = window.icon('sort');
    sortBtn.addEventListener('click', openSortMenu);
    tools.appendChild(sortBtn);

    const viewBtn = el('button', { class: 'btn ghost icon', title: 'Toggle list/grid' });
    viewBtn.innerHTML = window.icon(viewMode === 'list' ? 'grid' : 'list');
    viewBtn.addEventListener('click', () => {
      viewMode = viewMode === 'list' ? 'grid' : 'list';
      localStorage.setItem('files.viewMode', viewMode);
      renderTopBar(); renderList();
    });
    tools.appendChild(viewBtn);

    const newBtn = el('button', { class: 'btn ghost icon', title: 'New' });
    newBtn.innerHTML = window.icon('plus');
    newBtn.addEventListener('click', openNewMenu);
    tools.appendChild(newBtn);

    const upBtn = el('button', { class: 'btn ghost icon', title: 'Upload' });
    upBtn.innerHTML = window.icon('upload');
    upBtn.addEventListener('click', openUpload);
    tools.appendChild(upBtn);

    const moreBtn = el('button', { class: 'btn ghost icon', title: 'More' });
    moreBtn.innerHTML = window.icon('more');
    moreBtn.addEventListener('click', openFolderMenu);
    tools.appendChild(moreBtn);

    topBar.appendChild(tools);

    // Mobile-only: sidebar drawer button
    if (!matchMedia('(min-width: 920px)').matches) {
      const drawer = el('button', { class: 'btn ghost', style: { alignSelf: 'flex-start' } });
      drawer.innerHTML = window.icon('menu', { size: 14 }) + ' Locations';
      drawer.addEventListener('click', openSidebarDrawer);
      topBar.prepend(drawer);
    }
  }

  function openSortMenu() {
    const list = el('div', { class: 'col gap-1' });
    const opts = [
      ['name', 'Name'], ['size', 'Size'], ['mtime', 'Modified'], ['type', 'Type'],
    ];
    for (const [k, label] of opts) {
      const row = el('div', { class: 'list-item' }, [
        el('span', null, label),
        el('span', { class: 'spacer' }),
        sortKey === k ? el('span', { class: 'badge accent' }, sortDir === 'asc' ? '↑' : '↓') : null,
      ]);
      row.addEventListener('click', () => {
        if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = k; sortDir = 'asc'; }
        persistFolderSort();
        window.modal.close();
        renderList();
      });
      list.appendChild(row);
    }
    window.modal.open({ title: 'Sort', content: list, actions: [{ label: 'Close', kind: 'ghost', onClick: () => window.modal.close() }] });
  }

  function openNewMenu() {
    const list = el('div', { class: 'col gap-1' });
    const opts = [
      ['New folder', 'folder', () => createNewFolder()],
      ['New file', 'file', () => createNewFile('untitled.txt', '')],
      ['New Markdown', 'file-text', () => createNewFile('untitled.md', '# Untitled\n')],
      ['New JS file', 'file', () => createNewFile('untitled.js', '// untitled.js\n')],
      ['New JSON file', 'file', () => createNewFile('untitled.json', '{\n  \n}\n')],
    ];
    for (const [label, ic, fn] of opts) {
      const row = el('div', { class: 'list-item' }, [
        el('span', { html: window.icon(ic, { size: 16 }), style: { display:'inline-flex' } }),
        el('span', null, label),
      ]);
      row.addEventListener('click', () => { window.modal.close(); fn(); });
      list.appendChild(row);
    }
    window.modal.open({ title: 'Create', content: list, actions: [{ label: 'Close', kind: 'ghost', onClick: () => window.modal.close() }] });
  }

  function openFolderMenu() {
    const list = el('div', { class: 'col gap-1' });
    const opts = [
      ['Open in Console', 'terminal', () => { location.hash = '#console/' + encodeURIComponent(cwd); }],
      ['Open in Claude', 'rocket', () => { location.hash = '#sessions/new/' + encodeURIComponent(cwd); }],
      ['Pin folder', 'pin', pinCurrent],
      ['Reveal trash', 'trash', openTrash],
      ['Refresh', 'refresh', () => loadList(true)],
      ['Show hidden', 'eye', toggleHidden],
    ];
    for (const [label, ic, fn] of opts) {
      const row = el('div', { class: 'list-item' }, [
        el('span', { html: window.icon(ic, { size: 16 }) }),
        el('span', null, label),
      ]);
      row.addEventListener('click', () => { window.modal.close(); fn(); });
      list.appendChild(row);
    }
    window.modal.open({ title: 'Folder', content: list, actions: [{ label: 'Close', kind: 'ghost', onClick: () => window.modal.close() }] });
  }

  async function pinCurrent() {
    const s = await window.api('/api/settings');
    const list = (s.pinnedFolders || []).slice();
    if (list.find(f => (f.path || f) === cwd)) return window.toast.info('Already pinned');
    list.push({ name: window.basename(cwd) || cwd, path: cwd });
    await window.api('/api/settings', { method: 'PATCH', body: { pinnedFolders: list } });
    window.toast.success('Pinned');
    loadLocations();
  }

  async function toggleHidden() {
    const s = await window.api('/api/settings');
    await window.api('/api/settings', { method: 'PATCH', body: { hiddenFiles: !s.hiddenFiles } });
    loadList(true);
  }

  // ── Sidebar ──
  function renderSidebar() {
    sideEl.innerHTML = '';
    const sec = (title) => el('div', { class: 'section-title' }, title);
    sideEl.appendChild(sec('Quick'));
    for (const loc of locations.quick) {
      const r = el('div', { class: 'list-item', style: { padding: '8px 10px' } }, [
        el('span', { html: window.icon(loc.icon || 'folder', { size: 16 }), style: { color: 'var(--text-2)' } }),
        el('span', { class: 'truncate' }, loc.name),
        el('span', { class: 'spacer' }),
        loc.user ? el('button', { class: 'btn sm ghost icon', title: 'Unpin', onClick: (e) => { e.stopPropagation(); unpinLoc(loc); } }, [el('span', { html: window.icon('x', { size: 12 }) })]) : null,
      ]);
      r.addEventListener('click', () => navigateTo(loc.path));
      sideEl.appendChild(r);
    }
    if (locations.recent && locations.recent.length) {
      sideEl.appendChild(sec('Recent'));
      for (const p of locations.recent.slice(0, 8)) {
        const r = el('div', { class: 'list-item', style: { padding: '8px 10px' } }, [
          el('span', { html: window.icon('folder-open', { size: 16 }), style: { color: 'var(--text-3)' } }),
          el('span', { class: 'truncate' }, window.basename(p) || p),
        ]);
        r.title = p;
        r.addEventListener('click', () => navigateTo(p));
        sideEl.appendChild(r);
      }
    }
    sideEl.appendChild(sec('Trash'));
    const t = el('div', { class: 'list-item', style: { padding: '8px 10px' } }, [
      el('span', { html: window.icon('trash', { size: 16 }) }),
      el('span', null, 'Trash'),
    ]);
    t.addEventListener('click', openTrash);
    sideEl.appendChild(t);
  }
  async function unpinLoc(loc) {
    const s = await window.api('/api/settings');
    const target = String(loc && loc.path || '');
    const list = (s.pinnedFolders || []).filter(f => {
      const p = typeof f === 'string' ? f : (f && f.path) || '';
      return String(p) !== target;
    });
    await window.api('/api/settings', { method: 'PATCH', body: { pinnedFolders: list } });
    loadLocations();
  }

  function openSidebarDrawer() {
    const inner = el('div', { class: 'col gap-2', style: { padding: '12px' } });
    const sec = (title) => el('div', { class: 'section-title' }, title);
    inner.appendChild(sec('Quick'));
    for (const loc of locations.quick) {
      const r = el('div', { class: 'list-item' }, [
        el('span', { html: window.icon(loc.icon || 'folder', { size: 16 }) }),
        el('span', { class: 'truncate' }, loc.name),
      ]);
      r.addEventListener('click', () => { window.sheet.close(); navigateTo(loc.path); });
      inner.appendChild(r);
    }
    if (locations.recent && locations.recent.length) {
      inner.appendChild(sec('Recent'));
      for (const p of locations.recent.slice(0, 8)) {
        const r = el('div', { class: 'list-item' }, [
          el('span', { html: window.icon('folder-open', { size: 16 }) }),
          el('span', { class: 'truncate' }, window.basename(p) || p),
        ]);
        r.title = p;
        r.addEventListener('click', () => { window.sheet.close(); navigateTo(p); });
        inner.appendChild(r);
      }
    }
    window.sheet.open({ title: 'Locations', content: inner });
  }

  // ── List ──
  function renderList() {
    listEl.innerHTML = '';
    if (!cwd) {
      listEl.appendChild(window.emptyState({
        icon: 'folder', title: 'Pick a location', body: 'Choose Home, a drive, or a pinned folder.',
      }));
      return;
    }

    if (items === null) {
      listEl.appendChild(window.skeleton(8));
      return;
    }

    const visible = items.filter(matchesFilter).sort(sortFn());

    if (!visible.length) {
      listEl.appendChild(window.emptyState({
        icon: 'folder', title: filter ? 'No matches' : 'Empty folder',
        body: filter ? 'No files match "' + filter + '".' : 'Drop files here, or create one with the + button.',
      }));
      return;
    }

    const container = el('div', { class: viewMode === 'list' ? 'list' : 'file-grid', style: { padding: viewMode === 'list' ? '4px 0' : '12px', overflow: 'auto', minHeight: '0' } });

    if (viewMode === 'list') {
      for (const it of visible) container.appendChild(makeRow(it));
    } else {
      for (const it of visible) container.appendChild(makeTile(it));
    }
    listEl.appendChild(container);
  }

  function makeRow(it) {
    const r = el('div', { class: 'file-row' + (it.dir ? ' dir' : '') + (selected.has(it.path) ? ' selected' : '') });
    const cb = el('span', { class: 'icon', html: window.icon(fileIconFor(it), { size: 18 }) });
    const name = el('div', { class: 'name truncate', html: window.escapeHtml(it.name) });
    const meta1 = el('div', { class: 'meta' }, it.dir ? '—' : window.fmtBytes(it.size));
    const meta2 = el('div', { class: 'meta' }, it.mtime ? window.fmtRelative(it.mtime) : '');
    meta2.title = it.mtime ? window.fmtAbs(it.mtime) : '';
    r.appendChild(cb); r.appendChild(name); r.appendChild(meta1); r.appendChild(meta2);

    r.addEventListener('click', (e) => {
      if (selectMode || e.metaKey || e.ctrlKey) {
        toggleSelect(it.path); return;
      }
      if (it.dir) navigateTo(it.path);
      else openPreview(it);
    });
    window.attachLongPress(r, () => {
      selectMode = true;
      selected.add(it.path);
      window.vibrate(20);
      renderList(); renderSelBar();
    });
    return r;
  }

  function makeTile(it) {
    const t = el('div', { class: 'file-tile' + (it.dir ? ' dir' : '') + (selected.has(it.path) ? ' selected' : '') });
    if (!it.dir && window.fileKind(it.name) === 'image') {
      const img = el('img', {
        src: '/api/files/raw?path=' + encodeURIComponent(it.path),
        loading: 'lazy',
        style: { width: '100%', height: '60%', objectFit: 'cover', borderRadius: '4px' },
      });
      img.onerror = () => { img.replaceWith(el('div', { html: window.icon('image', { size: 28 }) })); };
      t.appendChild(img);
    } else {
      t.appendChild(el('div', { html: window.icon(fileIconFor(it), { size: 28 }), style: { color: it.dir ? 'var(--accent)' : 'var(--text-2)' } }));
    }
    t.appendChild(el('div', { class: 'name' }, it.name));

    t.addEventListener('click', (e) => {
      if (selectMode || e.metaKey || e.ctrlKey) { toggleSelect(it.path); return; }
      if (it.dir) navigateTo(it.path);
      else openPreview(it);
    });
    window.attachLongPress(t, () => {
      selectMode = true;
      selected.add(it.path);
      window.vibrate(20);
      renderList(); renderSelBar();
    });
    return t;
  }

  function toggleSelect(path) {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    if (!selected.size) selectMode = false;
    renderList(); renderSelBar();
  }

  // ── Selection toolbar ──
  function renderSelBar() {
    selBar.innerHTML = '';
    if (!selected.size) { selBar.style.display = 'none'; return; }
    selBar.style.display = 'flex';
    selBar.appendChild(el('span', { class: 'badge accent' }, selected.size + ' selected'));
    const mkBtn = (lbl, ic, kind, fn) => {
      const b = el('button', { class: 'btn sm ' + (kind || 'ghost') });
      b.innerHTML = window.icon(ic, { size: 14 }) + ' ' + lbl;
      b.addEventListener('click', fn);
      return b;
    };
    selBar.appendChild(mkBtn('Cut', 'scissors', '', () => { clipboard = { mode: 'cut', paths: [...selected] }; window.toast.info('Cut ' + selected.size); clearSelection(); }));
    selBar.appendChild(mkBtn('Copy', 'copy', '', () => { clipboard = { mode: 'copy', paths: [...selected] }; window.toast.info('Copied ' + selected.size); clearSelection(); }));
    selBar.appendChild(mkBtn('Move', 'move', '', moveSelected));
    selBar.appendChild(mkBtn('Zip', 'archive', '', zipSelected));
    selBar.appendChild(mkBtn('Download', 'download', '', downloadSelected));
    selBar.appendChild(mkBtn('Rename', 'edit', '', renameFirst));
    selBar.appendChild(mkBtn('Delete', 'trash', 'danger', deleteSelected));
    selBar.appendChild(el('span', { class: 'spacer' }));
    if (clipboard) selBar.appendChild(mkBtn('Paste', 'check', 'primary', pasteHere));
    selBar.appendChild(mkBtn('Cancel', 'x', '', clearSelection));
  }
  function clearSelection() { selected = new Set(); selectMode = false; renderList(); renderSelBar(); }

  // Keep paste available even when nothing is selected
  function ensurePasteBar() {
    if (!selected.size && clipboard) {
      selBar.style.display = 'flex'; selBar.innerHTML = '';
      selBar.appendChild(el('span', { class: 'badge' }, clipboard.mode === 'cut' ? 'Cut: ' + clipboard.paths.length : 'Copied: ' + clipboard.paths.length));
      const b = el('button', { class: 'btn sm primary' });
      b.innerHTML = window.icon('check', { size: 14 }) + ' Paste here';
      b.addEventListener('click', pasteHere);
      const c = el('button', { class: 'btn sm ghost' });
      c.innerHTML = window.icon('x', { size: 14 }) + ' Clear';
      c.addEventListener('click', () => { clipboard = null; renderSelBar(); ensurePasteBar(); });
      selBar.appendChild(b); selBar.appendChild(c);
    }
  }

  async function pasteHere() {
    if (!clipboard || !clipboard.paths.length) return;
    try {
      const fn = clipboard.mode === 'cut' ? '/api/files/move' : '/api/files/copy';
      const res = await window.api(fn, { method: 'POST', body: { paths: clipboard.paths, dest: cwd } });
      window.toast.success((clipboard.mode === 'cut' ? 'Moved ' : 'Copied ') + res.length + ' item(s)');
      if (clipboard.mode === 'cut') clipboard = null;
      clearSelection(); ensurePasteBar();
    } catch (e) { window.toast.error(e.message); }
  }

  async function moveSelected() {
    const dest = await window.promptModal({ title: 'Move to…', label: 'Destination folder', initial: cwd });
    if (!dest) return;
    try {
      const res = await window.api('/api/files/move', { method: 'POST', body: { paths: [...selected], dest } });
      window.toast.success('Moved ' + res.length); clearSelection();
    } catch (e) { window.toast.error(e.message); }
  }

  async function zipSelected() {
    const name = await window.promptModal({ title: 'Zip selected', label: 'Archive name', initial: 'archive-' + new Date().toISOString().slice(0,10) + '.zip' });
    if (!name) return;
    const url = '/api/files/download-zip?name=' + encodeURIComponent(name) + '&' + [...selected].map(p => 'paths=' + encodeURIComponent(p)).join('&');
    triggerDownload(url, name);
  }

  async function downloadSelected() {
    if (selected.size === 1) {
      const p = [...selected][0];
      const it = items.find(x => x.path === p);
      if (it && !it.dir) { triggerDownload('/api/files/raw?path=' + encodeURIComponent(p) + '&download=1', it.name); return; }
    }
    // Multi or directory → zip
    zipSelected();
  }

  function triggerDownload(url, name) {
    const a = document.createElement('a');
    a.href = url; if (name) a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function renameFirst() {
    if (!selected.size) return;
    const p = [...selected][0];
    const cur = window.basename(p);
    const next = await window.promptModal({ title: 'Rename', label: 'New name', initial: cur });
    if (!next || next === cur) return;
    try {
      await window.api('/api/files/rename', { method: 'POST', body: { from: p, to: window.joinPath(window.dirname(p), next) } });
      window.toast.success('Renamed');
      clearSelection();
    } catch (e) { window.toast.error(e.message); }
  }

  async function deleteSelected() {
    const ok = await window.confirmModal({
      title: 'Move to trash?',
      body: selected.size === 1
        ? 'Move "' + window.basename([...selected][0]) + '" to trash.'
        : 'Move ' + selected.size + ' items to trash.',
      confirmText: 'Move to trash', danger: true,
    });
    if (!ok) return;
    try {
      await window.api('/api/files/delete', { method: 'POST', body: { paths: [...selected] } });
      window.toast.success('Moved to trash');
      clearSelection();
    } catch (e) { window.toast.error(e.message); }
  }

  async function createNewFolder() {
    const name = await window.promptModal({ title: 'New folder', label: 'Name', placeholder: 'New folder' });
    if (!name) return;
    try {
      await window.api('/api/files/mkdir', { method: 'POST', body: { path: window.joinPath(cwd, name) } });
      window.toast.success('Folder created');
    } catch (e) { window.toast.error(e.message); }
  }

  async function createNewFile(defaultName, content) {
    const name = await window.promptModal({ title: 'New file', label: 'Name', initial: defaultName });
    if (!name) return;
    const p = window.joinPath(cwd, name);
    try {
      await window.api('/api/files/touch', { method: 'POST', body: { path: p } });
      if (content) await window.api('/api/files/write', { method: 'POST', body: { path: p, content } });
      window.toast.success('Created ' + name);
    } catch (e) { window.toast.error(e.message); }
  }

  function openUpload() {
    const input = el('input', { type: 'file', multiple: 'multiple', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return;
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const t = window.toast.info('Uploading ' + files.length + '…', { duration: 0 });
      try {
        const r = await fetch('/api/files/upload?dest=' + encodeURIComponent(cwd), { method: 'POST', body: fd, credentials: 'same-origin' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        t.dismiss(); window.toast.success('Uploaded ' + j.uploaded.length);
      } catch (e) { t.dismiss(); window.toast.error(e.message); }
    });
    document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
  }

  // ── Trash UI ──
  async function openTrash() {
    let { items } = await window.api('/api/files/trash');
    const root = el('div', { class: 'col gap-2' });
    function render() {
      root.innerHTML = '';
      if (!items.length) {
        root.appendChild(window.emptyState({ icon: 'trash', title: 'Trash is empty' }));
        return;
      }
      const list = el('div', { class: 'list' });
      for (const it of items) {
        const r = el('div', { class: 'list-item' });
        r.appendChild(el('div', { class: 'col', style: { flex: '1', minWidth: '0' } }, [
          el('div', { class: 'truncate' }, it.name),
          el('div', { class: 'muted text-sm truncate' }, it.originalPath),
        ]));
        r.appendChild(el('div', { class: 'muted text-sm' }, window.fmtRelative(it.when)));
        const restore = el('button', { class: 'btn sm ghost' });
        restore.innerHTML = window.icon('rotate-ccw', { size: 14 }) + ' Restore';
        restore.addEventListener('click', async () => {
          try { await window.api('/api/files/trash/restore', { method: 'POST', body: { id: it.id } }); items = items.filter(x => x.id !== it.id); render(); window.toast.success('Restored'); }
          catch (e) { window.toast.error(e.message); }
        });
        const del = el('button', { class: 'btn sm ghost danger' });
        del.innerHTML = window.icon('trash', { size: 14 });
        del.addEventListener('click', async () => {
          if (!await window.confirmModal({ title: 'Delete forever?', body: it.name, confirmText: 'Delete', danger: true })) return;
          try { await window.api('/api/files/trash/delete', { method: 'POST', body: { id: it.id } }); items = items.filter(x => x.id !== it.id); render(); }
          catch (e) { window.toast.error(e.message); }
        });
        r.appendChild(restore); r.appendChild(del);
        list.appendChild(r);
      }
      root.appendChild(list);
    }
    render();
    window.modal.open({
      title: 'Trash',
      content: root,
      size: 'lg',
      actions: [
        { label: 'Empty trash', kind: 'danger', onClick: async () => {
            if (!await window.confirmModal({ title: 'Empty trash?', body: 'This deletes ' + items.length + ' item(s) permanently.', danger: true, confirmText: 'Empty' })) return;
            await window.api('/api/files/trash/empty', { method: 'POST' });
            items = []; render(); window.toast.success('Trash emptied');
          } },
        { label: 'Close', kind: 'primary', onClick: () => window.modal.close() },
      ],
    });
  }

  // ── Preview ──
  async function openPreview(it) {
    selectedPath = it.path;
    layout();
    if (matchMedia('(min-width: 920px)').matches) {
      previewEl.style.display = 'flex';
      renderPreview(previewEl, it);
    } else {
      const inner = el('div', { class: 'col gap-2', style: { padding: '0 12px 12px', minHeight: '0', overflow: 'auto' } });
      const sheet = window.sheet.open({ title: it.name, content: inner, onClose: () => { selectedPath = null; layout(); } });
      renderPreview(sheet.body, it);
    }
  }

  async function renderPreview(host, it) {
    host.innerHTML = '';
    const head = el('div', { class: 'ph' }, [
      el('span', { html: window.icon(fileIconFor(it), { size: 16 }) }),
      el('span', { class: 'name truncate' }, it.name),
      el('span', { class: 'meta' }, it.dir ? '' : window.fmtBytes(it.size)),
      el('button', { class: 'btn sm ghost icon', title: 'Close', onClick: () => { selectedPath = null; layout(); } }, [el('span', { html: window.icon('x', { size: 14 }) })]),
    ]);
    host.appendChild(head);
    const body = el('div', { class: 'pb', style: { padding: '12px' } });
    host.appendChild(body);

    const kind = window.fileKind(it.name);
    const ext = window.getExt(it.name);
    if (it.dir) { body.appendChild(window.emptyState({ icon: 'folder', title: 'Folder', body: it.path })); return; }

    if (kind === 'image') {
      body.appendChild(el('img', { class: 'preview', src: '/api/files/raw?path=' + encodeURIComponent(it.path), style: { maxWidth: '100%', borderRadius: '6px' } }));
      body.appendChild(makeFileToolbar(it));
      return;
    }
    if (kind === 'audio') {
      body.appendChild(el('audio', { controls: 'controls', src: '/api/files/raw?path=' + encodeURIComponent(it.path), style: { width: '100%' } }));
      body.appendChild(makeFileToolbar(it));
      return;
    }
    if (kind === 'video') {
      body.appendChild(el('video', { controls: 'controls', src: '/api/files/raw?path=' + encodeURIComponent(it.path), style: { width: '100%', maxHeight: '70vh', borderRadius: '6px', background: '#000' } }));
      body.appendChild(makeFileToolbar(it));
      return;
    }
    if (kind === 'pdf') {
      const wrap = el('div', { style: { background: '#000', borderRadius: '6px', padding: '12px' } });
      body.appendChild(wrap);
      body.appendChild(makeFileToolbar(it));
      try { await renderPDF(wrap, '/api/files/raw?path=' + encodeURIComponent(it.path)); }
      catch (e) { wrap.appendChild(el('div', { class: 'muted' }, 'PDF preview failed: ' + e.message)); }
      return;
    }
    if (kind === 'archive') {
      const list = el('div', { class: 'list' });
      try {
        const z = await window.api('/api/files/zip-list?path=' + encodeURIComponent(it.path));
        for (const e of z.entries) {
          const r = el('div', { class: 'list-item' }, [
            el('span', { html: window.icon(e.isDir ? 'folder' : 'file', { size: 14 }) }),
            el('span', { class: 'truncate' }, e.name),
            el('span', { class: 'muted text-sm' }, e.isDir ? '' : window.fmtBytes(e.size)),
          ]);
          list.appendChild(r);
        }
        if (z.truncated) list.appendChild(el('div', { class: 'muted text-sm' }, '… (truncated)'));
        body.appendChild(list);
      } catch (e) { body.appendChild(el('div', { class: 'muted' }, e.message)); }
      body.appendChild(makeFileToolbar(it));
      return;
    }
    if (kind === 'markdown') {
      const r = await window.api('/api/files/read?path=' + encodeURIComponent(it.path));
      const tabs = el('div', { class: 'h-tabs' }, [
        Object.assign(el('div', { class: 'h-tab active' }, 'Preview'), {}),
        el('div', { class: 'h-tab' }, 'Raw'),
        el('div', { class: 'h-tab' }, 'Edit'),
      ]);
      body.appendChild(tabs);
      const view = el('div', { class: 'col gap-2' });
      body.appendChild(view);
      function show(idx) {
        for (let i = 0; i < tabs.children.length; i++) tabs.children[i].classList.toggle('active', i === idx);
        view.innerHTML = '';
        if (idx === 0) {
          const html = renderMarkdown(r.content);
          view.appendChild(el('div', { class: 'card padded', style: { lineHeight: '1.7' }, html }));
        } else if (idx === 1) {
          view.appendChild(makePre(r.content, ext));
        } else {
          view.appendChild(makeEditor(it, r.content));
        }
      }
      [...tabs.children].forEach((c, i) => c.addEventListener('click', () => show(i)));
      show(0);
      body.appendChild(makeFileToolbar(it));
      return;
    }
    if (kind === 'text') {
      const r = await window.api('/api/files/read?path=' + encodeURIComponent(it.path));
      const tabs = el('div', { class: 'h-tabs' }, [
        el('div', { class: 'h-tab active' }, 'View'),
        el('div', { class: 'h-tab' }, 'Edit'),
      ]);
      body.appendChild(tabs);
      const view = el('div', { class: 'col gap-2' });
      body.appendChild(view);
      function show(idx) {
        for (let i = 0; i < tabs.children.length; i++) tabs.children[i].classList.toggle('active', i === idx);
        view.innerHTML = '';
        if (idx === 0) {
          if (r.truncated) view.appendChild(el('div', { class: 'muted text-sm' }, 'Showing first ' + window.fmtBytes(r.content.length) + ' of ' + window.fmtBytes(r.size)));
          view.appendChild(makePre(r.content, ext));
        } else {
          view.appendChild(makeEditor(it, r.content));
        }
      }
      [...tabs.children].forEach((c, i) => c.addEventListener('click', () => show(i)));
      show(0);
      body.appendChild(makeFileToolbar(it));
      return;
    }
    // Binary fallback: hex preview
    try {
      const h = await window.api('/api/files/hex?path=' + encodeURIComponent(it.path) + '&bytes=512');
      const grouped = h.hex.match(/.{1,2}/g)?.join(' ') || '';
      body.appendChild(el('div', { class: 'muted text-sm' }, 'Binary file — first ' + h.bytesRead + ' bytes:'));
      body.appendChild(el('pre', { class: 'code-preview mono', style: { padding: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, grouped));
    } catch (e) { body.appendChild(el('div', { class: 'muted' }, e.message)); }
    body.appendChild(makeFileToolbar(it));
  }

  function makeFileToolbar(it) {
    const bar = el('div', { class: 'row gap-2 mt-3', style: { flexWrap: 'wrap' } });
    const dl = el('button', { class: 'btn ghost' });
    dl.innerHTML = window.icon('download', { size: 14 }) + ' Download';
    dl.addEventListener('click', () => triggerDownload('/api/files/raw?path=' + encodeURIComponent(it.path) + '&download=1', it.name));
    bar.appendChild(dl);

    const rn = el('button', { class: 'btn ghost' });
    rn.innerHTML = window.icon('edit', { size: 14 }) + ' Rename';
    rn.addEventListener('click', async () => {
      const next = await window.promptModal({ title: 'Rename', label: 'New name', initial: it.name });
      if (!next || next === it.name) return;
      try { await window.api('/api/files/rename', { method: 'POST', body: { from: it.path, to: window.joinPath(window.dirname(it.path), next) } }); window.toast.success('Renamed'); selectedPath = null; layout(); }
      catch (e) { window.toast.error(e.message); }
    });
    bar.appendChild(rn);

    const cp = el('button', { class: 'btn ghost' });
    cp.innerHTML = window.icon('link', { size: 14 }) + ' Copy path';
    cp.addEventListener('click', () => { window.copyToClipboard(it.path); window.toast.success('Path copied'); });
    bar.appendChild(cp);

    const del = el('button', { class: 'btn ghost danger' });
    del.innerHTML = window.icon('trash', { size: 14 }) + ' Delete';
    del.addEventListener('click', async () => {
      if (!await window.confirmModal({ title: 'Move to trash?', body: it.name, confirmText: 'Trash', danger: true })) return;
      try { await window.api('/api/files/delete', { method: 'POST', body: { paths: [it.path] } }); window.toast.success('Trashed'); selectedPath = null; layout(); }
      catch (e) { window.toast.error(e.message); }
    });
    bar.appendChild(del);
    return bar;
  }

  // ── Editor (CodeMirror 5 if available, else textarea) ──
  function makeEditor(it, initial) {
    const wrap = el('div', { class: 'col gap-2' });
    const meta = el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('div', { class: 'muted text-sm' }, it.name),
      el('div', { class: 'row gap-2' }),
    ]);
    const dirty = el('span', { class: 'badge', style: { display: 'none' } }, 'unsaved');
    const wordWrap = el('button', { class: 'btn sm ghost' });
    wordWrap.innerHTML = window.icon('list', { size: 14 }) + ' Wrap';
    const save = el('button', { class: 'btn sm primary' });
    save.innerHTML = window.icon('save', { size: 14 }) + ' Save';
    meta.children[1].appendChild(dirty);
    meta.children[1].appendChild(wordWrap);
    meta.children[1].appendChild(save);
    wrap.appendChild(meta);

    const host = el('div', { class: 'cm-host' });
    wrap.appendChild(host);

    let cm = null;
    let value = initial;
    let isDirty = false;
    function markDirty() { isDirty = true; dirty.style.display = 'inline-flex'; }

    if (window.CodeMirror) {
      cm = window.CodeMirror(host, {
        value: initial,
        mode: window.modeForExt(window.getExt(it.name)),
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: false,
        autoCloseBrackets: true,
        matchBrackets: true,
        styleActiveLine: true,
        indentUnit: 2,
        tabSize: 2,
        smartIndent: true,
        viewportMargin: 100,
        extraKeys: {
          'Ctrl-S': () => doSave(),
          'Cmd-S':  () => doSave(),
          'Ctrl-F': 'findPersistent',
        },
      });
      cm.on('change', () => { value = cm.getValue(); markDirty(); });
      setTimeout(() => cm.refresh(), 50);
      wordWrap.addEventListener('click', () => { cm.setOption('lineWrapping', !cm.getOption('lineWrapping')); });
    } else {
      const ta = el('textarea', { class: 'textarea mono', style: { minHeight: '300px', height: '60vh' } });
      ta.value = initial;
      ta.addEventListener('input', () => { value = ta.value; markDirty(); });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      });
      host.replaceWith(ta);
    }

    async function doSave() {
      try {
        save.disabled = true; save.textContent = 'Saving…';
        await window.api('/api/files/write', { method: 'POST', body: { path: it.path, content: value } });
        isDirty = false; dirty.style.display = 'none';
        window.toast.success('Saved');
      } catch (e) { window.toast.error(e.message); }
      finally { save.disabled = false; save.innerHTML = window.icon('save', { size: 14 }) + ' Save'; }
    }
    save.addEventListener('click', doSave);

    return wrap;
  }

  function makePre(content, ext) {
    const code = el('code');
    code.textContent = content;
    if (window.hljs) {
      try {
        const lang = window.hljs.getLanguage(ext) ? ext : null;
        if (lang) code.innerHTML = window.hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
        else { code.className = 'hljs'; code.innerHTML = window.hljs.highlightAuto(content).value; }
      } catch (e) {}
    }
    const pre = el('pre', { class: 'code-preview' });
    pre.appendChild(code);
    return pre;
  }

  // Minimal markdown renderer (no deps). Handles headings, bold, italic, code, lists, links, blockquote.
  function renderMarkdown(src) {
    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    // Code blocks first
    let out = src.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, body) => {
      const escaped = esc(body);
      let code = escaped;
      if (window.hljs && lang && window.hljs.getLanguage(lang)) {
        try { code = window.hljs.highlight(body, { language: lang, ignoreIllegals: true }).value; } catch (e) { code = escaped; }
      }
      return '<pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto"><code>' + code + '</code></pre>';
    });
    // Headings
    out = out.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
             .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
             .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
             .replace(/^### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^## (.+)$/gm, '<h2>$1</h2>')
             .replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Inline code
    out = out.replace(/`([^`]+)`/g, '<code style="background:var(--surface-2);padding:1px 6px;border-radius:4px;font-family:var(--mono)">$1</code>');
    // Bold + italic
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
             .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // Links
    out = out.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    // Lists (very simple, line-based)
    out = out.replace(/(^\- .+(?:\n\- .+)*)/gm, (m) => {
      const items = m.split(/\n/).map(l => l.replace(/^\- /, '').trim()).map(t => '<li>' + t + '</li>').join('');
      return '<ul>' + items + '</ul>';
    });
    // Blockquote
    out = out.replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid var(--border-strong);padding-left:12px;color:var(--text-2);margin:8px 0">$1</blockquote>');
    // Paragraphs (any remaining double-newline blocks)
    out = out.split(/\n{2,}/).map(b => {
      if (/^<(h\d|ul|pre|blockquote)/.test(b.trim())) return b;
      return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return out;
  }

  // PDF.js renderer — first 5 pages, lazy-load worker.
  async function renderPDF(host, url) {
    if (!window.pdfjsLib) {
      const m = await import('/vendor/pdfjs/pdf.min.mjs');
      window.pdfjsLib = m;
      m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    }
    const doc = await window.pdfjsLib.getDocument({ url }).promise;
    const max = Math.min(doc.numPages, 5);
    for (let i = 1; i <= max; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const c = document.createElement('canvas');
      c.width = viewport.width; c.height = viewport.height;
      c.style.width = '100%'; c.style.height = 'auto';
      c.style.display = 'block'; c.style.margin = '0 auto 12px';
      c.style.borderRadius = '4px'; c.style.background = '#fff';
      host.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    }
    if (doc.numPages > max) host.appendChild(el('div', { class: 'muted text-sm', style: { textAlign: 'center', padding: '8px' } }, 'Showing first ' + max + ' of ' + doc.numPages + ' pages — download to view all.'));
  }

  // ── Lazy-load CodeMirror + highlight.js ──
  async function loadVendor() {
    if (window.__vendorLoaded) return;
    window.__vendorLoaded = true;
    function loadScript(src) {
      return new Promise((resolve) => {
        const s = document.createElement('script'); s.src = src; s.async = true;
        s.onload = resolve; s.onerror = resolve; document.head.appendChild(s);
      });
    }
    // CodeMirror 5
    await loadScript('/vendor/codemirror/codemirror.js');
    if (window.CodeMirror) {
      await Promise.all([
        loadScript('/vendor/codemirror/mode/javascript/javascript.js'),
        loadScript('/vendor/codemirror/mode/xml/xml.js'),
        loadScript('/vendor/codemirror/mode/css/css.js'),
        loadScript('/vendor/codemirror/mode/htmlmixed/htmlmixed.js'),
        loadScript('/vendor/codemirror/mode/markdown/markdown.js'),
        loadScript('/vendor/codemirror/mode/yaml/yaml.js'),
        loadScript('/vendor/codemirror/mode/python/python.js'),
        loadScript('/vendor/codemirror/mode/rust/rust.js'),
        loadScript('/vendor/codemirror/mode/shell/shell.js'),
        loadScript('/vendor/codemirror/mode/sql/sql.js'),
        loadScript('/vendor/codemirror/mode/clike/clike.js'),
        loadScript('/vendor/codemirror/mode/go/go.js'),
        loadScript('/vendor/codemirror/addon/edit/closebrackets.js'),
        loadScript('/vendor/codemirror/addon/edit/matchbrackets.js'),
        loadScript('/vendor/codemirror/addon/selection/active-line.js'),
        loadScript('/vendor/codemirror/addon/dialog/dialog.js'),
        loadScript('/vendor/codemirror/addon/search/searchcursor.js'),
        loadScript('/vendor/codemirror/addon/search/search.js'),
      ]);
    }
    // highlight.js (common bundle)
    await loadScript('/vendor/highlight/common.js');
  }
  loadVendor();

  // ── Data loading ──
  async function loadLocations() {
    try {
      locations = await window.api('/api/files/locations');
      renderSidebar();
    } catch (e) { window.toast.error(e.message); }
  }

  async function loadList(force) {
    if (!cwd) { items = []; renderList(); return; }
    if (!force) items = null;
    renderList();
    try {
      const data = await window.api('/api/files/list?path=' + encodeURIComponent(cwd));
      items = data.items || [];
      renderList();
    } catch (e) {
      items = [];
      listEl.innerHTML = '';
      listEl.appendChild(window.emptyState({ icon: 'alert', title: 'Cannot list folder', body: e.message }));
    }
  }

  async function navigateTo(p) {
    if (!p) return;
    cwd = p;
    selected = new Set(); selectMode = false; selectedPath = null;
    renderTopBar(); renderSelBar(); ensurePasteBar(); layout();
    loadFolderSort();
    if (watching) { app.unsubscribe('files:' + watching); watching = null; }
    watching = p;
    app.subscribe('files:' + watching);
    // Update URL silently (no hashchange — view stays mounted).
    history.replaceState(null, '', '#files/' + encodeURIComponent(p));
    await loadList();
    try { window.api('/api/files/recent', { method: 'POST', body: { path: p } }); } catch (e) {}
  }

  // Listen for live FS events
  unsub = app.onMessage((msg) => {
    if (!msg || !msg.topic) return;
    if (msg.topic === 'files:' + cwd) {
      const ev = msg.payload || {};
      // Reload list (cheap; folder is single level)
      loadList(true);
    }
  });

  // ── Init ──
  await loadLocations();
  renderTopBar(); renderSelBar();
  if (cwd) { loadFolderSort(); navigateTo(cwd); }
  else renderList();

  // Cleanup
  return {
    // Called by router when hash changes within the same tab — avoids re-mount.
    route(restArr) {
      const next = decodeURIComponent((restArr || []).join('/'));
      if (next && next !== cwd) navigateTo(next);
    },
    destroy() {
      if (watching) app.unsubscribe('files:' + watching);
      if (typeof unsub === 'function') unsub();
      window.removeEventListener('resize', layout);
    },
  };
};
