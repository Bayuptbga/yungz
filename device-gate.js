// device-gate.js
// Blokir akses dari desktop dan dari Chrome/browser biasa yang belum "install" app.
// CATATAN: ini gating UX, BUKAN kontrol keamanan sejati. User-Agent dan display-mode
// bisa dipalsukan oleh siapa pun yang cukup paham (DevTools device toolbar, dsb).
// Jangan andalkan ini sebagai satu-satunya lapisan proteksi.
//
// ==== SAKLAR ON/OFF ====
// 1) Saklar utama (permanen, berlaku di semua halaman yang load file ini):
//    ganti DEVICE_GATE_ENABLED di bawah ke false untuk mematikan gate sepenuhnya.
// 2) Saklar sementara (buat testing di browser sendiri, tanpa ubah kode/deploy ulang):
//    buka console lalu jalankan salah satu dari:
//      localStorage.setItem('device_gate_disabled', '1')   // matikan gate di browser ini
//      localStorage.removeItem('device_gate_disabled')     // nyalakan lagi
(function () {
  var DEVICE_GATE_ENABLED = false;

  if (!DEVICE_GATE_ENABLED) return;
  try {
    if (localStorage.getItem('device_gate_disabled') === '1') return;
  } catch (e) { /* localStorage diblokir (mis. private mode) -> lanjut gate seperti biasa */ }

  function isMobileUA() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function isInstalledApp() {
    // TWA (Android app wrapper dari PWABuilder) selalu kirim referrer ini
    if (document.referrer && document.referrer.startsWith('android-app://')) return true;
    // PWA yang di-"Add to Home Screen" lalu dibuka standalone (Android/desktop Chrome)
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS: PWA yang di-"Add to Home Screen"
    if (window.navigator.standalone === true) return true;
    return false;
  }

  if (!isMobileUA() || !isInstalledApp()) {
    location.replace('akses-ditolak');
  }
})();
