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
    } else if(currentTrasportatore && currentTrasportatorePassword){
      const { data, error } = await sbClient.rpc('get_bookings_by_trasportatore', { p_nome: currentTrasportatore.nome, p_data: date, p_password: currentTrasportatorePassword });
      if(!error && data) fullRows = data;
    }
    fullRows.forEach(r => { byId[r.id] = r; });
  }catch(e){ /* dettagli non essenziali: la griglia resta comunque corretta */ }

  const merged = Object.values(byId);
  merged.forEach(b => { b.mine = isBookingMine(b); });
  return merged;
}
// nomeTrasportatore: il nome scelto dal menu a tendina (obbligatorio, sia
// che a sceglierlo sia l'admin per conto di qualcuno, sia il trasportatore
// stesso). Non esistono più account per i trasportatori: ogni nuova
// prenotazione ha sempre user_id null.
async function createBooking(vehicle_id, data, slot_index, nomeTrasportatore, destinazione, targa){
  // Re-fetch fresh bookings for accurate cross-baia check
  try {
    currentBookings = await refreshBookingsForDate(data);
  } catch(e) { /* use existing currentBookings if fetch fails */ }

  const trasportatoreScelto = TRASPORTATORI.find(t => t.nome === nomeTrasportatore);
  const isZini = !!trasportatoreScelto?.zini;
  if(vehicle_id==='baia-3' && !isAdmin() && !isZini){ throw new Error('La baia Depositi è riservata a ZINI Autotrasporti Srl.'); }
  if(hasConsecutiveConflict(vehicle_id, slot_index, nomeTrasportatore)){
    throw new Error('Hai raggiunto il numero massimo di slot consecutivi su questa baia.');
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
    offlineDb[k]={id,vehicle_id,data,slot_index,nome:nomeTrasportatore,destinazione,targa,user_id:null};
    return [offlineDb[k]];
  }
  // create_prenotazione (RPC) inserisce e restituisce la riga in un solo
  // passaggio: chi prenota senza account (ora il caso normale) può
  // inserire ma non potrebbe rileggere la riga appena creata con una
  // semplice insert().select(), perché non è il proprietario di alcun
  // account — vedi docs/CORREZIONE_PRIVACY_PRENOTAZIONI.md. Richiede anche
  // la password del trasportatore scelto (tranne per l'admin, già
  // autenticato con un vero login) — vedi docs/TRASPORTATORI_SENZA_LOGIN.md.
  const { data: res, error } = await sbClient.rpc('create_prenotazione', {
    p_vehicle_id: vehicle_id, p_data: data, p_slot_index: slot_index,
    p_nome: nomeTrasportatore, p_destinazione: destinazione, p_targa: targa,
    p_password: isAdmin() ? null : currentTrasportatorePassword
  });
  if(error) throw new Error(error.code==='23505'?'Slot già occupato.':error.message);
  return [res];
}
// Cancellazione: l'admin bypassa la sicurezza con la chiave service_role
// (come sempre); il trasportatore passa dalla funzione protetta da
// password, che verifica anche che la prenotazione sia davvero la sua.
async function deleteBooking(id, nomeTrasportatore){
  if(offlineMode){
    const k=Object.keys(offlineDb).find(k=>offlineDb[k].id===id);
    if(k) delete offlineDb[k]; return;
  }
  if(isAdmin()){
    // using persistent adminClient (service_role)
    const { error, count } = await adminClient
      .from('prenotazioni')
      .delete({ count: 'exact' })
      .eq('id', String(id));
    if(error){
      console.error('[deleteBooking] error:', error);
      throw new Error(error.message);
    }
    if(count === 0) console.warn('[deleteBooking] 0 rows deleted for id:', id);
    return;
  }
  const { error } = await sbClient.rpc('trasportatore_delete_booking', {
    p_id: id, p_nome: nomeTrasportatore, p_password: currentTrasportatorePassword
  });
  if(error) throw new Error(error.message);
}
async function updateBooking(id, nome, destinazione, targa, slot_index){
  if(isAdmin()){
    // using persistent adminClient (service_role)
    const patch = { nome, destinazione, targa };
    if(slot_index !== undefined && slot_index !== null) patch.slot_index = parseInt(slot_index);
    const { error } = await adminClient.from('prenotazioni').update(patch).eq('id', String(id));
    if(error){
      console.error('[updateBooking] error:', error);
      throw new Error(error.code==='23505'?'Slot già occupato. Scegline un altro.':error.message);
    }
    return;
  }
  const { error } = await sbClient.rpc('trasportatore_update_booking', {
    p_id: id, p_nome: nome, p_password: currentTrasportatorePassword,
    p_destinazione: destinazione, p_targa: targa,
    p_slot_index: (slot_index !== undefined && slot_index !== null) ? parseInt(slot_index) : null
  });
  if(error) throw new Error(error.message.includes('23505')?'Slot già occupato. Scegline un altro.':error.message);
}
