// System view — CPU, memory, disks, network, uptime, GPU, top processes, power.
window.SystemView = async function (root, { app }) {
  let snap = null;
  let history = { cpu: [], mem: [], rx: [], tx: [], t: [] };
  let unsub = null;

  root.innerHTML = '';
  const wrap = el('div', { class: 'col gap-3' });
  root.appendChild(wrap);

  const stats = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' },
  });
  wrap.appendChild(stats);

  const detail = el('div', { class: 'col gap-3' });
  wrap.appendChild(detail);

  function statCard(title, val, sparkVals, hint) {
    const card = el('div', { class: 'card padded', style: { display: 'grid', gridTemplateColumns: '1fr', gap: '6px' } });
    card.appendChild(el('div', { class: 'muted text-sm' }, title));
    card.appendChild(el('div', { class: 'tabular', style: { fontSize: '22px', fontWeight: '600', letterSpacing: '-0.01em' } }, val));
    if (sparkVals) card.appendChild(window.sparkline(sparkVals, { height: 32 }));
    if (hint) card.appendChild(el('div', { class: 'muted text-sm tabular' }, hint));
    return card;
  }

  function bar(pct, color = 'var(--accent)') {
    const o = el('div', { style: { background: 'var(--surface-2)', borderRadius: '6px', overflow: 'hidden', height: '6px' } });
    const i = el('div', { style: { width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: color, transition: 'width 200ms ease-out' } });
    o.appendChild(i); return o;
  }

  function render() {
    if (!snap) {
      stats.innerHTML = ''; for (let i = 0; i < 4; i++) stats.appendChild(window.skeleton(2));
      return;
    }
    stats.innerHTML = '';

    const c = snap.cpu;
    stats.appendChild(statCard('CPU', c.pct.toFixed(0) + '%', history.cpu, snap.host.cpuModel));

    const m = snap.mem;
    stats.appendChild(statCard('Memory', m.pct.toFixed(0) + '%', history.mem, window.fmtBytes(m.used) + ' / ' + window.fmtBytes(m.total)));

    const totalDisk = snap.disks.reduce((a, d) => a + d.total, 0);
    const usedDisk = snap.disks.reduce((a, d) => a + d.used, 0);
    const dPct = totalDisk ? (100 * usedDisk / totalDisk) : 0;
    stats.appendChild(statCard('Disk', dPct.toFixed(0) + '%', null, window.fmtBytes(usedDisk) + ' / ' + window.fmtBytes(totalDisk)));

    stats.appendChild(statCard('Uptime', window.fmtDur(snap.uptime * 1000), null, snap.host.hostname));

    detail.innerHTML = '';

    // Per-CPU bars
    if (c.perCpu && c.perCpu.length) {
      const cpuCard = el('div', { class: 'card padded' });
      cpuCard.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'Cores'));
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginTop: '12px' } });
      c.perCpu.forEach((p, i) => {
        const cell = el('div', { class: 'col gap-2' });
        cell.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
          el('span', { class: 'muted text-sm' }, '#' + i),
          el('span', { class: 'tabular text-sm' }, p.toFixed(0) + '%'),
        ]));
        cell.appendChild(bar(p));
        grid.appendChild(cell);
      });
      cpuCard.appendChild(grid);
      detail.appendChild(cpuCard);
    }

    // Disks
    const dCard = el('div', { class: 'card padded' });
    dCard.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'Disks'));
    if (!snap.disks.length) dCard.appendChild(el('div', { class: 'muted text-sm mt-3' }, 'No disks reported.'));
    for (const d of snap.disks) {
      const row = el('div', { class: 'col gap-2', style: { marginTop: '12px' } });
      row.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
        el('span', null, d.mount + (d.label ? '  ' + d.label : '')),
        el('span', { class: 'muted tabular text-sm' }, window.fmtBytes(d.used) + ' / ' + window.fmtBytes(d.total) + '   (' + d.pct.toFixed(0) + '%)'),
      ]));
      row.appendChild(bar(d.pct, d.pct >= 90 ? 'var(--danger)' : 'var(--accent)'));
      dCard.appendChild(row);
    }
    detail.appendChild(dCard);

    // Network
    const nCard = el('div', { class: 'card padded' });
    nCard.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'Network'));
    nCard.appendChild(el('div', { class: 'row gap-3 mt-3', style: { flexWrap: 'wrap' } }, [
      el('div', { class: 'col' }, [
        el('div', { class: 'muted text-sm' }, '↓ Down'),
        el('div', { class: 'tabular', style: { fontSize: '16px', fontWeight: 600 } }, window.fmtBytes(snap.net.rxBps) + '/s'),
      ]),
      el('div', { class: 'col' }, [
        el('div', { class: 'muted text-sm' }, '↑ Up'),
        el('div', { class: 'tabular', style: { fontSize: '16px', fontWeight: 600 } }, window.fmtBytes(snap.net.txBps) + '/s'),
      ]),
      el('div', { class: 'col' }, [
        el('div', { class: 'muted text-sm' }, 'Total received'),
        el('div', { class: 'tabular text-sm' }, window.fmtBytes(snap.net.totalRx)),
      ]),
      el('div', { class: 'col' }, [
        el('div', { class: 'muted text-sm' }, 'Total sent'),
        el('div', { class: 'tabular text-sm' }, window.fmtBytes(snap.net.totalTx)),
      ]),
    ]));
    nCard.appendChild(window.sparkline(history.rx, { height: 30 }));
    nCard.appendChild(window.sparkline(history.tx, { height: 30 }));
    detail.appendChild(nCard);

    // GPU
    if (snap.gpu && snap.gpu.length) {
      const g = el('div', { class: 'card padded' });
      g.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'GPU'));
      for (const card of snap.gpu) {
        const row = el('div', { class: 'col gap-2', style: { marginTop: '12px' } });
        row.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
          el('span', null, card.name),
          el('span', { class: 'muted tabular text-sm' }, card.util.toFixed(0) + '%   ' + window.fmtBytes(card.memUsed) + ' / ' + window.fmtBytes(card.memTotal) + '   ' + card.temp + '°C'),
        ]));
        row.appendChild(bar(card.util));
        g.appendChild(row);
      }
      detail.appendChild(g);
    }

    // Top procs (link to Processes tab)
    const tp = el('div', { class: 'card padded' });
    const tpHead = el('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } }, [
      el('div', { class: 'section-title', style: { margin: 0 } }, 'Top processes'),
      el('a', { href: '#processes', class: 'muted text-sm', style: { textDecoration: 'none' } }, 'Open Processes →'),
    ]);
    tp.appendChild(tpHead);
    const tbl = el('div', { class: 'list mt-2' });
    for (const p of (snap.topProcs || []).slice(0, 8)) {
      tbl.appendChild(el('div', { class: 'list-item' }, [
        el('span', { class: 'truncate' }, p.name + ' (' + p.pid + ')'),
        el('span', { class: 'muted tabular text-sm' }, window.fmtBytes(p.mem || 0) + (p.cpu != null ? '   CPU ' + p.cpu : '')),
      ]));
    }
    tp.appendChild(tbl);
    detail.appendChild(tp);

    // Power — capability-aware: unsupported actions render disabled with a
    // reason (§3.2) rather than being hidden or silently failing.
    const caps = (snap && snap.caps) || {};
    const power = caps.power || {};
    const pwr = el('div', { class: 'card padded' });
    pwr.appendChild(el('div', { class: 'section-title', style: { margin: 0 } }, 'Power'));
    const sleepReason = power.sleep === false
      ? (caps.virt && caps.virt !== 'none' ? 'Sleep unavailable — virtualized host has no suspend state' : 'Sleep is not supported on this host')
      : null;
    pwr.appendChild(el('div', { class: 'row gap-2 mt-2', style: { flexWrap: 'wrap' } }, [
      makeBtn('moon', 'Sleep', 'sleep', false, false, sleepReason),
      makeBtn('rotate-ccw', 'Restart', 'restart', true),
      makeBtn('power', 'Shutdown', 'shutdown', true),
      makeBtn('x', 'Cancel pending', 'cancel', false, true),
    ]));
    if (sleepReason) pwr.appendChild(el('div', { class: 'cap-reason mt-2' }, sleepReason));
    detail.appendChild(pwr);
  }

  function makeBtn(ic, label, action, danger, requirePwOnly = false, disabledReason = null) {
    if (disabledReason) {
      const b = el('button', { class: 'btn cap-off', 'aria-disabled': 'true', title: disabledReason, disabled: true });
      b.innerHTML = window.icon('slash', { size: 14 }) + ' ' + label;
      return b;
    }
    const b = el('button', { class: 'btn ' + (danger ? 'danger' : '') });
    b.innerHTML = window.icon(ic, { size: 14 }) + ' ' + label;
    b.addEventListener('click', () => doPower(action, label, danger, requirePwOnly));
    return b;
  }

  async function doPower(action, label, danger, requirePwOnly) {
    const body = el('div', { class: 'col gap-3' });
    body.appendChild(el('div', null, requirePwOnly ? 'Cancel any pending shutdown/restart?' : 'Confirm by entering your password.'));
    const pw = el('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    body.appendChild(pw);
    setTimeout(() => pw.focus(), 50);
    let acted = false;
    const submit = async () => {
      acted = true;
      try {
        await window.api('/api/system/power', { method: 'POST', body: { action, password: pw.value } });
        window.toast.success(label + ' scheduled');
        window.modal.close();
      } catch (e) { window.toast.error(e.message); }
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    window.modal.open({
      title: label + '?',
      content: body,
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => window.modal.close() },
        { label: action === 'cancel' ? 'Cancel pending' : 'Confirm', kind: danger ? 'danger primary' : 'primary', onClick: submit },
      ],
    });
  }

  // Show skeletons synchronously so the tab swap is instant.
  render();

  // ── Live updates ──
  app.subscribe('system');
  unsub = app.onMessage((msg) => {
    if (msg.topic !== 'system') return;
    snap = msg.payload.snap; history = msg.payload.history;
    render();
  });

  // Kick off initial fetch async — view returns immediately.
  (async () => {
    try {
      const r = await window.api('/api/system');
      snap = r.snap; history = r.history;
      render();
    } catch (e) { window.toast.error(e.message); render(); }
  })();

  return {
    destroy() {
      app.unsubscribe('system');
      if (unsub) unsub();
    },
  };
};
