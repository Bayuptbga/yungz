  let currentUserPin=null,myPrivateKey=null;const colorPalette=['#c77b8c','#3a3f47','#2f6b3a','#5b6b74','#2c2c2c','#7c3f9e','#8a7a4a','#1a7fc2'];
  function colorFor(id){let hash=0;for(let i=0;i<id.length;i++)hash=id.charCodeAt(i)+((hash<<5)-hash);return colorPalette[Math.abs(hash)%colorPalette.length];}
  function initials(u){return(u||'?').slice(0,2).toUpperCase();}
  // Helper foto profil: dipakai di template string (avatarStyle/avatarInner) dan di DOM langsung (applyAvatarEl).
  function avatarStyle(id,avatarUrl){return avatarUrl?`background:url(${avatarUrl}) center/cover no-repeat;`:`background:${colorFor(id)};`;}
  function avatarInner(username,avatarUrl){return avatarUrl?'':escapeHtml(initials(username));}
  function applyAvatarEl(el,id,username,avatarUrl){
    if(avatarUrl){el.style.background=`url(${avatarUrl}) center/cover no-repeat`;el.textContent='';}
    else{el.style.background=colorFor(id);el.textContent=initials(username);}
  }
  const contactAvatarMap={};
  function escapeHtml(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
  function timeLabel(iso){const d=new Date(iso),t=new Date();if(d.toDateString()===t.toDateString())return d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});return d.toLocaleDateString('id-ID',{day:'numeric',month:'short'});}
  // Sama persis dengan gaya badge di chat.html: 'sent' (abu, centang 1 putih),
  // 'delivered' (biru, centang 2 putih), 'read' (hijau, centang 2 putih).
  function tickStatus(del,read){ return read?'read':(del?'delivered':'sent'); }
  function tickSvg(status){
    const attrs='width="14" height="14" viewBox="0 0 24 24" fill="none"';
    if(status==='sent'){
      return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#8a97a3"/><path d="M7.3 12.3l2.7 2.7L16.8 8.4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    }
    if(status==='delivered'){
      return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#0a84ff"/><path d="M5.8 12.3l2.6 2.6L14 9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10.8 12.3l2.6 2.6L19 9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    }
    return `<svg ${attrs}><circle cx="12" cy="12" r="10" fill="#189a56"/><path d="M5.8 12.3l2.6 2.6L14 9" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10.8 12.3l2.6 2.6L19 9" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
  }
  function statusIconHTML(chat){if(!chat.mine)return'';return `<span class="status-icon" style="background:none;">${tickSvg(tickStatus(chat.deliveredAt,chat.readAt))}</span>`;}
  function render(chats){
    const list=document.getElementById('chatlist');if(!chats||chats.length===0){list.innerHTML=`<div class="panel-empty">Belum ada percakapan.</div>`;return;}
    chats.forEach(chat=>{contactAvatarMap[chat.uid]=chat.avatarUrl||null;});
    list.innerHTML=chats.map(chat=>`<div class="chat-item" data-uid="${escapeHtml(chat.uid)}" data-uname="${escapeHtml(chat.uname)}"><div class="avatar" style="${avatarStyle(chat.uid,chat.avatarUrl)}">${avatarInner(chat.uname,chat.avatarUrl)}</div><div class="chat-main"><div class="chat-top"><div class="chat-name" style="${chat.unread?'font-weight:700;':''}">${escapeHtml(chat.uname)}</div><div style="font-size:11.5px;color:var(--muted);">${escapeHtml(timeLabel(chat.time))}</div></div><div class="chat-bottom">${statusIconHTML(chat)}<div class="chat-msg" style="${chat.unread?'color:var(--ink);font-weight:600;':''}">${escapeHtml(chat.preview)}</div></div></div></div>`).join('');
    document.querySelectorAll('.chat-item').forEach(i=>i.addEventListener('click',()=>window.location.href=`chat.html?uid=${i.dataset.uid}&uname=${encodeURIComponent(i.dataset.uname)}`));
    document.querySelectorAll('.chat-item .avatar').forEach(a=>a.addEventListener('click',e=>{e.stopPropagation();const item=a.closest('.chat-item');openContactPreview(item.dataset.uid,item.dataset.uname);}));
  }
  function skeletonRow(){return `<div class="skel-item"><div class="skel-avatar"></div><div class="skel-lines"><div class="skel-line w60"></div><div class="skel-line w40"></div></div></div>`;}
  function looksEncrypted(content){try{const o=JSON.parse(content);return !!(o&&(o.e2e===1||o.e2e===2));}catch(e){return false;}}
  async function loadChats(userId){
    const list=document.getElementById('chatlist');list.innerHTML=skeletonRow().repeat(6);
    const {data:contactRows}=await supabaseClient.from('contacts').select('requester_id, addressee_id').eq('status','accepted').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    const acceptedIds=new Set((contactRows||[]).map(r=>r.requester_id===userId?r.addressee_id:r.requester_id));
    if(acceptedIds.size===0){render([]);return;}
    const {data:msgRows}=await supabaseClient.from('messages').select('sender_id, receiver_id, content, created_at, delivered_at, read_at').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order('created_at',{ascending:false}).limit(300);
    const {data:clearRows}=await supabaseClient.from('chat_clears').select('peer_id, cleared_before').eq('user_id',userId);
    const clearedMap=new Map((clearRows||[]).map(c=>[c.peer_id,c.cleared_before]));
    const lastByPartner=new Map();
    (msgRows||[]).forEach(m=>{const p=m.sender_id===userId?m.receiver_id:m.sender_id;if(!acceptedIds.has(p))return;const cutoff=clearedMap.get(p);if(cutoff&&m.created_at<=cutoff)return;if(!lastByPartner.has(p))lastByPartner.set(p,m);});
    if(lastByPartner.size===0){render([]);return;}
    const pIds=[...lastByPartner.keys()];const {data:profilesData}=await supabaseClient.from('profiles').select('id, username, public_key, avatar_url').in('id',pIds);
    const pMap={};(profilesData||[]).forEach(p=>pMap[p.id]=p);
    const chats=await Promise.all(pIds.map(async pid=>{
      const m=lastByPartner.get(pid);const mine=m.sender_id===userId;const prof=pMap[pid]||{};
      let previewText=m.content;
      if(myPrivateKey){
        try{previewText=await E2E.decryptMessage(myPrivateKey,m.content,mine,prof.public_key);}catch(e){}
      }else if(looksEncrypted(m.content)){
        previewText='🔒 Pesan terenkripsi';
      }
      if(previewText==='[INVITE_CALL]') previewText='📞 Panggilan suara';
      if(previewText==='[CALL_REJECTED]') previewText='📞 Panggilan ditolak';
      return {uid:pid,uname:prof.username||'Pengguna',avatarUrl:prof.avatar_url||null,preview:(mine?'Kamu: ':'')+previewText,time:m.created_at,mine,deliveredAt:m.delivered_at,readAt:m.read_at,unread:!mine&&!m.read_at};
    }));
    render(chats);
  }
  async function markInboxDelivered(userId){await supabaseClient.from('messages').update({delivered_at:new Date().toISOString()}).eq('receiver_id',userId).is('delivered_at',null);}
  let presenceTracked=false;function trackOnlinePresence(userId){if(presenceTracked)return;presenceTracked=true;supabaseClient.channel('online-users',{config:{presence:{key:userId}}}).subscribe(async(s)=>{if(s==='SUBSCRIBED')await supabaseClient.channel('online-users').track({online_at:new Date().toISOString()});});}
  async function refreshNotifBadge(){
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session){window.location.replace('index.html');return;}
    const {data:prof,error:profErr}=await supabaseClient.from('profiles').select('username, pin, avatar_url').eq('id',session.user.id).maybeSingle();
    if(profErr){console.error('Gagal memuat profil:',profErr);}
    if(prof){currentUserPin=prof.pin;applyAvatarEl(document.getElementById('composerAvatar'),session.user.id,prof.username,prof.avatar_url);applyAvatarEl(document.getElementById('profileAvatarBtn'),session.user.id,prof.username,prof.avatar_url);}
    initPushNotifications(session.user.id);trackOnlinePresence(session.user.id);
    const {count:pCount}=await supabaseClient.from('contacts').select('id',{count:'exact',head:true}).eq('addressee_id',session.user.id).eq('status','pending');
    const {count:uCount}=await supabaseClient.from('contacts').select('id',{count:'exact',head:true}).eq('requester_id',session.user.id).in('status',['accepted','declined']).eq('seen_by_requester',false);
    const badge=document.getElementById('notifBadge');const t=(pCount||0)+(uCount||0);
    if(t>0){badge.textContent=t;badge.style.display='flex';}else badge.style.display='none';
    loadChats(session.user.id);markInboxDelivered(session.user.id);
  }
  let foundProfile=null;const searchBtn=document.getElementById('searchBtn'),searchMsg=document.getElementById('searchMsg'),foundCard=document.getElementById('foundCard');
  const searchBtnIcon=searchBtn.innerHTML;
  searchBtn.addEventListener('click',async()=>{
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;const pin=document.getElementById('pinInput').value.trim().toUpperCase();
    const sendBtnEl=document.getElementById('sendRequestBtn');
    searchMsg.textContent='';searchMsg.className='search-msg';foundCard.classList.remove('show');foundProfile=null;sendBtnEl.disabled=true;sendBtnEl.textContent='Kirim Permintaan';
    if(!/^[A-Za-z0-9]{8}$/.test(pin)){searchMsg.textContent='PIN 8 karakter (huruf/angka).';searchMsg.className='search-msg err';return;}
    searchBtn.disabled=true;searchBtn.innerHTML='...';
    const {data:rows,error}=await supabaseClient.rpc('search_profile_by_pin',{p_pin:pin});
    searchBtn.disabled=false;searchBtn.innerHTML=searchBtnIcon;
    if(error){searchMsg.textContent=error.message.includes('Terlalu banyak')?'Terlalu banyak percobaan, coba lagi nanti.':'Gagal mencari.';searchMsg.className='search-msg err';return;}
    const data=(rows&&rows.length>0)?rows[0]:null;
    if(!data){searchMsg.textContent='Tidak ditemukan.';searchMsg.className='search-msg err';return;}
    if(data.id===session.user.id){searchMsg.textContent='Ini PIN kamu.';searchMsg.className='search-msg err';return;}
    const {data:existing}=await supabaseClient.from('contacts').select('status').or(`and(requester_id.eq.${session.user.id},addressee_id.eq.${data.id}),and(requester_id.eq.${data.id},addressee_id.eq.${session.user.id})`).maybeSingle();
    foundProfile=data;applyAvatarEl(document.getElementById('foundAvatar'),data.id,data.username,data.avatar_url||null);document.getElementById('foundUname').textContent=data.username;
    if(existing){
      const label=existing.status==='accepted'?'Sudah berteman':existing.status==='pending'?'Permintaan masih menunggu':'Permintaan pernah ditolak';
      foundCard.classList.add('show');searchMsg.textContent=label;searchMsg.className=existing.status==='accepted'?'search-msg ok':'search-msg err';return;
    }
    sendBtnEl.disabled=false;
    foundCard.classList.add('show');searchMsg.textContent='Ditemukan!';searchMsg.className='search-msg ok';
  });
  document.getElementById('sendRequestBtn').addEventListener('click',async()=>{
    if(!foundProfile)return;const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    document.getElementById('sendRequestBtn').disabled=true;
    const {error}=await supabaseClient.from('contacts').insert({requester_id:session.user.id,addressee_id:foundProfile.id,status:'pending'});
    if(error){searchMsg.textContent='Gagal/Sudah ada.';searchMsg.className='search-msg err';document.getElementById('sendRequestBtn').disabled=false;return;}
    document.getElementById('sendRequestBtn').textContent='Terkirim ✓';searchMsg.className='search-msg ok';
    setTimeout(closeAddModal,1200);
  });
  async function loadContacts(){
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const cList=document.getElementById('contactList');cList.innerHTML=skeletonRow().repeat(4);
    const cCount=document.getElementById('contactCount');if(cCount)cCount.textContent='';
    const {data:rows}=await supabaseClient.from('contacts').select('requester_id, addressee_id').eq('status','accepted').or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`);
    if(!rows||rows.length===0){cList.innerHTML='<div class="panel-empty">Belum ada kontak.</div>';if(cCount)cCount.textContent='0';return;}
    const oIds=rows.map(r=>r.requester_id===session.user.id?r.addressee_id:r.requester_id);
    const {data:pData}=await supabaseClient.from('profiles').select('id, username, avatar_url').in('id',oIds);const pMap={};(pData||[]).forEach(p=>{pMap[p.id]=p.username;contactAvatarMap[p.id]=p.avatar_url||null;});
    cList.innerHTML=oIds.map(id=>`<div class="contact-item" data-uid="${escapeHtml(id)}" data-uname="${escapeHtml(pMap[id])}"><div class="avatar" data-profuid="${escapeHtml(id)}" style="${avatarStyle(id,contactAvatarMap[id])}">${avatarInner(pMap[id],contactAvatarMap[id])}</div><div class="uname">${escapeHtml(pMap[id])}</div></div>`).join('');
    if(cCount)cCount.textContent=oIds.length;
    document.querySelectorAll('.contact-item').forEach(i=>i.addEventListener('click',()=>window.location.href=`chat.html?uid=${i.dataset.uid}&uname=${encodeURIComponent(i.dataset.uname)}`));
    document.querySelectorAll('.contact-item .avatar').forEach(a=>a.addEventListener('click',e=>{e.stopPropagation();openContactPreview(a.dataset.profuid,a.closest('.contact-item').dataset.uname);}));
  }
function timeAgo(iso){
    const diffMin=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));
    if(diffMin<1)return 'Baru saja';
    if(diffMin<60)return diffMin+' menit lalu';
    const diffH=Math.floor(diffMin/60);
    if(diffH<24)return diffH+' jam lalu';
    return timeLabel(iso);
  }
  const myStatusInput=document.getElementById('myStatusInput'),postStatusBtn=document.getElementById('postStatusBtn'),myStatusMsg=document.getElementById('myStatusMsg'),photoBtn=document.getElementById('photoBtn');
  photoBtn.addEventListener('click',()=>{myStatusMsg.textContent='Fitur unggah foto belum tersedia.';myStatusMsg.className='search-msg err';});
  let statusSubtab='saya';
  let latestKontakStatusTs=null;
  function getStatusLastSeen(){ try{return localStorage.getItem('statusKontakLastSeen')||'';}catch(e){return '';} }
  function markStatusKontakSeen(){
    if(latestKontakStatusTs){ try{localStorage.setItem('statusKontakLastSeen',latestKontakStatusTs);}catch(e){} }
    const tDot=document.getElementById('tabStatusDot'),sDot=document.getElementById('sstKontakDot');
    if(tDot)tDot.style.display='none';if(sDot)sDot.style.display='none';
  }
  function updateStatusNewIndicator(otherRows){
    latestKontakStatusTs=(otherRows&&otherRows.length>0)?otherRows[0].created_at:null;
    const tDot=document.getElementById('tabStatusDot'),sDot=document.getElementById('sstKontakDot');
    const hasNew=!!latestKontakStatusTs&&latestKontakStatusTs>getStatusLastSeen();
    if(tDot)tDot.style.display=hasNew?'block':'none';
    if(sDot)sDot.style.display=hasNew?'inline-block':'none';
    if(hasNew&&statusSubtab==='kontak')markStatusKontakSeen();
  }
  function setStatusSubtab(tab){
    statusSubtab=tab;
    document.querySelectorAll('.sst-item').forEach(el=>el.classList.toggle('active',el.dataset.sst===tab));
    document.getElementById('myStatusPinned').classList.toggle('active',tab==='saya');
    document.getElementById('statusList').classList.toggle('active',tab==='kontak');
    if(tab==='kontak')markStatusKontakSeen();
  }
  document.querySelectorAll('.sst-item').forEach(el=>el.addEventListener('click',()=>setStatusSubtab(el.dataset.sst)));
  const postStatusBtnDefaultHTML=postStatusBtn.innerHTML;
  postStatusBtn.addEventListener('click',async()=>{
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const content=myStatusInput.value.trim();
    if(!content){myStatusMsg.textContent='Status tidak boleh kosong.';myStatusMsg.className='search-msg err';return;}
    postStatusBtn.classList.add('disabled');
    postStatusBtn.innerHTML='<div class="icon-spinner"></div>';
    const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
    const {error}=await supabaseClient.from('statuses').insert({user_id:session.user.id,content,created_at:new Date().toISOString(),expires_at:expiresAt});
    postStatusBtn.classList.remove('disabled');
    postStatusBtn.innerHTML=postStatusBtnDefaultHTML;
    if(error){myStatusMsg.textContent='Gagal mengirim status.';myStatusMsg.className='search-msg err';return;}
    myStatusMsg.textContent='';myStatusMsg.className='search-msg';
    myStatusInput.value='';
    await loadStatusTab(false);
  });
  const RX_TYPES=['like','love','laugh','angry'];
  const RX_EMOJI={like:'👍',love:'❤️',laugh:'😂',angry:'😡'};
  const RX_LIKE_ICON=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22h-3a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>`;
  const RX_LIKE_ICON_FILLED=`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="M7 22h-3a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>`;
  function rxToggleIconHTML(type){ if(!type)return RX_LIKE_ICON; if(type==='like')return RX_LIKE_ICON_FILLED; return RX_EMOJI[type]; }
  function reactionSummaryHTML(counts){
    const entries=RX_TYPES.map(t=>({t,c:counts[t]||0})).filter(e=>e.c>0).sort((a,b)=>b.c-a.c);
    if(entries.length===0)return '';
    const total=entries.reduce((s,e)=>s+e.c,0);
    const icons=entries.slice(0,3).map(e=>RX_EMOJI[e.t]).join('');
    return `<span class="rx-summary-emojis">${icons}</span><span class="rx-summary-count">${total}</span>`;
  }
  function statusCardHTML(s,reactionCountMap,myReactionMap,pMap,myId){
    const counts=reactionCountMap[s.id]||{},myReaction=myReactionMap[s.id]||null,isMine=s.user_id===myId;
    const sProf=pMap[s.user_id]||{};if(!isMine)contactAvatarMap[s.user_id]=sProf.avatar_url||null;
    const summary=reactionSummaryHTML(counts);
    return `<div class="status-card" data-sid="${escapeHtml(s.id)}" data-uid="${escapeHtml(s.user_id)}" data-uname="${escapeHtml(sProf.username||'Pengguna')}" data-counts='${JSON.stringify(counts)}'>
      <div class="sc-head">
        <div class="sc-avatar-wrap${isMine?'':' ring'}"><div class="sc-avatar" style="${avatarStyle(s.user_id,sProf.avatar_url)}${isMine?'':'cursor:pointer;'}">${avatarInner(sProf.username,sProf.avatar_url)}</div></div>
        <div class="sc-head-info">
          <div class="sc-uname">${escapeHtml(sProf.username||'Pengguna')}${isMine?' <span style="color:var(--muted);font-weight:500;">(Anda)</span>':''}</div>
          <div class="sc-meta">${escapeHtml(timeAgo(s.created_at))}</div>
        </div>
        ${isMine?`<div class="sc-delete" data-id="${escapeHtml(s.id)}" onclick="deleteStatus(this)" title="Hapus status"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div>`:''}
      </div>
      <div class="sc-divider"></div>
      <div class="sc-content">${escapeHtml(s.content)}</div>
      <div class="sc-divider"></div>
      <div class="sc-reactions">
        <div class="rx-summary${summary?'':' empty'}">${summary||'<span class="rx-summary-empty">Beri reaksi pertama</span>'}</div>
        <div class="rx-toggle${myReaction?' active':''}" data-id="${escapeHtml(s.id)}" data-current="${myReaction||''}">
          <span class="rx-toggle-emoji">${rxToggleIconHTML(myReaction)}</span>
          <span class="rx-toggle-label">${myReaction&&myReaction!=='like'?'Bereaksi':'Suka'}</span>
        </div>
      </div>
    </div>`;
  }
  const STATUS_EMPTY_MINE='<div class="status-empty"><div class="icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--muted)" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5l3 2"/></svg></div>Anda belum memposting status.</div>';
  const STATUS_EMPTY_KONTAK='<div class="status-empty"><div class="icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--muted)" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5l3 2"/></svg></div>Belum ada pembaruan dari kontak.</div>';
  async function loadStatusTab(showSkeleton=true){
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const sList=document.getElementById('statusList'),pinnedWrap=document.getElementById('myStatusPinned');
    if(showSkeleton){sList.innerHTML=skeletonRow().repeat(3);pinnedWrap.innerHTML=skeletonRow().repeat(2);}
    const {data:rows}=await supabaseClient.from('contacts').select('requester_id, addressee_id').eq('status','accepted').or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`);
    const oIds=(rows||[]).map(r=>r.requester_id===session.user.id?r.addressee_id:r.requester_id);
    const allIds=[session.user.id,...oIds];
    const {data:sRows}=await supabaseClient.from('statuses').select('id, user_id, content, created_at, expires_at').in('user_id',allIds).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false});
    const myCountBadge=document.getElementById('sstMyCount'),kontakCountBadge=document.getElementById('sstKontakCount');
    if(!sRows||sRows.length===0){
      pinnedWrap.innerHTML=STATUS_EMPTY_MINE;sList.innerHTML=STATUS_EMPTY_KONTAK;
      myCountBadge.style.display='none';kontakCountBadge.style.display='none';
      updateStatusNewIndicator([]);
      setStatusSubtab(statusSubtab);return;
    }
    const uIds=sRows.map(s=>s.user_id);const {data:pData}=await supabaseClient.from('profiles').select('id, username, avatar_url').in('id',uIds);const pMap={};(pData||[]).forEach(p=>pMap[p.id]=p);
    const sIds=sRows.map(s=>s.id);const {data:likeRows}=await supabaseClient.from('status_likes').select('status_id, user_id, reaction').in('status_id',sIds);
    const reactionCountMap={},myReactionMap={};
    (likeRows||[]).forEach(l=>{
      const type=l.reaction||'like';
      if(!reactionCountMap[l.status_id])reactionCountMap[l.status_id]={};
      reactionCountMap[l.status_id][type]=(reactionCountMap[l.status_id][type]||0)+1;
      if(l.user_id===session.user.id)myReactionMap[l.status_id]=type;
    });
    const mineRows=sRows.filter(s=>s.user_id===session.user.id);
    const otherRows=sRows.filter(s=>s.user_id!==session.user.id);
    pinnedWrap.innerHTML=mineRows.length>0?mineRows.map(s=>statusCardHTML(s,reactionCountMap,myReactionMap,pMap,session.user.id)).join(''):STATUS_EMPTY_MINE;
    sList.innerHTML=otherRows.length>0?otherRows.map(s=>statusCardHTML(s,reactionCountMap,myReactionMap,pMap,session.user.id)).join(''):STATUS_EMPTY_KONTAK;
    if(mineRows.length>0){myCountBadge.textContent=mineRows.length;myCountBadge.style.display='';}else{myCountBadge.style.display='none';}
    if(otherRows.length>0){kontakCountBadge.textContent=otherRows.length;kontakCountBadge.style.display='';}else{kontakCountBadge.style.display='none';}
    updateStatusNewIndicator(otherRows);
    setStatusSubtab(statusSubtab);
    document.querySelectorAll('#statusList .status-card .sc-avatar').forEach(a=>{
      const card=a.closest('.status-card');
      if(!card.dataset.uid||card.dataset.uid===session.user.id)return;
      a.addEventListener('click',e=>{e.stopPropagation();openContactPreview(card.dataset.uid,card.dataset.uname);});
    });
  }
  async function loadNotifications(){
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;const nl=document.getElementById('notifList');nl.innerHTML=skeletonRow().repeat(4);
    const [{data:reqRows},{data:updRows}]=await Promise.all([
      supabaseClient.from('contacts').select('id, requester_id').eq('addressee_id',session.user.id).eq('status','pending'),
      supabaseClient.from('contacts').select('id, addressee_id, status, seen_by_requester').eq('requester_id',session.user.id).in('status',['accepted','declined'])
    ]);
    const items=[
      ...(reqRows||[]).map(r=>({kind:'request',id:r.id,uid:r.requester_id})),
      ...(updRows||[]).map(r=>({kind:'update',id:r.id,uid:r.addressee_id,status:r.status,seen:r.seen_by_requester}))
    ].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
    if(items.length===0){nl.innerHTML='<div class="panel-empty"><div class="icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="var(--muted)" stroke-width="1.6"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>Belum ada notifikasi.</div>';return;}
    const uids=[...new Set(items.map(i=>i.uid))];const {data:pData}=await supabaseClient.from('profiles').select('id, username, avatar_url').in('id',uids);const pMap={};(pData||[]).forEach(p=>pMap[p.id]=p);
    nl.innerHTML=items.map(it=>{
      const prof=pMap[it.uid]||{};
      if(it.kind==='request'){
        return `<div class="req-item"><div class="avatar" style="${avatarStyle(it.uid,prof.avatar_url)}">${avatarInner(prof.username,prof.avatar_url)}</div><div class="info"><div class="uname">${escapeHtml(prof.username)}</div><div class="sub">Ingin berteman dengan kamu</div></div><div class="req-actions"><button class="btn-accept" onclick="respondReq('${escapeHtml(it.id)}','accepted',this)">✓ Terima</button><button class="btn-decline" onclick="respondReq('${escapeHtml(it.id)}','declined',this)">Tolak</button></div></div>`;
      }
      return `<div class="notif-item ${it.seen?'':'unseen'}"><div class="avatar" style="${avatarStyle(it.uid,prof.avatar_url)}">${avatarInner(prof.username,prof.avatar_url)}</div><div class="info"><div class="uname">${escapeHtml(prof.username)}</div><div class="sub">${it.status==='accepted'?'✅ Diterima':'❌ Ditolak'}</div></div>${it.seen?'':'<span class="status-dot new"></span>'}</div>`;
    }).join('');
    const uIds=items.filter(i=>i.kind==='update'&&!i.seen).map(i=>i.id);if(uIds.length>0){await supabaseClient.from('contacts').update({seen_by_requester:true}).in('id',uIds);refreshNotifBadge();}
  }
  // ---- Tarik untuk refresh (pull-to-refresh) di tab Status ----
  (function(){
    const panel=document.getElementById('panelStatus');
    const ind=document.getElementById('statusPtr');
    const THRESHOLD=64,MAX=90;
    let startY=0,pulling=false,dragging=false,refreshing=false;
    panel.addEventListener('touchstart',e=>{
      if(refreshing||e.touches.length!==1){pulling=false;return;}
      if(panel.scrollTop>0){pulling=false;return;}
      startY=e.touches[0].clientY;pulling=true;dragging=false;
    },{passive:true});
    panel.addEventListener('touchmove',e=>{
      if(!pulling||refreshing)return;
      const dy=e.touches[0].clientY-startY;
      if(dy<=0||panel.scrollTop>0){pulling=false;dragging=false;ind.style.height='0px';return;}
      dragging=true;e.preventDefault();
      ind.style.height=Math.min(dy*0.5,MAX)+'px';
    },{passive:false});
    panel.addEventListener('touchend',async()=>{
      if(!pulling)return;pulling=false;
      const dist=parseInt(ind.style.height||'0',10);
      if(dragging&&dist>=THRESHOLD){
        refreshing=true;ind.style.height='50px';ind.classList.add('loading');
        await loadStatusTab(false);
        ind.classList.remove('loading');ind.style.height='0px';refreshing=false;
      }else{ind.style.height='0px';}
      dragging=false;
    },{passive:true});
  })();
  window.deleteStatus=async(el)=>{
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const statusId=el.dataset.id;if(!statusId)return;
    if(!confirm('Hapus status ini?'))return;
    const card=el.closest('.status-card');
    el.style.pointerEvents='none';
    const {error}=await supabaseClient.from('statuses').delete().eq('id',statusId).eq('user_id',session.user.id);
    if(error){el.style.pointerEvents='';alert('Gagal menghapus status.');return;}
    if(card){card.style.transition='opacity .25s ease';card.style.opacity='0';setTimeout(()=>card.remove(),250);}
  };
  // ---- Reaksi status: tap cepat tombol = toggle Suka; tekan-tahan = buka popup pilih emoji ----
  // 1 user cuma boleh punya 1 jenis reaksi aktif per status (upsert menggantikan reaksi lama).
  async function applyReactionChange(btn, newType){
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const statusId=btn.dataset.id, card=btn.closest('.status-card');
    if(!card||!statusId||card.dataset.busy==='1')return;
    card.dataset.busy='1';
    const summaryEl=card.querySelector('.rx-summary');
    const prevCountsJSON=card.dataset.counts||'{}';
    const prevBtnClass=btn.className, prevCurrent=btn.dataset.current||'', prevEmojiHTML=btn.querySelector('.rx-toggle-emoji').innerHTML, prevLabel=btn.querySelector('.rx-toggle-label').textContent;
    const prevSummaryHTML=summaryEl.innerHTML, prevSummaryClass=summaryEl.className;
    // Optimistic update
    const counts=JSON.parse(prevCountsJSON);
    if(prevCurrent)counts[prevCurrent]=Math.max(0,(counts[prevCurrent]||0)-1);
    if(newType)counts[newType]=(counts[newType]||0)+1;
    card.dataset.counts=JSON.stringify(counts);
    const newSummary=reactionSummaryHTML(counts);
    summaryEl.innerHTML=newSummary||'<span class="rx-summary-empty">Beri reaksi pertama</span>';
    summaryEl.classList.toggle('empty',!newSummary);
    btn.classList.toggle('active',!!newType);
    btn.dataset.current=newType||'';
    btn.querySelector('.rx-toggle-emoji').innerHTML=rxToggleIconHTML(newType);
    btn.querySelector('.rx-toggle-label').textContent=newType&&newType!=='like'?'Bereaksi':'Suka';
    let error;
    if(!newType){
      ({error}=await supabaseClient.from('status_likes').delete().eq('status_id',statusId).eq('user_id',session.user.id));
    }else{
      ({error}=await supabaseClient.from('status_likes').upsert({status_id:statusId,user_id:session.user.id,reaction:newType},{onConflict:'status_id,user_id'}));
    }
    if(error){
      card.dataset.counts=prevCountsJSON;
      btn.className=prevBtnClass;btn.dataset.current=prevCurrent;
      btn.querySelector('.rx-toggle-emoji').innerHTML=prevEmojiHTML;btn.querySelector('.rx-toggle-label').textContent=prevLabel;
      summaryEl.innerHTML=prevSummaryHTML;summaryEl.className=prevSummaryClass;
      alert('Gagal mengirim reaksi, coba lagi.');
    }
    card.dataset.busy='0';
  }
  (function(){
    const picker=document.getElementById('rxPicker');
    const LONG_PRESS_MS=380, MOVE_CANCEL_PX=12;
    let pressTimer=null,longPressFired=false,pressBtn=null,startX=0,startY=0;
    function openPicker(btn){
      const rect=btn.getBoundingClientRect();
      const pw=picker.offsetWidth||184,ph=picker.offsetHeight||52;
      let left=rect.left+rect.width/2-pw/2;
      left=Math.max(8,Math.min(left,window.innerWidth-8-pw));
      let top=rect.top-ph-10;
      if(top<8)top=rect.bottom+10;
      picker.style.left=left+'px';picker.style.top=top+'px';
      picker.dataset.id=btn.dataset.id;
      const current=btn.dataset.current||'';
      picker.querySelectorAll('.rx-picker-item').forEach(it=>it.classList.toggle('active',it.dataset.type===current));
      picker.classList.add('open');
    }
    function closePicker(){picker.classList.remove('open');}
    function cancelPress(){if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}pressBtn=null;}
    document.addEventListener('pointerdown',e=>{
      const btn=e.target.closest('.rx-toggle');
      if(!btn||e.pointerType==='mouse'&&e.button!==0)return;
      pressBtn=btn;longPressFired=false;startX=e.clientX;startY=e.clientY;
      pressTimer=setTimeout(()=>{longPressFired=true;openPicker(btn);},LONG_PRESS_MS);
    });
    document.addEventListener('pointermove',e=>{
      if(!pressTimer)return;
      if(Math.abs(e.clientX-startX)>MOVE_CANCEL_PX||Math.abs(e.clientY-startY)>MOVE_CANCEL_PX)cancelPress();
    });
    document.addEventListener('pointerup',e=>{
      const wasTimerActive=!!pressTimer;
      cancelPress();
      const btn=e.target.closest('.rx-toggle');
      if(btn&&wasTimerActive&&!longPressFired){
        const current=btn.dataset.current||null;
        applyReactionChange(btn,current?null:'like');
      }
    });
    document.addEventListener('pointercancel',cancelPress);
    picker.querySelectorAll('.rx-picker-item').forEach(item=>{
      item.addEventListener('click',()=>{
        const statusId=picker.dataset.id,type=item.dataset.type;
        closePicker();
        const btn=document.querySelector(`.rx-toggle[data-id="${CSS.escape(statusId)}"]`);
        if(!btn)return;
        const current=btn.dataset.current||null;
        applyReactionChange(btn,current===type?null:type);
      });
    });
    document.addEventListener('click',e=>{
      if(picker.classList.contains('open')&&!e.target.closest('.rx-picker')&&!e.target.closest('.rx-toggle'))closePicker();
    });
  })();
  window.respondReq=async(id,st,btn)=>{
    const item=btn.closest('.req-item');item.querySelectorAll('button').forEach(b=>b.disabled=true);
    await supabaseClient.from('contacts').update({status:st,seen_by_requester:false}).eq('id',id);
    item.classList.add('removing');setTimeout(()=>{item.remove();refreshNotifBadge();},300);
  };
  async function boot(){
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(!session){window.location.replace('index.html');return;}
    // Cek/siapkan kunci enkripsi diam-diam di background. Device baru otomatis
    // dapat keypair baru sendiri (tidak ada backup/restore PIN, mirip default
    // WhatsApp) -- jadi hasil ensureKeypair selalu langsung siap dipakai.
    try{
      const kp=await E2E.ensureKeypair(session.user.id);
      myPrivateKey=kp.privateKey;
    }catch(e){ console.error('Gagal cek kunci enkripsi:',e); }
    document.getElementById('authGate').style.display='none';
    refreshNotifBadge();
  }
  boot();
  window.addEventListener('pageshow',(e)=>{if(e.persisted){refreshNotifBadge();document.documentElement.style.setProperty('--app-height',(window.visualViewport?window.visualViewport.height:window.innerHeight)+'px');}});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshNotifBadge();});
  const tabDefs={chats:{tabEl:'tabChats',panelEl:'panelChats',title:'Baku Chat'},status:{tabEl:'tabStatus',panelEl:'panelStatus',title:'Status'},kontak:{tabEl:'tabKontak',panelEl:'panelKontak',title:'Kontak'},notif:{tabEl:'tabNotif',panelEl:'panelNotif',title:'Notifikasi'}};
  let activeTab='chats',onNonChatTab=false;
  function switchTab(name,fromPopstate){
    if(!tabDefs[name])return;activeTab=name;
    if(!fromPopstate){if(name!=='chats'){if(!onNonChatTab)history.pushState({tab:name},'',location.href);else history.replaceState({tab:name},'',location.href);onNonChatTab=true;}else if(onNonChatTab){history.back();return;}}
    Object.entries(tabDefs).forEach(([k,d])=>{
      const t=document.getElementById(d.tabEl),p=document.getElementById(d.panelEl),ia=k===name;t.classList.toggle('active',ia);p.classList.toggle('active',ia);
      const svg=t.querySelector('svg');
      if(svg){if(ia){svg.setAttribute('fill',k==='chats'?'var(--ink)':'none');svg.setAttribute('stroke','var(--ink)');}else{svg.setAttribute('fill','none');svg.setAttribute('stroke','var(--muted)');}}
    });
    const h1El=document.querySelector('.appbar h1');h1El.textContent=tabDefs[name].title;h1El.classList.toggle('brand',name==='chats');document.getElementById('fabNewChat').style.display=name==='chats'?'flex':'none';
    document.getElementById('searchOpenBtn').style.display=(name==='notif'||name==='chats')?'none':'flex';
    document.getElementById('profileBtn').style.display=(name==='chats')?'flex':'none';
    document.getElementById('chatSearchBar').style.display=(name==='chats')?'flex':'none';
    document.getElementById('chatSearchInput').value='';
    closeSearch();
    closeAddModal();
    if(name==='kontak')loadContacts();if(name==='notif'){loadNotifications();}if(name==='status')loadStatusTab();if(name==='chats')supabaseClient.auth.getSession().then(({data:{session}})=>{if(session)loadChats(session.user.id);});
    // Auto-refresh tab Status tiap 1 menit selama tab ini aktif, biar status
    // yang sudah lewat 24 jam otomatis hilang tanpa perlu reload manual.
    // Interval dihentikan begitu pindah ke tab lain supaya tidak boros resource.
    if(statusAutoRefresh){clearInterval(statusAutoRefresh);statusAutoRefresh=null;}
    if(name==='status'){statusAutoRefresh=setInterval(()=>{if(activeTab==='status'&&!document.hidden)loadStatusTab(false);},60000);}
  }
  let statusAutoRefresh=null;
  document.getElementById('tabChats').addEventListener('click',()=>switchTab('chats'));document.getElementById('tabStatus').addEventListener('click',()=>switchTab('status'));document.getElementById('tabKontak').addEventListener('click',()=>switchTab('kontak'));document.getElementById('tabNotif').addEventListener('click',()=>switchTab('notif'));
  window.addEventListener('popstate',(e)=>{
    // Cek isi state history-nya: kalau memang ada tab non-chat yang tersimpan
    // (misalnya balik dari profil.html ke dashboard saat tab Kontak aktif),
    // kembalikan ke tab itu -- bukan selalu paksa ke tab Chat.
    const stateTab=e.state&&e.state.tab;
    if(stateTab){ onNonChatTab=true; switchTab(stateTab,true); }
    else if(onNonChatTab){ onNonChatTab=false; switchTab('chats',true); }
  });

  // ---- Pencarian di appbar: cari kontak/chat/status sesuai tab yang lagi aktif ----
  const searchPlaceholders={chats:'Cari chat...',kontak:'Cari kontak...',status:'Cari status...'};
  function openSearch(){
    if(!searchPlaceholders[activeTab])return;
    document.getElementById('searchInput').placeholder=searchPlaceholders[activeTab];
    document.getElementById('searchBar').classList.add('show');
    document.getElementById('searchInput').value='';
    document.getElementById('searchInput').focus();
    applySearchFilter('');
  }
  function closeSearch(){
    document.getElementById('searchBar').classList.remove('show');
    document.getElementById('searchInput').value='';
    applySearchFilter('');
  }
  function applySearchFilter(qRaw){
    const q=qRaw.trim().toLowerCase();
    let listSel,matchFn;
    if(activeTab==='chats'){
      listSel='#chatlist .chat-item';
      matchFn=(el)=>(el.dataset.uname||'').toLowerCase().includes(q);
    }else if(activeTab==='kontak'){
      listSel='#contactList .contact-item';
      matchFn=(el)=>(el.dataset.uname||'').toLowerCase().includes(q);
    }else if(activeTab==='status'){
      listSel='#myStatusPinned .status-card, #statusList .status-card';
      matchFn=(el)=>{
        const uname=(el.querySelector('.sc-uname')?.textContent||'').toLowerCase();
        const content=(el.querySelector('.sc-content')?.textContent||'').toLowerCase();
        return uname.includes(q)||content.includes(q);
      };
    }else return;
    const items=document.querySelectorAll(listSel);
    let visibleCount=0;
    items.forEach(el=>{ const match=!q||matchFn(el); el.style.display=match?'':'none'; if(match)visibleCount++; });
    const listContainer=document.querySelector(activeTab==='chats'?'#chatlist':activeTab==='kontak'?'#contactList':'#statusList');
    let noRes=listContainer?.parentElement.querySelector('.no-results-search');
    if(q && visibleCount===0 && items.length>0){
      if(!noRes){ noRes=document.createElement('div'); noRes.className='no-results no-results-search'; noRes.textContent='Tidak ada hasil untuk "'+qRaw.trim()+'"'; listContainer.after(noRes); }
    }else if(noRes){ noRes.remove(); }
  }
  document.getElementById('searchOpenBtn').addEventListener('click',openSearch);
  document.getElementById('searchCloseBtn').addEventListener('click',closeSearch);
  document.getElementById('searchInput').addEventListener('input',(e)=>applySearchFilter(e.target.value));
  document.getElementById('chatSearchInput').addEventListener('input',(e)=>applySearchFilter(e.target.value));
  // Klik di mana saja di luar kotak input (termasuk area kosong search bar / luar header)
  // otomatis menutup search bar, tidak wajib klik panah kembali.
  document.addEventListener('click',(e)=>{
    if(!document.getElementById('searchBar').classList.contains('show'))return;
    if(e.target.closest('#searchInput')||e.target.closest('#searchOpenBtn'))return;
    closeSearch();
  },true);

  // ---- Geser (swipe) kiri/kanan untuk pindah tab ----
  // Urutan mengikuh alur visual di layar: Chats -> Status(Saya) -> Status(Kontak) -> Kontak -> Notifikasi.
  // Sub-tab "Saya"/"Kontak" di dalam Status diperlakukan sebagai langkah sendiri,
  // jadi geser dari Status:Kontak lanjut ke kanan otomatis masuk ke tab Kontak (kontak list).
  (function(){
    const order=['chats','status-saya','status-kontak','kontak','notif'];
    const zone=document.querySelector('.phone');
    let sx=0, sy=0, tracking=false;
    function blocked(){
      return false;
    }
    function currentStep(){
      if(activeTab==='status') return statusSubtab==='kontak' ? 'status-kontak' : 'status-saya';
      return activeTab;
    }
    function goToStep(step){
      if(step==='status-saya'||step==='status-kontak'){
        if(activeTab!=='status') switchTab('status');
        setStatusSubtab(step==='status-kontak'?'kontak':'saya');
      }else{
        switchTab(step);
      }
    }
    zone.addEventListener('touchstart', e=>{
      if(blocked() || e.touches.length!==1){ tracking=false; return; }
      sx=e.touches[0].clientX; sy=e.touches[0].clientY; tracking=true;
    }, {passive:true});
    zone.addEventListener('touchend', e=>{
      if(!tracking) return; tracking=false;
      const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy;
      if(Math.abs(dx)<60 || Math.abs(dx) < Math.abs(dy)*1.5) return; // terlalu pendek atau lebih vertikal
      const idx=order.indexOf(currentStep());
      const nextIdx = dx<0 ? idx+1 : idx-1;
      if(nextIdx<0 || nextIdx>=order.length) return;
      goToStep(order[nextIdx]);
    }, {passive:true});
  })();
  // ---- Ikon profil (di samping search bar) -> dropdown berisi menu dari Setelan ----
  const profileBtn=document.getElementById('profileBtn'),profileDropdown=document.getElementById('profileDropdown');
  profileBtn.addEventListener('click',(e)=>{e.stopPropagation();profileDropdown.classList.toggle('open');});
  document.addEventListener('click',()=>{profileDropdown.classList.remove('open');});
  document.getElementById('profileLogoutBtn').addEventListener('click',async(e)=>{
    e.stopPropagation();profileDropdown.classList.remove('open');
    if(!confirm('Yakin ingin keluar?'))return;
    await supabaseClient.auth.signOut();
    window.location.replace('index.html');
  });
  document.getElementById('fabNewChat').addEventListener('click',openNewChatSheet);
  let ncwAllContacts=[];
  async function openNewChatSheet(){
    document.getElementById('ncwOverlay').classList.add('open');
    document.getElementById('ncwSearchInput').value='';
    await loadNewChatContacts();
  }
  function closeNewChatSheet(){
    document.getElementById('ncwOverlay').classList.remove('open');
  }
  function renderNewChatList(list){
    const box=document.getElementById('ncwList');
    if(!list||list.length===0){
      box.innerHTML='<div class="ncw-empty">Tidak ada kontak ditemukan.</div>';
      return;
    }
    box.innerHTML=list.map(c=>`<div class="contact-item" data-uid="${escapeHtml(c.id)}" data-uname="${escapeHtml(c.username)}"><div class="avatar" style="${avatarStyle(c.id,c.avatar_url)}">${avatarInner(c.username,c.avatar_url)}</div><div class="uname">${escapeHtml(c.username)}</div></div>`).join('');
    document.querySelectorAll('#ncwList .contact-item').forEach(i=>i.addEventListener('click',()=>{
      window.location.href=`chat.html?uid=${i.dataset.uid}&uname=${encodeURIComponent(i.dataset.uname)}`;
    }));
  }
  async function loadNewChatContacts(){
    const box=document.getElementById('ncwList');box.innerHTML=skeletonRow().repeat(4);
    const {data:{session}}=await supabaseClient.auth.getSession();if(!session)return;
    const {data:rows}=await supabaseClient.from('contacts').select('requester_id, addressee_id').eq('status','accepted').or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`);
    if(!rows||rows.length===0){ncwAllContacts=[];box.innerHTML='<div class="ncw-empty">Belum ada kontak. Tambah kontak dulu lewat tab Kontak.</div>';return;}
    const oIds=rows.map(r=>r.requester_id===session.user.id?r.addressee_id:r.requester_id);
    const {data:pData}=await supabaseClient.from('profiles').select('id, username, avatar_url').in('id',oIds);
    ncwAllContacts=(pData||[]).slice().sort((a,b)=>a.username.localeCompare(b.username));
    renderNewChatList(ncwAllContacts);
  }
  document.getElementById('ncwCloseBtn').addEventListener('click',closeNewChatSheet);
  document.getElementById('ncwOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeNewChatSheet();});
  document.getElementById('ncwSearchInput').addEventListener('input',e=>{
    const q=e.target.value.trim().toLowerCase();
    renderNewChatList(!q?ncwAllContacts:ncwAllContacts.filter(c=>c.username.toLowerCase().includes(q)));
  });
  let cprevUid=null,cprevUname=null;
  function openContactPreview(uid,uname){
    cprevUid=uid;cprevUname=uname;
    applyAvatarEl(document.getElementById('cprevBanner'),uid,uname,contactAvatarMap[uid]||null);
    document.getElementById('cprevUname').textContent=uname;
    document.getElementById('cprevOverlay').classList.add('open');
  }
  function closeContactPreview(){document.getElementById('cprevOverlay').classList.remove('open');cprevUid=null;cprevUname=null;}
  document.getElementById('cprevSendBtn').addEventListener('click',()=>{if(cprevUid)window.location.href=`chat.html?uid=${cprevUid}&uname=${encodeURIComponent(cprevUname)}`;});
  document.getElementById('cprevProfilBtn').addEventListener('click',()=>{if(cprevUid)window.location.href=`profil.html?uid=${cprevUid}`;});
  document.getElementById('cprevOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeContactPreview();});
  function openAddModal(){
    document.getElementById('searchMsg').textContent='';
    document.getElementById('foundCard').classList.remove('show');
    document.getElementById('pinInput').value='';
    const sendBtnEl=document.getElementById('sendRequestBtn');sendBtnEl.disabled=true;sendBtnEl.textContent='Kirim Permintaan';
    document.getElementById('addPanelWrap').classList.add('show');
    document.getElementById('pinInput').focus();
  }
  function closeAddModal(){
    document.getElementById('addPanelWrap').classList.remove('show');
  }
  document.getElementById('fabAddContact').addEventListener('click',()=>{
    document.getElementById('addPanelWrap').classList.contains('show') ? closeAddModal() : openAddModal();
  });
  document.getElementById('addBackBtn').addEventListener('click',closeAddModal);
  document.getElementById('addPanelWrap').addEventListener('click',(e)=>{
    if(e.target===e.currentTarget) closeAddModal();
  });

  /* ===== Banner "Anda sedang offline" ===== */
  function updateOfflineBanner(){
    document.getElementById('offlineBanner').classList.toggle('show', !navigator.onLine);
  }
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();
