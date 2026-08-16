  const params = new URLSearchParams(window.location.search);
  const rawUid = params.get('uid');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const peerId = (rawUid && UUID_RE.test(rawUid)) ? rawUid : null;
  let currentUserId = null; let peerUsername = params.get('uname') || '';
  let myPrivateKey = null, myPublicKeyB64 = null, peerPublicKeyB64 = null;
  const msgArea = document.getElementById('msgArea'), msgInput = document.getElementById('msgInput'), sendBtn = document.getElementById('sendBtn'), peerAvatar = document.getElementById('peerAvatar'), peerUnameEl = document.getElementById('peerUname');
  const replyBar = document.getElementById('replyBar'), rbName = document.getElementById('rbName'), rbText = document.getElementById('rbText'), rbClose = document.getElementById('rbClose');
  const messagesById = new Map(); // id -> {id, sender_id, content}  (buat render kutipan reply)
  let replyingTo = null; // {id, sender_id, content} pesan yang sedang dibalas, atau null
  const colorPalette = ['#c77b8c','#3a3f47','#2f6b3a','#5b6b74','#2c2c2c','#7c3f9e','#8a7a4a','#1a7fc2'];
  function colorFor(id){let hash=0;for(let i=0;i<id.length;i++)hash=id.charCodeAt(i)+((hash<<5)-hash);return colorPalette[Math.abs(hash)%colorPalette.length];}
  function initials(u){return (u||'?').slice(0,2).toUpperCase();}
  function applyAvatarEl(el,id,username,avatarUrl){
    if(avatarUrl){el.style.background=`url(${avatarUrl}) center/cover no-repeat`;el.textContent='';}
    else{el.style.background=colorFor(id);el.textContent=initials(username);}
  }
  function escapeHtml(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
  function keyChangeNoticeHTML(uname){
    return `<div class="keychange-notice"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg><span>Kode keamanan enkripsi dengan <b>${escapeHtml(uname||'kontak ini')}</b> telah berubah. <span class="e2e-learn">Info lebih lanjut</span>.</span></div>`;
  }
  function normalizeText(str){if(!str)return'';str=str.replace(/[\r\v\f\u2028\u2029]/g,'\n');const lines=str.split('\n').map(l=>l.replace(/[ \t]+$/,''));const out=[];let blankRun=0;for(const line of lines){if(line.trim()===''){blankRun++;if(blankRun<=1)out.push('');}else{blankRun=0;out.push(line);}}return out.join('\n').trim();}
  function timeLabel(iso){return new Date(iso).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
  function isLockedContent(content){return typeof content==='string' && content.startsWith('🔒');}
  if(peerId){
    const goProfil=()=>window.location.href=`profil.html?uid=${peerId}`;
    document.getElementById('peerAvatar').addEventListener('click',goProfil);
    document.getElementById('peerWho').addEventListener('click',goProfil);
  }
  function dayLabel(iso){const d=new Date(iso),t=new Date(),y=new Date();y.setDate(t.getDate()-1);const s=(a,b)=>a.toDateString()===b.toDateString();if(s(d,t))return'Hari ini';if(s(d,y))return'Kemarin';return d.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});}
  // Status: 'sent' (badge abu, centang 1 putih), 'delivered' (badge biru, centang 2 putih), 'read' (badge hijau, centang 2 biru)
  function tickStatus(del,read){ return read?'read':(del?'delivered':'sent'); }
  function tickSvg(status){
    const attrs='width="15" height="15" viewBox="0 0 24 24" fill="none"';
    if(status==='sent'){
      return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#8a97a3"/><path d="M7.3 12.3l2.7 2.7L16.8 8.4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    }
    if(status==='delivered'){
      return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#0a84ff"/><path d="M5.8 12.3l2.6 2.6L14 9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10.8 12.3l2.6 2.6L19 9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    }
    return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#189a56"/><path d="M5.8 12.3l2.6 2.6L14 9" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10.8 12.3l2.6 2.6L19 9" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
  }
  async function init(){
    try{
      if(!peerId){window.location.href='dashboard.html';return;}
      const {data:{session},error:sessErr} = await supabaseClient.auth.getSession();
      if(sessErr) throw sessErr;
      if(!session){window.location.replace('index.html');return;}
      currentUserId=session.user.id;
      // Device baru otomatis dapat keypair baru (tidak ada restore/backup PIN,
      // mirip default WhatsApp: chat lama tidak terbaca lagi di device baru).
      let kp=await E2E.ensureKeypair(currentUserId);
      myPrivateKey=kp.privateKey;myPublicKeyB64=kp.publicKeyB64;
      document.getElementById('authGate').style.display='none';
      const {data:rel,error:relErr}=await supabaseClient.from('contacts').select('id, status').or(`and(requester_id.eq.${currentUserId},addressee_id.eq.${peerId}),and(requester_id.eq.${peerId},addressee_id.eq.${currentUserId})`).eq('status','accepted').maybeSingle();
      if(relErr) throw relErr;
      if(!rel){msgArea.innerHTML=`<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#66798d" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.6 3-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><path d="M18 8v5M15.5 10.5h5"/></svg></div><div class="es-title">Belum berteman</div><span>Tambahkan lewat tab Kontak dulu ya.</span></div>`;return;}
      const {data:prof,error:profErr}=await supabaseClient.from('profiles').select('username, public_key, avatar_url').eq('id',peerId).maybeSingle();
      if(profErr) throw profErr;
      if(!peerUsername) peerUsername=prof?prof.username:'Pengguna';
      peerPublicKeyB64=prof&&prof.public_key?prof.public_key:null;
      document.getElementById('keyChangeInfoText').textContent='Kode keamanan enkripsi kamu dengan '+(peerUsername||'kontak ini')+' sudah berubah sejak percakapan terakhir. Ini biasanya terjadi kalau dia memasang ulang aplikasi, ganti HP, atau menghapus data aplikasi. Kalau ragu, coba konfirmasi lewat cara lain sebelum membagikan info sensitif.';
      // ---- Deteksi kode keamanan berubah sejak percakapan terakhir dibuka ----
      // Bandingkan public key peer yang baru saja diambil dengan yang terakhir
      // kali "dilihat" di device ini (disimpan di localStorage). Kalau beda dan
      // sebelumnya memang sudah pernah ada catatan (bukan chat pertama kali),
      // tampilkan peringatan di dalam chat (mirip notifikasi WhatsApp).
      const peerKeySeenLS='e2e_peerkey_seen_'+currentUserId+'_'+peerId;
      const keyChangeNoticeLS='e2e_keychange_notice_'+currentUserId+'_'+peerId;
      if(peerPublicKeyB64){
        const lastSeenKey=localStorage.getItem(peerKeySeenLS);
        if(lastSeenKey && lastSeenKey!==peerPublicKeyB64) localStorage.setItem(keyChangeNoticeLS,'1');
        localStorage.setItem(peerKeySeenLS,peerPublicKeyB64);
      }
      // Peringatan tetap ditampilkan tiap kali chat ini dibuka (tidak otomatis
      // hilang setelah sekali dilihat) sampai user membersihkan obrolan lewat
      // menu "Bersihkan Obrolan", yang akan mereset flag ini.
      const showKeyChangeNotice = localStorage.getItem(keyChangeNoticeLS)==='1';
      applyAvatarEl(peerAvatar,peerId,peerUsername,prof&&prof.avatar_url);peerUnameEl.textContent=peerUsername;
      updateInputAvailability();
      await loadMessages(showKeyChangeNotice);await markIncomingAsRead();subscribeRealtime();subscribePresence();subscribePeerKeyChange();
    }catch(err){
      console.error('init error:',err);
      document.getElementById('authGate').style.display='none';
      msgArea.innerHTML=`<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#e4394f" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg></div><div class="es-title">Gagal memuat percakapan</div><span>Cek koneksi internet lalu tarik-turun atau buka ulang chat ini.</span></div>`;
    }
  }

  // ---- Input dikunci selama public key saya atau lawan bicara belum tersedia
  // (lawan bicara belum pernah buka aplikasi buat publish public key-nya). ----
  function updateInputAvailability(){
    const ready=!!(myPublicKeyB64&&peerPublicKeyB64);
    msgInput.disabled=!ready;
    if(ready) return;
    msgInput.placeholder = 'Menunggu '+(peerUsername||'lawan bicara')+' membuka aplikasi buat aktifkan enkripsi...';
  }

  const peerSubEl=document.getElementById('peerSub'),statusDotEl=document.getElementById('statusDot');let presenceChannel=null;
  function subscribePresence(){
    presenceChannel=supabaseClient.channel('online-users',{config:{presence:{key:currentUserId}}});
    presenceChannel.on('presence',{event:'sync'},updatePeerOnlineStatus).on('presence',{event:'join'},updatePeerOnlineStatus).on('presence',{event:'leave'},updatePeerOnlineStatus).subscribe(async(s)=>{if(s==='SUBSCRIBED')await presenceChannel.track({online_at:new Date().toISOString()});});
  }
  function updatePeerOnlineStatus(){
    if(!presenceChannel)return;const isOnline=!!presenceChannel.presenceState()[peerId];
    if(isOnline){peerSubEl.textContent='Online';peerSubEl.classList.add('online');statusDotEl.classList.add('online');}else{peerSubEl.textContent='Offline';peerSubEl.classList.remove('online');statusDotEl.classList.remove('online');}
  }
  let clearedBefore=null;
  async function loadMessages(showKeyChangeNotice){
    const {data:clearRow}=await supabaseClient.from('chat_clears').select('cleared_before').eq('user_id',currentUserId).eq('peer_id',peerId).maybeSingle();
    clearedBefore=clearRow?clearRow.cleared_before:null;
    let query=supabaseClient.from('messages').select('id, sender_id, content, created_at, delivered_at, read_at, reply_to_id').or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${currentUserId})`).order('created_at',{ascending:true});
    if(clearedBefore)query=query.gt('created_at',clearedBefore);
    const {data:rows,error}=await query;
    const banner=`<div class="e2e-banner" id="e2eBanner"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg><span>Pesan terenkripsi secara end-to-end. Hanya orang di obrolan ini yang bisa membaca atau membagikannya. <span class="e2e-learn">Pelajari selengkapnya</span>.</span></div>`;
    const keyNotice=showKeyChangeNotice?keyChangeNoticeHTML(peerUsername):'';
    if(error||!rows||rows.length===0){msgArea.innerHTML=banner+`<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#66798d" stroke-width="1.8"><path d="M21 15a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2h13a2 2 0 012 2z"/></svg></div><div class="es-title">Belum ada pesan</div></div>`+keyNotice;return;}
    for(const m of rows){m.content=await E2E.decryptMessage(myPrivateKey,m.content,m.sender_id===currentUserId,peerPublicKeyB64);}
    msgArea.innerHTML=banner;let lastDay=null;rows.forEach(m=>{const d=dayLabel(m.created_at);if(d!==lastDay){const sep=document.createElement('div');sep.className='day-sep';sep.textContent=d;msgArea.appendChild(sep);lastDay=d;}appendBubble(m);});
    if(keyNotice){const div=document.createElement('div');div.innerHTML=keyNotice;msgArea.appendChild(div.firstElementChild);}
    scrollToBottom();
  }
  function replyQuoteHTML(replyToId){
    if(!replyToId) return '';
    const q=messagesById.get(replyToId);
    if(!q) return `<div class="reply-quote" data-jump="${replyToId}"><div class="rq-name">Pesan asli</div><div class="rq-text">Pesan tidak tersedia</div></div>`;
    const who=q.sender_id===currentUserId?'Anda':(peerUsername||'Kontak');
    return `<div class="reply-quote" data-jump="${replyToId}"><div class="rq-name">${escapeHtml(who)}</div><div class="rq-text">${escapeHtml(normalizeText(q.content).slice(0,120))}</div></div>`;
  }
  function inviteContentHTML(m, mine) {
    if (m.content === '[CALL_REJECTED]') {
      return `<div class="invite-card" style="background:rgba(224,76,76,0.08); padding:12px; border-radius:10px; text-align:center; border:1px solid #e04c4c; min-width:180px; margin-top:4px;">
          <div style="font-weight:bold; color:#e04c4c; font-size:14px;">📞 Panggilan ditolak</div>
        </div>`;
    }
    return `<div class="invite-card" style="background:#eef2f8; padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border); min-width:180px; margin-top:4px;">
          <div style="font-weight:bold; color:#55697d; font-size:14px;">📞 Fitur panggilan sudah tidak tersedia</div>
        </div>`;
  }

  function isInviteContent(content) { return content === '[INVITE_CALL]' || content === '[CALL_REJECTED]'; }

  function appendBubble(m,sending){
    const mine=m.sender_id===currentUserId;const locked=isLockedContent(m.content);
    const row=document.createElement('div');row.className='bubble-row '+(mine?'mine':'theirs')+(sending?' sending':'')+(locked?' locked':'');row.dataset.id=m.id;
    
    let contentHTML = '';
    if (isInviteContent(m.content)) {
      contentHTML = inviteContentHTML(m, mine);
    } else {
      contentHTML = `<div class="txt"></div>`;
    }

    row.innerHTML=`<div class="swipe-reply-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#0564f5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17l-5-5 5-5"/><path d="M4 12h10a5 5 0 015 5v1"/></svg></div><div class="bubble">${replyQuoteHTML(m.reply_to_id)}${contentHTML}<div class="meta"><span>${timeLabel(m.created_at)}</span>${mine?`<span class="tick" data-status="${tickStatus(m.delivered_at,m.read_at)}">${tickSvg(tickStatus(m.delivered_at,m.read_at))}</span>`:''}</div></div>`;
    
    if (!isInviteContent(m.content)) {
      row.querySelector('.txt').textContent=normalizeText(m.content);
    }
    
    msgArea.appendChild(row);
    if(locked)return; // pesan gagal didekripsi: tidak bisa dibalas/di-hold & tidak dijadikan cache kutipan
    if(m.id && !String(m.id).startsWith('temp-')) messagesById.set(m.id,{id:m.id,sender_id:m.sender_id,content:m.content});
    bindBubblePress(row,m);
  }
  function scrollToBottom(){msgArea.scrollTop=msgArea.scrollHeight;}

  // ---- Balas pesan: tekan-tahan (long press) bubble untuk mulai membalas ----
  function startReply(m){
    if(!m||!m.id||String(m.id).startsWith('temp-'))return; // jangan bisa balas pesan yg belum terkirim
    replyingTo={id:m.id,sender_id:m.sender_id,content:m.content};
    rbName.textContent=m.sender_id===currentUserId?'Membalas Anda':'Membalas '+(peerUsername||'kontak');
    rbText.textContent=normalizeText(m.content).slice(0,140);
    replyBar.classList.add('show');msgInput.focus();
    if(navigator.vibrate)navigator.vibrate(30);
  }
  function cancelReply(){replyingTo=null;replyBar.classList.remove('show');}
  rbClose.addEventListener('click',cancelReply);
  function bindBubblePress(row,m){
    const bubbleEl=row.querySelector('.bubble'),iconEl=row.querySelector('.swipe-reply-icon');
    const SWIPE_THRESHOLD=58,SWIPE_MAX=78,LONGPRESS_MS=450,MOVE_TOLERANCE=8;
    let startX=0,startY=0,dx=0,dir=null,pressTimer=null;
    const clearPressTimer=()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}};
    const resetSwipe=()=>{row.classList.remove('no-anim');bubbleEl.style.transform='';iconEl.classList.remove('show');};
    function onStart(x,y){
      startX=x;startY=y;dx=0;dir=null;row.classList.add('no-anim');
      pressTimer=setTimeout(()=>{ pressTimer=null; if(dir===null){ if(navigator.vibrate)navigator.vibrate(30); resetSwipe(); openBubbleCtx(m,x,y); } },LONGPRESS_MS);
    }
    function onMove(x,y,ev){
      const ddx=x-startX,ddy=y-startY;
      if(dir===null){
        if(Math.abs(ddx)>MOVE_TOLERANCE && Math.abs(ddx)>Math.abs(ddy)){dir='h';clearPressTimer();}
        else if(Math.abs(ddy)>MOVE_TOLERANCE){dir='v';clearPressTimer();}
      }
      if(dir==='h'){
        if(ev&&ev.cancelable)ev.preventDefault();
        dx=Math.max(0,Math.min(ddx,SWIPE_MAX));
        bubbleEl.style.transform=`translateX(${dx}px)`;
        iconEl.classList.toggle('show',dx>18);
      }
    }
    function onEnd(){
      clearPressTimer();
      row.classList.remove('no-anim');
      if(dir==='h'&&dx>=SWIPE_THRESHOLD){ startReply(m); if(navigator.vibrate)navigator.vibrate(25); }
      bubbleEl.style.transform='';iconEl.classList.remove('show');
      dir=null;dx=0;
    }
    row.addEventListener('touchstart',(e)=>{const t=e.touches[0];onStart(t.clientX,t.clientY);},{passive:true});
    row.addEventListener('touchmove',(e)=>{const t=e.touches[0];onMove(t.clientX,t.clientY,e);},{passive:false});
    row.addEventListener('touchend',onEnd,{passive:true});
    row.addEventListener('touchcancel',()=>{clearPressTimer();resetSwipe();dir=null;dx=0;},{passive:true});
    // fallback mouse (testing desktop)
    row.addEventListener('mousedown',(e)=>onStart(e.clientX,e.clientY));
    row.addEventListener('mousemove',(e)=>{if(pressTimer!==null||dir==='h')onMove(e.clientX,e.clientY,e);});
    row.addEventListener('mouseup',onEnd);row.addEventListener('mouseleave',()=>{clearPressTimer();resetSwipe();dir=null;dx=0;});
  }

  // ---- Menu konteks (tekan-tahan): Balas / Salin / Hapus ----
  const bubbleCtxMenu=document.getElementById('bubbleCtxMenu'),bubbleCtxBackdrop=document.getElementById('bubbleCtxBackdrop');
  let ctxTargetMsg=null;
  function openBubbleCtx(m,x,y){
    if(!m||!m.id||String(m.id).startsWith('temp-'))return;
    ctxTargetMsg=m;
    document.getElementById('ctxDelete').style.display=(m.sender_id===currentUserId)?'flex':'none';
    bubbleCtxMenu.classList.add('open');bubbleCtxBackdrop.classList.add('open');
    requestAnimationFrame(()=>{
      const menuW=bubbleCtxMenu.offsetWidth||190,menuH=bubbleCtxMenu.offsetHeight||150;
      let left=Math.min(Math.max(10,x-menuW/2),window.innerWidth-menuW-10);
      let top=Math.min(Math.max(10,y-menuH-14),window.innerHeight-menuH-10);
      bubbleCtxMenu.style.left=left+'px';bubbleCtxMenu.style.top=top+'px';
    });
  }
  function closeBubbleCtx(){bubbleCtxMenu.classList.remove('open');bubbleCtxBackdrop.classList.remove('open');ctxTargetMsg=null;}
  bubbleCtxBackdrop.addEventListener('click',closeBubbleCtx);
  document.getElementById('ctxReply').addEventListener('click',()=>{if(ctxTargetMsg)startReply(ctxTargetMsg);closeBubbleCtx();});
  document.getElementById('ctxCopy').addEventListener('click',async()=>{
    if(ctxTargetMsg){try{await navigator.clipboard.writeText(normalizeText(ctxTargetMsg.content));}catch(e){}}
    closeBubbleCtx();
  });
  document.getElementById('ctxDelete').addEventListener('click',async()=>{
    if(!ctxTargetMsg)return;const target=ctxTargetMsg;closeBubbleCtx();
    const ok=await showConfirm('Hapus Pesan Ini?','Pesan ini akan dihapus untuk semua orang.','Hapus');
    if(!ok)return;
    const {error}=await supabaseClient.from('messages').delete().eq('id',target.id).eq('sender_id',currentUserId);
    if(!error){const row=msgArea.querySelector(`.bubble-row[data-id="${target.id}"]`);if(row)row.remove();messagesById.delete(target.id);}
  });
  // Ketuk kutipan di dalam bubble -> lompat & sorot pesan aslinya
  msgArea.addEventListener('click',(e)=>{
    const q=e.target.closest('.reply-quote');if(!q)return;
    const targetId=q.dataset.jump;const targetRow=msgArea.querySelector(`.bubble-row[data-id="${targetId}"]`);
    if(!targetRow)return;
    targetRow.scrollIntoView({behavior:'smooth',block:'center'});
    targetRow.classList.remove('highlight');void targetRow.offsetWidth;targetRow.classList.add('highlight');
    setTimeout(()=>targetRow.classList.remove('highlight'),1000);
  });

  // ---- Popup "Pelajari selengkapnya" (info enkripsi E2E) & popup kode keamanan berubah ----
  // Pakai event delegation karena banner/notice di dalam msgArea di-render ulang tiap loadMessages().
  document.addEventListener('click', (e) => {
    if(e.target.closest('#e2eBanner')) document.getElementById('e2eInfoOverlay').classList.add('open');
    if(e.target.closest('.keychange-notice')) document.getElementById('keyChangeInfoOverlay').classList.add('open');
  });
  document.getElementById('e2eInfoCloseBtn').addEventListener('click', () => {
    document.getElementById('e2eInfoOverlay').classList.remove('open');
  });
  document.getElementById('e2eInfoOverlay').addEventListener('click', (e) => {
    if(e.target.id==='e2eInfoOverlay') document.getElementById('e2eInfoOverlay').classList.remove('open');
  });
  document.getElementById('keyChangeInfoCloseBtn').addEventListener('click', () => {
    document.getElementById('keyChangeInfoOverlay').classList.remove('open');
    // User sudah baca & mengerti peringatan -> reset flag & hilangkan banner dari tampilan.
    // Tidak perlu "Bersihkan Obrolan" lagi cuma buat dismiss notice ini.
    const keyChangeNoticeLS='e2e_keychange_notice_'+currentUserId+'_'+peerId;
    localStorage.removeItem(keyChangeNoticeLS);
    document.querySelectorAll('.keychange-notice').forEach(el => el.remove());
  });
  document.getElementById('keyChangeInfoOverlay').addEventListener('click', (e) => {
    if(e.target.id==='keyChangeInfoOverlay') document.getElementById('keyChangeInfoOverlay').classList.remove('open');
  });
  async function markIncomingAsRead(){const n=new Date().toISOString();await supabaseClient.from('messages').update({delivered_at:n,read_at:n}).eq('sender_id',peerId).eq('receiver_id',currentUserId).is('read_at',null);}
  function subscribeRealtime(){
    supabaseClient.channel('chat-'+[currentUserId,peerId].sort().join('-')).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`receiver_id=eq.${currentUserId}`},async(p)=>{
      const m=p.new;if(m.sender_id!==peerId)return;m.content=await E2E.decryptMessage(myPrivateKey,m.content,false,peerPublicKeyB64);
      if(msgArea.querySelector('.empty-state'))msgArea.innerHTML='';appendBubble(m);scrollToBottom();
      if(m.content==='🔔 PING!!!'&&navigator.vibrate)navigator.vibrate([80,40,80,40,160]);
      const n=new Date().toISOString();if(document.visibilityState==='visible')await supabaseClient.from('messages').update({delivered_at:n,read_at:n}).eq('id',m.id);else await supabaseClient.from('messages').update({delivered_at:n}).eq('id',m.id).is('delivered_at',null);
    }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`sender_id=eq.${currentUserId}`},async(p)=>{
      const row=msgArea.querySelector(`.bubble-row[data-id="${p.new.id}"]`);if(!row)return;
      const t=row.querySelector('.tick');
      if(t){
        const newStatus=tickStatus(p.new.delivered_at,p.new.read_at);
        const justRead = t.dataset.status!=='read' && newStatus==='read';
        t.dataset.status=newStatus;
        t.innerHTML=tickSvg(newStatus);
        if(justRead){ t.classList.remove('tick-pop'); void t.offsetWidth; t.classList.add('tick-pop'); }
      }
      const card=row.querySelector('.invite-card');
      if(card){
        const decrypted=await E2E.decryptMessage(myPrivateKey,p.new.content,true,peerPublicKeyB64);
        if(decrypted==='[CALL_REJECTED]'){
          card.outerHTML=inviteContentHTML({id:p.new.id,content:decrypted},true);
          messagesById.set(p.new.id,{id:p.new.id,sender_id:currentUserId,content:decrypted});
        }
      }
    }).on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},(p)=>{
      const delId=p.old&&p.old.id;if(delId==null)return;
      const row=msgArea.querySelector(`.bubble-row[data-id="${delId}"]`);if(row)row.remove();
      messagesById.delete(delId);
    }).subscribe();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')markIncomingAsRead();});
  }

  // ---- Pantau perubahan public key lawan bicara selagi chat ini terbuka. ----
  function subscribePeerKeyChange(){
    supabaseClient.channel('pubkey-'+peerId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${peerId}`},async(p)=>{
        const newKey=p.new.public_key;
        if(!newKey || newKey===peerPublicKeyB64) return;
        peerPublicKeyB64=newKey;
        localStorage.setItem('e2e_peerkey_seen_'+currentUserId+'_'+peerId,newKey);
        localStorage.setItem('e2e_keychange_notice_'+currentUserId+'_'+peerId,'1');
        updateInputAvailability();
        if(msgArea.querySelector('.empty-state')===null){
          const div=document.createElement('div');
          div.innerHTML=keyChangeNoticeHTML(peerUsername);
          msgArea.appendChild(div.firstElementChild);
          scrollToBottom();
        }
      }).subscribe();
  }
  async function sendMessage(){
    const text=normalizeText(msgInput.value);if(!text||!myPublicKeyB64||!peerPublicKeyB64)return;msgInput.value='';autoResize();
    const replyToId=replyingTo?replyingTo.id:null;cancelReply();
    if(msgArea.querySelector('.empty-state'))msgArea.innerHTML='';const tempId='temp-'+Date.now();
    appendBubble({id:tempId,sender_id:currentUserId,content:text,created_at:new Date().toISOString(),reply_to_id:replyToId},true);scrollToBottom();
    const encrypted=await E2E.encryptMessage(myPublicKeyB64,peerPublicKeyB64,text);
    const {data,error}=await supabaseClient.from('messages').insert({sender_id:currentUserId,receiver_id:peerId,content:encrypted,reply_to_id:replyToId}).select().single();
    msgInput.focus();const tempRow=msgArea.querySelector(`[data-id="${tempId}"]`);
    if(error){if(tempRow){tempRow.classList.add('send-failed');tempRow.classList.remove('sending');}msgInput.value=text;return;}
    if(tempRow)tempRow.remove();data.content=text;appendBubble(data);
  }
  function autoResize(){msgInput.style.height='auto';msgInput.style.height=Math.min(msgInput.scrollHeight,100)+'px';}
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

  msgInput.addEventListener('input',()=>{autoResize();sendBtn.disabled=msgInput.value.trim().length===0;});
  // Enter/Shift+Enter sama-sama membuat baris baru (perilaku default textarea).
  // Kirim pesan HANYA lewat tombol kirim (sendBtn).
  sendBtn.addEventListener('click',sendMessage);
  const menuBtn=document.getElementById('menuBtn'),chatMenu=document.getElementById('chatMenu');
  menuBtn.addEventListener('click',(e)=>{e.stopPropagation();chatMenu.classList.toggle('open');});document.addEventListener('click',()=>{chatMenu.classList.remove('open');});
  document.getElementById('menuHapusPermanen').addEventListener('click',async(e)=>{
    e.stopPropagation();chatMenu.classList.remove('open');
    const ok=await showConfirm('Hapus Untuk Semua Orang','Semua percakapan ini akan di hapus untuk semua orang','Hapus Permanen');
    if(!ok)return;
    const {error}=await supabaseClient.from('messages').delete().or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${currentUserId})`);
    if(error){alert('Gagal menghapus permanen. Coba lagi.');return;}
    clearedBefore=null;
    await supabaseClient.from('chat_clears').delete().eq('user_id',currentUserId).eq('peer_id',peerId);
    localStorage.removeItem('e2e_keychange_notice_'+currentUserId+'_'+peerId);
    messagesById.clear();cancelReply();
    msgArea.innerHTML=`<div class="empty-state"><span>Belum ada pesan.</span></div>`;
  });
  document.getElementById('menuPing').addEventListener('click',async(e)=>{
    e.stopPropagation();chatMenu.classList.remove('open');if(!myPublicKeyB64||!peerPublicKeyB64)return;if(navigator.vibrate)navigator.vibrate([80,40,80,40,160]);
    const encrypted=await E2E.encryptMessage(myPublicKeyB64,peerPublicKeyB64,'🔔 PING!!!');
    const {data,error}=await supabaseClient.from('messages').insert({sender_id:currentUserId,receiver_id:peerId,content:encrypted}).select().single();
    if(!error){data.content='🔔 PING!!!';if(msgArea.querySelector('.empty-state'))msgArea.innerHTML='';appendBubble(data);scrollToBottom();}
  });
  history.pushState({page:'chat'},'',location.href);window.addEventListener('popstate',()=>{window.location.href='dashboard.html';});

  // ---- Tarik untuk refresh (pull-to-refresh) di area pesan ----
  (function(){
    const ind=document.getElementById('chatPtr');
    const THRESHOLD=64,MAX=90;
    let startY=0,pulling=false,dragging=false,refreshing=false;
    msgArea.addEventListener('touchstart',e=>{
      if(refreshing||e.touches.length!==1){pulling=false;return;}
      if(msgArea.scrollTop>0){pulling=false;return;}
      startY=e.touches[0].clientY;pulling=true;dragging=false;
    },{passive:true});
    msgArea.addEventListener('touchmove',e=>{
      if(!pulling||refreshing)return;
      const dy=e.touches[0].clientY-startY;
      if(dy<=0||msgArea.scrollTop>0){pulling=false;dragging=false;ind.style.height='0px';return;}
      dragging=true;e.preventDefault();
      ind.style.height=Math.min(dy*0.5,MAX)+'px';
    },{passive:false});
    msgArea.addEventListener('touchend',()=>{
      if(!pulling)return;pulling=false;
      const dist=parseInt(ind.style.height||'0',10);
      if(dragging&&dist>=THRESHOLD){
        refreshing=true;ind.style.height='50px';ind.classList.add('loading');
        location.reload();
      }else{ind.style.height='0px';}
      dragging=false;
    },{passive:true});
  })();
  if(typeof supabaseClient==='undefined'){
    msgArea.innerHTML=`<div class="empty-state"><div class="es-title">Gagal terhubung</div><span>app.js gagal dimuat (cek path file / koneksi internet / console browser).</span></div>`;
    console.error('supabaseClient belum terdefinisi — supabase-js CDN atau app.js gagal load.');
  }else{
    init();
  }
