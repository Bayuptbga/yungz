// push-notif.js (VERSI DEBUG - alert() akan dihapus setelah masalah ketemu)

const VAPID_PUBLIC_KEY = 'BLIETFYW3Md9wQlUAqRSL7LI3p_JiuDbAt3gRLPZtfJg_LaZEepowxzmYvIOglkpOkm0irU20-uywW-H_pABOiM';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initPushNotifications(userId) {
  alert('DEBUG 1: initPushNotifications terpanggil, userId=' + userId);

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('DEBUG STOP: Browser ini TIDAK mendukung Push API.');
    return;
  }
  alert('DEBUG 2: Push API didukung browser ini.');

  try {
    const registration = await navigator.serviceWorker.ready;
    alert('DEBUG 3: Service worker ready. Scope=' + registration.scope);

    let permission = Notification.permission;
    alert('DEBUG 4: Status permission saat ini = ' + permission);

    if (permission === 'default') {
      permission = await Notification.requestPermission();
      alert('DEBUG 5: Hasil setelah requestPermission = ' + permission);
    }

    if (permission !== 'granted') {
      alert('DEBUG STOP: Permission bukan granted (' + permission + '), berhenti di sini.');
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      alert('DEBUG 6: Belum ada subscription, membuat baru...');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      alert('DEBUG 7: Subscription berhasil dibuat.');
    } else {
      alert('DEBUG 6b: Subscription sudah ada sebelumnya.');
    }

    const subJson = subscription.toJSON();

    const { error } = await supabaseClient.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth
      },
      { onConflict: 'endpoint' }
    );

    if (error) {
      alert('DEBUG ERROR simpan ke Supabase: ' + JSON.stringify(error));
    } else {
      alert('DEBUG SUKSES: Push notification aktif & tersimpan!');
    }
  } catch (err) {
    alert('DEBUG CATCH ERROR: ' + (err && err.message ? err.message : String(err)));
  }
}
