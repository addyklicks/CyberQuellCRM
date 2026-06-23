const CACHE_NAME = 'cyberquell-crm-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './CQ_Icon-Only_Version_Green.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isFirebaseRequest = url.hostname.includes('firebase') || url.hostname.includes('googleapis');
  const isFirebaseConfig = url.pathname.endsWith('/firebase-config.js');
  const isAppShell = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html');

  if (isFirebaseRequest || isFirebaseConfig) return;

  if (isAppShell) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseToCache));
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
