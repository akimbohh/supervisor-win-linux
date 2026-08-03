// Claude Code Session Supervisor
// Run with: node supervisor.js
// Then open http://localhost:7778 (or http://<your-pc-ip>:7778 from phone)

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 7778;
const ROOT_DIR = process.env.PROJECTS_ROOT || path.join(os.homedir(), 'projects');
const sessions = new Map(); // id -> { id, folder, proc, status, log, startedAt }
let nextId = 1;

// ---------- Session management ----------

function startSession(folder) {
  if (!fs.existsSync(folder)) throw new Error('Folder does not exist: ' + folder);

  const id = nextId++;
  // On Windows, claude is usually claude.cmd. spawn with shell:true handles that.
  const proc = spawn('claude', ['rc'], {
    cwd: folder,
    shell: true,
    windowsHide: false,
  });

  const session = {
    id,
    folder,
    proc,
    status: 'running',
    log: [],
    startedAt: new Date().toISOString(),
  };

  const append = (chunk) => {
    const text = chunk.toString();
    session.log.push(text);
    if (session.log.length > 500) session.log.shift(); // cap memory
  };

  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('exit', (code) => {
    session.status = `exited (code ${code})`;
  });
  proc.on('error', (err) => {
    session.status = 'error: ' + err.message;
  });

  sessions.set(id, session);
  return session;
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    if (process.platform === 'win32') {
      // taskkill is the reliable way to kill a tree on Windows
      spawn('taskkill', ['/pid', s.proc.pid, '/f', '/t'], { shell: true });
    } else {
      s.proc.kill('SIGTERM');
    }
    s.status = 'killed';
    return true;
  } catch (e) {
    return false;
  }
}

function listFolders(parent) {
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => path.join(parent, d.name));
  } catch (e) {
    return [];
  }
}

// ---------- HTTP server ----------

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Static UI
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, INDEX_HTML, 'text/html');
  }

  // List folders under a parent (defaults to ROOT_DIR)
  if (url.pathname === '/api/folders') {
    const parent = url.searchParams.get('parent') || ROOT_DIR;
    return send(res, 200, {
      parent,
      parentExists: fs.existsSync(parent),
      folders: listFolders(parent),
    });
  }

  // List active sessions
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    const list = [...sessions.values()].map(s => ({
      id: s.id,
      folder: s.folder,
      status: s.status,
      startedAt: s.startedAt,
      lastLog: s.log.slice(-3).join(''),
    }));
    return send(res, 200, list);
  }

  // Get single session log
  if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const s = sessions.get(id);
    if (!s) return send(res, 404, { error: 'not found' });
    return send(res, 200, { ...s, proc: undefined, log: s.log.join('') });
  }

  // Spawn new session
  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder } = JSON.parse(body);
        const s = startSession(folder);
        send(res, 200, { id: s.id, folder: s.folder, status: s.status });
      } catch (e) {
        send(res, 400, { error: e.message });
      }
    });
    return;
  }

  // Kill session
  if (url.pathname.startsWith('/api/kill/') && req.method === 'POST') {
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const ok = killSession(id);
    return send(res, ok ? 200 : 404, { ok });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  console.log('\n=== Claude Code Supervisor ===');
  console.log(`Local:    http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`Network:  http://${ip}:${PORT}`));
  console.log(`Projects root: ${ROOT_DIR}`);
  console.log('(Set PROJECTS_ROOT env var to change)\n');
});

// ---------- Embedded UI ----------

const INDEX_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Supervisor</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #111; color: #eee; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 16px; margin: 24px 0 8px; color: #aaa; }
  .row { display: flex; gap: 8px; margin: 8px 0; align-items: center; }
  button { background: #2a6; color: white; border: 0; padding: 10px 14px; border-radius: 6px; font-size: 15px; cursor: pointer; }
  button.kill { background: #c33; }
  button.nav { background: #444; }
  input { flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; font-size: 15px; }
  .folder { padding: 12px; background: #222; border-radius: 6px; margin: 6px 0; display: flex; justify-content: space-between; align-items: center; }
  .folder span { word-break: break-all; font-size: 14px; }
  .session { padding: 12px; background: #1a3a1a; border-radius: 6px; margin: 6px 0; }
  .session .status { font-size: 12px; color: #8c8; }
  .session.dead { background: #3a1a1a; }
  .session.dead .status { color: #c88; }
  .log { font-family: monospace; font-size: 11px; background: #000; padding: 8px; border-radius: 4px; margin-top: 8px; max-height: 100px; overflow: auto; white-space: pre-wrap; }
  .crumbs { font-size: 12px; color: #888; word-break: break-all; margin-bottom: 8px; }
</style>
</head>
<body>
<h1>Claude Code Supervisor</h1>

<h2>Active Sessions</h2>
<div id="sessions"></div>

<h2>Start New Session</h2>
<div class="crumbs" id="crumbs"></div>
<div class="row">
  <input id="path" placeholder="folder path">
  <button onclick="goPath()">Go</button>
</div>
<div id="folders"></div>

<script>
let currentPath = '';

async function refresh() {
  const sess = await fetch('/api/sessions').then(r => r.json());
  document.getElementById('sessions').innerHTML = sess.length === 0
    ? '<div style="color:#666;font-size:14px">none running</div>'
    : sess.map(s => \`
      <div class="session \${s.status === 'running' ? '' : 'dead'}">
        <div><b>#\${s.id}</b> \${s.folder}</div>
        <div class="status">\${s.status} — started \${new Date(s.startedAt).toLocaleTimeString()}</div>
        \${s.lastLog ? '<div class="log">' + escapeHtml(s.lastLog) + '</div>' : ''}
        \${s.status === 'running' ? \`<div class="row"><button class="kill" onclick="kill(\${s.id})">Kill</button></div>\` : ''}
      </div>
    \`).join('');
}

async function loadFolders(parent) {
  const data = await fetch('/api/folders' + (parent ? '?parent=' + encodeURIComponent(parent) : '')).then(r => r.json());
  currentPath = data.parent;
  document.getElementById('path').value = currentPath;
  document.getElementById('crumbs').textContent = data.parentExists ? currentPath : currentPath + ' (does not exist)';
  const parentDir = currentPath.replace(/[\\\\\\/][^\\\\\\/]+$/, '') || currentPath;
  const upBtn = parentDir !== currentPath ? \`<div class="folder"><span>⬆️ up</span><button class="nav" onclick="loadFolders('\${parentDir.replace(/\\\\/g, '\\\\\\\\')}')">Open</button></div>\` : '';
  document.getElementById('folders').innerHTML = upBtn + data.folders.map(f => \`
    <div class="folder">
      <span>\${f.split(/[\\\\\\/]/).pop()}</span>
      <div class="row" style="margin:0">
        <button class="nav" onclick="loadFolders('\${f.replace(/\\\\/g, '\\\\\\\\')}')">Open</button>
        <button onclick="start('\${f.replace(/\\\\/g, '\\\\\\\\')}')">Launch Claude</button>
      </div>
    </div>
  \`).join('');
}

function goPath() {
  loadFolders(document.getElementById('path').value);
}

async function start(folder) {
  const r = await fetch('/api/sessions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({folder}) });
  const j = await r.json();
  if (j.error) alert(j.error); else refresh();
}

async function kill(id) {
  if (!confirm('Kill session ' + id + '?')) return;
  await fetch('/api/kill/' + id, { method: 'POST' });
  refresh();
}

function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

loadFolders('');
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
