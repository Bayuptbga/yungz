// device-gate.js
// Blokir akses dari desktop dan dari Chrome/browser biasa yang belum "install" app.
// CATATAN: ini gating UX, BUKAN kontrol keamanan sejati. User-Agent dan display-mode
// bisa dipalsukan oleh siapa pun yang cukup paham (DevTools device toolbar, dsb).
// Jangan andalkan ini sebagai satu-satunya lapisan proteksi.
(function () {
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
    location.replace('akses-ditolak.html');
  }
})();
