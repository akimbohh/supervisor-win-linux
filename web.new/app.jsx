/* App shell — header, restart banner, tabbar, view router.
 *
 * Compared to the original mock:
 *   - Hash routing (location.hash) replaces useState; supports sub-paths
 *     #sessions/new/<folder>, #console/<encoded-path>.
 *   - Connection dot + latency badge driven by window.App (WS singleton)
 *     with the original 3-color thresholds (green <100, amber 100-300, red >300).
 *   - Restart banner driven by window.App restart-state machine.
 *   - ? key opens the Maintenance ("Request a change") modal; g+s/f/c/p/y/t
 *     chord navigates tabs (800ms window). Both ignored in input/textarea.
 *   - Per-view state preserved across tab switches via `keepAlive` map.
 *   - Tweaks panel preserved as dev tooling.
 */
const { useState, useEffect, useRef, useCallback } = React;

const TABS = [
  { id: 'sessions', label: 'Sessions', icon: 'rocket' },
  { id: 'files',    label: 'Files',    icon: 'folder' },
  { id: 'console',  label: 'Console',  icon: 'terminal' },
  { id: 'processes',label: 'Procs',    icon: 'layers' },
  { id: 'system',   label: 'System',   icon: 'cpu' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const TAB_TITLE = {
  sessions: 'Sessions', files: 'Files', console: 'Console',
  processes: 'Processes', system: 'System', settings: 'Settings',
};
const G_CHORD = { s: 'sessions', f: 'files', c: 'console', p: 'processes', y: 'system', t: 'settings' };

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "amber",
  "density": "dense",
  "aurora": "on",
  "layout": "tabbar",
  "notifFinished": true,
  "notifAsked": true,
  "notifConsole": false,
  "notifDisk": true,
  "autoScroll": true,
  "kbdHelper": true
}/*EDITMODE-END*/;

/* Catches render-time errors so a crash shows a real message instead of a
 * silent black screen. Lives at the root of the React tree. */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error('[react] crashed:', err, info && info.componentStack);
    try { window.toast && window.toast.error('UI crashed: ' + (err && err.message)); } catch (_) {}
  }
  render() {
    if (this.state.err) {
      const e = this.state.err;
      const msg = (e && e.message) || String(e);
      const stack = (e && e.stack) || '';
      return (
        <div style={{ padding: '24px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, overflow: 'auto', height: '100dvh' }}>
          <h2 style={{ color: 'var(--err)', fontFamily: 'var(--font)', marginTop: 0 }}>UI crashed</h2>
          <pre style={{ color: 'var(--err)', whiteSpace: 'pre-wrap' }}>{msg}</pre>
          <pre style={{ color: 'var(--text-3)', whiteSpace: 'pre-wrap', fontSize: 11 }}>{stack}</pre>
          <button className="btn primary" onClick={() => location.reload()} style={{ marginTop: 12 }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* Parse #sessions/new/<folder> → { tab: 'sessions', rest: ['new','<folder>'] }. */
function parseHash() {
  const h = (location.hash || '').replace(/^#/, '') || 'sessions';
  const [tab, ...rest] = h.split('/');
  return { tab: TAB_TITLE[tab] ? tab : 'sessions', rest };
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((newHash) => {
    const want = newHash.startsWith('#') ? newHash : '#' + newHash;
    if (location.hash !== want) location.hash = want;
  }, []);
  return [route, navigate];
}

/* Connection dot + latency badge. Subscribes to App.onConnChange / App.onLatency
 * if available. Falls back to a static "offline" state if ws.jsx didn't load —
 * we'd rather show a stale dot than crash the whole shell. */
function ConnBadge() {
  const [state, setState] = useState('offline');
  const [rtt, setRtt] = useState(null);
  useEffect(() => {
    const A = window.App;
    if (!A || typeof A.onConnChange !== 'function' || typeof A.onLatency !== 'function') {
      console.warn('[supervisor] App.onConnChange/onLatency missing — ws.jsx didn\'t load fully');
      return;
    }
    const u1 = A.onConnChange(setState);
    const u2 = A.onLatency(setRtt);
    return () => { u1 && u1(); u2 && u2(); };
  }, []);
  let label = 'offline';
  if (state === 'online') label = 'live';
  let latLabel = '';
  let latCls = '';
  if (state === 'online') {
    if (rtt === 'stale') { latLabel = '…'; latCls = 'warn'; }
    else if (typeof rtt === 'number') {
      latLabel = rtt + 'ms';
      latCls = rtt > 300 ? 'danger' : rtt > 100 ? 'warn' : '';
    }
  }
  return (
    <span className="head-pill">
      <span className={'dot' + (state === 'offline' ? ' offline' : '')} style={state === 'online' ? null : { background: 'var(--text-4)', boxShadow: 'none' }}/>
      <span style={{ fontSize: 10.5, fontWeight: 500 }}>{label}</span>
      {latLabel && <span className={'lat ' + latCls}>{latLabel}</span>}
    </span>
  );
}

/* Restart banner — pending vs. ready. */
function RestartBanner() {
  const [state, setState] = useState('none');
  useEffect(() => {
    const A = window.App;
    if (!A || typeof A.onRestartChange !== 'function') return;
    return A.onRestartChange(setState);
  }, []);
  if (state === 'none') return null;
  if (state === 'pending') {
    return <div className="restart-banner pending"><span>Server is restarting…</span></div>;
  }
  return (
    <div className="restart-banner ready">
      <span>Server restarted</span>
      <button className="btn sm primary" onClick={() => location.reload()}>Reload now</button>
    </div>
  );
}

/* Maintenance ("Request a change") modal. Triggered by ? key or help button.
 * On submit: copies prompt to clipboard, POSTs /api/maintenance/interactive,
 * stashes shellId in localStorage, navigates to #console. */
async function showMaintenanceModal() {
  if (!window.modal || !window.el) return;
  const el = window.el;
  const ta = el('textarea', {
    class: 'textarea',
    placeholder: 'e.g. "The login button on mobile is too small — make it bigger."',
    style: { minHeight: '110px' },
  });
  const help = el('div', { class: 'help' }, 'Opens a Console shell with `claude` running and auto-pastes your prompt. The request is also copied to your clipboard.');
  const field = el('div', { class: 'field' }, [
    el('label', null, 'Describe the change or bug'),
    help,
    ta,
  ]);
  let handle = null;
  async function openInteractive() {
    const text = ta.value.trim();
    if (!text) { window.toast.error('Enter a description first'); return; }
    try { await window.copyToClipboard(text); } catch (e) {}
    try {
      const r = await window.api('/api/maintenance/interactive', { method: 'POST', body: { text } });
      if (r && r.shellId) {
        try { localStorage.setItem('consoleActivateShell', r.shellId); } catch (e) {}
      }
      window.toast.info('Request copied — opening Claude.');
      handle.close();
      location.hash = '#console';
    } catch (e) { window.toast.error(e.message); }
  }
  const interactiveBtn = el('button', { class: 'btn primary' }, 'Open in interactive Claude');
  interactiveBtn.title = 'Opens a Console shell with `claude` running and pastes your prompt; the prompt is also copied to your clipboard.';
  interactiveBtn.addEventListener('click', openInteractive);
  handle = window.modal.open({
    title: 'Request a change',
    content: field,
    actions: [{ label: 'Close', kind: 'ghost', onClick: () => handle.close() }],
    size: 'lg',
  });
  const footer = handle.el.querySelector('.modal-footer');
  if (footer) footer.appendChild(interactiveBtn);
  setTimeout(() => ta.focus(), 50);
}
window.showMaintenanceModal = showMaintenanceModal;

/* Global keyboard shortcuts: ? for maintenance modal, g+letter for tab nav.
 * Ignored when focus is in INPUT, TEXTAREA, or contentEditable. */
function useGlobalShortcuts() {
  useEffect(() => {
    let gPressed = false; let gTimer = null;
    function handler(e) {
      const tag = (e.target && e.target.tagName) || '';
      const inEditor = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      if (e.key === '?' && !inEditor) { e.preventDefault(); showMaintenanceModal(); return; }
      if (e.key.toLowerCase() === 'g' && !inEditor && !gPressed) {
        gPressed = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPressed = false; }, 800);
        return;
      }
      if (gPressed && !inEditor) {
        const target = G_CHORD[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          gPressed = false;
          clearTimeout(gTimer);
          location.hash = '#' + target;
        }
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, navigate] = useHashRoute();
  const [openSession, setOpenSession] = useState(null);
  const [booted, setBooted] = useState(false);
  /* Header-action slots: views can register a primary action button via context. */
  const [headerAction, setHeaderAction] = useState(null);

  useGlobalShortcuts();

  /* Apply tweaks (theme/accent/density/aurora/layout) to <html>. Theme-color
   * meta updates here too so it stays in sync with any tweak change. */
  useEffect(() => {
    document.documentElement.dataset.accent = tweaks.accent;
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.dataset.aurora = tweaks.aurora;
    document.documentElement.dataset.layout = tweaks.layout;
    document.documentElement.dataset.theme = tweaks.theme;
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', tweaks.theme === 'light' ? '#fafaf7' : '#0a0a0b');
  }, [tweaks]);

  /* Boot: auth check, settings load, WS connect. Always set booted=true even
   * on failure — we'd rather render the shell with stale state than wedge
   * forever on the "Connecting…" placeholder. */
  useEffect(() => {
    const A = window.App;
    if (!A || typeof A.bootWS !== 'function') {
      console.warn('[supervisor] App.bootWS missing — running in offline-only mode');
      setBooted(true);
      return;
    }
    let alive = true;
    A.bootWS().then((ok) => {
      if (!alive) return;
      setBooted(true);
      if (ok && A.settings) {
        const s = A.settings;
        if (s.theme) setTweak('theme', s.theme);
        if (s.accent) setTweak('accent', s.accent);
      }
    }).catch((err) => {
      console.error('[boot] failed', err);
      try { window.toast && window.toast.error('Boot failed: ' + (err && err.message || err)); } catch (_) {}
      if (alive) setBooted(true);
    });
    return () => { alive = false; };
  }, []);

  /* If no hash on first load, default to #sessions. */
  useEffect(() => {
    if (!location.hash) location.replace('#sessions');
  }, []);

  /* Reset header action when tab changes; views re-register on mount. */
  useEffect(() => { setHeaderAction(null); }, [route.tab]);

  const headerCtx = { register: (a) => setHeaderAction(a) };

  /* Per-view rendering. Each view receives a `route` object with `rest` (sub-path
   * segments) and a `header` context for registering its header action. */
  const renderView = () => {
    const props = { route, header: headerCtx, onOpen: (id) => setOpenSession(id) };
    switch (route.tab) {
      case 'sessions':  return <SessionsView {...props}/>;
      case 'files':     return <FilesView {...props}/>;
      case 'console':   return <ConsoleView {...props}/>;
      case 'processes': return <ProcessesView {...props}/>;
      case 'system':    return <SystemView {...props}/>;
      case 'settings':  return <SettingsView {...props} tweaks={tweaks} setTweak={setTweak}/>;
      default:          return null;
    }
  };

  const titleFor = TAB_TITLE[route.tab] || 'Supervisor';

  return (
    <div className="app" data-screen-label={'01 ' + titleFor}>
      <div className="aurora2"/>

      <RestartBanner/>

      {/* Header */}
      <div className="header">
        <div className="brand">
          <span className="logo"/>
          <b>Supervisor</b>
          <span className="ver">v2.4</span>
        </div>
        <span className="head-spacer"/>
        <ConnBadge/>
        {headerAction && (
          <button className="icon-btn" title={headerAction.title} onClick={headerAction.onClick}>
            <Icon name={headerAction.icon || 'plus'}/>
          </button>
        )}
        <button className="icon-btn" title="Help (?)" onClick={showMaintenanceModal}><Icon name="help"/></button>
      </div>

      {/* Page title */}
      <div className="page-title">
        <h1>{titleFor}</h1>
      </div>

      {/* Main content */}
      <div className="main">
        {booted ? renderView() : <div className="empty"><p style={{ color: 'var(--text-3)' }}>Connecting…</p></div>}
      </div>

      {/* Tabbar */}
      <nav className="tabbar">
        {TABS.map(t => (
          <button key={t.id} className={'tab' + (route.tab === t.id ? ' active' : '')}
                  onClick={() => navigate('#' + t.id)}>
            <Icon name={t.icon} size={19}/>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Session detail (in-React full-page sheet — distinct from the imperative bottom drawer). */}
      {openSession && <SessionDetail id={openSession} onClose={() => setOpenSession(null)}/>}

      {/* Tweaks panel (dev tooling, preserved). */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Look">
          <TweakRadio label="Theme" value={tweaks.theme} onChange={v=>setTweak('theme', v)}
            options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'},{value:'auto',label:'Auto'}]}/>
          <TweakSelect label="Accent" value={tweaks.accent} onChange={v=>setTweak('accent', v)}
            options={['amber','teal','purple','blue','rose','lime'].map(v=>({value:v,label:v}))}/>
          <TweakRadio label="Density" value={tweaks.density} onChange={v=>setTweak('density', v)}
            options={[{value:'dense',label:'Dense'},{value:'medium',label:'Med'},{value:'airy',label:'Airy'}]}/>
          <TweakToggle label="Aurora background" value={tweaks.aurora!=='off'} onChange={v=>setTweak('aurora', v?'on':'off')}/>
        </TweakSection>
        <TweakSection title="Behavior">
          <TweakToggle label="Console auto-scroll" value={tweaks.autoScroll} onChange={v=>setTweak('autoScroll', v)}/>
          <TweakToggle label="Mobile kbd helper" value={tweaks.kbdHelper} onChange={v=>setTweak('kbdHelper', v)}/>
          <TweakToggle label="Notify on session finish" value={tweaks.notifFinished} onChange={v=>setTweak('notifFinished', v)}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App/></ErrorBoundary>
);
