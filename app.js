// app.js — gabungan supabaseClient.js + e2e.js + push-notif.js
// Digabung dari 3 file terpisah supaya jumlah file lebih sedikit.
// Urutan eksekusi tetap sama: koneksi Supabase -> util E2E -> util push notification.
// device-gate.js SENGAJA TIDAK digabung ke sini karena harus load PALING ATAS,
// sebelum CDN supabase-js, supaya gate sempat redirect duluan (lihat device-gate.js).

/* ===== dari supabaseClient.js ===== */
// Konfigurasi koneksi Supabase untuk Bang Bayu Message
const SUPABASE_URL = 'https://pxwrbwfpkuuwioythqpt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LcTHxYsZJsvZWkdsdQWfoQ_JsV7ahbT';

// Catatan: Sakelar akses (mobile/TWA-only gate) TIDAK lagi di file ini.
// Sekarang ada di device-gate.js sendiri (file terpisah), supaya
// tanggung jawabnya jelas: file ini cuma ngurus koneksi Supabase.
// Pastikan device-gate.js di-load PALING ATAS di <head> setiap halaman,
// SEBELUM script lain (termasuk file ini), biar gate sempat redirect
// duluan sebelum konten/aset lain ke-load.

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== Update Service Worker dengan aman (anti "nyangkut versi lama") =====
   Kalau SW baru ambil alih kontrol tab yang sedang kebuka (karena sw.js
   pakai skipWaiting + clients.claim), HTML/JS yang sudah dimuat di memori
   browser masih versi lama. Ini bisa bikin app terasa error/rusak sampai
   user refresh manual. Jadi begitu SW baru ambil alih, kita reload sekali
   secara otomatis biar semuanya balik sinkron dengan versi terbaru. */
if ('serviceWorker' in navigator) {
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });

  // Jangan cuma andalkan pengecekan pasif browser (bisa ~24 jam sekali).
  // Paksa cek update tiap kali app dibuka / kembali aktif (penting untuk
  // TWA yang sering resume dari background, bukan cold start baru).
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reg.update().catch(() => {});
      }
    });
  }).catch(() => {});
}

// Karena Supabase Auth butuh format email, username diubah jadi
// "username@bbmchat.app" di belakang layar. User tidak pernah melihat ini.
// (Domain .local ditolak Supabase karena dianggap TLD tidak valid.)
function usernameToEmail(username){
  return username.trim().toLowerCase() + '@bbmchat.app';
}

function generatePin(){
  const chars = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // angka 1-9 + huruf A-Z (tanpa 0, biar tidak rancu sama huruf O)
  let pin = '';
  const rand = new Uint32Array(8);
  crypto.getRandomValues(rand);
  for(let i = 0; i < 8; i++){
    pin += chars[rand[i] % chars.length];
  }
  return pin;
}

function validUsername(u){
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

/* ===== dari e2e.js ===== */
// e2e.js — End-to-End Encryption untuk Baku Chat (skema v2: enkripsi per-penerima)
//
// RIWAYAT PERUBAHAN DARI SKEMA LAMA (v1):
// Skema v1 pakai SATU shared key (ECDH antara private key A + public key B) untuk
// SEMUA pesan di satu percakapan, dua arah sekaligus. Akibatnya: begitu salah satu
// pihak ganti device (private key berubah), shared key ikut berubah -- dan LAWAN
// BICARA YANG TIDAK GANTI DEVICE PUN IKUT KEHILANGAN AKSES ke seluruh riwayat chat
// itu. Itu bukan trade-off yang wajar, itu bug.
//
// Skema v2: tiap pesan dienkripsi pakai kunci AES-256 acak sekali-pakai (K). K itu
// "dibungkus" (wrap) DUA KALI secara terpisah -- satu pakai public key pengirim,
// satu pakai public key penerima -- masing-masing lewat ECDH sekali pakai per pesan
// (ephemeral key, gaya ECIES). Hasilnya:
//  - Penerima selalu bisa buka pesan pakai private key MILIKNYA SENDIRI, sama sekali
//    tidak tergantung apakah pengirim ganti device atau tidak.
//  - Kalau SAYA yang ganti device, SAYA kehilangan akses ke pesan lama (baik yang
//    saya kirim maupun yang saya terima) -- itu satu-satunya yang hilang. Lawan
//    bicara tidak kepengaruh sama sekali.
//
// KOMPATIBILITAS: pesan lama format v1 (shared-key) masih bisa dibuka SELAMA public
// key lawan bicara belum berubah sejak pesan itu dikirim (sama seperti batasan v1
// sebelumnya) -- lihat cabang `e2e === 1` di decryptMessage().
const E2E = (() => {
  const LS_PREFIX = 'e2e_priv_';

  function b64FromBuf(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function bufFromB64(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  function hasLocalKey(userId) {
    return !!localStorage.getItem(LS_PREFIX + userId);
  }

  // Import private key JWK yang sudah tersimpan di localStorage device ini.
  async function loadLocalKeypair(userId) {
    const saved = localStorage.getItem(LS_PREFIX + userId);
    const jwk = JSON.parse(saved);
    const privateKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const raw = await crypto.subtle.exportKey('raw', pubKey);
    return { privateKey, publicKeyB64: b64FromBuf(raw) };
  }

  // Generate keypair ECDH baru, simpan private key ke localStorage device ini,
  // dan publikasikan public key ke profiles.public_key (server).
  async function generateAndPublishKeypair(userId) {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    localStorage.setItem(LS_PREFIX + userId, JSON.stringify(jwk));
    const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
    const publicKeyB64 = b64FromBuf(raw);
    try {
      await supabaseClient.from('profiles').update({ public_key: publicKeyB64 }).eq('id', userId);
    } catch (e) {
      console.error('Gagal upload public key:', e);
    }
    return { privateKey: pair.privateKey, publicKeyB64 };
  }

  // Pastikan user punya keypair ECDH siap dipakai di device ini.
  // Return: { status:'ready'|'new', privateKey, publicKeyB64 }
  //  'ready' -> sudah ada kunci lokal, langsung dipakai.
  //  'new'   -> device baru (atau localStorage kosong); keypair BARU otomatis
  //             dibuat & dipublikasikan. Pesan lama yang ditujukan/dikirim pakai
  //             kunci lama tidak bisa dibuka lagi DI DEVICE INI (lihat catatan di
  //             atas) -- tapi lawan bicara tetap bisa baca riwayat mereka seperti biasa.
  async function ensureKeypair(userId) {
    if (hasLocalKey(userId)) {
      const kp = await loadLocalKeypair(userId);
      return { status: 'ready', ...kp };
    }
    const kp = await generateAndPublishKeypair(userId);
    return { status: 'new', ...kp };
  }

  // ---- Primitif ECIES: turunkan kunci pembungkus AES-GCM dari (privateKey saya
  // atau ephemeral, public key lawan). ----
  async function deriveWrapKey(privateKey, otherPublicKeyB64) {
    const otherPubKey = await crypto.subtle.importKey(
      'raw', bufFromB64(otherPublicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: otherPubKey }, privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }
  async function wrapKeyBytes(wrapKey, rawKeyBuf) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, rawKeyBuf);
    return { iv: b64FromBuf(iv), ct: b64FromBuf(ct) };
  }
  async function unwrapKeyBytes(wrapKey, wrapObj) {
    const iv = new Uint8Array(bufFromB64(wrapObj.iv));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, bufFromB64(wrapObj.ct));
  }

  // ---- Enkripsi ----
  // TIDAK butuh private key SAYA sama sekali -- cuma butuh public key saya sendiri
  // + public key penerima. Kunci pesan (K) dibungkus terpisah untuk masing-masing,
  // pakai ephemeral ECDH key sekali pakai khusus pesan ini.
  async function encryptMessage(myPublicKeyB64, peerPublicKeyB64, plaintext) {
    if (!myPublicKeyB64 || !peerPublicKeyB64) {
      // Sengaja throw, BUKAN fallback ke plaintext -- jangan sampai pesan
      // terkirim tanpa enkripsi tanpa disadari pemanggil.
      throw new Error('E2E: public key pengirim/penerima belum tersedia, pesan tidak dienkripsi/dikirim.');
    }
    const msgKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawMsgKey = await crypto.subtle.exportKey('raw', msgKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, msgKey, new TextEncoder().encode(plaintext));
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    const ephPubRaw = await crypto.subtle.exportKey('raw', eph.publicKey);
    const wrapForSenderKey = await deriveWrapKey(eph.privateKey, myPublicKeyB64);
    const wrapForReceiverKey = await deriveWrapKey(eph.privateKey, peerPublicKeyB64);
    const wrapSender = await wrapKeyBytes(wrapForSenderKey, rawMsgKey);
    const wrapReceiver = await wrapKeyBytes(wrapForReceiverKey, rawMsgKey);
    return JSON.stringify({
      e2e: 2,
      epk: b64FromBuf(ephPubRaw),
      iv: b64FromBuf(iv),
      ct: b64FromBuf(ctBuf),
      wrapSender, wrapReceiver
    });
  }

  // ---- Dekripsi ----
  // Cuma butuh private key SAYA SENDIRI. `amISender` menentukan wrap mana (wrapSender
  // / wrapReceiver) yang relevan buat saya di pesan ini. `legacyPeerPublicKeyB64`
  // opsional, cuma dipakai untuk buka pesan lama format v1 (shared-key) -- kalau
  // sejak pesan v1 itu dikirim salah satu pihak sudah ganti key, pesan v1 itu
  // memang tidak akan bisa dibuka lagi (batas matematis skema lama, bukan bug baru).
  async function decryptMessage(myPrivateKey, payload, amISender, legacyPeerPublicKeyB64) {
    let obj;
    try { obj = JSON.parse(payload); } catch (e) { return payload; } // bukan JSON -> pesan lama/plaintext, tampilkan apa adanya
    if (!obj || !obj.e2e) return payload;
    if (!myPrivateKey) return '🔒 Pesan terenkripsi (kunci tidak tersedia di perangkat ini)';
    try {
      if (obj.e2e === 2) {
        const wrapObj = amISender ? obj.wrapSender : obj.wrapReceiver;
        if (!wrapObj || !obj.epk) return '🔒 Pesan terkunci oleh enkripsi end-to-end';
        const wrapKey = await deriveWrapKey(myPrivateKey, obj.epk);
        const rawMsgKey = await unwrapKeyBytes(wrapKey, wrapObj);
        const msgKey = await crypto.subtle.importKey('raw', rawMsgKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const iv = new Uint8Array(bufFromB64(obj.iv));
        const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, msgKey, bufFromB64(obj.ct));
        return new TextDecoder().decode(ptBuf);
      }
      if (obj.e2e === 1) {
        // Format lama (shared-key). Perlu public key lawan bicara SAAT INI; kalau
        // sudah berubah sejak pesan ini dikirim, tetap tidak akan bisa dibuka.
        if (!legacyPeerPublicKeyB64 || !obj.iv || !obj.ct) return '🔒 Pesan terkunci oleh enkripsi end-to-end';
        const sharedKey = await deriveWrapKey(myPrivateKey, legacyPeerPublicKeyB64);
        const iv = new Uint8Array(bufFromB64(obj.iv));
        const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, bufFromB64(obj.ct));
        return new TextDecoder().decode(ptBuf);
      }
      return '🔒 Pesan terkunci oleh enkripsi end-to-end';
    } catch (e) {
      // Format e2e valid tapi gagal didekripsi -> kunci di device ini tidak cocok.
      return '🔒 Pesan terkunci oleh enkripsi end-to-end';
    }
  }

  return {
    ensureKeypair, encryptMessage, decryptMessage, hasLocalKey
  };
})();

/* ===== dari push-notif.js ===== */
// push-notif.js
// Dipanggil setelah user login (currentUserId tersedia), lihat index.html.
// Butuh supabaseClient sudah ter-inisialisasi di halaman.

const VAPID_PUBLIC_KEY = 'BLIETFYW3Md9wQlUAqRSL7LI3p_JiuDbAt3gRLPZtfJg_LaZEepowxzmYvIOglkpOkm0irU20-uywW-H_pABOiM';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initPushNotifications(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notification tidak didukung di browser ini.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.log('Izin notifikasi ditolak/belum diberikan.');
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const subJson = subscription.toJSON();

    await supabaseClient.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth
      },
      { onConflict: 'endpoint' }
    );

    console.log('Push notification aktif.');
  } catch (err) {
    console.error('Gagal setup push notification:', err);
  }
}
