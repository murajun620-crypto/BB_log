const VERSION = 'v2.2.26';
const CACHE_NAME = `courtside-reader-${VERSION}`;
const ASSETS = [
  '../js/cloud-config.js', '../js/cloud-share.js',
  './', './index.html', './css/reader.css', '../css/shot-chart.css', './js/reader.js', './manifest.webmanifest',
  '../js/domain.js', '../js/views.js', '../js/shared-report.js', '../icons/icon.svg', '../icons/icon-192.png',
  '../icons/icon-512.png', '../icons/maskable-512.png', '../icons/apple-touch-icon.png',
];
const assetRequests = ASSETS.map(asset => new Request(new URL(asset, self.registration.scope), { cache: 'reload' }));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(assetRequests)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('courtside-reader-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(event.request);
    return (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request);
  })());
});
