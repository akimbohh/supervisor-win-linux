const express = require('express');
const cp = require('child_process');
const auth = require('../lib/auth');
const metrics = require('../lib/metrics');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json());

// Start broadcasting once any client cares.
metrics.startLive(1500);

router.get('/', async (req, res) => {
  try { res.json({ snap: await metrics.snapshot(), history: metrics.getHistory() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', (req, res) => res.json(metrics.getHistory()));

router.post('/power', async (req, res) => {
  const { action, password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (!auth.getCreds() || !auth.verifyPassword(password, auth.getCreds())) return res.status(401).json({ error: 'Wrong password' });
  let cmd = null;
  if (action === 'shutdown') cmd = process.platform === 'win32' ? 'shutdown /s /t 5' : 'shutdown -h +0';
  else if (action === 'restart') cmd = process.platform === 'win32' ? 'shutdown /r /t 5' : 'shutdown -r +0';
  else if (action === 'sleep') cmd = process.platform === 'win32'
      ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
      : 'systemctl suspend';
  else if (action === 'cancel') cmd = process.platform === 'win32' ? 'shutdown /a' : 'shutdown -c';
  else return res.status(400).json({ error: 'Unknown action' });
  try { cp.exec(cmd, { timeout: 5000 }); res.json({ ok: true, scheduled: cmd }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
