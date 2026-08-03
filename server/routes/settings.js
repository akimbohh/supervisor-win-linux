const express = require('express');
const auth = require('../lib/auth');
const settings = require('../lib/settings');
const hub = require('../lib/hub');

const router = express.Router();
router.use(auth.requireAuth);

router.get('/', (req, res) => res.json(settings.get()));

router.patch('/', express.json({ limit: '1mb' }), (req, res) => {
  const patch = req.body || {};
  // Defensive: don't allow blanket overwrite of trustedDevices via PATCH
  delete patch.trustedDevices;
  const next = settings.update(patch);
  hub.publish('settings', next);
  res.json(next);
});

router.post('/reset', (req, res) => {
  const next = settings.reset();
  hub.publish('settings', next);
  res.json(next);
});

router.get('/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="supervisor-settings.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(settings.get(), null, 2));
});

router.post('/import', express.json({ limit: '5mb' }), (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Invalid' });
  // Drop unknown top-level keys not present in defaults
  const allowed = Object.keys(settings.get());
  const clean = {};
  for (const k of Object.keys(incoming)) if (allowed.includes(k)) clean[k] = incoming[k];
  const next = settings.update(clean);
  hub.publish('settings', next);
  res.json(next);
});

module.exports = router;
