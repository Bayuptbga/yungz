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
