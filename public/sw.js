/* KnowTomorrow service worker: офлайн-оболочка без кэширования API. */

const VERSION = 'knowtomorrow-v2.0.1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = [
  '/',
  '/app',
  '/privacy.html',
  '/manifest.webmanifest',
  '/css/base.css',
  '/css/site.css',
  '/css/landing-v2.css',
  '/css/app.css',
  '/js/site.js',
  '/js/app.js',
  '/js/api.js',
  '/js/icons.js',
  '/js/ui.js',
  '/js/charts.js',
  '/js/legal.js',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/favicon.png',
  '/assets/icons/apple-touch-icon.png',
  '/shared/constants.mjs',
  '/shared/dates.mjs',
  '/shared/app-model.mjs',
  '/shared/analytics.mjs',
  '/shared/demo.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch(() => {
            // Отдельный отсутствующий файл не должен ломать установку.
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(fallbackUrl || request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(fallbackUrl || request);
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Офлайн</title><p style="font-family:system-ui;padding:40px">Нет соединения. Откройте приложение ещё раз после подключения к сети.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await network;
  return fresh || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, url.pathname.startsWith('/app') ? '/app' : '/')
    );
    return;
  }

  if (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/shared/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
