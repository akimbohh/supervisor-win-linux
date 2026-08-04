// Interactive Claude API. Streams over the WS hub topic `claude:<requestId>`;
// these REST endpoints start/stop runs and read conversation history.
const express = require('express');
const auth = require('../lib/auth');
const interactive = require('../lib/interactive');
const platform = require('../platform');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '1mb' }));

function mapErr(res, e) {
  if (e.code === 'ENOCLAUDE') return res.status(400).json({ error: e.message, capability: 'claude' });
  if (e.code === 'EBLOCKED') return res.status(403).json({ error: e.message });
  if (e.code === 'ENOENT') return res.status(404).json({ error: e.message });
  if (e.code === 'ELIMIT') return res.status(429).json({ error: e.message });
  if (e.code === 'EINVAL') return res.status(400).json({ error: e.message });
  return res.status(500).json({ error: e.message });
}

// Start a streaming run. The client subscribes to the returned topic first.
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, cwd, permissionMode, allowedTools } = req.body || {};
    const r = await interactive.start({ message, sessionId, cwd, permissionMode, allowedTools });
    res.json(r);
  } catch (e) { mapErr(res, e); }
});

router.post('/abort', (req, res) => {
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });
  res.json({ ok: interactive.abort(requestId) });
});

router.get('/runs', (req, res) => res.json({ runs: interactive.listRuns() }));

router.get('/projects', async (req, res) => {
  try { res.json(await interactive.listProjects()); } catch (e) { mapErr(res, e); }
});

router.get('/conversations', async (req, res) => {
  try { res.json(await interactive.listConversations(req.query.cwd)); } catch (e) { mapErr(res, e); }
});

router.get('/conversation', async (req, res) => {
  try { res.json(await interactive.readConversation(req.query.cwd, req.query.sessionId)); } catch (e) { mapErr(res, e); }
});

// Convenience: is Claude available here?
router.get('/status', (req, res) => res.json({ available: !!platform.capabilities().claude, runs: interactive.count() }));

module.exports = router;
