/* Sessions, Files, Console views */

/* ── Sample data ── */
window.SUPER_DATA = {
  sessions: [
    { id: 's1', name: 'feat/auth-rework', folder: '~/code/acme-web', tag: 'frontend', status: 'running', startedAt: Date.now() - 1000*60*42, lastLog: '◇ Reviewing src/auth/login.tsx (line 84)\n◇ Editing src/middleware/auth.ts\n  + Added rate-limit gate\n→ Running tests… 12 passed' },
    { id: 's2', name: 'fix/payments-edge', folder: '~/code/acme-api', tag: 'backend', status: 'running', startedAt: Date.now() - 1000*60*8, lastLog: 'I\'ll patch the webhook handler to retry on 5xx with exponential backoff.\n→ Editing webhooks/stripe.ts' },
    { id: 's3', name: 'refactor/perf-pass', folder: '~/code/acme-web', tag: 'frontend', status: 'awaiting', startedAt: Date.now() - 1000*60*20, lastLog: '? Should I memoize the Selector component or hoist the props?\n  [a] memoize  [b] hoist  [c] both' },
    { id: 's4', name: 'docs/runbook', folder: '~/code/ops', tag: 'docs', status: 'exited', startedAt: Date.now() - 1000*60*120, lastLog: '✓ Wrote 4 files\n✓ Tests pass\nFinished. Total cost: $0.42' },
    { id: 's5', name: 'spike/llm-eval', folder: '~/code/research', tag: 'ml', status: 'exited', startedAt: Date.now() - 1000*60*240, lastLog: 'exited (code 0)' },
  ],
  presets: [
    { name: 'acme-web', folder: '~/code/acme-web' },
    { name: 'acme-api', folder: '~/code/acme-api' },
    { name: 'ops',      folder: '~/code/ops' },
    { name: 'research', folder: '~/code/research' },
  ],
  files: {
    '~/code/acme-web': [
      { name: '.git', dir: true,  size: null,    mtime: '2d' },
      { name: 'src',  dir: true,  size: null,    mtime: '12m' },
      { name: 'public', dir: true, size: null,   mtime: '3h' },
      { name: 'node_modules', dir: true, size: null, mtime: '8d' },
      { name: 'README.md',     dir: false, size: 4_204,    mtime: '2h',  ext: 'md' },
      { name: 'package.json',  dir: false, size: 2_148,    mtime: '1d',  ext: 'json' },
      { name: 'tsconfig.json', dir: false, size: 612,      mtime: '4d',  ext: 'json' },
      { name: 'vite.config.ts',dir: false, size: 1_064,    mtime: '4d',  ext: 'ts' },
      { name: '.env.local',    dir: false, size: 312,      mtime: '6h',  ext: 'env' },
      { name: 'pnpm-lock.yaml',dir: false, size: 482_390,  mtime: '1d',  ext: 'yaml' },
      { name: 'logo.png',      dir: false, size: 18_904,   mtime: '12d', ext: 'png' },
    ],
  },
  procs: [
    { pid: 18432, name: 'node',   cmd: 'node ./scripts/dev.js',   cpu: 38.4, mem: 612 },
    { pid: 19001, name: 'esbuild',cmd: 'esbuild --watch',         cpu: 12.1, mem: 248 },
    { pid: 17211, name: 'rg',     cmd: 'rg --files',              cpu: 0.8,  mem: 14 },
    { pid: 9210,  name: 'Code Helper', cmd: '/Applications/Visual Studio Code.app',  cpu: 6.2,  mem: 1844 },
    { pid: 412,   name: 'WindowServer', cmd: '/System/Library/PrivateFrameworks/SkyLight.framework', cpu: 4.5,  mem: 612 },
    { pid: 8801,  name: 'docker', cmd: 'docker compose up',        cpu: 11.2, mem: 412 },
    { pid: 6601,  name: 'chrome', cmd: 'Google Chrome --renderer', cpu: 18.6, mem: 1340 },
    { pid: 8814,  name: 'postgres', cmd: 'postgres -D /usr/local/var/postgres', cpu: 1.2, mem: 184 },
    { pid: 4421,  name: 'redis-server', cmd: 'redis-server *:6379', cpu: 0.4, mem: 32 },
    { pid: 2110,  name: 'figma', cmd: '/Applications/Figma.app',   cpu: 2.1,  mem: 814 },
  ],
  metrics: {
    cpu: { pct: 42, model: 'Apple M3 Pro · 12 cores', cores: [12,18,42,8,66,24,11,9,71,5,32,14] },
    mem: { pct: 71, used: 22.4, total: 32 },
    disk: [{ name: '/', used: 412, total: 1024 }, { name: '/Volumes/Backups', used: 740, total: 2048 }],
    net: [{ name: 'en0', rx: '1.2 MB/s', tx: '320 KB/s' }, { name: 'awdl0', rx: '4 KB/s', tx: '1 KB/s' }],
    uptime: '4d 12h',
    host: 'mac-studio.local',
  },
  spark: Array.from({ length: 28 }, (_, i) => 30 + 30*Math.sin(i/2.4) + 12*Math.cos(i/1.3) + Math.random()*8),
  spark2: Array.from({ length: 28 }, (_, i) => 60 + 16*Math.sin(i/3 + 1) + 10*Math.random()),
  spark3: Array.from({ length: 28 }, (_, i) => 20 + 18*Math.cos(i/1.7) + 8*Math.random()),
};

/* ── Sparkline ── */
window.Sparkline = function ({ values, height = 32, fill = true }) {
  const w = 200, h = height;
  const max = Math.max(...values), min = Math.min(...values);
  const r = max - min || 1;
  const pts = values.map((v,i) => [i/(values.length-1)*w, h - 2 - ((v-min)/r)*(h-4)]);
  const line = pts.map((p,i) => (i? 'L':'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${w},${h} L0,${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" className="spark-grad-stop1"/>
          <stop offset="100%" className="spark-grad-stop2"/>
        </linearGradient>
      </defs>
      {fill && <path d={area} className="area"/>}
      <path d={line} className="line"/>
    </svg>
  );
};

/* ── Sessions view ── */
window.SessionsView = function ({ onOpen }) {
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [groupBy, setGroupBy] = React.useState('none');

  let list = window.SUPER_DATA.sessions;
  if (filter === 'running') list = list.filter(s => s.status === 'running' || s.status === 'awaiting');
  else if (filter === 'exited') list = list.filter(s => s.status === 'exited');
  if (search) list = list.filter(s =>
    (s.name + s.folder + (s.tag||'')).toLowerCase().includes(search.toLowerCase()));

  const groups = (() => {
    if (groupBy === 'none') return [['', list]];
    const key = groupBy === 'folder' ? 'folder' : 'tag';
    const m = new Map();
    list.forEach(s => {
      const k = s[key] || '(none)';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    });
    return [...m.entries()];
  })();

  const fmtDur = (ms) => {
    const m = Math.floor(ms/60000); const h = Math.floor(m/60);
    if (h > 0) return `${h}h ${m%60}m`;
    return `${m}m`;
  };

  return (
    <div>
      <div className="toolbar">
        <div className="input">
          <Icon name="search"/>
          <input placeholder="Search folder, tag, log…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div className="seg">
          {['all','running','exited'].map(k => (
            <button key={k} className={filter===k?'on':''} onClick={()=>setFilter(k)}>
              {k[0].toUpperCase()+k.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => setGroupBy(g => g==='none'?'folder':g==='folder'?'tag':'none')}>
          <Icon name="layers" size={13}/>
          {groupBy==='none' ? 'No group' : groupBy==='folder' ? 'By folder' : 'By tag'}
        </button>
      </div>

      <div style={{display:'flex', gap:8, overflowX:'auto', padding:'2px 4px 12px', scrollbarWidth:'none'}}>
        <span style={{fontSize:10.5, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600, alignSelf:'center', marginRight:4}}>Presets</span>
        {window.SUPER_DATA.presets.map(p => (
          <button key={p.name} className="preset-chip">
            <Icon name="zap" size={11}/>{p.name}
          </button>
        ))}
        <button className="preset-chip" style={{borderStyle:'dashed', color:'var(--text-3)'}}>
          <Icon name="plus" size={11}/>Add
        </button>
      </div>

      {groups.map(([g, items]) => (
        <div key={g||'_'}>
          {g && <div className="sec-title">{g}</div>}
          <div style={{display:'grid', gap:'var(--gap)'}}>
            {items.map(s => (
              <div key={s.id} className="card card-tap session-card" onClick={()=>onOpen(s.id)}>
                <div className="session-head">
                  <span className={'chip ' + (s.status==='running'?'live':s.status==='awaiting'?'warn':'')}>
                    {s.status === 'running' ? <span className="live-bars"><span/><span/><span/><span/></span> :
                     s.status === 'awaiting' ? <span className="dotty"/> :
                     <span className="dotty" style={{background:'var(--text-4)', boxShadow:'none'}}/>}
                    {s.status}
                  </span>
                  <div style={{flex:1, minWidth:0}}>
                    <div className="session-name truncate">{s.name}</div>
                    <div className="session-folder truncate">{s.folder}</div>
                  </div>
                  {s.tag && <span className="chip">#{s.tag}</span>}
                  <span className="muted tab-num" style={{fontSize:11, fontFamily:'var(--mono)'}}>
                    {fmtDur(Date.now() - s.startedAt)}
                  </span>
                </div>
                <pre className="session-log">{s.lastLog}</pre>
                <div className="session-actions">
                  <button className="btn xs ghost" onClick={e => {e.stopPropagation(); onOpen(s.id);}}>
                    <Icon name="terminal" size={11}/>Open log
                  </button>
                  {s.status === 'running' || s.status === 'awaiting' ? (
                    <button className="btn xs ghost danger" onClick={e=>e.stopPropagation()}>
                      <Icon name="stop" size={11}/>Kill
                    </button>
                  ) : (
                    <button className="btn xs ghost" onClick={e=>e.stopPropagation()}>
                      <Icon name="rotate" size={11}/>Restart
                    </button>
                  )}
                  <button className="btn xs ghost" onClick={e=>e.stopPropagation()} title="Rename / tag">
                    <Icon name="tag" size={11}/>
                  </button>
                  <button className="btn xs ghost danger" onClick={e=>e.stopPropagation()} title="Remove">
                    <Icon name="trash" size={11}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{display:'flex', justifyContent:'center', marginTop:14}}>
        <button className="btn ghost sm">
          <Icon name="trash" size={11}/>Clear exited
        </button>
      </div>
    </div>
  );
};

/* ── Session detail / log sheet ── */
window.SessionDetail = function ({ id, onClose }) {
  const s = window.SUPER_DATA.sessions.find(x => x.id === id);
  const logRef = React.useRef(null);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [find, setFind] = React.useState('');
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (s.status !== 'running') return;
    const t = setInterval(() => setTick(x => x+1), 1400);
    return () => clearInterval(t);
  }, [s.status]);

  React.useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [tick, autoScroll]);

  // Synthesize streaming log
  const baseLog = (s.lastLog || '') + '\n';
  const liveTail = s.status === 'running'
    ? Array.from({length: tick}, (_,i) => `[${new Date(Date.now()-(tick-i)*1400).toLocaleTimeString()}] ${['◇ Reading file…','✓ Patch applied','→ Running tests…','  passed (12 of 14)','  failed: src/api/auth.test.ts:42','  retrying with --ci flag','◇ Editing config'][i%7]}`).join('\n')
    : '';
  const logText = baseLog + liveTail;

  return (
    <div className="sheet">
      <div className="sheet-head">
        <button className="icon-btn" onClick={onClose}><Icon name="arrowLeft"/></button>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontWeight:600, fontSize:14}} className="truncate">{s.name}</div>
          <div className="muted truncate" style={{fontSize:11, fontFamily:'var(--mono)'}}>{s.folder}</div>
        </div>
        <span className={'chip ' + (s.status==='running'?'live':s.status==='awaiting'?'warn':'')}>{s.status}</span>
      </div>
      <div style={{padding:'10px 14px', display:'flex', gap:8, alignItems:'center', borderBottom:'1px solid var(--border)'}}>
        <div className="input" style={{flex:1}}>
          <Icon name="search"/>
          <input placeholder="Find in log…" value={find} onChange={e=>setFind(e.target.value)}/>
        </div>
        <button className={'btn sm ' + (autoScroll?'primary':'ghost')} onClick={()=>setAutoScroll(a=>!a)}>
          <Icon name="arrowLeft" size={12} style={{transform:'rotate(-90deg)'}}/>
          Auto
        </button>
        <button className="btn sm ghost icon"><Icon name="copy" size={13}/></button>
      </div>
      <div className="sheet-body" style={{padding:0}}>
        <div ref={logRef} className="term" style={{height:'100%', borderRadius:0, padding:'14px 16px'}}
             onScroll={(e) => {
               const el = e.currentTarget;
               const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
               if (!atBottom && autoScroll) setAutoScroll(false);
             }}>
          {logText.split('\n').map((line, i) => {
            let cls = 'line';
            if (/^✓/.test(line)) cls += ' arrow';
            else if (/^→/.test(line)) cls += ' key';
            else if (/^◇/.test(line)) cls += ' dim';
            else if (/error|failed|err/i.test(line)) cls += ' err';
            const m = find && find.length > 1 ? line.split(new RegExp(`(${find})`, 'gi')) : null;
            return (
              <div key={i} className={cls}>
                {m ? m.map((p,j) => p.toLowerCase()===find.toLowerCase()
                  ? <mark key={j} style={{background:'var(--accent-soft)', color:'var(--accent)', padding:'0 2px', borderRadius:3}}>{p}</mark>
                  : p) : line}
              </div>
            );
          })}
          {s.status === 'running' && <span className="cur"/>}
        </div>
      </div>
      <div style={{padding:'10px 14px', display:'flex', gap:8, borderTop:'1px solid var(--border)'}}>
        {s.status === 'running' || s.status === 'awaiting' ? (
          <button className="btn sm danger"><Icon name="stop" size={12}/>Kill session</button>
        ) : (
          <button className="btn sm primary"><Icon name="rotate" size={12}/>Restart</button>
        )}
        <button className="btn sm ghost"><Icon name="bell" size={12}/>Notify on exit</button>
        <span style={{flex:1}}/>
        <button className="btn sm ghost"><Icon name="download" size={12}/>Export log</button>
      </div>
    </div>
  );
};
