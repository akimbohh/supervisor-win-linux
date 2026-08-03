/* Supervisor service worker — bumped cache + new file list.
 * Strategy:
 *   - HTML / app code: network-first with cache fallback (updates propagate fast).
 *   - /vendor/*: cache-first (rarely changes, expensive to refetch).
 *   - /api/*, /ws: never intercepted.
 *
 * Page-side companions live in index.html: 5min update poll, skipWaiting on
 * install, reload-on-controllerchange.
 */
const CACHE = 'supervisor-shell-v5';
const PRECACHE = [
  '.',
  'index.html',
  'login.html',
  'styles.css',
  'icons.jsx',
  'util.jsx',
  'modal.jsx',
  'toast.jsx',
  'sheet.jsx',
  'ws.jsx',
  'tweaks-panel.jsx',
  'view-sessions.jsx',
  'view-others.jsx',
  'app.jsx',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isVendor(pathname) { return pathname.includes('/vendor/'); }
function isFontHost(host) { return host.includes('fonts.g'); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pass through API + WS untouched.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Vendor assets: cache-first (CodeMirror/xterm/highlight/pdfjs are static).
  if (isVendor(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const clone = r.clone();
        caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        return r;
      }))
    );
    return;
  }

  // Google fonts: stale-while-revalidate.
  if (isFontHost(url.hostname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const fetched = fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // Default (app shell + JSX): network-first, cache fallback.
  e.respondWith(
    fetch(req).then((r) => {
      if (r && r.ok) {
        const clone = r.clone();
        caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: e.data && e.data.text() }; }
  const title = data.title || 'Supervisor';
  const opts = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag,
    data: data.url ? { url: data.url } : null,
    requireInteraction: !!data.sticky,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.startsWith(self.location.origin)) { c.focus(); c.navigate(url); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('message', async (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'purgeCache') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    if (e.source && e.source.postMessage) e.source.postMessage('cachePurged');
  }
});
