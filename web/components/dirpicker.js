// Directory picker — a bottom-sheet folder browser over the Files API,
// reusable anywhere a flow needs "pick a folder" (new chat session, --add-dir).
// Usage: const path = await window.pickDirectory({ title, initial }); // null = cancelled
(function () {
  window.pickDirectory = function ({ title = 'Choose a folder', initial = '' } = {}) {
    return new Promise((resolve) => {
      const el = window.el;
      let done = false;
      let cwd = '';

      function finish(v) {
        if (done) return;
        done = true;
        window.sheet.close();
        resolve(v);
      }

      const body = el('div', { class: 'dirpick' });
      const pathBar = el('div', { class: 'dirpick-path tabular' }, '');
      const list = el('div', { class: 'dirpick-list' });
      const chooseBtn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px' }, disabled: true }, 'Choose this folder');
      chooseBtn.addEventListener('click', () => { if (cwd) finish(cwd); });
      body.appendChild(pathBar);
      body.appendChild(list);
      body.appendChild(chooseBtn);

      function row({ ic, label, hint, muted }, onClick) {
        const r = el('div', { class: 'dirpick-row' + (muted ? ' muted' : '') }, [
          el('span', { class: 'ic', html: window.icon(ic, { size: 16 }) }),
          el('span', { class: 'lbl truncate' }, label),
          hint ? el('span', { class: 'hint truncate' }, hint) : null,
        ]);
        r.addEventListener('click', onClick);
        return r;
      }

      // No path → "places" screen: home, quick locations, recents, manual entry.
      async function loadPlaces() {
        cwd = '';
        chooseBtn.disabled = true;
        pathBar.textContent = 'Places';
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'muted text-sm', style: { padding: '8px 4px' } }, 'Loading…'));
        let loc = { quick: [], recent: [], home: '' };
        try { loc = await window.api('/api/files/locations'); } catch (e) {}
        list.innerHTML = '';
        if (loc.home) list.appendChild(row({ ic: 'home', label: 'Home', hint: loc.home }, () => load(loc.home)));
        for (const q of (loc.quick || [])) {
          if (q.path === loc.home) continue;
          list.appendChild(row({ ic: 'folder', label: q.name || window.basename(q.path) || q.path, hint: q.path }, () => load(q.path)));
        }
        for (const p of (loc.recent || []).slice(0, 8)) {
          list.appendChild(row({ ic: 'bookmark', label: window.basename(p) || p, hint: p }, () => load(p)));
        }
        list.appendChild(row({ ic: 'edit', label: 'Type a path…' }, async () => {
          const v = await window.promptModal({ title: 'Folder path', label: 'Absolute path to a folder', placeholder: '/home/user/project' });
          if (v != null && v.trim()) load(v.trim());
        }));
      }

      async function load(p) {
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'muted text-sm', style: { padding: '8px 4px' } }, 'Loading…'));
        try {
          const data = await window.api('/api/files/list?path=' + encodeURIComponent(p));
          cwd = data.path;
          chooseBtn.disabled = false;
          pathBar.textContent = cwd;
          list.innerHTML = '';
          list.appendChild(row({ ic: 'layers', label: 'Places', muted: true }, loadPlaces));
          if (data.parent) list.appendChild(row({ ic: 'arrow-up', label: '..', hint: data.parent, muted: true }, () => load(data.parent)));
          const dirs = (data.items || []).filter(i => i.dir && !i.broken);
          if (!dirs.length) list.appendChild(el('div', { class: 'muted text-sm', style: { padding: '10px 4px' } }, 'No subfolders.'));
          for (const d of dirs) {
            list.appendChild(row({ ic: 'folder', label: d.name }, () => load(d.path)));
          }
        } catch (e) {
          list.innerHTML = '';
          list.appendChild(el('div', { class: 'chat-error' }, e.message));
          list.appendChild(row({ ic: 'layers', label: 'Places', muted: true }, loadPlaces));
        }
      }

      window.sheet.open({
        title,
        content: body,
        onClose: () => { if (!done) { done = true; resolve(null); } },
      });
      if (initial) load(initial); else loadPlaces();
    });
  };
})();
