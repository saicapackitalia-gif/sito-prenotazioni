/* ===== AUTENTICAZIONE E IDENTITÀ =====
   L'unico login vero resta quello dell'amministratore (email/password via
   Supabase Auth). Chiunque altro (i trasportatori) non ha più un account:
   si identifica scegliendo il proprio nome da un elenco fisso
   (TRASPORTATORI, in js/config.js) invece di loggarsi o compilare un
   modulo da ospite. La scelta viene ricordata in localStorage così le
   visite successive dallo stesso browser vengono "riconosciute"
   automaticamente (resta comunque modificabile in qualsiasi momento).
   Caricato con un normale <script> (non un modulo) dopo
   js/supabase-client.js e prima dello script principale: le dichiarazioni
   top-level restano condivise. */

let offlineMode=false;
let offlineDb={};
let currentUser=null; // {id, email} — SOLO per l'admin, ora

// Trasportatore corrente (oggetto da TRASPORTATORI, o null se non ancora
// scelto su questo browser). Non è un'autenticazione vera: chiunque può
// scegliere qualunque nome dall'elenco — è una semplificazione scelta
// consapevolmente, non un controllo di sicurezza.
let currentTrasportatore = null;

function loadSavedTrasportatore(){
  try{
    const id = localStorage.getItem('trasportatoreId');
    return TRASPORTATORI.find(t => t.id === id) || null;
  }catch(e){ return null; }
}
function saveTrasportatore(t){
  currentTrasportatore = t || null;
  try{
    if(t) localStorage.setItem('trasportatoreId', t.id);
    else localStorage.removeItem('trasportatoreId');
  }catch(e){ /* localStorage non disponibile: la scelta vale solo per questa visita */ }
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
