// e2e.js — End-to-End Encryption untuk Private Chat
// Skema: ECDH (P-256) per user untuk sepakat kunci rahasia bersama per pasangan chat,
// lalu AES-GCM 256-bit buat enkripsi/dekripsi isi pesan.
// Private key TIDAK PERNAH dikirim ke server — hanya disimpan di perangkat (localStorage).
// Server (Supabase) hanya pernah melihat ciphertext.
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

  // Pastikan user punya keypair ECDH. Kalau belum ada di perangkat ini, generate baru
  // dan publikasikan public key-nya ke kolom profiles.public_key.
  // CATATAN: kalau user buka dari perangkat/browser baru tanpa private key lama,
  // keypair baru akan dibuat (percakapan lama jadi tidak bisa didekripsi di perangkat itu).
  async function ensureKeypair(userId) {
    const saved = localStorage.getItem(LS_PREFIX + userId);
    if (saved) {
      const jwk = JSON.parse(saved);
      const privateKey = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
      );
      const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
      const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const raw = await crypto.subtle.exportKey('raw', pubKey);
      return { privateKey, publicKeyB64: b64FromBuf(raw) };
    }
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

  async function encryptMessage(sharedKey, plaintext) {
    if (!sharedKey) return plaintext; // fallback, tidak seharusnya kejadian di alur normal
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plaintext);
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, enc);
    return JSON.stringify({ e2e: 1, iv: b64FromBuf(iv), ct: b64FromBuf(ctBuf) });
  }

  async function decryptMessage(sharedKey, payload) {
    try {
      const obj = JSON.parse(payload);
      if (!obj || obj.e2e !== 1 || !obj.iv || !obj.ct) return payload; // pesan lama/plaintext
      if (!sharedKey) return '🔒 Pesan terenkripsi (kunci tidak tersedia di perangkat ini)';
      const iv = new Uint8Array(bufFromB64(obj.iv));
      const ctBuf = bufFromB64(obj.ct);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ctBuf);
      return new TextDecoder().decode(ptBuf);
    } catch (e) {
      return payload; // bukan format terenkripsi -> tampilkan apa adanya (pesan lama)
    }
  }

  return { ensureKeypair, getSharedKey, encryptMessage, decryptMessage };
})();
