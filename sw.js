// CFO System service worker: keeps the app working offline.
// Strategy: network first (so updates show up), falling back to the cached copy when offline.
const CACHE = 'cfo-app-v4';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/config.js', './js/store.js', './js/i18n.js', './js/ui.js', './js/app.js', './js/docs.js', './js/banking.js',
  './js/inventory.js', './js/contacts.js', './js/reports.js', './js/control.js', './js/tax.js',
  './js/aiscan.js', './js/sample.js', './js/pwa.js', './js/sync.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Only handle this app's own files (never the A.I Scan API calls).
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
