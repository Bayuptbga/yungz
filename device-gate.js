// device-gate.js
// Blokir akses dari desktop dan dari Chrome/browser biasa yang belum "install" app.
// CATATAN: ini gating UX, BUKAN kontrol keamanan sejati. Karena situs ini statis
// (hosting seperti GitHub Pages tidak bisa cek apa pun SEBELUM HTML terkirim ke
// browser), semua pengecekan di file ini terjadi SETELAH konten sudah diterima
// klien -- siapa pun yang cukup paham (matikan JS, curl/wget, baca source file ini)
// tetap bisa lewat gate ini. JANGAN andalkan ini sebagai satu-satunya proteksi;
// proteksi ASLI data ada di auth + Row Level Security Supabase + enkripsi E2E.
//
// PENTING SOAL URUTAN LOAD:
// File ini HARUS di-load PALING ATAS di <head>, SEBELUM script lain (termasuk CDN
// supabase-js dan app.js). Tujuannya supaya kalau device tidak lolos gate, redirect
// ke akses-ditolak terjadi SEDINI mungkin -- sebelum aset lain sempat di-load.
//
// ==== SAKLAR ON/OFF ====
// 1) Saklar utama (permanen, berlaku di semua halaman yang load file ini):
//    ganti DEVICE_GATE_ENABLED di bawah ke false untuk mematikan gate sepenuhnya.
//    Cukup ubah SEKALI di file ini, otomatis berlaku ke semua halaman yang memuatnya.
// 2) Saklar sementara (buat testing di browser sendiri, tanpa ubah kode/deploy ulang):
//    buka console lalu jalankan salah satu dari:
//      localStorage.setItem('bc_gate_bypass_x7q', '1')   // matikan gate di browser ini
//      localStorage.removeItem('bc_gate_bypass_x7q')     // nyalakan lagi
//    (nama key sengaja tidak jelas artinya -- security-by-obscurity ringan,
//    tetap bukan pengganti proteksi asli)
(function () {
  var DEVICE_GATE_ENABLED = false;

  // Saklar fitur tambahan -- masing-masing bisa dimatikan sendiri kalau bikin masalah,
  // tanpa perlu mematikan gate secara keseluruhan.
  var STRICT_REFERRER_CHECK = true;   // true = referrer TWA harus persis dari TWA_PACKAGE_NAME
  var BLOCK_AUTOMATION = true;        // true = block browser automation/headless

  // Package name APK TWA (dari PWABuilder). Dipakai kalau STRICT_REFERRER_CHECK aktif.
  var TWA_PACKAGE_NAME = 'com.bakuchat.id';

  if (!DEVICE_GATE_ENABLED) return;
  try {
    if (localStorage.getItem('bc_gate_bypass_x7q') === '1') return;
  } catch (e) { /* localStorage diblokir (mis. private mode) -> lanjut gate seperti biasa */ }

  function isMobileUA() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  // Ciri-ciri umum browser automation/headless (scraper, bot testing, dsb).
  // Sekadar mempersulit, bukan mendeteksi semua kasus.
  function looksAutomated() {
    if (!BLOCK_AUTOMATION) return false;
    if (navigator.webdriver) return true;
    return /HeadlessChrome|PhantomJS|Puppeteer|Playwright/i.test(navigator.userAgent);
  }

  function isInstalledApp() {
    // TWA (Android app wrapper dari PWABuilder).
    if (document.referrer && document.referrer.indexOf('android-app://') === 0) {
      if (!STRICT_REFERRER_CHECK) return true; // longgar: android-app:// apa saja diterima
      return document.referrer.indexOf('android-app://' + TWA_PACKAGE_NAME) === 0; // ketat: harus package kita
    }
    // PWA yang di-"Add to Home Screen" lalu dibuka standalone (Android/desktop Chrome)
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS: PWA yang di-"Add to Home Screen"
    if (window.navigator.standalone === true) return true;
    return false;
  }

  if (looksAutomated() || !isMobileUA() || !isInstalledApp()) {
    location.replace('akses-ditolak');
  }
})();
