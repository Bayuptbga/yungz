// e2e.js — End-to-End Encryption untuk Private Chat
// Skema: ECDH (P-256) per user untuk sepakat kunci rahasia bersama per pasangan chat,
// lalu AES-GCM 256-bit buat enkripsi/dekripsi isi pesan.
// Private key TIDAK PERNAH dikirim ke server dalam bentuk terbuka — hanya disimpan
// di perangkat (localStorage). Server (Supabase) hanya pernah melihat ciphertext.
// CATATAN: versi ini TIDAK punya fitur backup/restore kunci (mirip default WhatsApp).
// Kalau device baru/localStorage kehapus, keypair baru dibuat otomatis dan riwayat
// chat lama TIDAK BISA dibuka lagi di device itu. Ini trade-off yang disengaja.
const E2E = (() => {
  const LS_PREFIX = 'e2e_priv_';
  const sharedKeyCache = new Map(); // peerId -> CryptoKey (AES-GCM), cache per sesi halaman

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
  //             dibuat & dipublikasikan. Riwayat chat lama TIDAK bisa dibuka lagi
  //             di device ini (tidak ada mekanisme restore), sama seperti WhatsApp
  //             kalau install ulang tanpa chat backup.
  async function ensureKeypair(userId) {
    if (hasLocalKey(userId)) {
      const kp = await loadLocalKeypair(userId);
      return { status: 'ready', ...kp };
    }
    const kp = await generateAndPublishKeypair(userId);
    return { status: 'new', ...kp };
  }

  // Turunkan AES-GCM key bersama dari private key kita + public key lawan bicara.
  async function getSharedKey(privateKey, peerId, peerPublicKeyB64) {
    if (!privateKey || !peerPublicKeyB64) return null;
    if (sharedKeyCache.has(peerId)) return sharedKeyCache.get(peerId);
    const peerPubKey = await crypto.subtle.importKey(
      'raw', bufFromB64(peerPublicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPubKey }, privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    sharedKeyCache.set(peerId, sharedKey);
    return sharedKey;
  }

  function clearSharedKeyCache() {
    sharedKeyCache.clear();
  }

  // Buang shared key yang ke-cache untuk SATU peer saja (dipakai saat public key
  // peer itu berubah di tengah sesi, misal dia baru login/reinstall di device lain).
  // Panggilan getSharedKey() berikutnya akan hitung ulang pakai public key terbaru.
  function invalidatePeer(peerId) {
    sharedKeyCache.delete(peerId);
  }

  async function encryptMessage(sharedKey, plaintext) {
    // PENTING: jangan pernah fallback ke plaintext di sini. Kalau sharedKey belum
    // siap, pemanggil HARUS menangani ini sebagai error (jangan sampai pesan
    // terkirim tanpa enkripsi tanpa disadari).
    if (!sharedKey) throw new Error('E2E: sharedKey belum tersedia, pesan tidak dienkripsi/dikirim.');
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
      // Format e2e valid tapi gagal didekripsi -> kunci di device ini tidak cocok
      // (mis. pesan dikirim/diterima dari pairing kunci yang berbeda).
      return '🔒 Pesan tidak bisa dibuka di perangkat ini';
    }
  }

  return {
    ensureKeypair, getSharedKey, encryptMessage, decryptMessage, clearSharedKeyCache,
    invalidatePeer, hasLocalKey
  };
})();
