// Self-maintenance endpoints — run a one-shot headless Claude in the
// supervisor's own repo, hand off to an interactive shell, then restart.
const express = require('express');
const fs = require('fs');
const auth = require('../lib/auth');
const settings = require('../lib/settings');
const maintenance = require('../lib/maintenance');
const restart = require('../lib/restart');
const shells = require('../lib/shells');
const claudeConfig = require('../lib/claude-config');
const hub = require('../lib/hub');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '256kb' }));

router.get('/status', (req, res) => {
  res.json(maintenance.snapshot());
});

router.post('/request', (req, res) => {
  const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text required' });

  const repoPath = settings.get().selfRepoPath;
  if (!repoPath || !fs.existsSync(repoPath)) {
    return res.status(400).json({ error: 'selfRepoPath not set or missing — configure in Settings' });
  }

  if (maintenance.isBusy()) {
    return res.status(409).json({ error: 'A maintenance run is already in progress' });
  }

  try {
    const snap = maintenance.start({ prompt: text, cwd: repoPath });
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/cancel', (req, res) => {
  const ok = maintenance.cancel();
  res.json({ ok });
});

router.post('/reset', (req, res) => {
  const ok = maintenance.reset();
  res.json({ ok });
});

// Hand off to an interactive Claude session inside the supervisor's repo.
// Creates a regular console shell, types `claude`, and auto-pastes the user's
// prompt once Claude's UI has settled. Mobile users can't Ctrl+V, so this is
// the only viable handoff path.
router.post('/interactive', async (req, res) => {
  const repoPath = settings.get().selfRepoPath;
  if (!repoPath || !fs.existsSync(repoPath)) {
    return res.status(400).json({ error: 'selfRepoPath not set or missing — configure in Settings' });
  }

  // Pre-accept the workspace trust dialog so it doesn't eat the auto-pasted
  // prompt. trustFolderInteractive caches per folder, so this is a no-op
  // after the first run.
  if (settings.get().autoTrustClaudeFolders !== false) {
    try { await claudeConfig.trustFolderInteractive(repoPath); } catch (e) {}
  }

  const meta = shells.create({ cwd: repoPath, name: 'Maintenance Claude' });
  const shellId = meta.id;
  const bodyText = (req.body && typeof req.body.text === 'string') ? req.body.text : '';
  const snap = maintenance.snapshot();
  // Claude's TUI handles single-line input cleanly; collapse newlines so the
  // prompt doesn't get committed early.
  const promptText = (bodyText || snap.prompt || '').replace(/\r\n?|\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Phase 1: type `claude` after a beat so cmd is ready.
  setTimeout(() => {
    try { shells.write(shellId, 'claude\r'); } catch (e) {}
  }, 800);

  // Phase 2: paste the prompt once Claude's UI has settled. We watch the
  // shell's output stream and paste 1.5 s after the last byte (i.e. quiet
  // period). Hard timeout at 15 s so we don't wait forever.
  if (promptText) {
    let pasted = false;
    let pasteTimer = null;
    const topic = 'shell:' + shellId;
    const finish = () => {
      if (pasted) return;
      pasted = true;
      try { shells.write(shellId, promptText + '\r'); } catch (e) {}
      hub.removeListener(topic, onPayload);
      if (pasteTimer) { clearTimeout(pasteTimer); pasteTimer = null; }
    };
    function onPayload(payload) {
      if (!payload || payload.event !== 'data') return;
      if (pasteTimer) clearTimeout(pasteTimer);
      pasteTimer = setTimeout(finish, 1500);
    }
    hub.on(topic, onPayload);
    setTimeout(() => { if (!pasted) finish(); }, 15000);
  }

  res.json({ shellId, prompt: promptText });
});

router.post('/restart', (req, res) => {
  try {
    restart.selfRestart();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
