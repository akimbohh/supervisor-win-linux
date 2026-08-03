// Web Push manager: VAPID keys (auto-generated), subscriptions, broadcast.
const crypto = require('crypto');
const webpush = require('web-push');
const { readJSON, writeJSON } = require('./store');
const settings = require('./settings');
const hub = require('./hub');

const VAPID_FILE = 'vapid.json';
const SUBS_FILE = 'push-subs.json';

function loadVapid() {
  let v = readJSON(VAPID_FILE, null);
  if (!v || !v.publicKey || !v.privateKey) {
    v = webpush.generateVAPIDKeys();
    writeJSON(VAPID_FILE, v);
  }
  webpush.setVapidDetails('mailto:supervisor@local', v.publicKey, v.privateKey);
  return v;
}
const vapid = loadVapid();

function getSubs() { return readJSON(SUBS_FILE, []); }
function saveSubs(list) { writeJSON(SUBS_FILE, list); }

function subId(sub) {
  return crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 16);
}

function addSub(sub, label) {
  const list = getSubs();
  const id = subId(sub);
  if (list.find(s => s.id === id)) return id;
  list.push({ id, label: label || 'device', sub, when: Date.now() });
  saveSubs(list);
  return id;
}
function removeSub(id) {
  const list = getSubs().filter(s => s.id !== id);
  saveSubs(list);
}
function listSubs() {
  return getSubs().map(s => ({ id: s.id, label: s.label, when: s.when, endpoint: s.sub.endpoint }));
}

async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    // 410 Gone / 404 → drop
    if (e.statusCode === 410 || e.statusCode === 404) {
      const list = getSubs().filter(s => s.sub.endpoint !== sub.endpoint);
      saveSubs(list);
      return { ok: false, dropped: true };
    }
    return { ok: false, error: e.message };
  }
}

async function broadcast(payload) {
  const list = getSubs();
  if (!list.length) return { sent: 0 };
  const results = await Promise.all(list.map(s => sendTo(s.sub, payload)));
  return { sent: results.filter(r => r.ok).length, dropped: results.filter(r => r.dropped).length };
}

// Bridge hub 'notify' events → push notifications, gated by settings.
hub.on('notify', async (e) => {
  const ns = settings.get().notifications || {};
  let title = 'Supervisor', body = '', tag, url, sticky = false;
  if (e.kind === 'finished') {
    if (!ns.sessionFinished) return;
    title = 'Session finished';
    body = (e.name || (e.folder || '').split(/[\\/]/).pop() || '') + ' • ' + e.status;
    tag = 'session-' + e.sessionId; url = '/#sessions';
  } else if (e.kind === 'asked') {
    if (!ns.sessionAskedForInput) return;
    title = 'Claude needs you';
    body = (e.name || (e.folder || '').split(/[\\/]/).pop() || '') + ' is waiting for input.';
    tag = 'session-' + e.sessionId; url = '/#sessions'; sticky = true;
  } else if (e.kind === 'error') {
    title = 'Session error';
    body = (e.name || (e.folder || '').split(/[\\/]/).pop() || '') + ' • ' + e.status;
    tag = 'session-' + e.sessionId; url = '/#sessions';
  } else if (e.kind === 'disk-low') {
    if (!ns.diskLow) return;
    const thresh = ns.diskLowThresholdPct || 10;
    if (100 - e.pct > thresh) return;
    title = 'Disk almost full';
    body = e.mount + ' is ' + Math.round(e.pct) + '% used.';
    tag = 'disk-' + e.mount; url = '/#system';
  } else {
    title = e.title || 'Supervisor';
    body = e.body || '';
    url = e.url || '/';
    tag = e.tag;
  }
  await broadcast({ title, body, tag, url, sticky });
});

module.exports = {
  vapidPublicKey: () => vapid.publicKey,
  addSub, removeSub, listSubs, broadcast, sendTo,
};
