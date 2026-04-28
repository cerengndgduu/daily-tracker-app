/* Ritual service worker — network-first for app shell so updates land instantly,
   cache-first for static deps. Offline still works via cached fallback. */
const CACHE = 'ritual-v6';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './health.js',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&f[]=fraunces@400,500,600&display=swap'
];

// Files that should always check the network first so users get the latest version.
// Static deps (chart.js, fflate, fonts) stay cache-first since they're versioned URLs.
function isAppShell(url) {
  if (!url.startsWith(self.location.origin)) return false;
  const path = new URL(url).pathname;
  return path === '/' || path.endsWith('/index.html') || path.endsWith('/app.js') ||
         path.endsWith('/style.css') || path.endsWith('/health.js') ||
         path.endsWith('/manifest.webmanifest');
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  // Clean up old caches. Do NOT call clients.claim() — letting the old SW finish the
  // current session prevents mid-page reloads / glitches when the user is interacting.
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Network-first for the app shell so deploys land immediately.
  if (isAppShell(req.url)) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for static deps (CDN libs, fonts, icons).
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes('fontshare') || req.url.includes('jsdelivr.net'))) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
