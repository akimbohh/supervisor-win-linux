const express = require('express');
const auth = require('../lib/auth');
const sessions = require('../lib/sessions');
const settings = require('../lib/settings');
const hub = require('../lib/hub');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '1mb' }));

router.get('/', (req, res) => res.json(sessions.list()));

router.get('/presets', (req, res) => res.json({ presets: settings.get().presets || [] }));

router.post('/presets', (req, res) => {
  const presets = (settings.get().presets || []).slice();
  const p = req.body || {};
  if (!p.id) p.id = 'p' + Date.now().toString(36);
  const idx = presets.findIndex(x => x.id === p.id);
  if (idx >= 0) presets[idx] = p; else presets.push(p);
  settings.update({ presets });
  res.json({ id: p.id, presets });
});

router.delete('/presets/:id', (req, res) => {
  const presets = (settings.get().presets || []).filter(p => p.id !== req.params.id);
  settings.update({ presets });
  res.json({ ok: true, presets });
});

router.get('/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.post('/', async (req, res) => {
  try {
    const { folder, args, env, prePrompt, name, tag, command } = req.body || {};
    if (!folder) return res.status(400).json({ error: 'folder required' });
    const s = await sessions.start({ folder, args, env, prePrompt, name, tag, command });
    res.json(s);
  } catch (e) {
    if (e.code === 'EBLOCKED') return res.status(403).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: e.message });
    if (e.code === 'ELIMIT') return res.status(429).json({ error: e.message });
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/kill', (req, res) => {
  const ok = sessions.kill(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

router.post('/:id/restart', async (req, res) => {
  try {
    const s = await sessions.restart(req.params.id);
    res.json(s);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/input', (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
    sessions.sendInput(req.params.id, text);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id', (req, res) => {
  const { name, tag } = req.body || {};
  const ok = sessions.setName(req.params.id, name, tag);
  res.status(ok ? 200 : 404).json({ ok });
});

router.delete('/:id', (req, res) => {
  const ok = sessions.clear(req.params.id);
  res.status(ok ? 200 : 404).json({ ok, error: ok ? null : 'Session not found' });
});

router.post('/clear-exited', (req, res) => {
  const n = sessions.clearAllExited();
  res.json({ removed: n });
});

module.exports = router;
