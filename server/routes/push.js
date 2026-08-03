const express = require('express');
const auth = require('../lib/auth');
const push = require('../lib/push');

const router = express.Router();
router.use(auth.requireAuth);
router.use(express.json({ limit: '64kb' }));

router.get('/vapid-key', (req, res) => res.json({ publicKey: push.vapidPublicKey() }));

router.get('/subscriptions', (req, res) => res.json({ subscriptions: push.listSubs() }));

router.post('/subscribe', (req, res) => {
  const { subscription, label } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'subscription required' });
  const id = push.addSub(subscription, label);
  res.json({ id });
});

router.post('/unsubscribe', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  push.removeSub(id);
  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  const r = await push.broadcast({ title: 'Supervisor test', body: 'Push notifications are working.', url: '/' });
  res.json(r);
});

module.exports = router;
