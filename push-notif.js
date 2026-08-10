// push-notif.js
// Panggil initPushNotifications() setelah user login (currentUserId tersedia).
// Butuh supabaseClient sudah ter-inisialisasi di halaman.

const VAPID_PUBLIC_KEY = 'GANTI_DENGAN_VAPID_PUBLIC_KEY_ANDA';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initPushNotifications(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notification tidak didukung di browser ini.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Kalau permission belum ditanya, minta sekarang
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.log('Izin notifikasi ditolak/belum diberikan.');
      return;
    }

    // Cek apakah sudah ada subscription aktif
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const subJson = subscription.toJSON();

    // Simpan/refresh ke Supabase (upsert berdasarkan endpoint unik)
    await supabaseClient.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth
      },
      { onConflict: 'endpoint' }
    );

    console.log('Push notification aktif.');
  } catch (err) {
    console.error('Gagal setup push notification:', err);
  }
}
