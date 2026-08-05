// Supervisor service worker.
// Strategy:
//   - HTML / app JS / CSS / icons.js / SW itself: network-first with cache
//     fallback. Updates propagate immediately, but the app still works offline.
//   - /vendor/* (CodeMirror, xterm, pdf.js, highlight.js): cache-first. These
//     never change between releases, no point re-fetching.
//   - /api/* and /ws: network-only (never cached, never intercepted).

// v24: liquid-glass button skin — new --glass-* tokens in styles.css + the
// #lg-refract SVG filter in index.html (see LIQUID-GLASS-PROMPT.md).
const CACHE = 'supervisor-shell-v27';
const PRECACHE = [
  '/',
  '/login',
  '/login.js',
  '/styles.css',
  '/app.js',
  '/icons.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isVendor(pathname) { return pathname.startsWith('/vendor/'); }
function isAppCode(pathname) {
  return pathname === '/' || pathname === '/login'
    || pathname.endsWith('.html')
    || pathname === '/app.js' || pathname === '/icons.js' || pathname === '/styles.css'
    || pathname === '/sw.js' || pathname === '/manifest.webmanifest'
    || pathname.startsWith('/views/') || pathname.startsWith('/components/');
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  if (isVendor(url.pathname)) {
    // Cache-first.
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        return r;
      }))
    );
    return;
  }

  if (isAppCode(url.pathname) || e.request.mode === 'navigate') {
    // Network-first with cache fallback. Updates propagate immediately.
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request).then(m => m || caches.match('/')))
    );
    return;
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: e.data && e.data.text() }; }
  const title = data.title || 'Supervisor';
  const opts = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
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

// Allow the page to nudge the SW into rolling over right away.
self.addEventListener('message', async (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'purgeCache') {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    if (e.source && e.source.postMessage) e.source.postMessage('cachePurged');
  }
});
