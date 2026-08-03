/* Files & Console & Processes & System & Settings views */

/* ── Files ── */
window.FilesView = function () {
  const [cwd, setCwd] = React.useState('~/code/acme-web');
  const [view, setView] = React.useState('list');
  const [selected, setSelected] = React.useState(null);
  const [selectMode, setSelectMode] = React.useState(false);
  const [multi, setMulti] = React.useState(new Set());
  const [filter, setFilter] = React.useState('');
  const [sortKey, setSortKey] = React.useState('name');
  const items = window.SUPER_DATA.files[cwd] || [];

  const fmtBytes = (b) => {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/1024/1024).toFixed(1) + ' MB';
  };
  const iconFor = (it) => {
    if (it.dir) return it.name === '.git' ? 'git' : 'folder';
    if (['png','jpg','svg','webp'].includes(it.ext)) return 'image';
    if (['ts','tsx','js','jsx','json','yaml'].includes(it.ext)) return 'code';
    if (['md','env'].includes(it.ext)) return 'file';
    return 'file';
  };

  const visible = items.filter(it => !filter || it.name.toLowerCase().includes(filter.toLowerCase()));

  const longPress = (it) => (e) => {
    let t = setTimeout(() => {
      setSelectMode(true);
      setMulti(new Set([it.name]));
    }, 380);
    const cancel = () => clearTimeout(t);
    e.currentTarget.addEventListener('pointerup', cancel, { once: true });
    e.currentTarget.addEventListener('pointercancel', cancel, { once: true });
    e.currentTarget.addEventListener('pointerleave', cancel, { once: true });
  };

  const toggleSel = (name) => {
    setMulti(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      if (n.size === 0) setSelectMode(false);
      return n;
    });
  };

  const crumbs = cwd.split('/').filter(Boolean);

  return (
    <div>
      <div className="crumbs">
        <span className="crumb"><Icon name="home" size={11}/></span>
        <span className="crumb-sep">/</span>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            <span className={'crumb' + (i===crumbs.length-1?' last':'')}>{c.replace('~','home')}</span>
            {i < crumbs.length-1 && <span className="crumb-sep">/</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="toolbar">
        <div className="input">
          <Icon name="search"/>
          <input placeholder="Filter in folder…" value={filter} onChange={e=>setFilter(e.target.value)}/>
        </div>
        <div className="seg">
          <button className={view==='list'?'on':''} onClick={()=>setView('list')}><Icon name="list" size={11}/></button>
          <button className={view==='grid'?'on':''} onClick={()=>setView('grid')}><Icon name="grid" size={11}/></button>
        </div>
        <button className="btn sm ghost"><Icon name="upload" size={12}/>Upload</button>
        <button className="btn sm ghost icon"><Icon name="more" size={13}/></button>
      </div>

      {selectMode && (
        <div className="card padded" style={{marginBottom:10, display:'flex', gap:8, alignItems:'center', padding:'8px 12px'}}>
          <button className="icon-btn" onClick={()=>{setSelectMode(false); setMulti(new Set());}}><Icon name="x"/></button>
          <span style={{fontSize:12, fontWeight:500}}>{multi.size} selected</span>
          <span style={{flex:1}}/>
          <button className="btn xs ghost"><Icon name="copy" size={11}/></button>
          <button className="btn xs ghost"><Icon name="download" size={11}/></button>
          <button className="btn xs ghost danger"><Icon name="trash" size={11}/></button>
        </div>
      )}

      <div className="sec-title">Quick access</div>
      <div className="qa-grid">
        {[
          { lab: 'acme-web', sub: '~/code', ic: 'star' },
          { lab: 'Downloads', sub: '~/', ic: 'download' },
          { lab: 'Desktop', sub: '~/', ic: 'monitor' },
          { lab: 'Recents', sub: '12 items', ic: 'clock' },
        ].map(q => (
          <button key={q.lab} className="qa-item">
            <span className="ico"><Icon name={q.ic} size={13}/></span>
            <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start', minWidth:0}}>
              <span className="lab truncate">{q.lab}</span>
              <span className="sub truncate">{q.sub}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="sec-title">{cwd.split('/').slice(-1)[0]} <span className="muted tab-num" style={{marginLeft:4, fontFamily:'var(--mono)', fontSize:10}}>{visible.length} items</span></div>
      <div className="card solid" style={{overflow:'hidden'}}>
        {view === 'list' ? visible.map(it => (
          <div key={it.name} className={'file-row' + (it.dir?' dir':'') + (selected===it.name?' selected':'')}
               onClick={() => { if (selectMode) toggleSel(it.name); else setSelected(it.name); }}
               onPointerDown={longPress(it)}>
            <span className="ico"><Icon name={iconFor(it)} size={14}/></span>
            <span className="name truncate">
              {selectMode && <span style={{display:'inline-block', width:14, height:14, borderRadius:4, border:'1.5px solid var(--border-3)', marginRight:8, verticalAlign:'middle', background: multi.has(it.name)?'var(--accent)':'transparent'}}/>}
              {it.name}
            </span>
            <span className="size">{fmtBytes(it.size)}</span>
            <span className="meta">{it.mtime}</span>
          </div>
        )) : (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(96px, 1fr))', gap:6, padding:8}}>
            {visible.map(it => (
              <div key={it.name} className="card-tap" style={{aspectRatio:'1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, background: it.dir?'color-mix(in oklab, var(--accent) 8%, var(--bg-2))':'var(--bg-2)', border:'1px solid var(--border)', borderRadius:'var(--r)', padding:8, textAlign:'center'}}>
                <Icon name={iconFor(it)} size={22} color={it.dir?'var(--accent)':'var(--text-2)'}/>
                <span style={{fontSize:10.5, lineHeight:1.2, wordBreak:'break-all', maxHeight:'2.4em', overflow:'hidden'}}>{it.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Console (xterm-style) ── */
window.ConsoleView = function () {
  const [tabs, setTabs] = React.useState([
    { id: 't1', name: 'main', pty: true, alive: true },
    { id: 't2', name: 'logs', pty: true, alive: true },
    { id: 't3', name: 'docker', pty: false, alive: false },
  ]);
  const [active, setActive] = React.useState('t1');
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [lines, setLines] = React.useState([
    { ps1: 'mac-studio', path: '~/code/acme-web', cmd: 'pnpm dev' },
    { out: '$ vite' },
    { out: '  VITE v5.4.10  ready in 412 ms', cls: 'arrow' },
    { out: '' },
    { out: '  ➜  Local:   http://localhost:5173/', cls: 'arrow' },
    { out: '  ➜  Network: http://192.168.1.42:5173/' },
    { out: '' },
    { out: '12:14:22 [vite] hmr update /src/auth/login.tsx', cls: 'dim' },
    { out: '12:14:38 [vite] hmr update /src/auth/middleware.ts', cls: 'dim' },
    { out: '12:14:51 [vite] page reload src/index.html', cls: 'dim' },
    { ps1: 'mac-studio', path: '~/code/acme-web', cmd: 'curl -s api/health' },
    { out: '{ "ok": true, "uptime": 4193, "build": "v2.4.0" }', cls: 'str' },
    { ps1: 'mac-studio', path: '~/code/acme-web', cmd: 'pnpm test --filter auth' },
    { out: ' PASS  src/auth/__tests__/login.test.ts (12 tests)', cls: 'arrow' },
    { out: ' PASS  src/auth/__tests__/session.test.ts (8 tests)', cls: 'arrow' },
    { out: '', },
    { out: 'Test Suites: 2 passed, 2 total' },
    { out: 'Tests:       20 passed, 20 total' },
    { out: 'Snapshots:   0 total' },
    { out: 'Time:        1.842s' },
  ]);
  const termRef = React.useRef(null);

  // Auto-scroll
  React.useEffect(() => {
    if (autoScroll && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [lines, autoScroll, active]);

  // Simulate streaming output
  React.useEffect(() => {
    const t = setInterval(() => {
      const stamps = ['hmr update', 'page reload', 'optimize deps', 'pre-bundling'];
      const file = ['/src/auth/login.tsx','/src/store/index.ts','/src/components/Nav.tsx','/src/api/client.ts'][Math.floor(Math.random()*4)];
      const time = new Date().toLocaleTimeString('en-GB');
      setLines(L => {
        const next = [...L, { out: `${time} [vite] ${stamps[Math.floor(Math.random()*stamps.length)]} ${file}`, cls: 'dim' }];
        return next.length > 200 ? next.slice(-200) : next;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  const onScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    if (!atBottom && autoScroll) setAutoScroll(false);
    if (atBottom && !autoScroll) setAutoScroll(true);
  };

  const closeTab = (id) => (e) => {
    e.stopPropagation();
    setTabs(t => t.filter(x => x.id !== id));
    if (active === id && tabs.length > 1) setActive(tabs[0].id);
  };

  const sendKey = (k) => {
    setLines(L => [...L, { out: `[key: ${k}]`, cls: 'dim' }]);
  };

  return (
    <div style={{display:'flex', flexDirection:'column', height:'calc(100dvh - 240px)', minHeight:380}}>
      <div className="term-shell" style={{flex:1, minHeight:0}}>
        <div className="term-bar">
          {tabs.map(t => (
            <div key={t.id} className={'term-tab' + (t.id===active?' active':'')} onClick={()=>setActive(t.id)}>
              <span className={'dotg' + (t.alive?' live':'')}/>
              <span>{t.name}{!t.pty && <span style={{color:'var(--text-4)'}}> (pipe)</span>}</span>
              <span className="x" onClick={closeTab(t.id)}><Icon name="x" size={10}/></span>
            </div>
          ))}
          <button className="term-tab" style={{color:'var(--text-3)'}}
                  onClick={() => {
                    const id = 't' + (tabs.length+1);
                    setTabs(t => [...t, { id, name: 'shell-' + (t.length+1), pty: true, alive: true }]);
                    setActive(id);
                  }}>
            <Icon name="plus" size={11}/>New
          </button>
          <span style={{flex:1}}/>
          <button className="term-tab" title={autoScroll?'Auto-scroll on':'Auto-scroll off'}
                  onClick={() => { setAutoScroll(a=>!a); if (!autoScroll && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }}
                  style={{color: autoScroll?'var(--accent)':'var(--text-3)'}}>
            <Icon name="activity" size={11}/>{autoScroll?'follow':'paused'}
          </button>
        </div>
        <div className="term" ref={termRef} onScroll={onScroll}>
          {lines.map((l, i) => (
            <div key={i} className="line">
              {l.ps1 ? (
                <>
                  <span className="ps1">{l.ps1}</span>
                  <span className="dim"> </span>
                  <span className="key">{l.path}</span>
                  <span className="arrow"> ❯ </span>
                  <span>{l.cmd}</span>
                </>
              ) : (
                <span className={l.cls || ''}>{l.out}</span>
              )}
            </div>
          ))}
          <div>
            <span className="ps1">mac-studio</span>
            <span className="dim"> </span>
            <span className="key">~/code/acme-web</span>
            <span className="arrow"> ❯ </span>
            <span className="cur"/>
          </div>
        </div>
        <div className="kbd-row">
          {['Esc','Tab','Ctrl','Alt','↑','↓','←','→','/','|','~','-','_'].map(k => (
            <button key={k} className="key" onClick={()=>sendKey(k)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Processes — closer to original: clickable column headers, dense table,
       inline kill, summary header. Adds gentle aurora-aware glass. ── */
window.ProcessesView = function () {
  const [filter, setFilter] = React.useState('');
  const [sortKey, setSortKey] = React.useState('cpu');
  const [sortDir, setSortDir] = React.useState('desc');

  let procs = window.SUPER_DATA.procs.slice();
  if (filter) procs = procs.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.cmd.toLowerCase().includes(filter.toLowerCase()) ||
    String(p.pid).includes(filter));
  procs.sort((a,b) => {
    const av = a[sortKey], bv = b[sortKey];
    const r = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortDir === 'asc' ? r : -r;
  });
  const totalCpu = window.SUPER_DATA.procs.reduce((s,p)=>s+p.cpu,0);
  const totalMem = window.SUPER_DATA.procs.reduce((s,p)=>s+p.mem,0);

  const onSort = (k) => {
    if (sortKey === k) setSortDir(d => d==='asc'?'desc':'asc');
    else { setSortKey(k); setSortDir(k==='name'||k==='pid' ? 'asc' : 'desc'); }
  };
  const arrow = (k) => sortKey===k ? (sortDir==='asc' ? ' ↑' : ' ↓') : '';

  return (
    <div>
      <div className="toolbar">
        <div className="input">
          <Icon name="search"/>
          <input placeholder="Filter by name, command or PID…"
            value={filter} onChange={e=>setFilter(e.target.value)}/>
        </div>
        <button className="btn sm ghost icon" title="Refresh"><Icon name="refresh" size={12}/></button>
      </div>

      {/* Summary strip — like the original meta line, upgraded to a glass header */}
      <div className="card padded" style={{
        display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, padding:'10px 12px', marginBottom:10
      }}>
        <div>
          <div className="muted" style={{fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600}}>Processes</div>
          <div className="tab-num" style={{fontSize:18, fontWeight:600, letterSpacing:'-0.02em'}}>{procs.length}<span className="muted" style={{fontSize:11, marginLeft:4}}>/ {window.SUPER_DATA.procs.length}</span></div>
        </div>
        <div>
          <div className="muted" style={{fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600}}>CPU</div>
          <div className="tab-num" style={{fontSize:18, fontWeight:600, letterSpacing:'-0.02em', color:'var(--accent)'}}>{totalCpu.toFixed(1)}%</div>
        </div>
        <div>
          <div className="muted" style={{fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600}}>Memory</div>
          <div className="tab-num" style={{fontSize:18, fontWeight:600, letterSpacing:'-0.02em'}}>{(totalMem/1024).toFixed(1)}<span className="muted" style={{fontSize:11, marginLeft:2}}>GB</span></div>
        </div>
      </div>

      {/* Table — mirrors old layout: PID | Name | CPU | MEM | kill */}
      <div className="card solid" style={{overflow:'hidden'}}>
        <div style={{
          display:'grid', gridTemplateColumns:'72px 1fr 92px 86px 36px',
          padding:'9px 12px',
          background:'var(--bg-2)',
          borderBottom:'1px solid var(--border)',
          fontSize:10.5, fontWeight:600, color:'var(--text-3)',
          textTransform:'uppercase', letterSpacing:'0.06em',
          fontFamily:'var(--font)',
        }}>
          <span onClick={()=>onSort('pid')} style={{cursor:'pointer'}}>PID{arrow('pid')}</span>
          <span onClick={()=>onSort('name')} style={{cursor:'pointer'}}>Name{arrow('name')}</span>
          <span onClick={()=>onSort('cpu')} style={{cursor:'pointer', textAlign:'right'}}>CPU{arrow('cpu')}</span>
          <span onClick={()=>onSort('mem')} style={{cursor:'pointer', textAlign:'right'}}>MEM{arrow('mem')}</span>
          <span/>
        </div>
        {procs.map(p => (
          <div key={p.pid} style={{
            display:'grid', gridTemplateColumns:'72px 1fr 92px 86px 36px',
            alignItems:'center',
            padding:'8px 12px',
            borderBottom:'1px solid var(--border)',
            fontSize:12,
            transition:'background var(--t1) var(--ease)',
          }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <span className="tab-num mono" style={{color:'var(--text-3)'}}>{p.pid}</span>
            <span style={{minWidth:0}}>
              <div className="truncate" style={{fontWeight:500, color:'var(--text)'}}>{p.name}</div>
              <div className="truncate mono" style={{fontSize:10.5, color:'var(--text-3)'}}>{p.cmd}</div>
            </span>
            <span style={{display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end'}}>
              <span className="tab-num mono" style={{color:'var(--accent)', minWidth:36, textAlign:'right'}}>{p.cpu.toFixed(1)}</span>
              <span style={{flex:'0 0 38px', height:4, background:'var(--bg-3)', borderRadius:99, overflow:'hidden'}}>
                <span style={{display:'block', height:'100%', width: Math.min(100, p.cpu*1.8)+'%',
                  background:'linear-gradient(90deg, var(--accent), var(--accent-2))',
                  borderRadius:99}}/>
              </span>
            </span>
            <span className="tab-num mono" style={{textAlign:'right', color:'var(--text-2)'}}>
              {p.mem >= 1024 ? (p.mem/1024).toFixed(1)+' GB' : p.mem+' MB'}
            </span>
            <button className="btn xs ghost danger" title="Kill" style={{padding:'3px 6px', justifySelf:'end'}}>
              <Icon name="x" size={11}/>
            </button>
          </div>
        ))}
        {!procs.length && (
          <div style={{padding:32, textAlign:'center', color:'var(--text-3)', fontSize:12}}>
            No processes match.
          </div>
        )}
      </div>
    </div>
  );
};

/* ── System ── */
window.SystemView = function () {
  const m = window.SUPER_DATA.metrics;
  const totalDisk = m.disk.reduce((a,d)=>a+d.total,0);
  const usedDisk = m.disk.reduce((a,d)=>a+d.used,0);

  const ring = (pct, color = 'var(--accent)') => {
    const r = 16, c = 2*Math.PI*r;
    return (
      <svg viewBox="0 0 40 40" width={38} height={38}>
        <circle cx="20" cy="20" r={r} stroke="var(--bg-3)" strokeWidth="3" fill="none"/>
        <circle cx="20" cy="20" r={r} stroke={color} strokeWidth="3" fill="none"
                strokeDasharray={c} strokeDashoffset={c*(1-pct/100)}
                strokeLinecap="round" transform="rotate(-90 20 20)"/>
        <text x="20" y="23" textAnchor="middle" fontSize="10" fill="var(--text)" fontWeight="600" fontFamily="var(--mono)">{Math.round(pct)}</text>
      </svg>
    );
  };

  return (
    <div>
      <div className="metrics">
        <div className="card metric">
          <span className="lab">CPU</span>
          <span className="val tab-num">{m.cpu.pct}<span className="unit">%</span></span>
          <Sparkline values={window.SUPER_DATA.spark}/>
          <span className="sub truncate">{m.cpu.model}</span>
        </div>
        <div className="card metric">
          <span className="lab">Memory</span>
          <span className="val tab-num">{m.mem.pct}<span className="unit">%</span></span>
          <Sparkline values={window.SUPER_DATA.spark2}/>
          <span className="sub tab-num">{m.mem.used} / {m.mem.total} GB</span>
        </div>
        <div className="card metric">
          <span className="lab">Disk</span>
          <span className="val tab-num">{Math.round(usedDisk/totalDisk*100)}<span className="unit">%</span></span>
          <div style={{height:32, display:'grid', placeItems:'center'}}>{ring(usedDisk/totalDisk*100)}</div>
          <span className="sub tab-num">{usedDisk} / {totalDisk} GB</span>
        </div>
        <div className="card metric">
          <span className="lab">Uptime</span>
          <span className="val">{m.uptime}</span>
          <Sparkline values={window.SUPER_DATA.spark3}/>
          <span className="sub truncate">{m.host}</span>
        </div>
      </div>

      <div className="sec-title">Cores · {m.cpu.cores.length}</div>
      <div className="card padded">
        <div className="cores">
          {m.cpu.cores.map((c, i) => (
            <div key={i} className="core">
              <div className="lab">CPU{i}</div>
              <div className="num tab-num">{c}%</div>
              <div className="bar"><span style={{width: c+'%'}}/></div>
            </div>
          ))}
        </div>
      </div>

      <div className="sec-title">Disks</div>
      <div className="card solid">
        {m.disk.map((d, i) => (
          <div key={i} className="disk">
            <div className="ring">{ring(d.used/d.total*100, 'var(--info)')}</div>
            <div className="info">
              <div className="name">{d.name}</div>
              <div className="sub tab-num">{d.used} / {d.total} GB · {Math.round(d.used/d.total*100)}% used</div>
            </div>
            <button className="btn xs ghost"><Icon name="more" size={12}/></button>
          </div>
        ))}
      </div>

      <div className="sec-title">Network</div>
      <div className="card solid">
        {m.net.map((n, i) => (
          <div key={i} className="net-row">
            <Icon name="wifi" size={13} color="var(--text-3)"/>
            <span className="name">{n.name}</span>
            <span className="rx">↓ {n.rx}</span>
            <span className="tx">↑ {n.tx}</span>
          </div>
        ))}
      </div>

      <div className="sec-title">Top processes</div>
      <div className="card solid">
        {window.SUPER_DATA.procs.slice(0, 5).map(p => (
          <div key={p.pid} style={{display:'grid', gridTemplateColumns:'1fr 60px 80px', gap:8, padding:'8px 12px', alignItems:'center', borderBottom:'1px solid var(--border)', fontSize:12}}>
            <div className="truncate">{p.name}</div>
            <div className="tab-num" style={{fontFamily:'var(--mono)', textAlign:'right', color:'var(--accent)'}}>{p.cpu.toFixed(1)}%</div>
            <div className="tab-num" style={{fontFamily:'var(--mono)', textAlign:'right', color:'var(--text-2)'}}>{p.mem >= 1024 ? (p.mem/1024).toFixed(1)+' GB' : p.mem+' MB'}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Settings ── */
window.SettingsView = function ({ tweaks, setTweak }) {
  return (
    <div style={{maxWidth:560}}>
      <div className="sec-title">Appearance</div>
      <div className="card set-card">
        <div className="set-row">
          <div className="left">
            <div className="lab">Theme</div>
            <div className="help">Match system, or pick light/dark</div>
          </div>
          <div className="seg">
            {[['dark','moon'],['light','sun'],['auto','monitor']].map(([k, ic]) => (
              <button key={k} className={tweaks.theme===k?'on':''} onClick={()=>setTweak('theme', k)}>
                <Icon name={ic} size={11}/> {k}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div className="left">
            <div className="lab">Accent</div>
            <div className="help">Tints buttons, indicators, charts</div>
          </div>
          <div style={{display:'flex', gap:6}}>
            {['amber','teal','purple','blue','rose','lime'].map(a => (
              <button key={a} className={'swatch' + (tweaks.accent===a?' on':'')}
                      onClick={()=>setTweak('accent', a)}
                      style={{background: ({amber:'#f5a524',teal:'#14b8a6',purple:'#a78bfa',blue:'#60a5fa',rose:'#fb7185',lime:'#a3e635'})[a], color: ({amber:'#f5a524',teal:'#14b8a6',purple:'#a78bfa',blue:'#60a5fa',rose:'#fb7185',lime:'#a3e635'})[a]}}/>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div className="left">
            <div className="lab">Density</div>
            <div className="help">Power-user dense vs calm and airy</div>
          </div>
          <div className="seg">
            {['dense','medium','airy'].map(d => (
              <button key={d} className={tweaks.density===d?'on':''} onClick={()=>setTweak('density', d)}>{d}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div className="left"><div className="lab">Aurora background</div><div className="help">Soft animated wash behind content</div></div>
          <div className={'toggle-sw' + (tweaks.aurora!=='off'?' on':'')} onClick={()=>setTweak('aurora', tweaks.aurora==='off'?'on':'off')}/>
        </div>
      </div>

      <div className="sec-title">Notifications</div>
      <div className="card set-card">
        {[
          ['notifFinished', 'Session finished', 'When a Claude Code session exits.'],
          ['notifAsked',    'Session asks for input', 'When Claude appears to wait on a prompt.'],
          ['notifConsole',  'Long-running console finished', 'For commands taking > 30s.'],
          ['notifDisk',     'Disk space low', 'Below 10% on any volume.'],
        ].map(([k, lab, help]) => (
          <div key={k} className="set-row">
            <div className="left"><div className="lab">{lab}</div><div className="help">{help}</div></div>
            <div className={'toggle-sw' + (tweaks[k]?' on':'')} onClick={()=>setTweak(k, !tweaks[k])}/>
          </div>
        ))}
      </div>

      <div className="sec-title">Console</div>
      <div className="card set-card">
        <div className="set-row">
          <div className="left"><div className="lab">Auto-scroll new shells</div><div className="help">Follow output by default</div></div>
          <div className={'toggle-sw' + (tweaks.autoScroll?' on':'')} onClick={()=>setTweak('autoScroll', !tweaks.autoScroll)}/>
        </div>
        <div className="set-row">
          <div className="left"><div className="lab">Mobile keyboard helper</div><div className="help">Bottom row with Esc/Ctrl/arrows</div></div>
          <div className={'toggle-sw' + (tweaks.kbdHelper?' on':'')} onClick={()=>setTweak('kbdHelper', !tweaks.kbdHelper)}/>
        </div>
      </div>

      <div className="sec-title">About</div>
      <div className="card set-card">
        <div className="set-row">
          <div className="left"><div className="lab">Supervisor</div><div className="help mono">v2.4.0 · build 18432 · {window.SUPER_DATA.metrics.host}</div></div>
          <button className="btn sm ghost"><Icon name="refresh" size={12}/>Check updates</button>
        </div>
        <div className="set-row">
          <div className="left"><div className="lab">Restart server</div><div className="help">Reloads supervisor + all sessions detach</div></div>
          <button className="btn sm danger"><Icon name="rotate" size={12}/>Restart</button>
        </div>
      </div>
    </div>
  );
};
