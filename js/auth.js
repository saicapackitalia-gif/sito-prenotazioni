/* ===== AUTENTICAZIONE E IDENTITÀ UTENTE =====
   Stato su chi sta usando l'app (utente loggato, ospite, modalità demo
   offline) e le funzioni che parlano con l'autenticazione di Supabase.
   Caricato con un normale <script> (non un modulo) dopo
   js/supabase-client.js e prima dello script principale: le dichiarazioni
   top-level restano condivise. Comportamento invariato: codice spostato
   senza modifiche. */

let offlineMode=false;
let offlineDb={};
let currentUser=null; // {id, email}
let isGuest=false;
// Guest bookings have no user_id (per DB schema), so "mine" is tracked via the
// management_token returned on insert, saved locally in this browser only.
function getGuestTokens(){
  try{ return JSON.parse(localStorage.getItem('guestTokens')||'[]'); }catch(e){ return []; }
}
function saveGuestToken(token){
  if(!token) return;
  const list = getGuestTokens();
  if(!list.includes(token)){ list.push(token); localStorage.setItem('guestTokens', JSON.stringify(list)); }
}
function isBookingMine(b){
  if(currentUser) return b.user_id === currentUser.id;
  if(isGuest) return !b.user_id && b.management_token && getGuestTokens().includes(b.management_token);
  return false;
}

// Auth
async function signUp(email, password, nome, reparto){
  const { data, error } = await sbClient.auth.signUp({
    email, password,
    options: { data: { nome, reparto } }
  });
  if(error) throw new Error(error.message);
  return data;
}
async function signIn(email, password){
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
  if(error) throw new Error(error.message);
  return data;
}
async function signOut(){
  await sbClient.auth.signOut();
  currentUser = null;
  isGuest = false;
}
async function getUser(){
  const { data: { user }, error } = await sbClient.auth.getUser();
  if(error) throw new Error(error.message);
  return user;
}
