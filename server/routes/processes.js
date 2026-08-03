const express = require('express');
const auth = require('../lib/auth');
const metrics = require('../lib/metrics');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json());

router.get('/', async (req, res) => {
  try {
    const procs = await metrics.listProcs();
    res.json({ procs, t: Date.now() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:pid/kill', async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  if (!pid) return res.status(400).json({ error: 'pid required' });
  // Refuse to kill ourselves.
  if (pid === process.pid) return res.status(400).json({ error: 'Refusing to kill the supervisor itself' });
  const ok = await metrics.killPid(pid);
  res.status(ok ? 200 : 500).json({ ok });
});

module.exports = router;
