const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { tmpDataDir } = require('./helpers');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function waitFor(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await req({ host: '127.0.0.1', port, path: '/login', method: 'GET' }); if (r.status) return true; }
    catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server did not come up');
}

test('server boots, auth works, secured routes respond, shuts down clean', async () => {
  const port = await freePort();
  const env = {
    ...process.env,
    SUPERVISOR_DATA_DIR: tmpDataDir(),
    SUPERVISOR_PASSWORD: 'smoketest123',
    SUPERVISOR_PORT: String(port),
    SUPERVISOR_BIND: '127.0.0.1',
  };
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env, stdio: 'ignore' });
  try {
    await waitFor(port);

    // Unauthenticated identity check is 401.
    let r = await req({ host: '127.0.0.1', port, path: '/api/auth/me', method: 'GET' });
    assert.equal(r.status, 401, '/api/auth/me unauthenticated');

    // CSP header is present on the app shell.
    r = await req({ host: '127.0.0.1', port, path: '/login', method: 'GET' });
    assert.match(r.headers['content-security-policy'] || '', /script-src 'self'/);

    // Login.
    r = await req(
      { host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ password: 'smoketest123' }),
    );
    assert.equal(r.status, 200, 'login succeeds');
    const cookie = (r.headers['set-cookie'] || [''])[0].split(';')[0];
    assert.match(cookie, /^sup_sess=/, 'session cookie set');

    // Authenticated route.
    r = await req({ host: '127.0.0.1', port, path: '/api/settings', method: 'GET', headers: { Cookie: cookie } });
    assert.equal(r.status, 200, '/api/settings authenticated');

    // Capabilities endpoint.
    r = await req({ host: '127.0.0.1', port, path: '/api/system/capabilities', method: 'GET', headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.ok(JSON.parse(r.body).platform, 'capabilities has platform');

    // Blocked-path read is refused.
    const secret = path.join(require('../server/lib/paths').REPO_ROOT, 'data', 'secret.bin');
    r = await req({ host: '127.0.0.1', port, path: '/api/files/read?path=' + encodeURIComponent(secret), method: 'GET', headers: { Cookie: cookie } });
    assert.equal(r.status, 403, 'reading app secrets is blocked');
  } finally {
    proc.kill('SIGTERM');
    await new Promise(r => { proc.on('exit', r); setTimeout(r, 3000); });
  }
});
