# Correzione: esposizione dei dati di altre prenotazioni

## Cosa è stato verificato e trovato

Su richiesta esplicita, ho verificato con test funzionali reali (non solo
lettura del codice) due regole di business:

1. **Slot consecutivi bloccati per utenti loggati** (Fogli/Scatole) → ✅
   confermato funzionante, nessuna modifica necessaria.
2. **Un account vede le prenotazioni altrui solo come "Occupato"** → ✅
   confermato che l'interfaccia si comporta così, MA ho trovato che
   **il dato completo (nome, destinazione, targa e — per gli ospiti —
   telefono) arrivava comunque nel browser di chiunque fosse loggato**,
   anche se la schermata non lo mostrava. Chiunque avesse aperto gli
   strumenti sviluppatore del browser (F12) poteva leggere i dettagli di
   tutte le prenotazioni del giorno, non solo le proprie.

Approfondendo la causa a livello di database ho trovato che il problema era
**più ampio di quanto sembrasse dal solo comportamento dell'app**: la
policy di sicurezza (RLS) della tabella `prenotazioni` permetteva la
lettura completa (`SELECT`) a **chiunque avesse la chiave pubblica del
sito**, anche senza essere loggato — cioè un accesso diretto al database
(bypassando completamente il sito) avrebbe potuto scaricare l'intera
tabella con tutti i dati di tutte le prenotazioni, presenti e passate.
Questo comportamento esisteva già prima di qualsiasi mia modifica
precedente (verificato sulla versione originale del progetto).

## Correzione applicata

### Lato database (Supabase, applicata direttamente — non è nel repo)

Non essendoci in questo repository file di migrazione tracciati (le
modifiche al database sono sempre state fatte direttamente su Supabase,
come da impostazione del progetto), ho applicato la correzione
direttamente sul progetto Supabase live, con la migrazione
`restrict_prenotazioni_select_add_public_view_and_guest_rpc`:

1. **Nuova vista `prenotazioni_disponibilita`**: espone solo
   `id, vehicle_id, data, slot_index, user_id, created_at` — nessun nome,
   destinazione, targa o telefono. Usata da chiunque (anche senza login)
   per sapere quali slot sono occupati/liberi e per i calcoli di capacità
   condivisa, senza esporre dati personali.
2. **Nuova funzione `guest_get_bookings_by_tokens(tokens[], data)`**:
   permette a un ospite (senza account) di recuperare le PROPRIE
   prenotazioni del giorno tramite i codici salvati nel suo browser, senza
   bisogno di leggere l'intera tabella.
3. **Policy di lettura sulla tabella completa ristretta**: un utente
   loggato vede per intero solo le proprie righe; l'admin le vede tutte;
   un ospite non ha più accesso diretto alla tabella completa (usa la RPC
   sopra per le proprie prenotazioni).
4. **Punto critico verificato prima di procedere**: le funzioni che
   applicano davvero le regole sul database (capacità condivisa tra baie,
   slot non consecutivi, limite prenotazioni ospiti) leggevano la tabella
   con gli stessi permessi di chi sta prenotando — quindi restringere la
   lettura, da sola, le avrebbe rotte silenziosamente per chiunque non
   fosse admin (non avrebbero più visto le prenotazioni altrui per
   contarle). Le ho rese `SECURITY DEFINER` (eseguono con i permessi del
   proprietario del database, che non è soggetto a queste restrizioni),
   così continuano a vedere tutto il necessario per i controlli, mentre la
   lettura diretta da parte dei client resta ristretta.

**Verifica fatta direttamente sul database prima di toccare il sito**
(simulando i vari ruoli con cui gira davvero l'app):
- un visitatore anonimo non vede più nulla dalla tabella completa (0
  righe), ma vede tutti gli slot occupati/liberi dalla nuova vista;
- un utente normale vede solo le proprie prenotazioni (contate: le sue,
  non tutte);
- l'admin vede tutto, come prima;
- la nuova funzione per gli ospiti restituisce solo la prenotazione giusta
  per il codice giusto, e nessun'altra;
- **prova di non-regressione critica**: ho simulato due account diversi
  che provano a prenotare lo stesso slot già pieno — il secondo tentativo
  è stato correttamente respinto, a conferma che il controllo di capacità
  continua a "vedere" le prenotazioni di tutti anche dopo la restrizione.
- righe di prova create per questi test sono state cancellate subito dopo,
  nessun dato reale è stato toccato.

### Lato sito (questo Pull Request)

- `js/bookings-api.js`: nuova funzione `refreshBookingsForDate(date)` —
  punto unico che: legge la disponibilità di tutti (vista pubblica, senza
  dati personali) e la arricchisce con i dettagli completi SOLO delle
  righe che l'utente corrente ha diritto di vedere per intero (le proprie,
  quelle dell'ospite tramite i codici salvati, o tutte se admin).
- `js/app-ui.js`: `loadAndRender()` e `loadBookingsForStep1()` ora usano
  questa funzione al posto della lettura diretta e completa della tabella.
- Nessuna regola di business cambiata, nessuna interfaccia cambiata:
  stesso identico comportamento visibile, dati non necessari non arrivano
  più nel browser di chi non ne ha diritto.

**Verifica fatta con test end-to-end in browser headless** (login/ospite
simulati, dati finti — nessun dato reale coinvolto in questa parte):
- utente che prenota due slot consecutivi → bloccato, come prima;
- un secondo utente vede lo slot come "Occupato" e **la memoria del suo
  browser (`currentBookings`) ora contiene solo `id/baia/data/slot/user_id`,
  non più nome/destinazione/targa**;
- il proprietario della prenotazione continua a vedere i propri dettagli
  completi ("✓ Milano Ovest");
- l'admin continua a vedere tutti i dettagli completi nel pannello;
- un ospite che prenota e poi torna sul sito (stesso browser) rivede la
  propria prenotazione con i dettagli completi; un ospite diverso la vede
  solo come "Occupato", senza alcun dato personale in memoria.

## Cosa NON è cambiato / limiti noti

- La chiave `service_role` incorporata lato client (per le operazioni
  admin di modifica/cancellazione) resta invariata — è un problema
  distinto, già segnalato in `PIANO_REFACTORING.md`.
- Le funzioni RPC `guest_get_booking`/`guest_update_booking`/
  `guest_delete_booking` (già esistenti nel database, non usate finora dal
  sito) non sono state collegate al codice: questa correzione ha usato solo
  la lettura (`guest_get_bookings_by_tokens`, nuova). Modifica/cancellazione
  ospite continuano a passare dal client admin come prima — un
  miglioramento possibile ma fuori dallo scope di questa correzione.
