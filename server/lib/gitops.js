// Git sync for the supervisor repo. Lets the UI commit + push Claude's edits to
// GitHub in one tap (so self-edits never sit uncommitted and block a later
// pull), and pull updates back. Runs git in `selfRepoPath`.
//
// The GitHub token is stored write-only in data/git-token.json (or the
// SUPERVISOR_GITHUB_TOKEN env var) — never returned by any API, never written
// into .git/config. Pushes use a one-shot tokenized URL passed as an argv
// argument, and every command's output is scrubbed of the token before it
// leaves the server.
const cp = require('child_process');
const path = require('path');
const settings = require('./settings');
const { readJSON, writeJSON } = require('./store');

function repoDir() { return settings.get().selfRepoPath || path.resolve(__dirname, '..', '..'); }

function git(args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    // execFile with an argv array — no shell, so nothing here is injectable.
    cp.execFile('git', args, { cwd: repoDir(), timeout, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

// ── Token (write-only) ──────────────────────────────────────────────────────
function getToken() {
  if (process.env.SUPERVISOR_GITHUB_TOKEN) return process.env.SUPERVISOR_GITHUB_TOKEN;
  const t = readJSON('git-token.json', null);
  return t && t.token ? t.token : null;
}
function setToken(tok) { writeJSON('git-token.json', { token: String(tok || '') }); }
function hasToken() { return !!getToken(); }

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────
// Inject a token into an https GitHub URL without persisting it anywhere.
function injectToken(url, token) {
  if (!url || !token || !/^https:\/\//i.test(url)) return url;
  return url.replace(/^https:\/\/([^@/]*@)?/i, 'https://x-access-token:' + token + '@');
}
// Never let the token appear in output returned to a client / logs.
function scrub(text, token) {
  if (!text) return text;
  let s = String(text);
  if (token) s = s.split(token).join('***');
  return s.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}

// ── Status ───────────────────────────────────────────────────────────────
async function status() {
  const branchR = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const porcelain = await git(['status', '--porcelain']);
  const changes = porcelain.out ? porcelain.out.split('\n').filter(Boolean) : [];
  let ahead = 0, behind = 0, upstream = null;
  const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (up.ok) {
    upstream = up.out;
    const ab = await git(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    if (ab.ok) { const [b, a] = ab.out.split(/\s+/); behind = parseInt(b, 10) || 0; ahead = parseInt(a, 10) || 0; }
  }
  const last = await git(['log', '-1', '--format=%h %s (%cr)']);
  const isRepo = branchR.ok;
  return {
    isRepo, repo: repoDir(),
    branch: branchR.ok ? branchR.out : null,
    dirty: changes.length > 0, changeCount: changes.length, changes: changes.slice(0, 200),
    ahead, behind, upstream,
    lastCommit: last.ok ? last.out : null,
    hasToken: hasToken(),
  };
}

// ── Actions ──────────────────────────────────────────────────────────────
async function commitAll(message) {
  const add = await git(['add', '-A']);
  if (!add.ok) return { ok: false, error: scrub(add.err || 'git add failed', getToken()) };
  const st = await git(['status', '--porcelain']);
  if (!st.out) return { ok: true, committed: false, reason: 'nothing to commit' };
  await git(['config', 'user.email', 'supervisor@local']);
  await git(['config', 'user.name', 'Supervisor']);
  const msg = (message && String(message).trim()) ? String(message).trim().slice(0, 200)
    : ('supervisor: changes ' + new Date().toISOString());
  const c = await git(['commit', '-m', msg]);
  if (!c.ok) return { ok: false, error: scrub(c.err || c.out || 'git commit failed', getToken()) };
  const h = await git(['rev-parse', '--short', 'HEAD']);
  return { ok: true, committed: true, hash: h.out, message: msg };
}

async function push({ branch } = {}) {
  const token = getToken();
  if (!token) return { ok: false, error: 'No GitHub token set — add one under Settings → Sync.', needToken: true };
  const st = await status();
  const target = branch || st.branch;
  if (!target) return { ok: false, error: 'Not a git repository' };
  const urlR = await git(['remote', 'get-url', 'origin']);
  if (!urlR.ok) return { ok: false, error: 'No "origin" remote configured' };
  const authUrl = injectToken(urlR.out, token);
  const r = await git(['push', authUrl, 'HEAD:' + target], { timeout: 60000 });
  if (!r.ok) return { ok: false, error: scrub(r.err || r.out || 'push failed', token), branch: target };
  return { ok: true, out: scrub(r.err || r.out || 'pushed', token), branch: target };
}

// Update from GitHub. hard=true does fetch + reset --hard (server tree becomes
// an exact copy of the remote — safe once local edits are pushed); otherwise a
// merge, which can conflict.
async function pull({ hard, branch } = {}) {
  const st = await status();
  const target = branch || st.branch;
  if (!target) return { ok: false, error: 'Not a git repository' };
  const f = await git(['fetch', 'origin', target], { timeout: 60000 });
  if (!f.ok) return { ok: false, error: scrub(f.err || 'fetch failed', getToken()) };
  if (hard) {
    const r = await git(['reset', '--hard', 'origin/' + target]);
    return { ok: r.ok, mode: 'hard', out: scrub(r.out || r.err || 'reset', getToken()) };
  }
  const r = await git(['merge', '--no-edit', 'origin/' + target], { timeout: 30000 });
  return { ok: r.ok, mode: 'merge', out: scrub(r.ok ? (r.out || 'updated') : (r.err || r.out), getToken()) };
}

module.exports = {
  status, commitAll, push, pull, getToken, setToken, hasToken,
  injectToken, scrub, // for tests
};
