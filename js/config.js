/* ===== CONFIGURAZIONE APPLICAZIONE =====
   Dati fissi (costanti) usati dallo script principale: baie/mezzi, admin,
   credenziali Supabase di produzione. Caricato PRIMA dello script
   principale con un normale <script> (non un modulo), quindi queste
   dichiarazioni "top-level" sono visibili per nome anche nel file
   successivo, esattamente come lo erano quando erano scritte nello stesso
   file — nessun comportamento cambiato, solo spostate qui per isolarle.

   ATTENZIONE SICUREZZA (nota già presente nel progetto, non introdotta da
   questo spostamento): SUPABASE_SERVICE_ROLE_KEY è una chiave che bypassa
   le regole di sicurezza (RLS) del database ed è incorporata qui lato
   client per scelta accettata in precedenza, per permettere alcune
   operazioni admin (es. cancellare prenotazioni di altri utenti). È un
   compromesso noto, da rivedere in futuro con policy RLS più granulari o
   un endpoint backend — questo file la isola per renderla facile da
   individuare, ma NON la rimuove né ne cambia l'uso. */

// Baie di carico/scarico e relativi parametri (durata slot, orari, capacità,
// massimo di slot consecutivi per lo stesso trasportatore — nessuna voce
// "maxConsecutiveSlots" vuol dire nessuna regola su quella baia, es. Depositi).
// Devono restare sincronizzati a mano con la tabella "mezzi" su Supabase:
// vedi docs/PIANO_REFACTORING.md.
const VEHICLES = [
  {id:'baia-1', name:'Fogli',    icon:'📄', slotStep:45, startHour:6,  endHour:20, maxPerSlot:1, durataSlot:45, maxConsecutiveSlots:1},
  {id:'baia-2', name:'Scatole',  icon:'📦', slotStep:30, startHour:6,  endHour:20, maxPerSlot:2, durataSlot:30, maxConsecutiveSlots:2},
  {id:'baia-3', name:'Depositi', icon:'🏭', slotStep:30, startHour:6,  endHour:10, maxPerSlot:1, durataSlot:30},
];

// Elenco fisso dei trasportatori: sostituisce login/account per chiunque non
// sia admin. Scelto da un menu a tendina invece di testo libero, così il
// sito riconosce automaticamente "chi" sta prenotando, per applicare la
// regola sui slot consecutivi e la riserva della baia Depositi a ZINI.
// Per aggiungere/rimuovere un trasportatore, modificare questo elenco.
const TRASPORTATORI = [
  {id:'zini',          nome:'Zini', zini:true},
  {id:'tavola',        nome:'Tavola'},
  {id:'cmf',           nome:'CMF'},
  {id:'evolution',     nome:'Soc. Coop. Evolution'},
  {id:'colombo',       nome:'Autotrasporti Colombo'},
  {id:'world-express', nome:'World Express'},
];

// Identità dell'amministratore (usata per i controlli isAdmin()/esenzioni).
const ADMIN_EMAIL_CONST = 'giacomo.rigamonti@saica.com';
const ADMIN_UID = 'f3bb2b25-e625-4e9d-b902-bbc8e6ea8ff1';

// Chiave service_role: bypassa le RLS del database, usata SOLO per le
// operazioni admin che devono agire su prenotazioni di altri utenti
// (es. cancellazione). Vedi nota di sicurezza sopra.
const SB_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptaHd4cGd3YWtycW1ud2VmcXJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU0MDA5NywiZXhwIjoyMDk3MTE2MDk3fQ.vHoh21d1itwUP7apg8QMwKVD_dxyJdct8TUgnmA-K_o';

// URL del progetto Supabase e chiave pubblica "anon" (soggetta a RLS).
// Sono i valori di default usati all'avvio; la pagina di setup permette
// comunque di sovrascriverli a runtime (restano variabili `let` nello
// script principale) — questi restano solo i valori di partenza.
const SUPABASE_URL_DEFAULT = 'https://jmhwxpgwakrqmnwefqrs.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptaHd4cGd3YWtycW1ud2VmcXJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDAwOTcsImV4cCI6MjA5NzExNjA5N30.6JTiaa7UADSlUTd8wfJbumRpROWJTq7WBSlE9EpchZU';
