// Interactive Claude API. Streams over the WS hub topic `claude:<requestId>`;
// these REST endpoints start/stop runs and read conversation history.
const os = require('os');
const fs = require('fs');
const express = require('express');
const auth = require('../lib/auth');
const interactive = require('../lib/interactive');
const { ensureSafe } = require('../lib/paths');
const platform = require('../platform');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '1mb' }));

function mapErr(res, e) {
  if (e.code === 'ENOCLAUDE') return res.status(400).json({ error: e.message, capability: 'claude' });
  if (e.code === 'EBLOCKED') return res.status(403).json({ error: e.message });
  if (e.code === 'ENOENT') return res.status(404).json({ error: e.message });
  if (e.code === 'ELIMIT') return res.status(429).json({ error: e.message });
  if (e.code === 'EBUSY') return res.status(409).json({ error: e.message });
  if (e.code === 'EINVAL') return res.status(400).json({ error: e.message });
  return res.status(500).json({ error: e.message });
}

// Start a streaming run. The client subscribes to the returned topic, then
// replays anything it missed via GET /chats/:chatId?since=<seq>.
router.post('/chat', (req, res) => {
  try {
    const { message, chatId, sessionId, cwd, permissionMode, allowedTools, addDirs, model } = req.body || {};
    const r = interactive.start({ message, chatId, sessionId, cwd, permissionMode, allowedTools, addDirs, model });
    res.json(r);
  } catch (e) { mapErr(res, e); }
});

router.post('/abort', (req, res) => {
  const { requestId, chatId } = req.body || {};
  if (!requestId && !chatId) return res.status(400).json({ error: 'requestId or chatId required' });
  res.json({ ok: requestId ? interactive.abort(requestId) : interactive.abortChat(chatId) });
});

// Server-side chats (survive the client; lost on server restart — the client
// then falls back to the on-disk transcript via sessionId).
router.get('/chats', (req, res) => res.json({ chats: interactive.listChats() }));

// Create an idle chat up-front (the "New session in <folder>" flow); the
// first message spawns the actual run.
router.post('/chats', (req, res) => {
  try {
    const { cwd, name, addDirs } = req.body || {};
    const safe = cwd ? ensureSafe(cwd) : os.homedir();
    if (!fs.existsSync(safe)) { const e = new Error('cwd does not exist'); e.code = 'ENOENT'; throw e; }
    const chat = interactive.createChat({ cwd: safe, name, addDirs });
    res.json(interactive.snapshot(chat.chatId, 0));
  } catch (e) { mapErr(res, e); }
});

router.get('/chats/:chatId', (req, res) => {
  const snap = interactive.snapshot(req.params.chatId, req.query.since);
  if (!snap) return res.status(404).json({ error: 'unknown chat (server restarted?)' });
  res.json(snap);
});

router.post('/chats/:chatId/rename', (req, res) => {
  const ok = interactive.renameChat(req.params.chatId, (req.body || {}).name);
  if (!ok) return res.status(404).json({ error: 'unknown chat' });
  res.json({ ok: true });
});

router.delete('/chats/:chatId', (req, res) => {
  const ok = interactive.deleteChat(req.params.chatId);
  if (!ok) return res.status(404).json({ error: 'unknown chat' });
  res.json({ ok: true });
});

// Replace the chat's --add-dir list (takes effect on the next message).
router.post('/chats/:chatId/dirs', (req, res) => {
  try {
    const dirs = interactive.setChatDirs(req.params.chatId, (req.body || {}).dirs);
    if (dirs === null) return res.status(404).json({ error: 'unknown chat' });
    res.json({ addDirs: dirs });
  } catch (e) { mapErr(res, e); }
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
