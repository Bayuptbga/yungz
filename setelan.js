  const colorPalette=['#c77b8c','#3a3f47','#2f6b3a','#5b6b74','#2c2c2c','#7c3f9e','#8a7a4a','#1a7fc2'];
  function colorFor(id){let hash=0;for(let i=0;i<id.length;i++)hash=id.charCodeAt(i)+((hash<<5)-hash);return colorPalette[Math.abs(hash)%colorPalette.length];}
  function initials(u){return(u||'?').slice(0,2).toUpperCase();}

  // ---- Foto Profil: preview saja di sini, edit/ganti fotonya dilakukan di halaman Profil ----
  const avatarPreview=document.getElementById('avatarPreview');

  function renderAvatarPreview(){
    if(currentAvatarUrl){
      avatarPreview.style.background=`url(${currentAvatarUrl}) center/cover no-repeat`;
      avatarPreview.textContent='';
    } else {
      avatarPreview.style.background = currentUserId ? colorFor(currentUserId) : 'var(--border)';
      avatarPreview.textContent = initials(currentUsername);
    }
  }

  // ---- Navigasi sub-halaman di dalam satu file (menggantikan 3 file lama) ----
  const VIEWS = {
    main:    { id:'viewMain',    title:'Setelan' },
    privasi: { id:'viewPrivasi', title:'Privasi & Keamanan' },
    data:    { id:'viewData',    title:'Data & Penyimpanan' }
  };
  function applyView(name){
    if(!VIEWS[name]) name='main';
    Object.values(VIEWS).forEach(v=>document.getElementById(v.id).classList.remove('active'));
    document.getElementById(VIEWS[name].id).classList.add('active');
    document.getElementById('appbarTitle').textContent = VIEWS[name].title;
  }
  function switchView(name){
    // Push hash biar tombol back browser kembali ke menu utama, bukan langsung keluar halaman.
    location.hash = name==='main' ? '' : name;
  }
  function currentViewFromHash(){
    const h=(location.hash||'').replace('#','');
    return VIEWS[h] ? h : 'main';
  }
  window.addEventListener('hashchange', ()=>applyView(currentViewFromHash()));
  applyView(currentViewFromHash());

  function goBack(){
    // Selalu mundur lewat history browser yang sesungguhnya (bukan cuma reset
    // hash ke ''), supaya urutannya benar untuk kedua kasus:
    // 1) Dibuka langsung dari drawer dashboard ke sub-halaman (mis. #data):
    //    history-nya [..., dashboard, setelan#data] -> back = balik ke dashboard.
    // 2) Dibuka dari menu utama Setelan lalu klik ke sub-halaman:
    //    switchView() di atas sudah nambah entry baru saat itu, jadi history-nya
    //    [..., dashboard, setelan(main), setelan#privasi] -> back = balik ke
    //    menu utama Setelan dulu (hashchange event yang urus tampilannya),
    //    baru back sekali lagi = balik ke dashboard.
    // Reset hash manual (location.hash='') TIDAK dipakai lagi karena itu malah
    // NAMBAH entry history baru alih-alih mundur, sehingga tombol back jadi
    // "mantul" dan terasa stuck di halaman Setelan.
    if(window.history.length>1){ window.history.back(); }
    else { window.location.href='dashboard.html'; }
  }

  let currentUsername=null;
  let currentUserId=null;
  let currentAvatarUrl=null;

  async function boot(){
    const {data:{session}} = await supabaseClient.auth.getSession();
    if(!session){ window.location.replace('index.html'); return; }
    currentUserId = session.user.id;
    const {data:prof} = await supabaseClient.from('profiles').select('username, avatar_url').eq('id', session.user.id).maybeSingle();
    if(prof){ currentUsername = prof.username; currentAvatarUrl = prof.avatar_url || null; }
    renderAvatarPreview();
    document.getElementById('authGate').style.display = 'none';
  }
  boot();

  // Tombol Keluar sudah dipindah ke profil.html (bagian profil sendiri).

  // ---- Instal Aplikasi (PWA) ----
  let deferredPrompt = null;
  const installRow = document.getElementById('installRow'), installedRow = document.getElementById('installedRow');
  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  if(isStandalone()){ installedRow.style.display='flex'; }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(!isStandalone()){ installRow.style.display='flex'; }
  });
  document.getElementById('installBtn').addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const {outcome} = await deferredPrompt.userChoice;
    if(outcome === 'accepted'){ installRow.style.display='none'; installedRow.style.display='flex'; }
    deferredPrompt = null;
  });
  window.addEventListener('appinstalled', () => {
    installRow.style.display='none'; installedRow.style.display='flex';
  });

  // ---- Popup "Informasi Tentang Aplikasi Ini" ----
  const aboutInfoOverlay=document.getElementById('aboutInfoOverlay');
  document.getElementById('aboutInfoRow').addEventListener('click',()=>aboutInfoOverlay.classList.add('open'));
  document.getElementById('aboutInfoCloseBtn').addEventListener('click',()=>aboutInfoOverlay.classList.remove('open'));
  aboutInfoOverlay.addEventListener('click',(e)=>{ if(e.target===aboutInfoOverlay) aboutInfoOverlay.classList.remove('open'); });

  // ---- Hapus Akun ----
  // Alur: re-auth pakai kata sandi (memastikan yang minta hapus benar pemilik akun,
  // bukan sesi yang ke-tinggal login di device orang lain) -> konfirmasi eksplisit
  // (irreversible) -> panggil RPC delete_own_account() yang jalan di server dengan
  // hak akses lebih tinggi (SECURITY DEFINER) untuk hapus semua data + akun auth-nya.
  // Anon key di browser TIDAK PERNAH bisa hapus baris auth.users langsung -- itu
  // sengaja dibatasi Supabase, makanya harus lewat fungsi database ini.
  document.getElementById('deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw=document.getElementById('deletePassword').value,
          b=document.getElementById('deleteSubmitBtn'), hint=document.getElementById('deleteHint');
    if(!pw){ hint.textContent='Masukkan kata sandi.'; hint.className='hint err'; return; }
    if(!currentUsername){ hint.textContent='Gagal memuat data akun, coba muat ulang halaman.'; hint.className='hint err'; return; }
    b.disabled=true; b.classList.add('loading'); b.querySelector('.btn-label').textContent='Memeriksa...';
    const {error:reauthErr} = await supabaseClient.auth.signInWithPassword({email: usernameToEmail(currentUsername), password: pw});
    if(reauthErr){
      hint.textContent='Kata sandi salah.'; hint.className='hint err';
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Hapus Akun Saya';
      return;
    }
    const confirmed=confirm('Yakin ingin menghapus akun secara permanen?\n\nSemua chat, kontak, dan status akan hilang dan TIDAK BISA dikembalikan.');
    if(!confirmed){
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Hapus Akun Saya';
      return;
    }
    b.querySelector('.btn-label').textContent='Menghapus...';
    const {error:delErr} = await supabaseClient.rpc('delete_own_account');
    if(delErr){
      hint.textContent='Gagal menghapus akun: '+delErr.message; hint.className='hint err';
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Hapus Akun Saya';
      return;
    }
    await supabaseClient.auth.signOut();
    window.location.replace('index.html');
  });

  // ---- Ganti Kata Sandi (dulu di privasi-keamanan.html) ----
  function translatePwError(msg){
    const m=(msg||'').toLowerCase();
    if(m.includes('at least 6')) return 'Kata sandi minimal 6 karakter.';
    if(m.includes('same') && m.includes('password')) return 'Kata sandi baru harus beda dari yang lama.';
    if(m.includes('rate limit')) return 'Terlalu banyak percobaan, coba lagi sebentar lagi.';
    return 'Gagal menyimpan kata sandi, coba lagi.';
  }
  function translateOldPwError(msg){
    const m=(msg||'').toLowerCase();
    if(m.includes('rate limit')) return 'Terlalu banyak percobaan, coba lagi sebentar lagi.';
    return 'Kata sandi lama salah.';
  }
  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p0=document.getElementById('oldPassword').value, p1=document.getElementById('newPassword').value, p2=document.getElementById('confirmPassword').value,
          b=document.getElementById('pwSubmitBtn'), hint=document.getElementById('pwHint');
    if(!p0){ hint.textContent='Masukkan kata sandi lama.'; hint.className='hint err'; return; }
    if(p1.length<6){ hint.textContent='Kata sandi minimal 6 karakter.'; hint.className='hint err'; return; }
    if(p1!==p2){ hint.textContent='Kata sandi tidak cocok.'; hint.className='hint err'; return; }
    if(!currentUsername){ hint.textContent='Gagal memuat data akun, coba muat ulang halaman.'; hint.className='hint err'; return; }
    b.disabled=true; b.classList.add('loading'); b.querySelector('.btn-label').textContent='Memeriksa...';
    const {error:reauthErr} = await supabaseClient.auth.signInWithPassword({email: usernameToEmail(currentUsername), password: p0});
    if(reauthErr){
      hint.textContent=translateOldPwError(reauthErr.message); hint.className='hint err';
      b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Simpan Kata Sandi';
      return;
    }
    b.querySelector('.btn-label').textContent='Menyimpan...';
    const {error} = await supabaseClient.auth.updateUser({password:p1});
    b.disabled=false; b.classList.remove('loading'); b.querySelector('.btn-label').textContent='Simpan Kata Sandi';
    if(error){ hint.textContent=translatePwError(error.message); hint.className='hint err'; return; }
    hint.textContent='Kata sandi berhasil diperbarui.'; hint.className='hint ok';
    document.getElementById('pwForm').reset();
  });
