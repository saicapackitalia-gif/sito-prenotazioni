/* ===== CLIENT SUPABASE =====
   Stato di connessione (URL/chiave correnti, i due client) e funzione che
   li inizializza. Caricato con un normale <script> (non un modulo) dopo
   js/config.js e prima dello script principale: le dichiarazioni
   top-level restano condivise, quindi il resto del codice continua a
   leggere/scrivere queste stesse variabili come prima, solo che ora sono
   dichiarate qui invece che dentro lo script principale. Comportamento
   invariato: codice spostato senza modifiche. */

// SB_URL/SB_KEY partono vuoti e vengono impostati all'avvio (INIT, nello
// script principale) o dalla schermata di setup / modalità offline.
let SB_URL='', SB_KEY='';
let sbClient = null;
let adminClient = null; // service_role client, bypasses RLS

function initSupabaseClient(){
  sbClient = supabase.createClient(SB_URL, SB_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
  // Single persistent admin client — created once, reused everywhere
  adminClient = supabase.createClient(SB_URL, SB_SVC, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      storageKey: 'sb-admin-session'
    }
  });
}
