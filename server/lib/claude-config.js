// Claude Code workspace-trust helper.
//
// Pre-writing ~/.claude.json with hasTrustDialogAccepted=true is NOT enough
// for `claude rc` (Remote Control) — it does its own check and rejects.
// The only path that actually works is to run interactive `claude` in the
// folder and respond to the trust dialog. We do that here via node-pty:
// spawn claude, wait for the prompt, press Enter (default option is "Yes"),
// then kill.
//
// Successful trusts are cached in data/claude-trusted.json so we don't pay
// the ~3 s startup cost more than once per folder.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { dataPath, ensureDataDir } = require('./store');
const platform = require('../platform');

let pty = null;
try { pty = require('node-pty'); } catch (e) { pty = null; }

const CACHE_FILE = 'claude-trusted.json';
let cache = null;

function loadCache() {
  if (cache) return cache;
  ensureDataDir();
  try { cache = JSON.parse(fs.readFileSync(dataPath(CACHE_FILE), 'utf8')); }
  catch (e) { cache = { folders: [] }; }
  if (!Array.isArray(cache.folders)) cache.folders = [];
  return cache;
}

function saveCache() {
  if (!cache) return;
  try { fs.writeFileSync(dataPath(CACHE_FILE), JSON.stringify(cache, null, 2)); } catch (e) {}
}

function isCached(folder) {
  const abs = path.resolve(folder);
  return loadCache().folders.includes(abs);
}

function markCached(folder) {
  const abs = path.resolve(folder);
  const c = loadCache();
  if (!c.folders.includes(abs)) {
    c.folders.push(abs);
    saveCache();
  }
}

function unmarkCached(folder) {
  const abs = path.resolve(folder);
  const c = loadCache();
  const idx = c.folders.indexOf(abs);
  if (idx !== -1) { c.folders.splice(idx, 1); saveCache(); }
}

// Strip enough ANSI to recognise text in the prompt. Claude's TUI lays out
// menu items using cursor-right escapes (\x1b[NC) instead of literal spaces,
// so we convert those to spaces first — otherwise "Yes, I trust this folder"
// arrives as "Yes,I trustthis folder" and word-boundary regexes miss it.
function stripAnsi(s) {
  return s
    .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Math.min(parseInt(n, 10) || 1, 8)))
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

// Returns { ok, cached, reason }.
async function trustFolderInteractive(folder, { timeoutMs = 8000 } = {}) {
  if (!folder) return { ok: false, reason: 'no folder' };
  if (isCached(folder)) return { ok: true, cached: true };
  if (!pty) return { ok: false, reason: 'node-pty unavailable' };
  if (!fs.existsSync(folder)) return { ok: false, reason: 'folder missing' };

  return new Promise((resolve) => {
    let term;
    try {
      const { cmd, args } = platform.shellRunCommand('claude');
      term = pty.spawn(cmd, args, {
        name: 'xterm-256color', cols: 100, rows: 30,
        cwd: folder, env: process.env,
      });
    } catch (e) { return resolve({ ok: false, reason: 'spawn: ' + e.message }); }

    let buf = '';
    let sent = false;
    let settled = false;
    const settle = (v) => {
      if (settled) return; settled = true;
      try { term.kill(); } catch (e) {}
      resolve(v);
    };

    term.onData((d) => {
      buf += d;
      if (!sent) {
        const visible = stripAnsi(buf);
        if (/trust this folder|safety check|Yes, I trust/i.test(visible)) {
          // Default selection is "Yes, I trust this folder" — Enter confirms.
          try { term.write('\r'); } catch (e) {}
          sent = true;
          // Give claude a beat to persist trust state, then kill.
          setTimeout(() => {
            markCached(folder);
            settle({ ok: true });
          }, 1200);
        }
      }
    });

    term.onExit(() => {
      if (!settled) settle({ ok: sent, reason: sent ? null : 'claude exited before prompt' });
    });

    setTimeout(() => settle({ ok: sent, reason: sent ? 'kill after grace' : 'timeout waiting for trust prompt' }), timeoutMs);
  });
}

function listCached() { return loadCache().folders.slice(); }

function clearCache() { cache = { folders: [] }; saveCache(); }

module.exports = {
  trustFolderInteractive,
  isCached,
  markCached,
  unmarkCached,
  listCached,
  clearCache,
};
