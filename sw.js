// Bump this version whenever any app-shell asset changes.
const VERSION = 'v1.0.14';
const CACHE_PREFIX = 'courtside-shell-';
// Include scope in the name so multiple GitHub Pages projects cannot clear each other's caches.
const CACHE_BASE = `${CACHE_PREFIX}${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_BASE}${VERSION}`;
const ASSETS = [
  './', './index.html', './css/app.css', './js/app.js', './js/domain.js', './js/db.js',
  './js/views.js', './js/transfer.js', './js/share-image.js', './js/shared-report.js', './js/line-share.js', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  // An update waits for all old clients to close; no reload during a live game.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_BASE) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Reader owns the more specific /reader/ scope. Let its first visit reach its own app shell.
  const readerPath = new URL('./reader/', self.registration.scope).pathname;
  if (url.pathname.startsWith(readerPath)) return;
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope) || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(event.request);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    return cached || fetch(event.request);
  })());
});
