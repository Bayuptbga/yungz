// Service Worker - Baku Chat
//
// ==== VERSIONING OTOMATIS ====
// VERSION di bawah ini diisi OTOMATIS oleh GitHub Actions setiap deploy,
// berdasarkan jumlah commit di repo (jadi selalu naik: 1.0.1, 1.0.2, dst).
// Lihat .github/workflows/deploy.yml. Jangan edit manual di sini.
const VERSION = '__VERSION__';
const CACHE_NAME = `private-chat-${VERSION}`;

// Aset yang nyaris tidak pernah berubah (ikon, font) -> lebih cocok cache-first
// biar loading-nya cepat, tidak perlu nunggu network tiap kali.
function isStaticAsset(url) {
  return url.includes('/icons/') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com');
}

// File "app shell" yang dicache saat instalasi, biar bisa dibuka offline.
// CSS & JS per-halaman dipisah dari HTML (lihat css/ dan js/) supaya browser
// bisa cache masing-masing terpisah -- kalau cuma HTML yang berubah, aset
// CSS/JS lama masih valid dari cache dan tidak perlu diunduh ulang.
const APP_SHELL = [
  './',
  './index.html',
  './dashboard',
  './dashboard.html',
  './chat',
  './chat.html',
  './setelan',
  './setelan.html',
  './akses-ditolak',
  './akses-ditolak.html',
  './manifest.json',
  './device-gate.js?v=__VERSION__',
  './app.js?v=__VERSION__',
  './css/index.css?v=__VERSION__',
  './css/dashboard.css?v=__VERSION__',
  './css/chat.css?v=__VERSION__',
  './css/profil.css?v=__VERSION__',
  './css/setelan.css?v=__VERSION__',
  './css/akses-ditolak.css?v=__VERSION__',
  './js/index.js?v=__VERSION__',
  './js/dashboard.js?v=__VERSION__',
  './js/chat.js?v=__VERSION__',
  './js/profil.js?v=__VERSION__',
  './js/setelan.js?v=__VERSION__',
  './icons/icon-192.png?v=3',
  './icons/icon-512.png?v=3',
  './icons/apple-touch-icon.png?v=3'
];

// Install: cache app shell.
// Pakai penambahan satu per satu (bukan cache.addAll) supaya kalau satu URL gagal
// (misal versi extensionless './dashboard' cuma resolve di GitHub Pages, gagal di
// hosting lain saat testing lokal), instalasi SW tetap lanjut untuk file lainnya.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch((err) => console.warn('Gagal cache:', url, err)))
      )
    ).then(() => self.skipWaiting())
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
// - Ikon & font (jarang berubah) -> cache-first, biar tampil instan tanpa nunggu
//   network; kalau belum ada di cache baru ambil dari network sekali lalu disimpan.
// - Sisanya (html, css, js aplikasi) -> stale-while-revalidate: langsung balas dari
//   cache kalau ada (jadi buka app INSTAN, tidak nunggu network), sambil diam-diam
//   fetch versi terbaru di background utk dipakai pas load berikutnya. Aman karena
//   app.js sudah auto-reload sekali saat SW baru ambil alih (lihat controllerchange
//   listener), jadi user tetap otomatis dapat update terbaru tanpa nunggu di awal.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Jangan pernah cache request ke Supabase (data realtime/dinamis)
  if (url.includes('supabase.co') || url.includes('supabase.in')) {
    return; // biarkan browser handle langsung ke network
  }

  // Hanya tangani GET request untuk aset statis
  if (event.request.method !== 'GET') return;

  if (isStaticAsset(url)) {
    // Cache-first: pakai cache kalau ada, network cuma dipanggil sekali di awal
    // (atau kalau ada versi baru di install, karena CACHE_NAME akan berubah).
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Fetch terbaru selalu jalan di background buat nyimpen versi baru ke cache,
      // dipakai kalau ternyata belum ada cache sama sekali (first load / offline).
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => null); // offline / gagal -> biar ditangani lewat fallback di bawah

      if (cached) {
        // Ada di cache -> balas INSTAN, update terbaru disimpan diam-diam
        // di background utk dipakai pas request berikutnya.
        return cached;
      }

      // Belum ada di cache (pertama kali) -> harus nunggu network,
      // fallback ke shell utama kalau ternyata offline.
      return networkFetch.then((response) => response || caches.match('./'));
    })
  );
});

// Terima push notification dari server (dikirim lewat Supabase Edge Function)
self.addEventListener('push', (event) => {
  let payload = { title: 'Baku Chat', body: 'Ada pesan baru', url: './' };
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
      data: { url: payload.url || './' },
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
  const targetUrl = event.notification.data?.url || './';

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

// ==== Auto-recovery kalau browser diam-diam ganti/expire subscription ====
// Ini sering jadi penyebab notif "hilang" tanpa ketahuan: browser rotasi
// endpoint push, subscription lama jadi mati, tapi app.js gak pernah tau
// karena event ini kejadian di background, bukan pas app dibuka.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey = event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : null;

        const newSubscription = await self.registration.pushManager.subscribe(
          applicationServerKey
            ? { userVisibleOnly: true, applicationServerKey }
            : { userVisibleOnly: true }
        );

        // Simpan flag + subscription baru, nanti disinkron ke Supabase oleh
        // app.js begitu halaman dibuka lagi (SW gak punya akses langsung ke
        // sesi login user).
        const clientsList = await self.clients.matchAll({ type: 'window' });
        for (const client of clientsList) {
          client.postMessage({
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            subscription: newSubscription.toJSON()
          });
        }
      } catch (err) {
        console.warn('Gagal resubscribe otomatis:', err);
      }
    })()
  );
});
