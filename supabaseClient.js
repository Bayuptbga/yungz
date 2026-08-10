// Konfigurasi koneksi Supabase untuk Bang Bayu Message
const SUPABASE_URL = 'https://pxwrbwfpkuuwioythqpt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LcTHxYsZJsvZWkdsdQWfoQ_JsV7ahbT';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Karena Supabase Auth butuh format email, username diubah jadi
// "username@bbmchat.app" di belakang layar. User tidak pernah melihat ini.
// (Domain .local ditolak Supabase karena dianggap TLD tidak valid.)
function usernameToEmail(username){
  return username.trim().toLowerCase() + '@bbmchat.app';
}

function generatePin(){
  let pin = '';
  for(let i = 0; i < 8; i++){
    pin += Math.floor(Math.random() * 10);
  }
  return pin;
}

function validUsername(u){
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}
