// Konfigurasi koneksi Supabase untuk Bang Bayu Message
const SUPABASE_URL = 'https://pxwrbwfpkuuwioythqpt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LcTHxYsZJsvZWkdsdQWfoQ_JsV7ahbT';

// ==================================================================
// SAKELAR AKSES: dipasang di sini (bukan di akses-ditolak.html) karena
// file ini di-include di SEMUA halaman (index, dashboard, chat, setelan)
// -- jadi cukup ubah SATU baris ini buat nyala/matiin di semua halaman
// sekaligus.
//   true  -> aplikasi cuma bisa dibuka dari APLIKASI TWA yang sudah
//            terpasang di HP. Browser desktop MAUPUN tab Chrome biasa
//            di HP (belum install / buka dari link biasa) otomatis
//            dialihkan ke akses-ditolak.html.
//   false -> restriksi dimatikan, semua perangkat/cara buka bisa masuk.
//
// CATATAN PENTING: sebelumnya gerbang ini cuma cek User-Agent mobile,
// jadi tab Chrome biasa di HP (bukan app TWA yang di-install) tetap
// LOLOS -- padahal pesan di akses-ditolak.html janjinya "bukan dari
// tab Chrome biasa". Makanya sekarang ditambah cek display-mode:
// standalone, yang cuma true kalau app dijalankan dari ikon TWA di
// homescreen (tanpa address bar Chrome), bukan dari tab browser biasa.
// ==================================================================
const MOBILE_ONLY_ACCESS = false;

function isRunningInInstalledApp(){
  // TWA (Android) / PWA yang di-install: browsing context berjalan
  // standalone, tanpa UI Chrome (address bar dst). Ini tetap true di
  // SEMUA halaman selama sesi TWA berjalan, bukan cuma di halaman awal.
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  // Fallback iOS lama (add to home screen)
  if (window.navigator.standalone === true) return true;
  // Fallback tambahan: saat cold-start dari intent Android, Chrome
  // kadang isi document.referrer dengan skema android-app://
  if (document.referrer && document.referrer.startsWith('android-app://')) return true;
  return false;
}

if (MOBILE_ONLY_ACCESS && !location.pathname.endsWith('akses-ditolak.html')) {
  const isMobileUA = /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(navigator.userAgent);
  if (!isMobileUA || !isRunningInInstalledApp()) {
    window.location.replace('akses-ditolak.html');
  }
}

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
