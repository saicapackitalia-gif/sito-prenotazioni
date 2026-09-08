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
   modulo) dopo js/auth.js e prima dello script principale.

   IMPORTANTE (sicurezza): dal lato database, la tabella "prenotazioni"
   ora è leggibile per intero (con nome/destinazione/targa/telefono) solo
   dal proprietario della riga o dall'admin — vedi la policy
   "select_own_or_admin" e la vista pubblica "prenotazioni_disponibilita"
   (solo id/vehicle_id/data/slot_index/user_id, nessun dato personale),
   applicate direttamente sul database Supabase (non tracciate in questo
   repo). refreshBookingsForDate() qui sotto rispecchia lato client questa
   stessa separazione: prende gli slot occupati/liberi di TUTTI dalla vista
   pubblica, e arricchisce con i dettagli completi solo le righe che
   l'utente corrente ha il diritto di vedere per intero (le proprie,
   quelle dell'ospite tramite i codici salvati nel browser, o tutte se
   admin). Va usata al posto di leggere "prenotazioni" per intero ogni
   volta che serve lo stato di TUTTE le prenotazioni del giorno (non solo
   le proprie) — vedi docs/PIANO_REFACTORING.md. */

async function fetchBookings(date){
  if(offlineMode){
    return Object.entries(offlineDb)
      .filter(([k]) => k.includes('_'+date+'_'))
      .map(([k,v]) => { const p=k.split('_'); return {...v, vehicle_id:p[0], data:date, slot_index:parseInt(p[2])}; });
  }
  const { data, error } = await sbClient.from('prenotazioni_disponibilita').select('*').eq('data', date);
  if(error) throw new Error(error.message);
  return data;
}

// Stato completo del giorno (occupato/libero per tutti + dettagli completi
// solo dove l'utente corrente ne ha diritto). Unico punto usato da
// loadAndRender(), loadBookingsForStep1() e dal pre-check di createBooking(),
// così un'eventuale correzione futura va fatta in un solo posto.
async function refreshBookingsForDate(date){
  if(offlineMode){
    return fetchBookings(date).then(rows => { rows.forEach(b=>{ b.mine = isBookingMine(b); }); return rows; });
  }
  // 1) Disponibilità di TUTTI (nessun dato personale) — sempre leggibile.
  const { data: availability, error: availErr } = await sbClient.from('prenotazioni_disponibilita').select('*').eq('data', date);
  if(availErr) throw new Error(availErr.message);
  const byId = {};
  availability.forEach(r => { byId[r.id] = r; });

  // 2) Dettagli completi delle sole righe che l'utente corrente può vedere
  //    per intero. Se questa parte fallisce, gli slot restano comunque
  //    corretti come occupati/liberi (arricchimento, non requisito).
  try{
    let fullRows = [];
    if(isAdmin()){
      const { data, error } = await adminClient.from('prenotazioni').select('*').eq('data', date);
      if(!error && data) fullRows = data;
    } else if(currentUser){
      const { data, error } = await sbClient.from('prenotazioni').select('*').eq('data', date).eq('user_id', currentUser.id);
      if(!error && data) fullRows = data;
    } else if(isGuest){
      const tokens = getGuestTokens();
      if(tokens.length){
        const { data, error } = await sbClient.rpc('guest_get_bookings_by_tokens', { p_tokens: tokens, p_data: date });
        if(!error && data) fullRows = data;
      }
    }
    fullRows.forEach(r => { byId[r.id] = r; });
  }catch(e){ /* dettagli non essenziali: la griglia resta comunque corretta */ }

  const merged = Object.values(byId);
  merged.forEach(b => { b.mine = isBookingMine(b); });
  return merged;
}
async function createBooking(vehicle_id, data, slot_index, nome, destinazione, targa, guestInfo){
  // Re-fetch fresh bookings for accurate cross-baia check
  try {
    currentBookings = await refreshBookingsForDate(data);
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
