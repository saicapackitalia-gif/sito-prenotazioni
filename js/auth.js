/* ===== AUTENTICAZIONE E IDENTITÀ =====
   L'unico login vero resta quello dell'amministratore (email/password via
   Supabase Auth). Chiunque altro (i trasportatori) non ha un account
   personale: si identifica scegliendo il proprio nome da un elenco fisso
   (TRASPORTATORI, in js/config.js) e inserendo la password di quel
   trasportatore (verificata sul database — vedi
   docs/TRASPORTATORI_SENZA_LOGIN.md — impedisce di scegliere semplicemente
   "sono il trasportatore X" senza conoscerne la password). L'identità
   scelta (solo l'id, non la password) viene ricordata in localStorage così
   le visite successive dallo stesso browser vengono "riconosciute" e non
   serve riselezionarla dal menu; la password viene invece tenuta solo in
   sessionStorage (si perde chiudendo la scheda/il browser) così non resta
   salvata a lungo termine sul dispositivo.
   Caricato con un normale <script> (non un modulo) dopo
   js/supabase-client.js e prima dello script principale: le dichiarazioni
   top-level restano condivise. */

let offlineMode=false;
let offlineDb={};
let currentUser=null; // {id, email} — SOLO per l'admin, ora

// Trasportatore corrente (oggetto da TRASPORTATORI, o null se non ancora
// scelto/verificato su questo browser).
let currentTrasportatore = null;
// Password verificata per currentTrasportatore, tenuta solo in memoria +
// sessionStorage (mai in localStorage): serve ad ogni prenotazione/modifica/
// cancellazione, che il database verifica di nuovo comunque.
let currentTrasportatorePassword = null;

function loadSavedTrasportatore(){
  try{
    const id = localStorage.getItem('trasportatoreId');
    const t = TRASPORTATORI.find(t => t.id === id) || null;
    if(!t) return null;
    const pw = sessionStorage.getItem('trasportatorePw');
    return pw ? { t, pw } : null; // senza password valida per questa sessione, va riverificato
  }catch(e){ return null; }
}
function saveTrasportatore(t, password){
  currentTrasportatore = t || null;
  currentTrasportatorePassword = t ? (password||null) : null;
  try{
    if(t) localStorage.setItem('trasportatoreId', t.id);
    else localStorage.removeItem('trasportatoreId');
    if(t && password) sessionStorage.setItem('trasportatorePw', password);
    else sessionStorage.removeItem('trasportatorePw');
  }catch(e){ /* storage non disponibile: la scelta vale solo per questa visita */ }
}

function isBookingMine(b){
  if(currentUser) return b.user_id === currentUser.id; // storico: vecchi account registrati
  if(currentTrasportatore) return !b.user_id && b.nome && b.nome.trim().toLowerCase() === currentTrasportatore.nome.trim().toLowerCase();
  return false;
}

// Auth (solo per l'amministratore: non esiste più una registrazione)
async function signIn(email, password){
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
  if(error) throw new Error(error.message);
  return data;
}
async function signOut(){
  await sbClient.auth.signOut();
  currentUser = null;
}
async function getUser(){
  const { data: { user }, error } = await sbClient.auth.getUser();
  if(error) throw new Error(error.message);
  return user;
}
