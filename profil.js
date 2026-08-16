  const colorPalette=['#c77b8c','#3a3f47','#2f6b3a','#5b6b74','#2c2c2c','#7c3f9e','#8a7a4a','#1a7fc2'];
  function colorFor(id){let hash=0;for(let i=0;i<id.length;i++)hash=id.charCodeAt(i)+((hash<<5)-hash);return colorPalette[Math.abs(hash)%colorPalette.length];}
  function initials(u){return(u||'?').slice(0,2).toUpperCase();}
  function setAvatar(el, id, username, avatarUrl){
    if(avatarUrl){ el.style.background=`url(${avatarUrl}) center/cover no-repeat`; el.textContent=''; }
    else { el.style.background=colorFor(id); el.textContent=initials(username); }
  }
  function formatJoined(iso){
    if(!iso)return'Bergabung —';
    const d=new Date(iso);
    const bulan=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    return 'Bergabung sejak '+d.getDate()+' '+bulan[d.getMonth()]+' '+d.getFullYear();
  }

  let currentPin=null;
  let currentUserId=null;
  let currentUsername=null;
  let currentAvatarUrl=null;

  function getParam(name){return new URLSearchParams(window.location.search).get(name);}

  function goBack(){
    // Kalau ada riwayat navigasi (misalnya dibuka dari chat.html), kembali ke halaman
    // sebelumnya persis (termasuk percakapan chat yang sedang dibuka).
    // Fallback ke dashboard hanya kalau halaman ini dibuka tanpa riwayat sebelumnya.
    if(window.history.length>1){ window.history.back(); }
    else { window.location.href='dashboard.html'; }
  }
  const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function showConfirm(title,msg,okLabel){
    return new Promise((resolve)=>{
      const ov=document.getElementById('confirmOverlay'),ok=document.getElementById('confirmOkBtn'),cancel=document.getElementById('confirmCancelBtn');
      document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmMsg').textContent=msg;ok.textContent=okLabel||'Hapus';
      ov.classList.add('open');
      function cleanup(result){ov.classList.remove('open');ok.removeEventListener('click',onOk);cancel.removeEventListener('click',onCancel);ov.removeEventListener('click',onOverlay);resolve(result);}
      function onOk(){cleanup(true);} function onCancel(){cleanup(false);} function onOverlay(e){if(e.target===ov)cleanup(false);}
      ok.addEventListener('click',onOk);cancel.addEventListener('click',onCancel);ov.addEventListener('click',onOverlay);
    });
  }

  async function boot(){
    const {data:{session}} = await supabaseClient.auth.getSession();
    if(!session){ window.location.replace('index.html'); return; }
    const myUid=session.user.id;
    const rawParam=getParam('uid');
    const viewUid=(rawParam && UUID_RE.test(rawParam) && rawParam!==myUid) ? rawParam : myUid;
    const isOwn = viewUid===myUid;

    if(!isOwn){
      document.getElementById('pageTitle').textContent='Profil Kontak';
      document.getElementById('ownOnlySection').style.display='none';
      document.getElementById('statsRow').style.display='none';
      const msgBtn=document.getElementById('msgBtn');
      msgBtn.style.display='flex';
      const clearChatBtn=document.getElementById('clearChatBtn');
      const deleteContactBtn=document.getElementById('deleteContactBtn');
      clearChatBtn.style.display='flex';
      deleteContactBtn.style.display='flex';
      const {data:prof,error:profErr} = await supabaseClient.from('profiles').select('username, created_at, avatar_url').eq('id', viewUid).maybeSingle();
      if(profErr){ console.error('Gagal memuat profil kontak:',profErr); }
      if(!prof){ document.getElementById('hUname').textContent='Pengguna tidak ditemukan'; document.getElementById('authGate').style.display='none'; return; }
      document.getElementById('hUname').textContent = prof.username;
      setAvatar(document.getElementById('hAvatar'), viewUid, prof.username, prof.avatar_url);
      document.getElementById('hJoined').textContent = formatJoined(prof.created_at);
      document.getElementById('e2eCardDesc').textContent = 'Pesan antara kamu dan '+prof.username+' dilindungi enkripsi end-to-end.';
      document.getElementById('e2eInfoText').textContent = 'Semua pesan antara kamu dan '+prof.username+' dilindungi enkripsi end-to-end secara otomatis.';
      msgBtn.addEventListener('click',()=>{window.location.href=`chat.html?uid=${viewUid}&uname=${encodeURIComponent(prof.username)}`;});
      clearChatBtn.addEventListener('click',async()=>{
        const ok=await showConfirm('Hapus Untuk Semua Orang','Semua percakapan ini akan di hapus untuk semua orang','Hapus Permanen');
        if(!ok)return;
        const {error}=await supabaseClient.from('messages').delete().or(`and(sender_id.eq.${myUid},receiver_id.eq.${viewUid}),and(sender_id.eq.${viewUid},receiver_id.eq.${myUid})`);
        if(error){alert('Gagal menghapus permanen. Coba lagi.');return;}
        await supabaseClient.from('chat_clears').delete().eq('user_id',myUid).eq('peer_id',viewUid);
        window.location.href=`chat.html?uid=${viewUid}&uname=${encodeURIComponent(prof.username)}`;
      });
      deleteContactBtn.addEventListener('click',async()=>{
        const ok=await showConfirm('Hapus Kontak Ini?','Menghapus kontak akan menghapus juga kontak anda dari teman ini.','Hapus');
        if(!ok)return;
        const {error}=await supabaseClient.from('contacts').delete().or(`and(requester_id.eq.${myUid},addressee_id.eq.${viewUid}),and(requester_id.eq.${viewUid},addressee_id.eq.${myUid})`);
        if(!error)window.location.href='dashboard.html';
      });
      document.getElementById('authGate').style.display = 'none';
      return;
    }

    const {data:prof} = await supabaseClient.from('profiles').select('username, pin, avatar_url').eq('id', myUid).maybeSingle();
    if(prof){
      currentPin = prof.pin;
      currentUserId = myUid;
      currentAvatarUrl = prof.avatar_url || null;
      document.getElementById('hUname').textContent = prof.username;
      currentUsername = prof.username;
      document.getElementById('iPin').textContent = prof.pin;
      setAvatar(document.getElementById('hAvatar'), myUid, prof.username, currentAvatarUrl);
    }
    document.getElementById('avatarEditBadge').style.display = 'flex';
    updateAvatarRemoveRow();
    document.getElementById('hJoined').textContent = formatJoined(session.user.created_at);
    document.getElementById('e2eCardDesc').textContent = 'Semua pesanmu di Baku Chat dilindungi enkripsi end-to-end. Bahkan kami pun tidak bisa membacanya.';
    document.getElementById('e2eInfoText').textContent = 'Semua pesan pribadi di Baku Chat dilindungi enkripsi end-to-end secara otomatis, di setiap obrolan yang kamu punya.';

    const {data:cRows} = await supabaseClient.from('contacts').select('requester_id, addressee_id').eq('status','accepted').or(`requester_id.eq.${myUid},addressee_id.eq.${myUid}`);
    document.getElementById('stKontak').textContent = (cRows||[]).length;

    const {count:sCount} = await supabaseClient.from('statuses').select('id',{count:'exact',head:true}).eq('user_id',myUid).gt('expires_at', new Date().toISOString());
    document.getElementById('stStatus').textContent = sCount ?? 0;

    document.getElementById('logoutBtn').addEventListener('click', async()=>{
      const ok = await showConfirm('Keluar dari Akun?','Kamu perlu masuk lagi untuk membuka Baku Chat.','Keluar');
      if(!ok) return;
      await supabaseClient.auth.signOut();
      window.location.replace('index.html');
    });

    document.getElementById('authGate').style.display = 'none';
  }
  boot();

  // ---- Foto Profil: resize di client lalu upload ke Supabase Storage (bucket "avatars"),
  // kolom profiles.avatar_url hanya menyimpan URL publiknya. Hanya untuk profil sendiri. ----
  const avatarFileInput=document.getElementById('avatarFileInput'), avatarEditBadge=document.getElementById('avatarEditBadge'), avatarHint=document.getElementById('avatarHint'),
        avatarRemoveRow=document.getElementById('avatarRemoveRow'), avatarRemoveBtn=document.getElementById('avatarRemoveBtn');
  avatarEditBadge.addEventListener('click', ()=>avatarFileInput.click());
  function updateAvatarRemoveRow(){ avatarRemoveRow.style.display = currentAvatarUrl ? 'block' : 'none'; }
  avatarRemoveBtn.addEventListener('click', async ()=>{
    if(!currentUserId) return;
    if(!confirm('Hapus foto profil?')) return;
    await supabaseClient.storage.from('avatars').remove([currentUserId + '.jpg']);
    const {error}=await supabaseClient.from('profiles').update({avatar_url:null}).eq('id', currentUserId);
    if(error){ avatarHint.textContent='Gagal menghapus foto: '+error.message; avatarHint.style.color='var(--error)'; return; }
    currentAvatarUrl=null;
    setAvatar(document.getElementById('hAvatar'), currentUserId, currentUsername, currentAvatarUrl);
    updateAvatarRemoveRow();
    avatarHint.textContent='Foto profil dihapus.'; avatarHint.style.color='var(--ok)';
  });

  // ---- Crop foto: layar penuh ala WhatsApp. Foto bisa digeser (drag/pan) dan
  // diperbesar (pinch dua jari, scroll wheel, atau slider), area lingkaran di tengah
  // menandai bagian yang akan dipakai sebagai foto profil. ----
  const CROP_OUTPUT=400, CROP_MIN_ZOOM=1, CROP_MAX_ZOOM=3;
  const cropOverlay=document.getElementById('cropOverlay'), cropImgEl=document.getElementById('cropImgEl'),
        cropOkBtn=document.getElementById('cropOkBtn'), cropCancelBtn=document.getElementById('cropCancelBtn'),
        cropStageWrap=document.getElementById('cropStageWrap'), cropCircle=document.getElementById('cropCircle'),
        cropZoomRange=document.getElementById('cropZoomRange');
  let cropImg=null, cropObjectUrl=null;
  let stageW=0, stageH=0, circleR=0, circleCX=0, circleCY=0, baseScale=1;
  let zoom=1, cx=0, cy=0; // titik tengah gambar, dalam koordinat px stage
  const cropPointers=new Map();
  let dragStart=null, pinchStart=null;

  function measureStage(){
    const r=cropStageWrap.getBoundingClientRect();
    stageW=r.width; stageH=r.height;
    circleR=Math.min(stageW,stageH)*0.42;
    circleCX=stageW/2; circleCY=stageH/2;
    cropCircle.style.width=cropCircle.style.height=(circleR*2)+'px';
    cropCircle.style.left=(circleCX-circleR)+'px';
    cropCircle.style.top=(circleCY-circleR)+'px';
  }
  function applyTransform(){
    const dispW=cropImg.width*baseScale*zoom, dispH=cropImg.height*baseScale*zoom;
    cropImgEl.style.width=dispW+'px'; cropImgEl.style.height=dispH+'px';
    cropImgEl.style.transform=`translate(${(cx-dispW/2)}px, ${(cy-dispH/2)}px)`;
  }
  function clampCenter(){
    const dispW=cropImg.width*baseScale*zoom, dispH=cropImg.height*baseScale*zoom;
    const minCx=circleCX+circleR-dispW/2, maxCx=circleCX-circleR+dispW/2;
    const minCy=circleCY+circleR-dispH/2, maxCy=circleCY-circleR+dispH/2;
    cx=Math.max(minCx,Math.min(maxCx,cx));
    cy=Math.max(minCy,Math.min(maxCy,cy));
  }
  function setZoom(newZoom, anchorX, anchorY){
    newZoom=Math.max(CROP_MIN_ZOOM,Math.min(CROP_MAX_ZOOM,newZoom));
    if(anchorX==null){ anchorX=circleCX; anchorY=circleCY; }
    const oldDispW=cropImg.width*baseScale*zoom, oldDispH=cropImg.height*baseScale*zoom;
    const relX=(anchorX-(cx-oldDispW/2))/oldDispW, relY=(anchorY-(cy-oldDispH/2))/oldDispH;
    zoom=newZoom;
    const newDispW=cropImg.width*baseScale*zoom, newDispH=cropImg.height*baseScale*zoom;
    cx=anchorX-relX*newDispW+newDispW/2; cy=anchorY-relY*newDispH+newDispH/2;
    clampCenter();
    applyTransform();
    cropZoomRange.value=zoom;
  }
  function openCropper(file){
    cropObjectUrl=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      cropImg=img;
      cropOverlay.classList.add('open');
      document.body.style.overflow='hidden';
      requestAnimationFrame(()=>{
        measureStage();
        baseScale=(circleR*2)/Math.min(img.width,img.height);
        zoom=1; cx=circleCX; cy=circleCY;
        cropZoomRange.value=1;
        cropImgEl.src=cropObjectUrl;
        applyTransform();
      });
    };
    img.onerror=()=>{ avatarHint.textContent='Gagal memuat gambar.'; avatarHint.style.color='var(--error)'; URL.revokeObjectURL(cropObjectUrl); };
    img.src=cropObjectUrl;
  }
  function closeCropper(){
    cropOverlay.classList.remove('open');
    document.body.style.overflow='';
    if(cropObjectUrl){ URL.revokeObjectURL(cropObjectUrl); cropObjectUrl=null; }
    cropImg=null; cropPointers.clear(); dragStart=null; pinchStart=null;
    cropImgEl.removeAttribute('src');
  }
  cropStageWrap.addEventListener('pointerdown',(e)=>{
    if(!cropImg)return;
    cropStageWrap.setPointerCapture(e.pointerId);
    cropPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(cropPointers.size===1){
      dragStart={x:e.clientX,y:e.clientY,cx,cy};
    } else if(cropPointers.size===2){
      dragStart=null;
      const pts=[...cropPointers.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const rect=cropStageWrap.getBoundingClientRect();
      pinchStart={dist, zoom, cx, cy, midX:(pts[0].x+pts[1].x)/2-rect.left, midY:(pts[0].y+pts[1].y)/2-rect.top};
    }
  });
  cropStageWrap.addEventListener('pointermove',(e)=>{
    if(!cropImg||!cropPointers.has(e.pointerId))return;
    cropPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(cropPointers.size===1&&dragStart){
      cx=dragStart.cx+(e.clientX-dragStart.x); cy=dragStart.cy+(e.clientY-dragStart.y);
      clampCenter(); applyTransform();
    } else if(cropPointers.size===2&&pinchStart){
      const pts=[...cropPointers.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      cx=pinchStart.cx; cy=pinchStart.cy;
      setZoom(pinchStart.zoom*(dist/pinchStart.dist), pinchStart.midX, pinchStart.midY);
    }
  });
  function cropPointerEnd(e){
    cropPointers.delete(e.pointerId);
    if(cropPointers.size<2) pinchStart=null;
    if(cropPointers.size===1){
      const remaining=[...cropPointers.values()][0];
      dragStart={x:remaining.x,y:remaining.y,cx,cy};
    } else if(cropPointers.size===0){ dragStart=null; }
  }
  cropStageWrap.addEventListener('pointerup',cropPointerEnd);
  cropStageWrap.addEventListener('pointercancel',cropPointerEnd);
  cropStageWrap.addEventListener('wheel',(e)=>{
    if(!cropImg)return;
    e.preventDefault();
    const rect=cropStageWrap.getBoundingClientRect();
    setZoom(zoom-e.deltaY*0.0015, e.clientX-rect.left, e.clientY-rect.top);
  },{passive:false});
  cropZoomRange.addEventListener('input',()=>{ if(cropImg) setZoom(parseFloat(cropZoomRange.value)); });
  window.addEventListener('resize',()=>{ if(cropImg){ measureStage(); clampCenter(); applyTransform(); } });
  cropCancelBtn.addEventListener('click', ()=>{ closeCropper(); avatarFileInput.value=''; });

  function cropToBlob(){
    return new Promise((resolve,reject)=>{
      const s=baseScale*zoom;
      const dispW=cropImg.width*s, dispH=cropImg.height*s;
      const circleLeft=circleCX-circleR, circleTop=circleCY-circleR;
      const srcX=(circleLeft-(cx-dispW/2))/s, srcY=(circleTop-(cy-dispH/2))/s, srcSize=(circleR*2)/s;
      const outCanvas=document.createElement('canvas');
      outCanvas.width=CROP_OUTPUT; outCanvas.height=CROP_OUTPUT;
      const outCtx=outCanvas.getContext('2d');
      outCtx.drawImage(cropImg,srcX,srcY,srcSize,srcSize,0,0,CROP_OUTPUT,CROP_OUTPUT);
      outCanvas.toBlob(blob=>{ blob?resolve(blob):reject(new Error('Gagal memproses gambar')); }, 'image/jpeg', 0.9);
    });
  }

  cropOkBtn.addEventListener('click', async ()=>{
    if(!cropImg || !currentUserId) return;
    cropOkBtn.disabled=true;
    avatarHint.textContent='Mengunggah foto...'; avatarHint.style.color='var(--muted)';
    try{
      const blob=await cropToBlob();
      closeCropper();
      const path=currentUserId+'.jpg';
      const {error:upErr}=await supabaseClient.storage.from('avatars').upload(path, blob, {contentType:'image/jpeg', upsert:true});
      if(upErr){ avatarHint.textContent='Gagal mengunggah foto: '+upErr.message; avatarHint.style.color='var(--error)'; return; }
      const {data:urlData}=supabaseClient.storage.from('avatars').getPublicUrl(path);
      const publicUrl=urlData.publicUrl+'?v='+Date.now();
      const {error}=await supabaseClient.from('profiles').update({avatar_url:publicUrl}).eq('id', currentUserId);
      if(error){ avatarHint.textContent='Gagal menyimpan foto: '+error.message; avatarHint.style.color='var(--error)'; return; }
      currentAvatarUrl=publicUrl;
      setAvatar(document.getElementById('hAvatar'), currentUserId, currentUsername, currentAvatarUrl);
      updateAvatarRemoveRow();
      avatarHint.textContent='Foto profil diperbarui.'; avatarHint.style.color='var(--ok)';
    }catch(err){
      avatarHint.textContent='Gagal memproses foto.'; avatarHint.style.color='var(--error)';
    }finally{
      cropOkBtn.disabled=false;
      avatarFileInput.value='';
    }
  });

  avatarFileInput.addEventListener('change', ()=>{
    const file=avatarFileInput.files[0];
    if(!file || !currentUserId) return;
    if(!file.type.startsWith('image/')){ avatarHint.textContent='File harus berupa gambar.'; avatarHint.style.color='var(--error)'; avatarFileInput.value=''; return; }
    avatarHint.textContent=''; 
    openCropper(file);
  });

  document.getElementById('pinCopyBtn').addEventListener('click', async () => {
    if(!currentPin) return;
    const btn = document.getElementById('pinCopyBtn');
    try{ await navigator.clipboard.writeText(currentPin); btn.textContent='Tersalin ✓'; }
    catch(e){ btn.textContent='Gagal'; }
    setTimeout(()=>{ btn.textContent='Salin'; }, 1600);
  });

  document.getElementById('e2eCard').addEventListener('click', () => {
    document.getElementById('e2eInfoOverlay').classList.add('open');
  });
  document.getElementById('e2eInfoCloseBtn').addEventListener('click', () => {
    document.getElementById('e2eInfoOverlay').classList.remove('open');
  });
  document.getElementById('e2eInfoOverlay').addEventListener('click', (e) => {
    if(e.target.id==='e2eInfoOverlay') document.getElementById('e2eInfoOverlay').classList.remove('open');
  });
