/* ===== INTERFACCIA APPLICAZIONE (griglia, modali, admin, flusso 2 step, export) =====
   Tutta la logica di interfaccia rimasta: rendering della griglia slot,
   finestre di prenotazione/modifica/cancellazione, autenticazione (UI),
   pannello admin, flusso "scegli baia poi orario", riepilogo utente ed
   export CSV/Excel. È rimasta un unico blocco (non ulteriormente diviso)
   perché le sue parti si richiamano a vicenda in tutte le direzioni
   tramite uno stato condiviso (data/baia/slot selezionati, ecc.): provare
   a separarle in file diversi senza prima riprogettare come condividono
   questo stato avrebbe solo spostato il rischio, non ridotto la
   complessità reale — vedi docs/PIANO_REFACTORING.md. Caricato come
   ultimo <script>, dopo config.js/supabase-client.js/auth.js/slots.js/
   bookings-api.js (di cui usa le funzioni/costanti condivise: VEHICLES,
   sbClient/adminClient, currentUser/isGuest, currentBookings,
   canBookSlot/hasConsecutiveConflict/slotTimeRange, createBooking/
   deleteBooking/updateBooking/fetchBookings, ecc.). Codice spostato senza
   modifiche da index.html. */

(function(){
'use strict';

// ===== THEME =====
const root = document.documentElement;
const themeToggle = document.querySelector('[data-theme-toggle]');
let curTheme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
root.setAttribute('data-theme', curTheme);
function updTheme(){
  if(!themeToggle) return;
  themeToggle.innerHTML = curTheme==='dark'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
updTheme();
themeToggle && themeToggle.addEventListener('click', ()=>{ curTheme=curTheme==='dark'?'light':'dark'; root.setAttribute('data-theme',curTheme); updTheme(); });

// ===== UTILS =====
function showPage(id){
  ['page-setup','page-login','app-wrapper'].forEach(p=>{
    const el=document.getElementById(p);
    if(el) el.classList.toggle('hidden', p!==id);
  });
}
function toast(msg, type){
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');
  t.setAttribute('role','status');
  t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),350);},3200);
}
function formatTime(h,m){return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
function formatDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
// isAdmin() ora è in js/slots.js. Comportamento invariato.
function formatDateIT(s){
  const [y,mo,da]=s.split('-');
  const days=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const months=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const dt=new Date(parseInt(y),parseInt(mo)-1,parseInt(da));
  return `${days[dt.getDay()]} ${parseInt(da)} ${months[parseInt(mo)-1]} ${y}`;
}
function isPast(h,m){
  const now=new Date(), todayS=formatDate(now);
  if(selectedDate<todayS) return true;
  if(selectedDate>todayS) return false;
  return (h*60+m)<(now.getHours()*60+now.getMinutes());
}
function isWeekend(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  return d.getDay()===0||d.getDay()===6;
}
function updateWeekendBanner(){
  const banner=document.getElementById('weekend-banner');
  const txt=document.getElementById('weekend-banner-text');
  const d=new Date(selectedDate+'T00:00:00');
  const dayName=d.getDay()===6?'sabato':'domenica';
  if(banner){
    banner.style.display=isWeekend(selectedDate)?'flex':'none';
    if(txt) txt.textContent=`Lo stabilimento è chiuso il ${dayName} — nessuna prenotazione disponibile.`;
  }
}

// ===== SUPABASE CONFIG, CLIENT, AUTENTICAZIONE, ACCESSO PRENOTAZIONI =====
// Tutto questo blocco (stato di connessione, login/logout, lettura e
// scrittura delle prenotazioni) è stato spostato senza modifiche in
// js/supabase-client.js, js/auth.js e js/bookings-api.js (caricati prima
// di questo script). Comportamento invariato — vedi docs/PIANO_REFACTORING.md.

// ===== VEHICLES & SLOTS =====
// VEHICLES ora è in js/config.js; slotTimeRange, rangesOverlap,
// isBookableSlotIndex, generateSlotsForVehicle, generateSlots e
// currentBookings ora sono in js/slots.js. Comportamento invariato.
let SLOTS=generateSlots();

// ===== APP STATE =====
let selectedVehicle=VEHICLES[0].id;
let selectedVehicleObj=VEHICLES[0];
let adminAddBookingMode=false;
let selectedDate=formatDate(new Date());
let pendingSlot=null;
let deleteBookingId=null;
let lastNome='', lastReparto='';

// ===== DB STATUS =====
function setDbStatus(s){
  const dot=document.getElementById('db-dot'), txt=document.getElementById('db-status-text');
  if(!dot||!txt) return;
  dot.className='db-dot'+(s==='ok'?' connected':s==='error'?' error':'');
  txt.textContent=s==='ok'?(offlineMode?'Offline':'Connesso'):s==='error'?'Errore DB':'...';
}

// ===== RENDER TABS =====
function renderTabs(){
  const c=document.getElementById('vehicle-tabs-container'); if(!c) return;
  c.innerHTML='';
  VEHICLES.forEach(v=>{
    const b=document.createElement('button');
    b.className='vehicle-tab'+(v.id===selectedVehicle?' active':'');
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected',v.id===selectedVehicle);
    b.innerHTML=`<span aria-hidden="true">${v.icon}</span> ${v.name}`;
    b.addEventListener('click',()=>{selectedVehicle=v.id; selectedVehicleObj=v; SLOTS=generateSlotsForVehicle(v); renderTabs(); loadAndRender();});
    c.appendChild(b);
  });
}

// updateBooking() ora è in js/bookings-api.js. Comportamento invariato.
// ===== LOAD & RENDER =====
async function loadAndRender(){
  updateWeekendBanner();
  renderGridSkeleton();
  try{
    // Always fetch ALL baie for correct cross-baia availability check
    // using persistent adminClient (service_role)
    const { data, error } = await adminClient.from('prenotazioni').select('*').eq('data', selectedDate);
    if(!error && data) currentBookings = data;
    else currentBookings = await fetchBookings(selectedDate);
    currentBookings.forEach(b=>{ b.mine = isBookingMine(b); });
    setDbStatus('ok');
  }catch(e){
    setDbStatus('error');
    toast('Errore caricamento: '+e.message,'error-t');
    currentBookings=[];
  }
  const vNow = VEHICLES.find(v=>v.id===selectedVehicle);
  if(vNow){ selectedVehicleObj = vNow; SLOTS = generateSlotsForVehicle(vNow); }
  try{
    renderGrid();
    renderAdminBookings();
    updateStats();
  }catch(e){
    console.error('Errore di rendering griglia:', e?.message||String(e));
    toast('Errore nel mostrare gli slot. Ricarica la pagina.','error-t');
  }
}

function renderGridSkeleton(){
  const tbody=document.getElementById('booking-tbody'); if(!tbody) return;
  tbody.innerHTML='';
  SLOTS.forEach((slot,idx)=>{
    if(!isBookableSlotIndex(selectedVehicle, idx)) return;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><span class="time-label">${formatTime(slot.hour,slot.min)}</span></td><td class="slot-cell"><div class="slot loading" style="height:44px;">&nbsp;</div></td>`;
    tbody.appendChild(tr);
  });
}


// ===== CROSS-BAIA AVAILABILITY =====
// TOTAL_CARRELLISTI, countBookingsForSlot, totalBusyInRange, totalBusyAtTime,
// hasConsecutiveConflict, canBookSlot, maxAllowedForSlot ora sono in
// js/slots.js. Comportamento invariato.

function renderGrid(){
  const tbody=document.getElementById('booking-tbody'); if(!tbody) return;
  const thM=document.getElementById('th-mezzo');
  const v=VEHICLES.find(v=>v.id===selectedVehicle);
  if(!v) return;
  const vehicleSlots = generateSlotsForVehicle(v);
  SLOTS = vehicleSlots;
  selectedVehicleObj = v;
  if(thM) thM.textContent=v.name;
  tbody.innerHTML='';
  const map={};
  currentBookings.forEach(b=>{if(b.vehicle_id===selectedVehicle) map[b.slot_index]=b;});
  const weekend=isWeekend(selectedDate);
  vehicleSlots.forEach((slot,idx)=>{
    if(!isBookableSlotIndex(selectedVehicle, idx)) return;
    const b=map[idx];
    const booked_count=countBookingsForSlot(selectedVehicle,idx);
    const max_allowed=maxAllowedForSlot(selectedVehicle,idx);
    const isFull=!canBookSlot(selectedVehicle,idx);
    const myConsecutive = !b && hasConsecutiveConflict(selectedVehicle,idx);
    const past=isPast(slot.hour,slot.min)||weekend;
    let cls='free',txt='Disponibile',aria=`${formatTime(slot.hour,slot.min)} - Disponibile`;
    if(booked_count>0&&booked_count<max_allowed&&!past){
      cls='free'; txt=`Disponibile (${booked_count}/${max_allowed})`;
      aria=`${formatTime(slot.hour,slot.min)} - Parzialmente occupato`;
    }
    if(past){
      if(b){
        if(b.mine){cls='past mine';txt=`✓ ${b.destinazione||b.targa||b.nome}`;aria=`${formatTime(slot.hour,slot.min)} - Mia prenotazione: ${b.destinazione||''}`;}
        else if(isAdmin()){cls='past';txt=b.nome;aria=`${formatTime(slot.hour,slot.min)} - ${b.nome} | ${b.destinazione} | ${b.targa}`;}
        else {cls='past';txt='Occupato';aria=`${formatTime(slot.hour,slot.min)} - Slot occupato`;}
      } else {cls='past';txt='—';}
    }
    else if(isFull&&b){if(b.mine){
          cls='mine';
          txt=`✓ ${b.destinazione||b.targa||b.nome}`;
          aria=`${formatTime(slot.hour,slot.min)} - Mia prenotazione: ${b.destinazione||''} (${b.targa||''})`;
        } else if(isAdmin()){
          cls='booked';
          txt=`${b.nome}`;
          aria=`${formatTime(slot.hour,slot.min)} - ${b.nome} | ${b.destinazione} | ${b.targa}`;
        } else {
          cls='occupied-other';
          txt='Occupato';
          aria=`${formatTime(slot.hour,slot.min)} - Slot occupato`;
        }}
    else if(isFull&&!b&&!past){cls='occupied-other';txt='Occupato';aria=`${formatTime(slot.hour,slot.min)} - Slot occupato`;}
    else if(myConsecutive&&!past){cls='occupied-other';txt='Non prenotabile';aria=`${formatTime(slot.hour,slot.min)} - Non prenotabile: consecutivo a una tua prenotazione`;}
    const mineTitle = b && b.mine ? `title="${b.nome} → ${b.destinazione} | ${b.targa}"` : '';
    const adminTitle = b && !b.mine && isAdmin() ? `title="${b.nome} → ${b.destinazione} | ${b.targa}"` : '';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><span class="time-label">${formatTime(slot.hour,slot.min)}</span></td><td class="slot-cell"><div class="slot ${cls}" tabindex="${past?'-1':'0'}" role="${(!b&&!past&&!myConsecutive)||(b&&b.mine&&!past)?'button':'cell'}" aria-label="${aria}" data-idx="${idx}" ${mineTitle||adminTitle}><span class="slot-time">${formatTime(slot.hour,slot.min)}</span><span class="slot-label">${txt}</span></div></td>`;
    const el=tr.querySelector('.slot');
    if(!past){
      if(!isFull&&!myConsecutive){el.addEventListener('click',()=>openBookingModal(idx,slot));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openBookingModal(idx,slot);}});}
      else if(b&&b.mine){el.addEventListener('click',()=>openUserEditModal(idx,slot,b));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openUserEditModal(idx,slot,b);}});}
      else if(isAdmin()&&b&&!b.mine){el.addEventListener('click',()=>openAdminEdit(b));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAdminEdit(b);}});}
      // else: slot full due to cross-baia capacity or consecutive-slot rule → not clickable, no handler needed
    }
    tbody.appendChild(tr);
  });
}

function updateStats(){
  const vehicle = VEHICLES.find(v=>v.id===selectedVehicle);
  const vehicleSlots = vehicle ? generateSlotsForVehicle(vehicle) : [];
  const map={};
  currentBookings.forEach(b=>{if(b.vehicle_id===selectedVehicle) map[b.slot_index]=b;});
  let free=0,booked=0,mine=0;
  vehicleSlots.forEach((slot,idx)=>{
    if(!isBookableSlotIndex(selectedVehicle, idx)) return;
    if(isPast(slot.hour,slot.min) || isWeekend(selectedDate)) return;
    const b=map[idx];
    if(!b) free++; else{booked++;if(b.mine) mine++;}
  });
  const el=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  el('stat-free',free); el('stat-booked',booked); el('stat-mine',mine);
  el('stat-vehicle',vehicle?vehicle.name:'—');
}


function slotInfoHtml(slot,vehicleName){
  return `
    <div class="slot-info-item"><div class="slot-info-item-label">Orario</div><div class="slot-info-item-value">${formatTime(slot.hour,slot.min)}</div></div>
    <div class="slot-info-item"><div class="slot-info-item-label">Mezzo</div><div class="slot-info-item-value">${vehicleName}</div></div>
    <div class="slot-info-item"><div class="slot-info-item-label">Data</div><div class="slot-info-item-value">${selectedDate}</div></div>`;
}
function openBookingModal(idx,slot){
  pendingSlot={idx,slot};
  const vv=VEHICLES.find(v=>v.id===selectedVehicle);
  const isZini = (currentUser?.user_metadata?.reparto || currentUser?.reparto || '').toLowerCase().includes('zini');
  if(vv && vv.id==='baia-3' && !isAdmin() && !isZini){ toast('La baia Depositi è riservata a ZINI Autotrasporti Srl.','error-t'); return; }
  document.getElementById('modal-subtitle').textContent=`${vv?vv.name:''} — ${formatDateIT(selectedDate)}`;
  document.getElementById('slot-info-box').innerHTML=slotInfoHtml(slot,vv?vv.name:'');
  document.getElementById('field-nome').value=lastNome;
  document.getElementById('field-destinazione').value='';
  document.getElementById('field-targa').value='';
  const telWrap=document.getElementById('field-telefono-wrap');
  const azWrap=document.getElementById('field-azienda-wrap');
  if(telWrap) telWrap.style.display = isGuest ? '' : 'none';
  if(azWrap) azWrap.style.display = isGuest ? '' : 'none';
  const telField=document.getElementById('field-telefono'); if(telField) telField.value='';
  const azField=document.getElementById('field-azienda'); if(azField) azField.value='';
  document.getElementById('modal-overlay').classList.add('visible');
  setTimeout(()=>{const f=document.getElementById('field-nome');f.focus();},100);
}
function closeModal(id){document.getElementById(id).classList.remove('visible');}
document.getElementById('modal-close').addEventListener('click',()=>closeModal('modal-overlay'));
document.getElementById('modal-cancel-btn').addEventListener('click',()=>closeModal('modal-overlay'));
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal('modal-overlay');});

document.getElementById('modal-confirm').addEventListener('click',async()=>{
  if(!pendingSlot) return;
  const nome=document.getElementById('field-nome').value.trim();
  const destinazione=document.getElementById('field-destinazione').value.trim();
  const targa=document.getElementById('field-targa').value.trim().toUpperCase();
  const telefono=isGuest?document.getElementById('field-telefono').value.trim():'';
  const azienda=isGuest?document.getElementById('field-azienda').value.trim():'';
  if(!nome){document.getElementById('field-nome').focus();toast('Inserisci il nome del trasportatore.','error-t');return;}
  if(!destinazione){document.getElementById('field-destinazione').focus();toast('Inserisci la destinazione.','error-t');return;}
  if(!targa){document.getElementById('field-targa').focus();toast('Inserisci la targa del mezzo.','error-t');return;}
  if(isGuest && !telefono){document.getElementById('field-telefono').focus();toast('Inserisci un numero di telefono.','error-t');return;}
  const btn=document.getElementById('modal-confirm');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Salvo...';
  try{
    if(!pendingSlot){toast('Errore: nessuno slot selezionato.','error-t');return;}
  const res=await createBooking(selectedVehicle,selectedDate,pendingSlot.idx,nome,destinazione,targa,isGuest?{telefono,azienda}:null);
    lastNome=nome; lastReparto='';
    const nb=Array.isArray(res)?res[0]:res;
    if(nb){
      nb.mine=true;
      currentBookings.push(nb);
      if(isGuest && nb.management_token) saveGuestToken(nb.management_token);
    }
    closeModal('modal-overlay');
    renderGrid(); loadBookingsForStep1(); updateStats();
    toast(`✓ Prenotato per le ${formatTime(pendingSlot.slot.hour,pendingSlot.slot.min)}!`,'success');
    pendingSlot=null;
  }catch(e){ toast('Errore: '+(e.message.includes('unique')||e.message.includes('duplicate')?'Slot già occupato.':e.message),'error-t'); }
  btn.disabled=false;
  btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Conferma';
});

// ===== DELETE MODAL =====
function openDeleteModal(idx,slot,bookingId){
  deleteBookingId=bookingId;
  const vv=VEHICLES.find(v=>v.id===selectedVehicle);
  document.getElementById('modal-del-subtitle').textContent=`${vv?vv.name:''} — ${formatTime(slot.hour,slot.min)}`;
  document.getElementById('del-slot-info').innerHTML=slotInfoHtml(slot,vv?vv.name:'');
  document.getElementById('modal-del-overlay').classList.add('visible');
  setTimeout(()=>document.getElementById('modal-del-no').focus(),100);
}
document.getElementById('modal-del-close').addEventListener('click',()=>closeModal('modal-del-overlay'));
document.getElementById('modal-del-no').addEventListener('click',()=>closeModal('modal-del-overlay'));
document.getElementById('modal-del-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal('modal-del-overlay');});
document.getElementById('modal-del-yes').addEventListener('click',async()=>{
  const btn=document.getElementById('modal-del-yes');
  btn.disabled=true;
  try{
    await deleteBooking(deleteBookingId);
    currentBookings=currentBookings.filter(b=>b.id!==deleteBookingId);
    closeModal('modal-del-overlay');
    renderGrid(); renderAdminBookings(); loadBookingsForStep1(); updateStats();
    toast('Prenotazione cancellata.','error-t');
    deleteBookingId=null;
  }catch(e){ toast('Errore: '+e.message,'error-t'); }
  btn.disabled=false;
});

// ===== DATE PICKER =====
const datePicker=document.getElementById('date-picker');
if(datePicker){
  // If today is weekend, start from Monday
  let initD=new Date(selectedDate+'T00:00:00');
  if(initD.getDay()===6) initD.setDate(initD.getDate()+2);
  if(initD.getDay()===0) initD.setDate(initD.getDate()+1);
  selectedDate=formatDate(initD);
  datePicker.value=selectedDate;
  datePicker.addEventListener('change',()=>{
    let d=new Date(datePicker.value+'T00:00:00');
    if(d.getDay()===6) d.setDate(d.getDate()+2); // Sat → Mon
    if(d.getDay()===0) d.setDate(d.getDate()+1); // Sun → Mon
    selectedDate=formatDate(d);
    datePicker.value=selectedDate;
    loadAndRender();
  });
  let _navBusyS2 = false;
  function _navGuardS2(fn){
    if(_navBusyS2) return;
    _navBusyS2 = true;
    fn();
    setTimeout(()=>{_navBusyS2=false;}, 350);
  }
  document.getElementById('prev-day').addEventListener('click',()=>_navGuardS2(()=>{
    const d=new Date(selectedDate+'T00:00:00');
    d.setDate(d.getDate()-1);
    // skip weekends going back
    while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()-1);
    selectedDate=formatDate(d);datePicker.value=selectedDate;loadAndRender();
  }));
  document.getElementById('next-day').addEventListener('click',()=>_navGuardS2(()=>{
    const d=new Date(selectedDate+'T00:00:00');
    d.setDate(d.getDate()+1);
    // skip weekends going forward
    while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1);
    selectedDate=formatDate(d);datePicker.value=selectedDate;loadAndRender();
  }));
}

// ===== LOGOUT =====
document.getElementById('btn-logout')&&document.getElementById('btn-logout').addEventListener('click',async()=>{
  await signOut();
  toast('Logout effettuato.');
  showPage('page-login');
  renderAuthLogin();
});

// ===== SETTINGS =====
document.getElementById('btn-settings')&&document.getElementById('btn-settings').addEventListener('click',()=>{
  document.getElementById('setup-url').value=SB_URL;
  document.getElementById('setup-key').value=SB_KEY;
  showPage('page-setup');
});

// ===== ESC =====
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal('modal-overlay');closeModal('modal-del-overlay');}
});

// ===== AUTH UI =====
let authMode='login'; // 'login' | 'register'

function renderAuthLogin(){
  authMode='login';
  document.getElementById('auth-title').textContent='Accedi';
  document.getElementById('auth-body').innerHTML=`
    <div class="field">
      <label class="field-label" for="auth-email">Email aziendale</label>
      <input type="email" class="field-input" id="auth-email" placeholder="mario.rossi@azienda.it" autocomplete="email">
    </div>
    <div class="field">
      <label class="field-label" for="auth-pw">Password</label>
      <div class="password-wrapper">
        <input type="password" class="field-input" id="auth-pw" placeholder="••••••••" autocomplete="current-password">
        <button class="pw-toggle" type="button" onclick="togglePw('auth-pw',this)" aria-label="Mostra/nascondi password">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    <div class="error-msg" id="auth-error"></div>
  `;
  document.getElementById('auth-footer').innerHTML=`
    <button class="btn btn-primary" id="auth-submit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      Accedi
    </button>
    <button class="btn btn-ghost" id="auth-guest" style="margin-top:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      Prenota senza account
    </button>
    <div class="auth-switch">Non hai un account? <button onclick="renderAuthRegister()">Registrati</button></div>
  `;
  document.getElementById('auth-submit').addEventListener('click', doLogin);
  document.getElementById('auth-guest').addEventListener('click', startGuestMode);
  document.getElementById('auth-pw').addEventListener('keydown',e=>{if(e.key==='Enter') doLogin();});
  setTimeout(()=>document.getElementById('auth-email').focus(),100);
}

function renderAuthRegister(){
  authMode='register';
  document.getElementById('auth-title').textContent='Registrati';
  document.getElementById('auth-body').innerHTML=`
    <div class="field">
      <label class="field-label" for="reg-nome">Nome e Cognome *</label>
      <input type="text" class="field-input" id="reg-nome" placeholder="Es. Mario Rossi" autocomplete="name">
    </div>
    <div class="field">
      <label class="field-label" for="reg-reparto">Azienda *</label>
      <input type="text" class="field-input" id="reg-reparto" placeholder="Es. Saica Pack, Trasporti Rossi...">
    </div>
    <div class="field">
      <label class="field-label" for="reg-email">Email aziendale *</label>
      <input type="email" class="field-input" id="reg-email" placeholder="mario.rossi@azienda.it" autocomplete="email">
    </div>
    <div class="field">
      <label class="field-label" for="reg-pw">Password *</label>
      <div class="password-wrapper">
        <input type="password" class="field-input" id="reg-pw" placeholder="Min. 8 caratteri" autocomplete="new-password">
        <button class="pw-toggle" type="button" onclick="togglePw('reg-pw',this)" aria-label="Mostra password">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <span class="field-hint">Minimo 8 caratteri</span>
    </div>
    <div class="error-msg" id="auth-error"></div>
    <div class="success-msg" id="auth-success"></div>
  `;
  document.getElementById('auth-footer').innerHTML=`
    <button class="btn btn-primary" id="auth-submit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
      Crea account
    </button>
    <div class="auth-switch">Hai già un account? <button onclick="renderAuthLogin()">Accedi</button></div>
  `;
  document.getElementById('auth-submit').addEventListener('click', doRegister);
  setTimeout(()=>document.getElementById('reg-nome').focus(),100);
}

window.renderAuthLogin=renderAuthLogin;
window.renderAuthRegister=renderAuthRegister;
window.togglePw=function(id,btn){
  const inp=document.getElementById(id);
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  btn.innerHTML=show
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
};

function showAuthError(msg){
  const e=document.getElementById('auth-error');
  if(e){e.textContent=msg;e.classList.add('show');}
}
function hideAuthError(){
  const e=document.getElementById('auth-error');
  if(e) e.classList.remove('show');
}

async function doLogin(){
  const email=(document.getElementById('auth-email')||{}).value?.trim();
  const pw=(document.getElementById('auth-pw')||{}).value;
  if(!email||!pw){showAuthError('Inserisci email e password.');return;}
  hideAuthError();
  const btn=document.getElementById('auth-submit');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Accesso...';
  try{
    const r=await signIn(email,pw);
    const user = r.user || await getUser();
    currentUser={id:user.id, email:user.email, nome:user.user_metadata?.nome||user.email.split('@')[0], reparto:user.user_metadata?.reparto||''};
    lastNome=currentUser.nome; lastReparto='';
    startApp();
  }catch(e){
    showAuthError(e.message.includes('Invalid')||e.message.includes('invalid')?'Email o password non corretti.':e.message);
    btn.disabled=false;
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Accedi';
  }
}

async function doRegister(){
  const nome=(document.getElementById('reg-nome')||{}).value?.trim();
  const reparto=(document.getElementById('reg-reparto')||{}).value?.trim();
  const email=(document.getElementById('reg-email')||{}).value?.trim();
  const pw=(document.getElementById('reg-pw')||{}).value;
  if(!nome||!reparto||!email||!pw){showAuthError('Compila tutti i campi obbligatori.');return;}
  if(pw.length<8){showAuthError('La password deve avere almeno 8 caratteri.');return;}
  hideAuthError();
  const btn=document.getElementById('auth-submit');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Creo account...';
  try{
    await signUp(email,pw,nome,reparto);
    // Try immediate login
    try{
      const r=await signIn(email,pw);
      const user = r.user || await getUser();
      currentUser={id:user.id,email:user.email,nome,reparto};
      lastNome=nome; lastReparto=reparto;
      startApp();
    }catch(e2){
      // Email confirmation required
      const s=document.getElementById('auth-success');
      if(s){s.textContent='✓ Account creato! Controlla la tua email per confermare, poi accedi.';s.classList.add('show');}
      btn.disabled=false;
      btn.innerHTML='Crea account';
      setTimeout(()=>renderAuthLogin(),2500);
    }
  }catch(e){
    showAuthError(e.message.includes('already')||e.message.includes('exists')?'Email già registrata. Prova ad accedere.':e.message);
    btn.disabled=false;
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Crea account';
  }
}

function startGuestMode(){
  isGuest = true;
  currentUser = null;
  startApp();
}

function startApp(){
  // Update user chip
  const avatar=document.getElementById('user-avatar');
  const emailLabel=document.getElementById('user-email-label');
  if(avatar) avatar.textContent = isGuest ? 'O' : (currentUser?.nome||currentUser?.email||'?').charAt(0).toUpperCase();
  if(emailLabel) emailLabel.textContent = isGuest ? 'Ospite' : (currentUser?.nome||currentUser?.email||'');
  setDbStatus('ok');
  showPage('app-wrapper');
  renderTabs();
  // Show export bar only to admin
  const exportBar = document.getElementById('export-bar');
  if(exportBar) exportBar.style.display = isAdmin() ? '' : 'none';
  // Show admin panel section only to admin
  const adminSection = document.getElementById('admin-all-bookings');
  if(adminSection) adminSection.style.display = isAdmin() ? '' : 'none';
  if(isAdmin()){ initAdminFilters(); initAdminEditModal(); initAdminAddBooking(); }
  initUserEditModal();
  // Start on step 1 (baia selection)
  initStep1Controls();
  goToStep1();
  if(window._initExportDates) window._initExportDates();
}

// ===== SETUP SCREEN =====
document.getElementById('setup-skip').addEventListener('click',()=>{
  offlineMode=true; SB_URL=''; SB_KEY='';
  currentUser={id:'offline',email:'demo@offline.it',nome:'Utente Demo',reparto:'Demo'};
  lastNome='Utente Demo'; lastReparto='Demo';
  startApp();
});

document.getElementById('setup-connect').addEventListener('click',async()=>{
  const url=document.getElementById('setup-url').value.trim().replace(/\/$/,'');
  const key=document.getElementById('setup-key').value.trim();
  const errBox=document.getElementById('setup-error');
  errBox.classList.remove('show');
  if(!url||!key){errBox.textContent='Inserisci URL e chiave API.';errBox.classList.add('show');return;}
  SB_URL=url; SB_KEY=key;
  initSupabaseClient();
  const btn=document.getElementById('setup-connect');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Connessione...';
  try{
    const { error } = await sbClient.from('prenotazioni').select('id').limit(1);
    if(error && error.code !== 'PGRST116') throw new Error(error.message);
    showPage('page-login');
    renderAuthLogin();
  }catch(e){
    errBox.textContent='Connessione fallita. Verifica URL e chiave. Dettaglio: '+e.message;
    errBox.classList.add('show');
    btn.disabled=false;
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Salva e Connetti';
  }
});

// ===== INIT =====
SB_URL = SUPABASE_URL_DEFAULT;
SB_KEY = SUPABASE_ANON_KEY_DEFAULT;
offlineMode = false;
initSupabaseClient();

// Controlla sessione esistente → se loggato salta il login
(async () => {
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session && session.user) {
      const meta = session.user.user_metadata || {};
      currentUser = {
        id: session.user.id,
        email: session.user.email,
        nome: meta.nome || session.user.email.split('@')[0],
        reparto: meta.reparto || ''
      };
      lastNome = currentUser.nome;
      startApp();
    } else {
      showPage('page-login');
      renderAuthLogin();
    }
  } catch(e) {
    showPage('page-login');
    renderAuthLogin();
  }
})();



  
// ===== ADMIN: render all bookings =====
let adminFilter = 'all';

function renderAdminBookings(){
  if(!isAdmin()) return;
  const list = document.getElementById('admin-bookings-list');
  const badge = document.getElementById('admin-total-badge');
  if(!list) return;
  const all = currentBookings || [];
  if(badge) badge.textContent = all.length;

  // Apply filter
  const filtered = adminFilter === 'all' ? all : all.filter(b => b.vehicle_id === adminFilter);

  if(filtered.length === 0){
    list.innerHTML = `<div class="admin-empty">${adminFilter==='all'?'Nessuna prenotazione per oggi':'Nessuna prenotazione per questa baia'}</div>`;
    updateBulkBar();
    return;
  }
  // Sort by slot_index
  const sorted = [...filtered].sort((a,b)=>(a.slot_index||0)-(b.slot_index||0));
  list.innerHTML = sorted.map(b => {
    const v = VEHICLES.find(v=>v.id===b.vehicle_id)||{icon:'🚪',name:b.vehicle_id};
    let time = '--:--';
    const idx = parseInt(b.slot_index);
    if(!isNaN(idx) && SLOTS[idx]){
      const s = SLOTS[idx];
      time = formatTime(s.hour, s.min);
    }
    const name = b.nome || b.trasportatore || b.user_nome || b.user_email || 'N/D';
    const targa = b.targa || '';
    const dest = b.destinazione || '';
    return `<div class="admin-booking-row" data-id="${b.id}">
      <input type="checkbox" class="admin-row-check" data-id="${b.id}" title="Seleziona">
      <div class="admin-booking-time">${time}</div>
      <div class="admin-booking-baia">${v.icon} ${v.name}</div>
      <div class="admin-booking-info">
        <span class="admin-booking-name">${name}</span>
        ${targa ? `<span class="admin-booking-targa">${targa}</span>` : ''}
        ${dest ? `<span class="admin-booking-dest">→ ${dest}</span>` : ''}
      </div>
      <div class="admin-row-actions">
        <button class="admin-row-btn admin-edit-btn" data-id="${b.id}" title="Modifica">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="admin-row-btn admin-delete-btn" data-id="${b.id}" title="Elimina">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  // Re-attach checkbox listeners
  list.querySelectorAll('.admin-row-check').forEach(chk => {
    chk.addEventListener('change', updateBulkBar);
  });
  updateBulkBar();
}

function updateBulkBar(){
  const bar = document.getElementById('admin-bulk-bar');
  const countEl = document.getElementById('admin-selected-count');
  if(!bar) return;
  const checked = document.querySelectorAll('.admin-row-check:checked');
  const total = document.querySelectorAll('.admin-row-check');
  if(checked.length > 0){
    bar.classList.add('visible');
    countEl.textContent = checked.length + ' selezionat' + (checked.length===1?'a':'e');
    const selAllBtn = document.getElementById('admin-select-all-btn');
    if(selAllBtn) selAllBtn.textContent = checked.length === total.length ? 'Deseleziona tutti' : 'Seleziona tutti';
  } else {
    bar.classList.remove('visible');
  }
}

function initAdminFilters(){
  document.querySelectorAll('.admin-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      adminFilter = btn.dataset.filter;
      document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAdminBookings();
    });
  });

  // Select all button
  document.getElementById('admin-select-all-btn')?.addEventListener('click', () => {
    const checks = document.querySelectorAll('.admin-row-check');
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => c.checked = !allChecked);
    updateBulkBar();
  });

  // Bulk delete button
  document.getElementById('admin-bulk-delete-btn')?.addEventListener('click', async () => {
    const checked = document.querySelectorAll('.admin-row-check:checked');
    if(checked.length === 0) return;
    if(!confirm(`Eliminare ${checked.length} prenotazion${checked.length===1?'e':'i'}?`)) return;
    const ids = [...checked].map(c => c.dataset.id);
    let errors = 0;
    for(const id of ids){
      try{ await deleteBooking(id); }
      catch(e){ errors++; }
    }
    if(errors === 0) toast(`✓ ${ids.length} prenotazion${ids.length===1?'e':'i'} eliminat${ids.length===1?'a':'e'}`, 'success');
    else toast(`Eliminat${ids.length-errors===1?'a':'e'} ${ids.length-errors} su ${ids.length}. Errori: ${errors}`, 'warning');
    await loadAndRender();
  });
}

// ===== 2-STEP FLOW =====
function renderBaiaCards(){
  const c = document.getElementById('baia-cards-container');
  if(!c) return;
  const titleEl = document.querySelector('.baia-select-title');
  // Admin: only show baia cards when in add-booking mode
  if(isAdmin()){
    if(adminAddBookingMode && !isWeekend(selectedDate)){
      renderBaiaCardsForAdmin();
    } else {
      c.style.display='none';
      if(titleEl) titleEl.style.display='none';
    }
    return;
  }
  if(titleEl) titleEl.style.display='';
  c.style.display='';
  c.innerHTML = '';
  VEHICLES.forEach(v => {
    const isDepositi = v.id === 'baia-3';
    const isZini = (currentUser?.user_metadata?.reparto || currentUser?.reparto || '').toLowerCase().includes('zini');
    if(isDepositi && !isAdmin() && !isZini) return;
    const card = document.createElement('button');
    card.className = 'baia-card';
    card.setAttribute('aria-label', 'Seleziona ' + v.name);
    // Count free slots for this vehicle today
    const vSlots = generateSlotsForVehicle(v);
    const booked = currentBookings.filter(b => b.vehicle_id === v.id).length;
    const free = vSlots.length - booked;
    card.innerHTML = `
      <div class="baia-card-icon">${v.icon}</div>
      <div class="baia-card-name">${v.name}</div>
      <div class="baia-card-slots">${free} slot liberi</div>
      <div class="baia-card-arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    card.addEventListener('click', () => goToStep2(v));
    c.appendChild(card);
  });
}

let _goToStep2Busy = false;
async function goToStep2(vehicle) {
  if(_goToStep2Busy) return; // avoid double-tap causing a stuck/half-loaded state
  _goToStep2Busy = true;
  selectedVehicle = vehicle.id;
  selectedVehicleObj = vehicle;
  SLOTS = generateSlotsForVehicle(vehicle);
  renderTabs();
  try{
    await loadAndRender();
  }catch(e){
    // loadAndRender already handles its own errors internally, but guard here too
    // so a network hiccup never leaves the user stuck on step 1 with no feedback.
    toast('Errore di connessione, riprova.','error-t');
  }finally{
    // Update step2 header labels
    const dateLabel = document.getElementById('step2-date-label');
    const baiaLabel = document.getElementById('step2-baia-label');
    if(dateLabel) dateLabel.textContent = formatDateIT(selectedDate);
    if(baiaLabel) baiaLabel.textContent = vehicle.icon + ' ' + vehicle.name;
    // Switch views (always happens, even if loading failed)
    document.getElementById('step-select').style.display = 'none';
    document.getElementById('step-slots').style.display = 'flex';
    document.getElementById('step-slots').style.flexDirection = 'column';
    document.getElementById('step-slots').style.gap = 'var(--space-4)';
    _goToStep2Busy = false;
  }
}

function goHome(){
  goToStep1();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function goToStep1(){
  document.getElementById('step-slots').style.display = 'none';
  document.getElementById('step-select').style.display = 'flex';
  document.getElementById('step-select').style.flexDirection = 'column';
  document.getElementById('step-select').style.gap = 'var(--space-4)';
  // Restore admin panels if hidden
  if(isAdmin()){
    const adminAll = document.getElementById('admin-all-bookings');
    const exportBar = document.getElementById('export-bar');
    const addBtn = document.getElementById('admin-add-booking-btn');
    if(adminAll) adminAll.style.display = '';
    if(exportBar) exportBar.style.display = '';
    if(addBtn) addBtn.style.display = 'inline-flex';
    // Remove inline slots panel if present
    const inlineSlots = document.getElementById('admin-inline-slots');
    if(inlineSlots) inlineSlots.remove();
  }
  // Refresh bookings count on cards
  loadBookingsForStep1();
}

async function loadBookingsForStep1(){
  try {
    if(isAdmin()){
      // Admin fetches ALL bookings using service role (bypasses RLS)
      // using persistent adminClient (service_role)
      const { data, error } = await adminClient.from('prenotazioni').select('*').eq('data', selectedDate);
      if(!error && data) {
        currentBookings = data;
      } else {
        currentBookings = await fetchBookings(selectedDate);
      }
    } else {
      currentBookings = await fetchBookings(selectedDate);
    }
    currentBookings.forEach(b=>{ b.mine = isBookingMine(b); });
  } catch(e){ console.error('loadBookingsForStep1 error:', e?.message||String(e)); }
  renderBaiaCards();
  renderAdminBookings();
  renderUserSchedule();
  updateWeekendBannerS1();
}

function updateWeekendBannerS1(){
  const banner = document.getElementById('weekend-banner-s1');
  const txt = document.getElementById('weekend-banner-text-s1');
  if(!banner) return;
  const d = new Date(selectedDate+'T00:00:00');
  const dayName = d.getDay()===6?'sabato':'domenica';
  banner.style.display = isWeekend(selectedDate) ? 'flex' : 'none';
  if(txt) txt.textContent = `Stabilimento chiuso ${dayName}`;
  // Hide baia cards + inline slots on weekend even in admin add-booking mode
  if(isWeekend(selectedDate) && adminAddBookingMode){
    const panel = document.getElementById('admin-inline-slots');
    const c = document.getElementById('baia-cards-container');
    const titleEl = document.querySelector('.baia-select-title');
    if(panel) panel.remove();
    if(c) c.style.display = 'none';
    if(titleEl) titleEl.style.display = 'none';
  }
}

// Init step1 date pickers in sync with main
document.addEventListener('DOMContentLoaded', () => {});
function initStep1Controls(){
  const dp = document.getElementById('date-picker-s1');
  const mainDp = document.getElementById('date-picker');
  if(dp){
    dp.value = selectedDate;
    dp.addEventListener('change', e => {
      selectedDate = e.target.value;
      if(mainDp) mainDp.value = selectedDate;
      loadBookingsForStep1();
    });
  }
  const prev = document.getElementById('prev-day-s1');
  const next = document.getElementById('next-day-s1');
  let _navBusyS1 = false;
  function _navGuard(fn){
    if(_navBusyS1) return;
    _navBusyS1 = true;
    fn();
    setTimeout(()=>{_navBusyS1=false;}, 350);
  }
  if(prev) prev.addEventListener('click', () => _navGuard(() => {
    const d = new Date(selectedDate+'T00:00:00');
    d.setDate(d.getDate()-1);
    selectedDate = formatDate(d);
    if(dp) dp.value = selectedDate;
    if(mainDp) mainDp.value = selectedDate;
    loadBookingsForStep1();
  }));
  if(next) next.addEventListener('click', () => _navGuard(() => {
    const d = new Date(selectedDate+'T00:00:00');
    d.setDate(d.getDate()+1);
    selectedDate = formatDate(d);
    if(dp) dp.value = selectedDate;
    if(mainDp) mainDp.value = selectedDate;
    loadBookingsForStep1();
  }));
  const backBtn = document.getElementById('btn-back-step1');
  if(backBtn) backBtn.addEventListener('click', goToStep1);
  const homeBtn = document.getElementById('btn-home-step2');
  if(homeBtn) homeBtn.addEventListener('click', goHome);
}





// ===== ADMIN ADD BOOKING =====
function initAdminAddBooking(){
  const btn = document.getElementById('admin-add-booking-btn');
  if(btn) {
    btn.style.display = isAdmin() ? 'inline-flex' : 'none';
    btn.addEventListener('click', showBaiaCardsForAdmin);
  }
}

function showBaiaCardsForAdmin(){
  adminAddBookingMode = true;
  // Show baia cards and title like a normal user
  const c = document.getElementById('baia-cards-container');
  const titleEl = document.querySelector('.baia-select-title');
  const adminAll = document.getElementById('admin-all-bookings');
  const exportBar = document.getElementById('export-bar');
  const addBtn = document.getElementById('admin-add-booking-btn');

  if(c) { c.style.display = ''; renderBaiaCardsForAdmin(); }
  if(titleEl) titleEl.style.display = '';
  if(adminAll) adminAll.style.display = 'none';
  if(exportBar) exportBar.style.display = 'none';
  if(addBtn) addBtn.style.display = 'none';
}

function renderBaiaCardsForAdmin(){
  const c = document.getElementById('baia-cards-container');
  if(!c) return;
  c.style.display = '';
  const titleEl = document.querySelector('.baia-select-title');
  if(titleEl) titleEl.style.display = '';
  c.innerHTML = '';
  VEHICLES.forEach(v => {
    const card = document.createElement('button');
    card.className = 'baia-card';
    card.id = 'admin-baia-card-' + v.id;
    card.setAttribute('aria-label', 'Seleziona ' + v.name);
    const vSlots = generateSlotsForVehicle(v);
    const booked = currentBookings.filter(b => b.vehicle_id === v.id).length;
    const free = vSlots.length - booked;
    card.innerHTML = `
      <div class="baia-card-icon">${v.icon}</div>
      <div class="baia-card-body">
        <div class="baia-card-name">${v.name}</div>
        <div class="baia-card-slots">${free} slot liber${free===1?'o':'i'}</div>
      </div>
      <svg class="baia-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
    card.addEventListener('click', () => showInlineSlots(v));
    c.appendChild(card);
  });
  // Remove any previous inline slot panel
  const old = document.getElementById('admin-inline-slots');
  if(old) old.remove();
}

function showInlineSlots(vehicle){
  // Highlight selected card
  VEHICLES.forEach(v => {
    const card = document.getElementById('admin-baia-card-' + v.id);
    if(card) card.classList.toggle('baia-card--selected', v.id === vehicle.id);
  });

  // Remove previous slot panel
  const old = document.getElementById('admin-inline-slots');
  if(old) old.remove();

  // Build inline slot grid
  const panel = document.createElement('div');
  panel.id = 'admin-inline-slots';
  panel.className = 'admin-inline-slots';

  const vehicleSlots = generateSlotsForVehicle(vehicle);
  const booked = currentBookings.filter(b => b.vehicle_id === vehicle.id);
  const bookedSlots = booked.map(b => parseInt(b.slot_index));

  let slotsHTML = '';
  vehicleSlots.forEach((s, idx) => {
    if(!isBookableSlotIndex(vehicle.id, idx)) return;
    const slotBookings = booked.filter(b => parseInt(b.slot_index) === idx);
    const bookingCount = slotBookings.length;
    const maxAllowed = maxAllowedForSlot(vehicle.id, idx);
    const isTaken = !canBookSlot(vehicle.id, idx);
    const booking = slotBookings[0];
    const label = s.hour.toString().padStart(2,'0') + ':' + s.min.toString().padStart(2,'0');
    if(isTaken){
      const nome = booking?.nome || '–';
      const targa = booking?.targa || '';
      const dest = booking?.destinazione || '';
      slotsHTML += `<div class="inline-slot inline-slot--taken">
        <span class="inline-slot-time">${label}</span>
        <span class="inline-slot-name">${nome}</span>
        ${targa ? `<span class="inline-slot-detail">🚛 ${targa}</span>` : ''}
        ${dest ? `<span class="inline-slot-detail">📍 ${dest}</span>` : ''}
      </div>`;
    } else if(bookingCount > 0 && canBookSlot(vehicle.id, idx)){
      // Partially booked (only possible on Scatole)
      const nome = booking?.nome || '–';
      const targa = booking?.targa || '';
      slotsHTML += `<button class="inline-slot inline-slot--partial" data-idx="${idx}" data-vehicle="${vehicle.id}">
        <span class="inline-slot-time">${label}</span>
        <span class="inline-slot-free">+1 libero</span>
        <span class="inline-slot-detail">${nome}${targa?' · '+targa:''}</span>
      </button>`;
    } else {
      slotsHTML += `<button class="inline-slot inline-slot--free" data-idx="${idx}" data-vehicle="${vehicle.id}">
        <span class="inline-slot-time">${label}</span>
        <span class="inline-slot-free">Libero</span>
      </button>`;
    }
  });

  panel.innerHTML = `
    <div class="inline-slots-header">
      <span class="inline-slots-title">${vehicle.icon} Slot disponibili – ${vehicle.name}</span>
      <div class="inline-slots-btns">
        <button class="inline-slots-back" id="inline-slots-back-btn">← Indietro</button>
        <button class="inline-slots-home" id="inline-slots-home-btn">🏠 Home</button>
      </div>
    </div>
    <div class="inline-slots-grid">${slotsHTML}</div>`;

  // Attach click on free slots → open booking modal
  const c = document.getElementById('baia-cards-container');
  c.after(panel);

  panel.querySelector('#inline-slots-home-btn').addEventListener('click', () => {
    panel.remove();
    adminAddBookingMode = false;
    const baiaContainer = document.getElementById('baia-cards-container');
    const titleEl = document.querySelector('.baia-select-title');
    const adminAll = document.getElementById('admin-all-bookings');
    const exportBar = document.getElementById('export-bar');
    const addBtn = document.getElementById('admin-add-booking-btn');
    if(baiaContainer) baiaContainer.style.display = 'none';
    if(titleEl) titleEl.style.display = 'none';
    if(adminAll) adminAll.style.display = '';
    if(exportBar) exportBar.style.display = '';
    if(addBtn) addBtn.style.display = '';
    window.scrollTo({top: 0, behavior: 'smooth'});
  });

  panel.querySelector('#inline-slots-back-btn').addEventListener('click', () => {
    panel.remove();
    VEHICLES.forEach(v => {
      const card = document.getElementById('admin-baia-card-' + v.id);
      if(card) card.classList.remove('baia-card--selected');
    });
    adminAddBookingMode = false;
    // Hide baia cards, show bookings list + export bar
    const baiaContainer = document.getElementById('baia-cards-container');
    const titleEl = document.querySelector('.baia-select-title');
    const adminAll = document.getElementById('admin-all-bookings');
    const exportBar = document.getElementById('export-bar');
    const addBtn = document.getElementById('admin-add-booking-btn');
    if(baiaContainer) baiaContainer.style.display = 'none';
    if(titleEl) titleEl.style.display = 'none';
    if(adminAll) adminAll.style.display = '';
    if(exportBar) exportBar.style.display = '';
    if(addBtn) addBtn.style.display = '';
  });

  panel.querySelectorAll('.inline-slot--free, .inline-slot--partial').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedVehicle = vehicle.id;
      const vSlots2 = generateSlotsForVehicle(vehicle);
      openBookingModal(parseInt(btn.dataset.idx), vSlots2[parseInt(btn.dataset.idx)]);
    });
  });
}

// ===== USER EDIT MODAL =====
let userEditBookingId = null;
let userEditVehicleId = null;

function openUserEditModal(idx, slot, booking){
  userEditBookingId = booking.id;
  userEditVehicleId = booking.vehicle_id;
  const v = VEHICLES.find(v=>v.id===booking.vehicle_id)||{name:booking.vehicle_id};
  const timeStr = formatTime(slot.hour, slot.min);
  document.getElementById('user-edit-subtitle').textContent = `${timeStr} · ${v.name}`;

  // Slot selector: current + free slots for this vehicle/date
  const slotSel = document.getElementById('user-edit-slot');
  const occupied = (currentBookings||[])
    .filter(b => b.vehicle_id === booking.vehicle_id && b.id !== booking.id)
    .map(b => parseInt(b.slot_index));
  slotSel.innerHTML = '';
  SLOTS.forEach((s, i) => {
    if(!isBookableSlotIndex(booking.vehicle_id, i)) return;
    if(isPast(s.hour, s.min)) return;
    if(i !== idx && !canBookSlot(booking.vehicle_id, i)) return;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = formatTime(s.hour, s.min) + (i === idx ? ' (attuale)' : '');
    if(i === idx) opt.selected = true;
    slotSel.appendChild(opt);
  });

  document.getElementById('user-edit-nome').value = booking.nome || '';
  document.getElementById('user-edit-dest').value = booking.destinazione || '';
  document.getElementById('user-edit-targa').value = booking.targa || '';
  document.getElementById('user-edit-error').classList.remove('show');
  document.getElementById('user-edit-overlay').classList.add('visible');
  document.getElementById('user-edit-slot').focus();
}

function closeUserEdit(){
  document.getElementById('user-edit-overlay').classList.remove('visible');
  userEditBookingId = null;
}

function initUserEditModal(){
  document.getElementById('user-edit-close').addEventListener('click', closeUserEdit);
  document.getElementById('user-edit-cancel').addEventListener('click', closeUserEdit);
  document.getElementById('user-edit-overlay').addEventListener('click', e => {
    if(e.target === e.currentTarget) closeUserEdit();
  });

  document.getElementById('user-edit-save').addEventListener('click', async () => {
    const nome = document.getElementById('user-edit-nome').value.trim();
    const dest = document.getElementById('user-edit-dest').value.trim();
    const targa = document.getElementById('user-edit-targa').value.trim().toUpperCase();
    const newSlot = parseInt(document.getElementById('user-edit-slot').value);
    const errEl = document.getElementById('user-edit-error');
    if(!nome||!dest||!targa){errEl.textContent='Compila tutti i campi.';errEl.classList.add('show');return;}
    errEl.classList.remove('show');
    const btn = document.getElementById('user-edit-save');
    btn.disabled=true; btn.textContent='Salvataggio...';
    try{
      await updateBooking(userEditBookingId, nome, dest, targa, newSlot);
      toast('✓ Prenotazione modificata','success');
      closeUserEdit();
      loadAndRender();
      loadBookingsForStep1();
    }catch(e){
      errEl.textContent=e.message; errEl.classList.add('show');
    }finally{
      btn.disabled=false;
      btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Salva modifiche';
    }
  });

  document.getElementById('user-edit-delete').addEventListener('click', async () => {
    if(!confirm('Eliminare questa prenotazione?')) return;
    try{
      await deleteBooking(userEditBookingId);
      toast('✓ Prenotazione eliminata','success');
      closeUserEdit();
      loadAndRender();
      loadBookingsForStep1();
    }catch(e){ toast('Errore: '+e.message,'error'); }
  });
}

// ===== ADMIN EDIT/DELETE =====
let adminEditBookingId = null;

function initAdminEditModal(){
  const overlay = document.getElementById('admin-edit-overlay');
  document.getElementById('admin-edit-close').addEventListener('click', closeAdminEdit);
  document.getElementById('admin-edit-cancel').addEventListener('click', closeAdminEdit);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeAdminEdit(); });

  document.getElementById('admin-edit-save').addEventListener('click', async () => {
    const nome = document.getElementById('admin-edit-nome').value.trim();
    const dest = document.getElementById('admin-edit-dest').value.trim();
    const targa = document.getElementById('admin-edit-targa').value.trim().toUpperCase();
    const slotVal = document.getElementById('admin-edit-slot').value;
    const newSlotIdx = slotVal !== '' ? parseInt(slotVal) : null;
    const errEl = document.getElementById('admin-edit-error');
    if(!nome || !dest || !targa){ errEl.textContent='Compila tutti i campi.'; errEl.classList.add('show'); return; }
    errEl.classList.remove('show');
    const btn = document.getElementById('admin-edit-save');
    btn.disabled = true; btn.textContent = 'Salvataggio...';
    try {
      await updateBooking(adminEditBookingId, nome, dest, targa, newSlotIdx);
      toast('✓ Prenotazione modificata', 'success');
      closeAdminEdit();
      await loadAndRender();
      loadBookingsForStep1();
    } catch(e) {
      errEl.textContent = e.message; errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Salva modifiche';
    }
  });
}

function openAdminEdit(booking){
  adminEditBookingId = booking.id;
  const currentIdx = parseInt(booking.slot_index);
  const v = VEHICLES.find(v=>v.id===booking.vehicle_id)||{name:booking.vehicle_id};
  const timeStr = (!isNaN(currentIdx) && SLOTS[currentIdx]) ? formatTime(SLOTS[currentIdx].hour, SLOTS[currentIdx].min) : '';
  document.getElementById('admin-edit-title').textContent = 'Modifica prenotazione';
  document.getElementById('admin-edit-subtitle').textContent = `${timeStr} · ${v.name}`;

  // Populate slot dropdown: current slot + all FREE slots for this vehicle/date
  const slotSel = document.getElementById('admin-edit-slot');
  const occupiedByOthers = (currentBookings||[])
    .filter(b => b.vehicle_id === booking.vehicle_id && b.id !== booking.id)
    .map(b => parseInt(b.slot_index));
  slotSel.innerHTML = '';
  SLOTS.forEach((s, idx) => {
    if(!isBookableSlotIndex(booking.vehicle_id, idx)) return;
    if(idx !== currentIdx && occupiedByOthers.includes(idx)) return; // skip slots taken by others
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = formatTime(s.hour, s.min) + (idx === currentIdx ? ' (attuale)' : '');
    if(idx === currentIdx) opt.selected = true;
    slotSel.appendChild(opt);
  });

  document.getElementById('admin-edit-nome').value = booking.nome || '';
  document.getElementById('admin-edit-dest').value = booking.destinazione || '';
  document.getElementById('admin-edit-targa').value = booking.targa || '';
  document.getElementById('admin-edit-error').classList.remove('show');
  document.getElementById('admin-edit-overlay').classList.add('visible');
  document.getElementById('admin-edit-slot').focus();
}

function closeAdminEdit(){
  document.getElementById('admin-edit-overlay').classList.remove('visible');
  adminEditBookingId = null;
}

// Delegate click on admin list for edit/delete
document.addEventListener('click', async e => {
  const editBtn = e.target.closest('.admin-edit-btn');
  const delBtn = e.target.closest('.admin-delete-btn');
  if(editBtn){
    const id = editBtn.dataset.id;
    const booking = (currentBookings||[]).find(b=>String(b.id)===String(id));
    if(booking) openAdminEdit(booking);
  }
  if(delBtn){
    const id = delBtn.dataset.id;
    const booking = (currentBookings||[]).find(b=>String(b.id)===String(id));
    const name = booking?.nome || 'questa prenotazione';
    if(!confirm(`Eliminare la prenotazione di ${name}?`)) return;
    try {
      await deleteBooking(id);
      toast('✓ Prenotazione eliminata', 'success');
      await loadAndRender();
      loadBookingsForStep1();
    } catch(e){ toast('Errore: '+e.message,'error'); }
  }
});


// ===== USER SCHEDULE OVERVIEW =====
function renderUserSchedule(){
  const section = document.getElementById('user-schedule-overview');
  if(!section) return;
  // Hide for admin (they have the full panel)
  // Show for regular users
  section.style.display = isAdmin() ? 'none' : 'block';

  const all = currentBookings || [];

  VEHICLES.forEach(v => {
    const colId = v.id === 'baia-1' ? 'slots-fogli' : 'slots-scatole';
    const col = document.getElementById(colId);
    if(!col) return;
    const vBookings = all.filter(b => b.vehicle_id === v.id)
                        .sort((a,b) => parseInt(a.slot_index) - parseInt(b.slot_index));
    if(vBookings.length === 0){
      col.innerHTML = '<div class="schedule-empty">Nessuno slot occupato</div>';
      return;
    }
    col.innerHTML = vBookings.map(b => {
      const idx = parseInt(b.slot_index);
      const vSlots = generateSlotsForVehicle(v);
      const time = (!isNaN(idx) && vSlots[idx]) ? formatTime(vSlots[idx].hour, vSlots[idx].min) : '--:--';
      const isMine = isBookingMine(b);
      return `<div class="schedule-slot-pill${isMine ? ' mine' : ''}">
        ${time}${isMine ? ' <span class="schedule-mine-dot">●</span>' : ''}
      </div>`;
    }).join('');
  });
}

// ===== EXPORT =====
  (function(){
    const today = formatDate(new Date());
    // Default range: primo del mese corrente → oggi
    const firstOfMonth = today.slice(0,8)+'01';

    function initExportDates(){
      const ef = document.getElementById('export-from');
      const et = document.getElementById('export-to');
      if(ef && !ef.value) ef.value = firstOfMonth;
      if(et && !et.value) et.value = today;
    }

    async function fetchExportData(){
      const from = document.getElementById('export-from').value;
      const to   = document.getElementById('export-to').value;
      if(!from || !to){ toast('Seleziona un intervallo di date.','error-t'); return null; }
      if(from > to){ toast('La data di inizio deve essere precedente alla fine.','error-t'); return null; }
      let rows;
      if(offlineMode){
        rows = Object.values(offlineDb)
          .filter(b => b.data >= from && b.data <= to)
          .sort((a,b)=> a.data.localeCompare(b.data)||a.vehicle_id.localeCompare(b.vehicle_id)||a.slot_index-b.slot_index);
      } else {
        try{
          let query = sbClient.from('prenotazioni')
            .select('*').gte('data', from).lte('data', to)
            .order('data').order('vehicle_id').order('slot_index');
          // Non-admin: only own bookings
          if(!isAdmin()) query = query.eq('user_id', currentUser?.id||'');
          const { data: exportData, error: exportErr } = await query;
          if(exportErr) throw new Error(exportErr.message);
          rows = exportData;
        }catch(e){ toast('Errore scaricamento dati: '+e.message,'error-t'); return null; }
      }
      return { rows, from, to };
    }

    function slotToTime(idx){
      const s = SLOTS[idx];
      return s ? formatTime(s.hour, s.min) : '—';
    }
    function vehicleName(id){
      const v = VEHICLES.find(v=>v.id===id);
      return v ? v.name : id;
    }
    function formatDateITShort(s){
      if(!s) return '';
      const [y,mo,da] = s.split('-');
      return `${da}/${mo}/${y}`;
    }

    // ===== CSV =====
    document.getElementById('btn-export-csv').addEventListener('click', async function(){
      initExportDates();
      const btn = this;
      btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
      const result = await fetchExportData();
      if(!result){ btn.disabled=false; btn.innerHTML='CSV'; return; }
      const { rows, from, to } = result;

      const headers = ['Data','Giorno','Orario','Baia','Nome Trasportatore','Destinazione','Targa','Creato il'];
      const days = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
      const csvRows = [headers.join(';')];
      rows.forEach(r=>{
        const dt = new Date(r.data+'T00:00:00');
        const created = r.created_at ? new Date(r.created_at).toLocaleString('it-IT') : '';
        const row = [
          formatDateITShort(r.data),
          days[dt.getDay()],
          slotToTime(r.slot_index),
          vehicleName(r.vehicle_id),
          `"${(r.nome||'').replace(/"/g,'""')}"`,
          `"${(r.destinazione||'').replace(/"/g,'""')}"`,
          (r.targa||'').toUpperCase(),
          created
        ];
        csvRows.push(row.join(';'));
      });
      const bom = '\uFEFF'; // UTF-8 BOM for Excel compatibility
      const csv = bom + csvRows.join('\r\n');
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `prenotazioni_${from}_${to}.csv`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`✓ CSV esportato (${rows.length} righe)`,'success');
      btn.disabled=false;
      btn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> CSV';
    });

    // ===== EXCEL (XLSX via SheetJS) =====
    document.getElementById('btn-export-xlsx').addEventListener('click', async function(){
      initExportDates();
      const btn = this;
      btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
      const result = await fetchExportData();
      if(!result){ btn.disabled=false; btn.innerHTML='Excel'; return; }
      const { rows, from, to } = result;

      // Load SheetJS dynamically
      if(!window.XLSX){
        await new Promise((res,rej)=>{
          const s=document.createElement('script');
          s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
          s.onload=res; s.onerror=rej;
          document.head.appendChild(s);
        });
      }

      const days = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
      const wsData = [
        ['Data','Giorno','Orario','Baia','Nome Trasportatore','Destinazione','Targa','Creato il']
      ];
      rows.forEach(r=>{
        const dt = new Date(r.data+'T00:00:00');
        const created = r.created_at ? new Date(r.created_at).toLocaleString('it-IT') : '';
        wsData.push([
          formatDateITShort(r.data),
          days[dt.getDay()],
          slotToTime(r.slot_index),
          vehicleName(r.vehicle_id),
          r.nome||'',
          r.destinazione||'',
          (r.targa||'').toUpperCase(),
          created
        ]);
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Column widths
      ws['!cols'] = [
        {wch:12},{wch:12},{wch:10},{wch:18},
        {wch:22},{wch:16},{wch:28},{wch:20}
      ];

      // Header style (row 0)
      const range = XLSX.utils.decode_range(ws['!ref']);
      for(let c=range.s.c; c<=range.e.c; c++){
        const cell = ws[XLSX.utils.encode_cell({r:0,c})];
        if(cell){
          cell.s = {
            font:{bold:true,color:{rgb:'FFFFFF'}},
            fill:{fgColor:{rgb:'01696F'}},
            alignment:{horizontal:'center',vertical:'center'},
            border:{
              bottom:{style:'thin',color:{rgb:'CCCCCC'}}
            }
          };
        }
      }

      // Zebra rows
      for(let r=1; r<=rows.length; r++){
        for(let c=range.s.c; c<=range.e.c; c++){
          const cell = ws[XLSX.utils.encode_cell({r,c})];
          if(cell){
            cell.s = {
              fill:{fgColor:{rgb: r%2===0 ? 'F0EDE8' : 'FFFFFF'}},
              alignment:{vertical:'center'},
            };
          }
        }
      }

      // Summary sheet
      const vehicles = VEHICLES.map(v=>v.name);
      const summary = [['Riepilogo per mezzo'],['']];
      summary.push(['Mezzo','Totale prenotazioni']);
      VEHICLES.forEach(v=>{
        const count = rows.filter(r=>r.vehicle_id===v.id).length;
        summary.push([v.name, count]);
      });
      summary.push(['']);
      summary.push(['Periodo', `${formatDateITShort(from)} - ${formatDateITShort(to)}`]);
      summary.push(['Totale prenotazioni', rows.length]);
      const wsSummary = XLSX.utils.aoa_to_sheet(summary);
      wsSummary['!cols']=[{wch:22},{wch:22}];

      XLSX.utils.book_append_sheet(wb, ws, 'Prenotazioni');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Riepilogo');

      XLSX.writeFile(wb, `prenotazioni_${from}_${to}.xlsx`);
      toast(`✓ Excel esportato (${rows.length} righe)`,'success');
      btn.disabled=false;
      btn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v18M16 3v18M2 9h20M2 15h20"/></svg> Excel';
    });

    // Init on app start
    window._initExportDates = initExportDates;
  })();

})();
