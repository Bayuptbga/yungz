// e2e.js — End-to-End Encryption untuk Private Chat
// Skema: ECDH (P-256) per user untuk sepakat kunci rahasia bersama per pasangan chat,
// lalu AES-GCM 256-bit buat enkripsi/dekripsi isi pesan.
// Private key TIDAK PERNAH dikirim ke server dalam bentuk terbuka — hanya disimpan
// di perangkat (localStorage). Server (Supabase) hanya pernah melihat ciphertext.
//
// VERSIONED KEYS (biar cuma yang ganti device yang kehilangan histori):
// - Tiap user punya "key_version" (integer, mulai dari 1) yang naik tiap kali
//   keypair baru dibuat (device baru / localStorage kehapus).
// - Public key LAMA tidak ditimpa — dipindah ke profiles.public_key_history
//   (array [{version, key}]) sebelum public key baru dipublikasikan.
// - Tiap pesan menyimpan sender_key_version & receiver_key_version, yaitu versi
//   kunci masing-masing pihak yang aktif SAAT pesan itu dibuat.
// - Dekripsi: kalau versi kunci LOKAL saya sekarang != versi yang tercatat di
//   pesan itu, berarti saya sudah rotasi kunci setelah pesan itu dibuat -> saya
//   TIDAK BISA buka pesan itu lagi (private key lama sudah hilang, disengaja).
//   Tapi kalau versi saya cocok, saya cuma perlu public key LAWAN pada versi
//   yang tercatat (diambil dari public_key_history kalau bukan versi current)
//   -> selama saya sendiri tidak pernah rotasi, saya TETAP bisa buka semua
//   pesan lama, walau lawan bicara sudah ganti device berkali-kali.
const E2E = (() => {
  const LS_PREFIX = 'e2e_priv_';
  // cache shared key per kombinasi peerId + versi saya + versi lawan
  const sharedKeyCache = new Map(); // `${peerId}:${myVersion}:${peerVersion}` -> CryptoKey

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
  // Mendukung format lama (raw JWK, dianggap versi 1) dan format baru {version, jwk}.
  async function loadLocalKeypair(userId) {
    const saved = localStorage.getItem(LS_PREFIX + userId);
    const parsed = JSON.parse(saved);
    let version, jwk;
    if (parsed && parsed.jwk && typeof parsed.version === 'number') {
      version = parsed.version;
      jwk = parsed.jwk;
    } else {
      // format lama: JWK mentah tanpa versi -> anggap versi 1, migrasi diam-diam.
      version = 1;
      jwk = parsed;
      localStorage.setItem(LS_PREFIX + userId, JSON.stringify({ version, jwk }));
    }
    const privateKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const raw = await crypto.subtle.exportKey('raw', pubKey);
    return { privateKey, publicKeyB64: b64FromBuf(raw), version };
  }

  // Generate keypair ECDH baru, simpan private key ke localStorage device ini,
  // arsipkan public key LAMA (kalau ada) ke public_key_history, lalu publikasikan
  // public key baru + key_version baru ke server.
  async function generateAndPublishKeypair(userId) {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
    const publicKeyB64 = b64FromBuf(raw);

    let newVersion = 1;
    try {
      const { data: prof } = await supabaseClient
        .from('profiles')
        .select('public_key, key_version, public_key_history')
        .eq('id', userId)
        .maybeSingle();

      const oldVersion = prof && prof.key_version ? prof.key_version : (prof && prof.public_key ? 1 : 0);
      const history = (prof && Array.isArray(prof.public_key_history)) ? prof.public_key_history.slice() : [];
      if (prof && prof.public_key) {
        // simpan kunci lama ke riwayat sebelum ditimpa, supaya lawan bicara yang
        // TIDAK ganti device tetap bisa dekripsi pesan lama.
        history.push({ version: oldVersion, key: prof.public_key });
      }
      newVersion = oldVersion + 1;
      await supabaseClient.from('profiles').update({
        public_key: publicKeyB64,
        key_version: newVersion,
        public_key_history: history
      }).eq('id', userId);
    } catch (e) {
      console.error('Gagal upload/arsip public key:', e);
    }

    localStorage.setItem(LS_PREFIX + userId, JSON.stringify({ version: newVersion, jwk }));
    return { privateKey: pair.privateKey, publicKeyB64, version: newVersion };
  }

  // Pastikan user punya keypair ECDH siap dipakai di device ini.
  // Return: { status:'ready'|'new', privateKey, publicKeyB64, version }
  async function ensureKeypair(userId) {
    if (hasLocalKey(userId)) {
      const kp = await loadLocalKeypair(userId);
      return { status: 'ready', ...kp };
    }
    const kp = await generateAndPublishKeypair(userId);
    return { status: 'new', ...kp };
  }

  // Ambil public key lawan bicara PADA VERSI TERTENTU. Kalau versi yang diminta
  // adalah versi current lawan, pakai peerProfile.public_key langsung. Kalau
  // versi lama, cari di peerProfile.public_key_history.
  function getPeerPublicKeyAtVersion(peerProfile, version) {
    if (!peerProfile) return null;
    const currentVersion = peerProfile.key_version || 1;
    if (version === currentVersion) return peerProfile.public_key || null;
    const hist = Array.isArray(peerProfile.public_key_history) ? peerProfile.public_key_history : [];
    const found = hist.find(h => h.version === version);
    return found ? found.key : null;
  }

  // Turunkan AES-GCM key bersama dari private key kita (versi tertentu) + public
  // key lawan bicara (versi tertentu). myVersion dan peerVersion dipakai sebagai
  // kunci cache supaya tiap kombinasi versi punya shared key sendiri.
  async function getSharedKeyForVersions(privateKey, myVersion, peerId, peerVersion, peerPublicKeyB64) {
    if (!privateKey || !peerPublicKeyB64) return null;
    const cacheKey = `${peerId}:${myVersion}:${peerVersion}`;
    if (sharedKeyCache.has(cacheKey)) return sharedKeyCache.get(cacheKey);
    const peerPubKey = await crypto.subtle.importKey(
      'raw', bufFromB64(peerPublicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPubKey }, privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    sharedKeyCache.set(cacheKey, sharedKey);
    return sharedKey;
  }

  // Kompatibilitas lama (tidak versioned) — tetap ada kalau ada pemanggil lama.
  async function getSharedKey(privateKey, peerId, peerPublicKeyB64) {
    return getSharedKeyForVersions(privateKey, 1, peerId, 1, peerPublicKeyB64);
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

  // ---- CADANGAN & PEMULIHAN KUNCI (opsional, dimatikan secara default) ----
  // Kalau user AKTIF mengaktifkan ini (isi kode sandi cadangan sendiri di halaman
  // Data & Penyimpanan), private key (versi yang sedang aktif) dienkripsi pakai
  // kunci yang diturunkan dari kode sandi itu (PBKDF2 -> AES-GCM), lalu ciphertext-nya
  // (BUKAN kode sandinya, BUKAN private key mentahnya) disimpan di profiles.key_backup.
  // Kode sandi TIDAK PERNAH dikirim ke server. Kalau kode sandi lupa, cadangan itu
  // tidak bisa dipulihkan siapapun termasuk admin/Anthropic -- sama seperti WA.
  // Kalau fitur ini aktif dan dipulihkan dengan benar di device baru, PRIVATE KEY
  // YANG SAMA didapat lagi (bukan rotasi/versi baru) -> histori chat TIDAK hilang
  // sama sekali, baik buat diri sendiri maupun lawan bicara.
  const PBKDF2_ITER = 250000;

  async function deriveKeyFromPassphrase(passphrase, saltB64) {
    const salt = saltB64 ? new Uint8Array(bufFromB64(saltB64)) : crypto.getRandomValues(new Uint8Array(16));
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return { key, saltB64: b64FromBuf(salt) };
  }

  // Cadangkan private key device ini (yang sedang aktif dipakai) ke server,
  // dienkripsi pakai kode sandi cadangan yang dipilih user.
  async function backupPrivateKeyWithPassphrase(userId, passphrase) {
    if (!passphrase || passphrase.length < 4) throw new Error('Kode sandi minimal 4 karakter');
    if (!hasLocalKey(userId)) throw new Error('Belum ada kunci lokal di perangkat ini');
    const saved = localStorage.getItem(LS_PREFIX + userId);
    const parsed = JSON.parse(saved);
    const payload = (parsed && parsed.jwk && typeof parsed.version === 'number')
      ? parsed
      : { version: 1, jwk: parsed };
    const { key, saltB64 } = await deriveKeyFromPassphrase(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))
    );
    const backup = { salt: saltB64, iv: b64FromBuf(iv), ct: b64FromBuf(ctBuf), v: payload.version };
    const { error } = await supabaseClient.from('profiles').update({
      key_backup: backup,
      key_backup_updated_at: new Date().toISOString()
    }).eq('id', userId);
    if (error) throw error;
    return true;
  }

  async function hasServerBackup(userId) {
    const { data, error } = await supabaseClient.from('profiles').select('key_backup').eq('id', userId).maybeSingle();
    if (error || !data) return false;
    return !!data.key_backup;
  }

  // Coba pulihkan private key dari cadangan server pakai kode sandi. Kalau
  // salah kode sandi, dekripsi gagal -> lempar error (bukan bikin kunci baru).
  // Kalau berhasil, private key yang SAMA disimpan ke localStorage device ini
  // (tidak menaikkan key_version, tidak mengarsipkan apapun -> tidak ada histori
  // yang hilang untuk siapapun).
  async function restorePrivateKeyWithPassphrase(userId, passphrase) {
    const { data, error } = await supabaseClient.from('profiles').select('key_backup').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data || !data.key_backup) throw new Error('Tidak ada cadangan di server');
    const backup = data.key_backup;
    const { key } = await deriveKeyFromPassphrase(passphrase, backup.salt);
    let payload;
    try {
      const iv = new Uint8Array(bufFromB64(backup.iv));
      const ctBuf = bufFromB64(backup.ct);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBuf);
      payload = JSON.parse(new TextDecoder().decode(ptBuf));
    } catch (e) {
      throw new Error('Kode sandi salah atau cadangan rusak');
    }
    const privateKey = await crypto.subtle.importKey(
      'jwk', payload.jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const pubJwk = { kty: payload.jwk.kty, crv: payload.jwk.crv, x: payload.jwk.x, y: payload.jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const raw = await crypto.subtle.exportKey('raw', pubKey);
    localStorage.setItem(LS_PREFIX + userId, JSON.stringify({ version: payload.version, jwk: payload.jwk }));
    return { privateKey, publicKeyB64: b64FromBuf(raw), version: payload.version };
  }

  async function removeServerBackup(userId) {
    const { error } = await supabaseClient.from('profiles').update({ key_backup: null, key_backup_updated_at: null }).eq('id', userId);
    if (error) throw error;
    return true;
  }

  return {
    ensureKeypair, getSharedKey, getSharedKeyForVersions, getPeerPublicKeyAtVersion,
    encryptMessage, decryptMessage, clearSharedKeyCache, hasLocalKey,
    backupPrivateKeyWithPassphrase, restorePrivateKeyWithPassphrase, hasServerBackup, removeServerBackup
  };
})();
