/* ===== CONFIGURAZIONE APPLICAZIONE =====
   Dati fissi (costanti) usati dallo script principale: baie/mezzi, admin,
   credenziali Supabase di produzione. Caricato PRIMA dello script
   principale con un normale <script> (non un modulo), quindi queste
   dichiarazioni "top-level" sono visibili per nome anche nel file
   successivo, esattamente come lo erano quando erano scritte nello stesso
   file — nessun comportamento cambiato, solo spostate qui per isolarle.

   SICUREZZA: qui era incorporata in precedenza anche la chiave
   service_role di Supabase (SUPABASE_SERVICE_ROLE_KEY / SB_SVC), che
   bypassa completamente le regole RLS del database. Essendo servita al
   browser di chiunque visitasse il sito (repository pubblico su GitHub
   Pages), chiunque aprisse il sorgente della pagina aveva accesso
   completo in lettura/scrittura/cancellazione a tutte le prenotazioni.
   Rimossa: vedi js/supabase-client.js e docs/CORREZIONE_SERVICE_ROLE.md
   per come le operazioni admin che la usavano sono state rifatte senza
   di essa. La chiave stessa, essendo già stata pubblicamente esposta, va
   comunque considerata compromessa e rigenerata dal pannello Supabase
   (Project Settings → API) indipendentemente da questa modifica al
   codice — la rimozione dal codice non invalida una chiave già trapelata. */

// Baie di carico/scarico e relativi parametri (durata slot, orari, capacità,
// massimo di slot consecutivi per lo stesso trasportatore — nessuna voce
// "maxConsecutiveSlots" vuol dire nessuna regola su quella baia, es. Depositi;
// minAnticipoMinuti: anticipo minimo richiesto per prenotare uno slot,
// nessun valore = nessuna regola, es. Depositi — l'admin è sempre esente).
// Devono restare sincronizzati a mano con la tabella "mezzi" su Supabase:
// vedi docs/PIANO_REFACTORING.md.
const VEHICLES = [
  {id:'baia-1', name:'Fogli',    icon:'📄', slotStep:45, startHour:6,  endHour:20, maxPerSlot:1, durataSlot:45, maxConsecutiveSlots:2, minAnticipoMinuti:46},
  {id:'baia-2', name:'Scatole',  icon:'📦', slotStep:30, startHour:6,  endHour:20, maxPerSlot:2, durataSlot:30, maxConsecutiveSlots:2, minAnticipoMinuti:31},
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
  {id:'vitrans',        nome:'Vitrans'},
];

// Identità dell'amministratore (usata per i controlli isAdmin()/esenzioni).
const ADMIN_EMAIL_CONST = 'giacomo.rigamonti@saica.com';
const ADMIN_UID = 'f3bb2b25-e625-4e9d-b902-bbc8e6ea8ff1';

// URL del progetto Supabase e chiave pubblica (soggetta a RLS). Sono i
// valori di default usati all'avvio; la pagina di setup permette comunque
// di sovrascriverli a runtime (restano variabili `let` nello script
// principale) — questi restano solo i valori di partenza.
//
// SICUREZZA: la chiave sotto è la "publishable key" del sistema NUOVO di
// Supabase (prefisso sb_publishable_), non la vecchia "anon" (JWT lungo
// che iniziava con eyJ...). Sostituita in seguito alla rimozione della
// service_role (vedi sopra e docs/CORREZIONE_SERVICE_ROLE.md): la vecchia
// coppia anon/service_role (le "Legacy API keys" su Supabase) va
// disabilitata dal pannello Supabase DOPO che questa modifica sarà online,
// per invalidare definitivamente anche la vecchia service_role già
// trapelata pubblicamente.
const SUPABASE_URL_DEFAULT = 'https://jmhwxpgwakrqmnwefqrs.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'sb_publishable_--odAgbAY5o48ExhsBlVTA_vNNWAzpD';
