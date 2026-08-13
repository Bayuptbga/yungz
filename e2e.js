// e2e.js — End-to-End Encryption untuk Private Chat
// Skema: ECDH (P-256) per user untuk sepakat kunci rahasia bersama per pasangan chat,
// lalu AES-GCM 256-bit buat enkripsi/dekripsi isi pesan.
// Private key TIDAK PERNAH dikirim ke server dalam bentuk terbuka — hanya disimpan
// di perangkat (localStorage). Server (Supabase) hanya pernah melihat ciphertext,
// dan (opsional) backup key yang dienkripsi pakai Password Enkripsi milik user.
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
  // Return salah satu dari:
  //  { status:'ready', privateKey, publicKeyB64 }        -> siap pakai langsung
  //  { status:'needs_restore' }                            -> device baru TAPI user sudah
  //                                                           pernah setel Password Enkripsi;
  //                                                           UI wajib minta password lalu panggil restorePrivateKey()
  //  { status:'needs_setup', privateKey, publicKeyB64 }    -> device baru & belum pernah ada
  //                                                           backup sama sekali; keypair BARU
  //                                                           sudah dibuat (chat lama di device
  //                                                           lain jadi tidak terbaca); UI
  //                                                           sebaiknya tawarkan setel Password
  //                                                           Enkripsi sekarang biar next time aman.
  async function ensureKeypair(userId) {
    if (hasLocalKey(userId)) {
      const kp = await loadLocalKeypair(userId);
      return { status: 'ready', ...kp };
    }
    let hasBackupOnServer = false;
    try {
      const { data: prof } = await supabaseClient.from('profiles').select('key_backup').eq('id', userId).maybeSingle();
      hasBackupOnServer = !!(prof && prof.key_backup);
    } catch (e) {
      console.error('Gagal cek backup key:', e);
    }
    if (hasBackupOnServer) {
      return { status: 'needs_restore' };
    }
    const kp = await generateAndPublishKeypair(userId);
    return { status: 'needs_setup', ...kp };
  }

  // ---- Backup & restore private key pakai Password Enkripsi ----

  async function deriveKeyFromPassword(password, saltBytes) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // Enkripsi private key device ini pakai password, lalu upload ke profiles.key_backup.
  async function backupPrivateKey(userId, privateKey, password) {
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveKeyFromPassword(password, salt);
    const ctBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(jwk))
    );
    const payload = JSON.stringify({ v: 1, salt: b64FromBuf(salt), iv: b64FromBuf(iv), ct: b64FromBuf(ctBuf) });
    const { error } = await supabaseClient.from('profiles').update({ key_backup: payload }).eq('id', userId);
    if (error) throw error;
  }

  // Ambil backup dari server, coba buka pakai password, lalu simpan sebagai
  // private key aktif di device ini (TIDAK generate keypair baru / TIDAK ubah public_key).
  // Throw Error('WRONG_PASSWORD') kalau password salah.
  // Throw Error('NO_BACKUP') kalau ternyata tidak ada backup di server.
  async function restorePrivateKey(userId, password) {
    const { data: prof, error } = await supabaseClient.from('profiles').select('key_backup').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!prof || !prof.key_backup) throw new Error('NO_BACKUP');
    const payload = JSON.parse(prof.key_backup);
    const salt = new Uint8Array(bufFromB64(payload.salt));
    const iv = new Uint8Array(bufFromB64(payload.iv));
    const aesKey = await deriveKeyFromPassword(password, salt);
    let ptBuf;
    try {
      ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, bufFromB64(payload.ct));
    } catch (e) {
      throw new Error('WRONG_PASSWORD');
    }
    const jwk = JSON.parse(new TextDecoder().decode(ptBuf));
    localStorage.setItem(LS_PREFIX + userId, JSON.stringify(jwk));
    const privateKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const raw = await crypto.subtle.exportKey('raw', pubKey);
    return { privateKey, publicKeyB64: b64FromBuf(raw) };
  }

  async function hasBackup(userId) {
    try {
      const { data: prof } = await supabaseClient.from('profiles').select('key_backup').eq('id', userId).maybeSingle();
      return !!(prof && prof.key_backup);
    } catch (e) {
      return false;
    }
  }

  // Ganti Password Enkripsi: pakai privateKey device ini (yang sedang aktif) sebagai
  // sumber, lalu simpan ulang backup dengan password baru.
  async function changeBackupPassword(userId, currentPrivateKey, newPassword) {
    await backupPrivateKey(userId, currentPrivateKey, newPassword);
  }

  // Kalau user pilih "abaikan, mulai percakapan baru" saat restore gagal/lupa password:
  // generate keypair baru seperti device benar-benar baru (chat lama di device lama jadi
  // tidak terbaca lagi, tapi ini pilihan sadar user, bukan default otomatis).
  // PENTING: backup PIN lama di server dihapus di sini juga, karena backup itu
  // dienkripsi untuk private key yang LAMA -- kalau dibiarkan, hasBackup() akan
  // terus mengira device ini "sudah aman" padahal PIN lama sudah tidak match
  // dengan kunci baru ini, jadi banner "Buat PIN" tidak akan pernah muncul lagi.
  async function forceNewKeypair(userId) {
    try {
      await supabaseClient.from('profiles').update({ key_backup: null }).eq('id', userId);
    } catch (e) {
      console.error('Gagal hapus backup PIN lama:', e);
    }
    return generateAndPublishKeypair(userId);
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
      // Format e2e valid tapi gagal didekripsi -> kunci di device ini tidak cocok
      // (mis. pesan dikirim/diterima dari pairing kunci yang berbeda).
      return '🔒 Pesan tidak bisa dibuka di perangkat ini';
    }
  }

  return {
    ensureKeypair, getSharedKey, encryptMessage, decryptMessage, clearSharedKeyCache,
    hasLocalKey, hasBackup, backupPrivateKey, restorePrivateKey, changeBackupPassword, forceNewKeypair
  };
})();
