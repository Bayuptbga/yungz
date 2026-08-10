// Service Worker - Bang Bayu Message
const CACHE_NAME = 'bb-message-v1';

// File "app shell" yang dicache saat instalasi, biar bisa dibuka offline
const APP_SHELL = [
  './',
  './index.html',
  './chat.html',
  './login.html',
  './daftar.html',
  './setelan.html',
  './manifest.json',
  './supabaseClient.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: bersihkan cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Request ke Supabase (data live: pesan, auth, dll) -> selalu network, JANGAN dicache,
//   biar data chat selalu fresh dan tidak basi.
// - Request file statis (html, css, js, gambar, ikon) -> network-first, fallback ke cache
//   kalau offline. Jadi saat online selalu dapat versi terbaru, saat offline tetap bisa dibuka.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Jangan pernah cache request ke Supabase (data realtime/dinamis)
  if (url.includes('supabase.co') || url.includes('supabase.in')) {
    return; // biarkan browser handle langsung ke network
  }

  // Hanya tangani GET request untuk aset statis
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan salinan terbaru ke cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Offline -> ambil dari cache
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});
