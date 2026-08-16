  function translateAuthError(msg){
    const m = (msg||'').toLowerCase();
    if(m.includes('at least 6')) return 'Kata sandi minimal 6 karakter.';
    if(m.includes('already registered') || m.includes('already exists') || m.includes('already been registered')) return 'Username sudah dipakai, coba yang lain.';
    if(m.includes('invalid') && m.includes('email')) return 'Username mengandung karakter yang tidak valid.';
    if(m.includes('rate limit')) return 'Terlalu banyak percobaan, coba lagi sebentar lagi.';
    return 'Terjadi kesalahan, coba lagi.';
  }

  function applyPanel(which){
    const isLogin = which==='login';
    document.getElementById('panelLogin').classList.toggle('active', isLogin);
    document.getElementById('panelDaftar').classList.toggle('active', !isLogin);
    document.getElementById('tabLogin').classList.toggle('active', isLogin);
    document.getElementById('tabDaftar').classList.toggle('active', !isLogin);
    document.getElementById('tabLogin2').classList.toggle('active', isLogin);
    document.getElementById('tabDaftar2').classList.toggle('active', !isLogin);
    document.getElementById('topSub').textContent = isLogin ? 'Masuk untuk lanjut ngobrol' : 'Buat akun untuk mulai ngobrol';
    history.replaceState(null, '', isLogin ? '#masuk' : '#daftar');
  }
  function switchPanel(which){
    if(document.startViewTransition){ document.startViewTransition(()=>applyPanel(which)); }
    else{ applyPanel(which); }
  }

  // Catatan: index.html TIDAK LAGI mengurus status kunci enkripsi (PIN Enkripsi).
  // Login/daftar langsung lempar ke dashboard. Kunci ECDH dibuat otomatis secara diam-diam
  // di background (lihat dashboard.html -> boot()), dan modal restore/setel Password
  // Enkripsi baru muncul saat user benar-benar membuka sebuah chat (lihat chat.html -> init()).

  // Login
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u=document.getElementById('loginUsername').value.trim(), p=document.getElementById('loginPassword').value,
          b=document.getElementById('loginSubmitBtn'), err=document.getElementById('loginError'), errText=document.getElementById('loginErrorText');
    err.classList.remove('show'); b.disabled=true; b.classList.add('loading'); b.querySelector('.btn-label').textContent='Memeriksa...';
    const {data:liData, error} = await supabaseClient.auth.signInWithPassword({email: usernameToEmail(u), password: p});
    if(error){
      errText.textContent='Username atau kata sandi salah.'; err.classList.add('show');
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Masuk';
      return;
    }
    window.location.replace('dashboard');
  });

  // Daftar
  document.getElementById('daftarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u=document.getElementById('daftarUsername').value.trim(), p=document.getElementById('daftarPassword').value,
          b=document.getElementById('daftarSubmitBtn'), hint=document.getElementById('uHint'), pHint=document.getElementById('pHint');
    pHint.textContent='Minimal 6 karakter'; pHint.className='hint';
    if(p.length < 6){
      pHint.textContent='Kata sandi minimal 6 karakter'; pHint.className='hint err';
      return;
    }
    if(!validUsername(u)){
      hint.textContent='Username 3-20 karakter, hanya huruf/angka/underscore.'; hint.className='hint err';
      return;
    }
    b.disabled=true; b.classList.add('loading'); b.querySelector('.btn-label').textContent='Membuat...';
    const {data:sData, error:sErr} = await supabaseClient.auth.signUp({email: usernameToEmail(u), password: p});
    if(sErr){
      hint.textContent=translateAuthError(sErr.message); hint.className='hint err';
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Daftar';
      return;
    }
    const pin = generatePin();
    await supabaseClient.from('profiles').insert({id: sData.user.id, username: u, pin: pin});
    // Buat & publish keypair ECDH secara diam-diam di background (biar orang lain
    // langsung bisa kirim pesan terenkripsi ke akun ini).
    try{ await E2E.ensureKeypair(sData.user.id); }
    catch(e){ console.error('Gagal setup kunci enkripsi:', e); }
    document.getElementById('panelDaftar').style.display='none';
    document.getElementById('topBadge').style.display='none';
    document.getElementById('pinValue').textContent=pin;
    document.getElementById('pinScreen').classList.add('show');
  });
  document.getElementById('pinCopyBtn').addEventListener('click', async () => {
    const pin=document.getElementById('pinValue').textContent, label=document.getElementById('pinCopyLabel');
    try{ await navigator.clipboard.writeText(pin); label.textContent='Tersalin ✓'; }
    catch(e){ label.textContent='Gagal menyalin'; }
    setTimeout(()=>{ label.textContent='Salin PIN'; }, 1800);
  });

  // Setelah lihat PIN, lanjut langsung ke dashboard. PIN Enkripsi TIDAK
  // ditanya di sini -- baru ditawarkan nanti saat user pertama kali buka sebuah chat
  // (lihat chat.html).
  document.getElementById('pinContinueBtn').addEventListener('click', () => { window.location.replace('dashboard'); });

  // Buka panel sesuai hash URL (index.html#daftar), default: login
  if(location.hash === '#daftar'){ switchPanel('daftar'); }

  // Kalau sesi masih aktif, langsung lempar ke dashboard tanpa perlu login ulang.
  (async()=>{
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(session){ window.location.replace('dashboard'); return; }
    document.getElementById('authGate').style.display='none';
  })();
