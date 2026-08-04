// Git sync API — commit + push the supervisor repo to GitHub, pull updates,
// set the (write-only) token. Behind auth.
const express = require('express');
const auth = require('../lib/auth');
const gitops = require('../lib/gitops');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '64kb' }));

router.get('/status', async (req, res) => {
  try { res.json(await gitops.status()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Commit any local changes, then push. One tap after a Claude edit.
router.post('/push', async (req, res) => {
  try {
    const commit = await gitops.commitAll(req.body && req.body.message);
    if (commit.ok === false) return res.status(500).json({ commit });
    const push = await gitops.push({ branch: req.body && req.body.branch });
    res.status(push.ok ? 200 : (push.needToken ? 400 : 500)).json({ commit, push });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/commit', async (req, res) => {
  try { res.json(await gitops.commitAll(req.body && req.body.message)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pull', async (req, res) => {
  try {
    const r = await gitops.pull({ hard: !!(req.body && req.body.hard), branch: req.body && req.body.branch });
    res.status(r.ok ? 200 : 500).json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Store the GitHub token (write-only; never returned).
router.post('/token', (req, res) => {
  const t = req.body && req.body.token;
  if (typeof t !== 'string' || !t.trim()) return res.status(400).json({ error: 'token required' });
  gitops.setToken(t.trim());
  res.json({ ok: true, hasToken: gitops.hasToken() });
});

module.exports = router;
