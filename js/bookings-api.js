/* ===== ACCESSO ALLE PRENOTAZIONI (tabella "prenotazioni" su Supabase) =====
   Funzioni di lettura/scrittura delle prenotazioni. createBooking incorpora
   anche i controlli di business già in uso (baia Depositi riservata a ZINI,
   slot consecutivi, capacità condivisa tra baie): questi controlli
   richiamano funzioni definite più avanti nello script principale
   (isAdmin, hasConsecutiveConflict, canBookSlot, slotTimeRange,
   totalBusyInRange, TOTAL_CARRELLISTI, currentBookings) — funziona perché
   tutti gli script della pagina condividono lo stesso ambiente globale ed
   eseguono per intero prima che un utente possa premere un pulsante che
   chiama queste funzioni async. Caricato con un normale <script> (non un
   modulo) dopo js/auth.js e prima dello script principale. Comportamento
   invariato: codice spostato senza modifiche. */

async function fetchBookings(date){
  if(offlineMode){
    return Object.entries(offlineDb)
      .filter(([k]) => k.includes('_'+date+'_'))
      .map(([k,v]) => { const p=k.split('_'); return {...v, vehicle_id:p[0], data:date, slot_index:parseInt(p[2])}; });
  }
  const { data, error } = await sbClient.from('prenotazioni').select('*').eq('data', date);
  if(error) throw new Error(error.message);
  return data;
}
async function createBooking(vehicle_id, data, slot_index, nome, destinazione, targa, guestInfo){
  // Re-fetch fresh bookings for accurate cross-baia check
  try {
    // using persistent adminClient (service_role)
    const { data: fresh, error } = await adminClient.from('prenotazioni').select('*').eq('data', data);
    if(!error && fresh) {
      currentBookings = fresh;
      currentBookings.forEach(b=>{ b.mine = isBookingMine(b); });
    }
  } catch(e) { /* use existing currentBookings if fetch fails */ }

  const isZini = (currentUser?.user_metadata?.reparto || currentUser?.reparto || '').toLowerCase().includes('zini');
  if(vehicle_id==='baia-3' && !isAdmin() && !isZini){ throw new Error('La baia Depositi è riservata a ZINI Autotrasporti Srl.'); }
  if(hasConsecutiveConflict(vehicle_id, slot_index)){
    throw new Error('Non puoi prenotare due slot consecutivi sulla stessa baia.');
  }
  // Pre-check: cross-baia carrellista availability
  if(!canBookSlot(vehicle_id, slot_index)){
    const target = slotTimeRange(vehicle_id, slot_index);
    const busy = target ? totalBusyInRange(target.start, target.end) : TOTAL_CARRELLISTI;
    if(busy >= TOTAL_CARRELLISTI){
      throw new Error('Slot non disponibile: entrambi i carrellisti sono già impegnati in questo orario.');
    }
    throw new Error('Slot già occupato.');
  }
  if(offlineMode){
    const k=`${vehicle_id}_${data}_${slot_index}_${Date.now()}`;
    const id='offline-'+Date.now();
    offlineDb[k]={id,vehicle_id,data,slot_index,nome,destinazione,targa,user_id:'offline'};
    return [offlineDb[k]];
  }
  const insertRow = guestInfo
    ? { user_id: null, vehicle_id, data, slot_index, nome, destinazione, targa, telefono: guestInfo.telefono||null, azienda: guestInfo.azienda||null }
    : { user_id: currentUser.id, vehicle_id, data, slot_index, nome, destinazione, targa };
  const { data: res, error } = await sbClient.from('prenotazioni').insert(insertRow).select();
  if(error) throw new Error(error.code==='23505'?'Slot già occupato.':error.message);
  return res;
}
async function deleteBooking(id){
  if(offlineMode){
    const k=Object.keys(offlineDb).find(k=>offlineDb[k].id===id);
    if(k) delete offlineDb[k]; return;
  }
  // Always use adminClient for delete (bypasses RLS for any booking)
  // using persistent adminClient (service_role)
  const { error, count } = await adminClient
    .from('prenotazioni')
    .delete({ count: 'exact' })
    .eq('id', String(id));
  if(error){
    console.error('[deleteBooking] error:', error);
    throw new Error(error.message);
  }
  if(count === 0){
    console.warn('[deleteBooking] 0 rows deleted for id:', id);
    // Try fallback: delete by user sbClient in case it is own booking
    const { error: e2 } = await sbClient.from('prenotazioni').delete().eq('id', String(id));
    if(e2) throw new Error(e2.message);
  }
}
async function updateBooking(id, nome, destinazione, targa, slot_index){
  // using persistent adminClient (service_role)
  const patch = { nome, destinazione, targa };
  if(slot_index !== undefined && slot_index !== null) patch.slot_index = parseInt(slot_index);
  const { error } = await adminClient.from('prenotazioni').update(patch).eq('id', String(id));
  if(error){
    console.error('[updateBooking] error:', error);
    throw new Error(error.code==='23505'?'Slot già occupato. Scegline un altro.':error.message);
  }
}
