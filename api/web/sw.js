// Сервіс-воркер: кешує оболонку застосунку, дані завжди беруться з мережі.
const VERSION = 'dc-shell-v1';
const SHELL = [
  '/', '/index.html', '/css/tokens.css', '/css/base.css', '/css/components.css', '/css/views.css', '/css/print.css',
  '/fonts/carlito-400.woff', '/fonts/carlito-700.woff', '/fonts/lora-var.woff', '/fonts/mono-400.woff', '/fonts/mono-700.woff',
  '/icons/icon.svg', '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isAsset = /^\/(css|js|fonts|icons)\//.test(url.pathname) || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.webmanifest';
  if (!isAsset) return;
  // стратегія: спершу мережа, за відсутності зв'язку кеш
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html'))),
  );
});
