// Service Worker - Private Chat
const CACHE_NAME = 'private-chat-v3';

// File "app shell" yang dicache saat instalasi, biar bisa dibuka offline
const APP_SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './chat.html',
  './setelan.html',
  './manifest.json',
  './supabaseClient.js',
  './push-notif.js',
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

// Terima push notification dari server (dikirim lewat Supabase Edge Function)
self.addEventListener('push', (event) => {
  let payload = { title: 'Private Chat', body: 'Ada pesan baru', url: './index.html' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // fallback kalau payload bukan JSON
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-96.png',
      data: { url: payload.url || './index.html' },
      vibrate: [200, 100, 200],
      tag: payload.url, // notif dari peer yang sama akan menumpuk jadi 1
      renotify: true,
      silent: false,
      requireInteraction: false
    })
  );
});

// Waktu notifikasi diklik: fokus/buka tab chat yang relevan
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl.split('?')[0]) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
