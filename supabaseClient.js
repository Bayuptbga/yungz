// Konfigurasi koneksi Supabase untuk Bang Bayu Message
const SUPABASE_URL = 'https://pxwrbwfpkuuwioythqpt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LcTHxYsZJsvZWkdsdQWfoQ_JsV7ahbT';

// ==================================================================
// SAKELAR AKSES: dipasang di sini (bukan di akses-ditolak.html) karena
// file ini di-include di SEMUA halaman (index, dashboard, chat, setelan)
// -- jadi cukup ubah SATU baris ini buat nyala/matiin di semua halaman
// sekaligus.
//   true  -> aplikasi cuma bisa dibuka dari HP. Browser desktop otomatis
//            dialihkan ke akses-ditolak.html.
//   false -> restriksi dimatikan, semua perangkat bisa buka seperti biasa.
// ==================================================================
const MOBILE_ONLY_ACCESS = true;

if (MOBILE_ONLY_ACCESS && !location.pathname.endsWith('akses-ditolak.html')) {
  const isMobileUA = /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(navigator.userAgent);
  if (!isMobileUA) {
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
