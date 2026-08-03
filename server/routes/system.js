const express = require('express');
const auth = require('../lib/auth');
const metrics = require('../lib/metrics');
const platform = require('../platform');

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

// Capability map the frontend consumes to decide what to render (§3.2).
router.get('/capabilities', (req, res) => res.json(platform.capabilities()));

router.post('/power', async (req, res) => {
  const { action, password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (!auth.getCreds() || !auth.verifyPassword(password, auth.getCreds())) return res.status(401).json({ error: 'Wrong password' });
  if (!['shutdown', 'restart', 'sleep', 'cancel'].includes(action)) return res.status(400).json({ error: 'Unknown action' });

  const caps = platform.capabilities();
  if (action === 'sleep' && !caps.power.sleep) {
    return res.status(400).json({ error: 'Sleep is unavailable on this host' });
  }
  // powerAction reports real success/failure now (P-3): a permission error no
  // longer returns {ok:true} after the response has been sent.
  const result = await platform.powerAction(action);
  if (result.ok) res.json({ ok: true, scheduled: result.scheduled });
  else res.status(500).json({ error: result.error || 'Power action failed' });
});

// ── Linux-native features (§5). Each is gated on the capability; the adapter
// helper only exists on the Linux adapter, so unsupported hosts get a clean 400
// the frontend renders as a disabled section with a reason. ──────────────────
function requireHelper(name, res) {
  if (typeof platform[name] !== 'function') { res.status(400).json({ error: 'Not supported on this host' }); return false; }
  return true;
}

router.get('/services', async (req, res) => {
  if (!requireHelper('listServices', res)) return;
  try { res.json(await platform.listServices()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/services/:unit/:action', async (req, res) => {
  if (!requireHelper('serviceControl', res)) return;
  // Controlling services is privileged and destructive — re-confirm the password.
  const { password } = req.body || {};
  if (!password || !auth.getCreds() || !auth.verifyPassword(password, auth.getCreds())) return res.status(401).json({ error: 'Wrong password' });
  try { res.json(await platform.serviceControl(req.params.unit, req.params.action)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ports', async (req, res) => {
  if (!requireHelper('listeningPorts', res)) return;
  try { res.json(await platform.listeningPorts()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/packages', async (req, res) => {
  if (!requireHelper('packageStatus', res)) return;
  try { res.json(await platform.packageStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/firewall', async (req, res) => {
  if (!requireHelper('firewallStatus', res)) return;
  try { res.json(await platform.firewallStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
