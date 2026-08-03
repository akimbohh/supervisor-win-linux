const express = require('express');
const auth = require('../lib/auth');
const shells = require('../lib/shells');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '256kb' }));

router.get('/', (req, res) => res.json(shells.list()));

router.get('/:id', (req, res) => {
  const s = shells.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.post('/', (req, res) => {
  try {
    const { name, cwd, shellPath, shellArgs, cols, rows } = req.body || {};
    res.json(shells.create({ name, cwd, shellPath, shellArgs, cols, rows }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/write', (req, res) => {
  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data required' });
  const ok = shells.write(req.params.id, data);
  res.status(ok ? 200 : 404).json({ ok });
});

router.post('/:id/resize', (req, res) => {
  const { cols, rows } = req.body || {};
  shells.resize(req.params.id, cols, rows);
  res.json({ ok: true });
});

router.post('/:id/kill', (req, res) => {
  const ok = shells.kill(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

router.patch('/:id', (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const ok = shells.rename(req.params.id, name);
  res.status(ok ? 200 : 404).json({ ok });
});

router.delete('/:id', (req, res) => {
  const ok = shells.destroy(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

module.exports = router;
