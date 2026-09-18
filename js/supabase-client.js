/* ===== CLIENT SUPABASE =====
   Stato di connessione (URL/chiave correnti, il client) e funzione che lo
   inizializza. Caricato con un normale <script> (non un modulo) dopo
   js/config.js e prima dello script principale: le dichiarazioni top-level
   restano condivise, quindi il resto del codice continua a leggere/
   scrivere queste stesse variabili come prima, solo che ora sono
   dichiarate qui invece che dentro lo script principale.

   SICUREZZA: esisteva in precedenza un secondo client ("adminClient")
   creato con la chiave service_role, che bypassa completamente le RLS del
   database — incorporata qui lato client, era leggibile da chiunque
   aprisse il sorgente della pagina (view-source / F12), dando accesso
   completo in lettura/scrittura/cancellazione a TUTTE le prenotazioni di
   TUTTI, non solo all'admin. Rimosso: le operazioni che richiedevano
   service_role (update/delete di prenotazioni altrui da parte dell'admin)
   passano ora dalle funzioni admin_update_booking/admin_delete_booking
   (RPC, SECURITY DEFINER) che verificano server-side che chi chiama sia
   davvero autenticato come l'admin (auth.uid()), invece di bypassare le
   RLS incondizionatamente per chiunque conosca la chiave — vedi
   docs/CORREZIONE_SERVICE_ROLE.md. La lettura di tutte le prenotazioni da
   parte dell'admin non necessitava di service_role: la policy RLS
   "select_own_or_admin" la permette già con la sola chiave anon. */

// SB_URL/SB_KEY partono vuoti e vengono impostati all'avvio (INIT, nello
// script principale) o dalla schermata di setup / modalità offline.
let SB_URL='', SB_KEY='';
let sbClient = null;

function initSupabaseClient(){
  sbClient = supabase.createClient(SB_URL, SB_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
}
