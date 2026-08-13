// e2e.js — End-to-End Encryption untuk Private Chat
// Skema: ECDH (P-256) per user untuk sepakat kunci rahasia bersama per pasangan chat,
// lalu AES-GCM 256-bit buat enkripsi/dekripsi isi pesan.
// Private key TIDAK PERNAH dikirim ke server dalam bentuk terbuka — hanya disimpan
// di perangkat (localStorage). Server (Supabase) hanya pernah melihat ciphertext.
//
// SATU KUNCI PER USER (tidak versioned):
// - Tiap user cuma punya SATU public key aktif di profiles.public_key, ditimpa
//   langsung kalau bikin keypair baru (device baru / localStorage kehapus).
// - Tidak ada histori kunci lama, tidak ada penomoran versi per pesan. Lebih
//   sederhana dan lebih sedikit celah bug dibanding skema versioned sebelumnya.
// - Konsekuensi: begitu SIAPAPUN (saya atau lawan bicara) ganti device / bikin
//   kunci baru, SEMUA histori chat dengan orang itu jadi tidak terbaca lagi buat
//   KEDUA belah pihak (bukan cuma yang gantinya) -- disengaja, bukan bug.
const E2E = (() => {
  const LS_PREFIX = 'e2e_priv_';
  const sharedKeyCache = new Map(); // peerId -> { key, peerPublicKeyB64 }

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
  // Mendukung juga format lama peninggalan skema versioned ({version, jwk}),
  // supaya user yang sudah pernah pakai app ini tidak kehilangan kunci lokalnya.
  async function loadLocalKeypair(userId) {
    const saved = localStorage.getItem(LS_PREFIX + userId);
    const parsed = JSON.parse(saved);
    const jwk = (parsed && parsed.jwk && typeof parsed.version === 'number') ? parsed.jwk : parsed;
    const privateKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const raw = await crypto.subtle.exportKey('raw', pubKey);
    return { privateKey, publicKeyB64: b64FromBuf(raw) };
  }

  // Generate keypair ECDH baru, simpan private key ke localStorage device ini,
  // lalu timpa langsung public key di server dengan yang baru (tidak diarsipkan).
  async function generateAndPublishKeypair(userId) {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
    const publicKeyB64 = b64FromBuf(raw);

    try {
      await supabaseClient.from('profiles').update({ public_key: publicKeyB64 }).eq('id', userId);
    } catch (e) {
      console.error('Gagal upload public key:', e);
    }

    localStorage.setItem(LS_PREFIX + userId, JSON.stringify(jwk));
    return { privateKey: pair.privateKey, publicKeyB64 };
  }

  // Pastikan user punya keypair ECDH siap dipakai di device ini.
  // Return: { status:'ready'|'new', privateKey, publicKeyB64 }
  async function ensureKeypair(userId) {
    if (hasLocalKey(userId)) {
      const kp = await loadLocalKeypair(userId);
      return { status: 'ready', ...kp };
    }
    const kp = await generateAndPublishKeypair(userId);
    return { status: 'new', ...kp };
  }

  // Turunkan AES-GCM key bersama dari private key kita + public key lawan
  // bicara SEKARANG (selalu kunci yang lagi aktif, tidak ada pilihan versi).
  async function getSharedKey(privateKey, peerId, peerPublicKeyB64) {
    if (!privateKey || !peerPublicKeyB64) return null;
    if (sharedKeyCache.has(peerId)) {
      const cached = sharedKeyCache.get(peerId);
      if (cached.peerPublicKeyB64 === peerPublicKeyB64) return cached.key;
    }
    const peerPubKey = await crypto.subtle.importKey(
      'raw', bufFromB64(peerPublicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPubKey }, privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    sharedKeyCache.set(peerId, { key, peerPublicKeyB64 });
    return key;
  }

  function clearSharedKeyCache() {
    sharedKeyCache.clear();
  }

  async function encryptMessage(sharedKey, plaintext) {
    if (!sharedKey) return plaintext; // fallback, tidak seharusnya kejadian di alur normal
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plaintext);
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, enc);
    return JSON.stringify({ e2e: 1, iv: b64FromBuf(iv), ct: b64FromBuf(ctBuf) });
  }

  async function decryptMessage(sharedKey, payload) {
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch (e) {
      return payload; // bukan JSON -> pesan lama/plaintext, tampilkan apa adanya
    }
    if (!obj || obj.e2e !== 1 || !obj.iv || !obj.ct) return payload; // bukan format e2e
    if (!sharedKey) return '🔒 Pesan terenkripsi (kunci tidak tersedia di perangkat ini)';
    try {
      const iv = new Uint8Array(bufFromB64(obj.iv));
      const ctBuf = bufFromB64(obj.ct);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ctBuf);
      return new TextDecoder().decode(ptBuf);
    } catch (e) {
      return '🔒 Pesan tidak bisa dibuka di perangkat ini';
    }
  }

  // Catatan: fitur cadangkan/pulihkan kunci lewat kode sandi sudah dihapus
  // sebelumnya. Private key HANYA pernah ada di localStorage device tempat ia
  // dibuat -- server tidak pernah punya cara merekonstruksinya.

  return {
    ensureKeypair, getSharedKey,
    encryptMessage, decryptMessage, clearSharedKeyCache, hasLocalKey
  };
})();
