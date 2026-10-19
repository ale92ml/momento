// sw.js — caché de la app para que funcione sin conexión.
// Sube VERSION cada vez que publiques cambios.
const VERSION = 'momento-v4';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/emotions.js',
  './js/photo.js',
  './js/format.js',
  './js/charts.js',
  './js/colors.js',
  './js/sky.js',
  './js/stats.js',
  './js/report.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './fonts/fraunces-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return resp;
      });
    })
  );
});
