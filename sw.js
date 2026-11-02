// Service worker: makes the game installable and playable offline.
// BUILD_ID is replaced with the commit SHA by the GitHub Pages workflow, so each deploy gets a fresh cache.
const BUILD_ID = 'dev';
const CACHE = `gunmerge3d-${BUILD_ID}`;
const FONT_CACHE = 'gunmerge3d-fonts';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './src/main.js',
  './src/scene.js',
  './src/battle.js',
  './src/gunstats.js',
  './src/layout.js',
  './src/i18n.js',
  './src/storage.js',
  './src/sfx.js',
  './src/pwa.js',
  './vendor/three.module.js',
  './assets/logo.png',
  './assets/coin.png',
  './assets/explosion.png',
  './assets/muzzle.png',
  './assets/player_badge.png',
  './assets/enemy_badge.png',
  './assets/gun_r1.png',
  './assets/gun_r2.png',
  './assets/gun_r3.png',
  './assets/gun_r4.png',
  './assets/gun_r5.png',
  './assets/gun_r6.png',
  './assets/gun_r7.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gunmerge3d-') && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // always try the network first so updates show up immediately; fall back to cache offline
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
  }
});
