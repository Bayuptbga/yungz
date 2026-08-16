// offline-db.js — Cache offline untuk Baku Chat.
//
// Pakai IndexedDB (bukan localStorage) karena datanya bisa cukup besar
// (riwayat pesan) dan localStorage sudah dipakai buat kunci E2E + flag kecil.
//
// Isi database:
// - "messages" : riwayat pesan per percakapan (key = convoKey "uidA-uidB" terurut),
//                pesan disimpan SUDAH DIDEKRIPSI (plaintext) karena memang cuma
//                dibaca ulang di device yang sama yang punya private key-nya --
//                sama seperti riwayat chat WhatsApp yang tersimpan plaintext di
//                storage lokal device. Ini bukan kebocoran baru: private key
//                E2E kita sendiri juga sudah tersimpan plaintext di localStorage.
// - "cache"    : cache generik key/value (daftar chat, kontak, status, profil peer, dst.)
// - "outbox"   : antrian pesan yang GAGAL terkirim (mis. saat offline), untuk
//                dikirim ulang otomatis begitu koneksi kembali.
//
// Semua fungsi di sini "fail-soft": kalau IndexedDB tidak tersedia/gagal
// (mis. private browsing di beberapa browser), fungsi cukup gagal diam-diam
// (return null / tidak menyimpan) supaya tidak merusak alur online normal.
const OfflineDB = (function () {
  const DB_NAME = 'bakuchat-offline';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('messages')) {
          db.createObjectStore('messages', { keyPath: 'convoKey' });
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'localId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  async function store(name, mode) {
    const db = await open();
    if (!db) return null;
    try {
      return db.transaction(name, mode).objectStore(name);
    } catch (e) {
      return null;
    }
  }

  function reqToPromise(req, fallback) {
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(fallback);
    });
  }

  // Kunci percakapan konsisten dengan channel realtime yang sudah dipakai di chat.html
  function convoKey(idA, idB) {
    return [idA, idB].sort().join('-');
  }

  return {
    convoKey,

    // ---- Riwayat pesan per percakapan ----
    async saveMessages(cKey, rows) {
      const s = await store('messages', 'readwrite');
      if (!s) return;
      try { s.put({ convoKey: cKey, rows, updatedAt: Date.now() }); } catch (e) { /* abaikan */ }
    },
    async getMessages(cKey) {
      const s = await store('messages', 'readonly');
      if (!s) return null;
      const result = await reqToPromise(s.get(cKey), null);
      return result ? result.rows : null;
    },

    // ---- Cache generik (daftar chat, kontak, status, profil peer, dll) ----
    async setCache(key, value) {
      const s = await store('cache', 'readwrite');
      if (!s) return;
      try { s.put({ key, value, updatedAt: Date.now() }); } catch (e) { /* abaikan */ }
    },
    async getCache(key) {
      const s = await store('cache', 'readonly');
      if (!s) return null;
      const result = await reqToPromise(s.get(key), null);
      return result ? result.value : null;
    },

    // ---- Outbox: pesan yang belum berhasil terkirim ----
    async addOutbox(item) {
      const s = await store('outbox', 'readwrite');
      if (!s) return;
      try { s.put(item); } catch (e) { /* abaikan */ }
    },
    async removeOutbox(localId) {
      const s = await store('outbox', 'readwrite');
      if (!s) return;
      try { s.delete(localId); } catch (e) { /* abaikan */ }
    },
    async getOutboxFor(cKey) {
      const s = await store('outbox', 'readonly');
      if (!s) return [];
      return new Promise((resolve) => {
        const out = [];
        const req = s.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (!cKey || cursor.value.convoKey === cKey) out.push(cursor.value);
            cursor.continue();
          } else {
            resolve(out.sort((a, b) => a.createdAtMs - b.createdAtMs));
          }
        };
        req.onerror = () => resolve([]);
      });
    },
    async getAllOutbox() {
      return this.getOutboxFor(null);
    }
  };
})();

// ---- Indikator online/offline yang dipakai bersama di semua halaman ----
// Menampilkan pita kecil di atas layar saat koneksi terputus, hilang otomatis
// begitu koneksi kembali. Dipanggil dari halaman lewat OfflineBanner.init().
const OfflineBanner = (function () {
  let el = null;
  function ensureEl() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'offlineBanner';
    el.textContent = 'Sedang offline — menampilkan data tersimpan';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#5b3a12;color:#ffe6b3;font-size:12.5px;text-align:center;padding:6px 10px;padding-top:calc(6px + env(safe-area-inset-top));display:none;font-family:Inter,Segoe UI,Roboto,sans-serif;';
    document.body.appendChild(el);
    return el;
  }
  function show() { ensureEl().style.display = 'block'; }
  function hide() { ensureEl().style.display = 'none'; }
  function init(onOnline) {
    ensureEl();
    if (!navigator.onLine) show();
    window.addEventListener('online', () => { hide(); if (onOnline) onOnline(); });
    window.addEventListener('offline', () => show());
  }
  return { init, show, hide };
})();
