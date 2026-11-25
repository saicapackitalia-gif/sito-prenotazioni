# Faital: anticipo minimo 2 giorni (Scatole) + email immediata

## Cosa fa

1. **Anticipo minimo**: Faital può prenotare **Scatole** solo con **almeno
   2 giorni di calendario di anticipo** — non per oggi, non per domani.
   Nessun'altra baia è coinvolta (Fogli e Depositi restano senza questa
   regola per Faital). L'admin è sempre esente.
2. **Email immediata**: ogni volta che Faital inserisce una prenotazione
   (qualsiasi baia, qualsiasi orario), parte **subito** un'email di
   notifica — diversa dal promemoria "un'ora prima" già esistente per
   Fogli (`docs/PROMEMORIA_EMAIL_FOGLI.md`), che è per tutti i
   trasportatori e parte in anticipo rispetto all'orario, non alla
   creazione.

## Lato database (autorevole)

- **`verifica_anticipo_minimo_giorni_faital`** (trigger
  `trg_anticipo_minimo_giorni_faital`, BEFORE INSERT OR UPDATE su
  `prenotazioni`): stesso pattern delle altre regole di business —
  SECURITY DEFINER, bypass admin, su UPDATE si applica solo se
  baia/data/slot cambiano davvero. Scoped a `vehicle_id = 'baia-2'` e
  `nome = 'faital'` (case-insensitive); confronta `data` con
  `(oggi + 2 giorni)` in fuso Europe/Rome.
- **`notifica_prenotazione_faital`** (trigger
  `trg_notifica_prenotazione_faital`, **AFTER INSERT** — non BEFORE,
  deve scattare solo su un inserimento davvero riuscito): se
  `nome = 'faital'`, chiama Resend (stessa API key nel Vault usata dal
  promemoria Fogli) con i dettagli della prenotazione appena creata.

**Verificato con test reali** (via la stessa RPC `create_prenotazione`
usata dal sito, dati di prova cancellati subito dopo), il 25/11/2026:
1. Faital, Scatole, oggi → **respinto**.
2. Faital, Scatole, domani (+1) → **respinto**.
3. Faital, Scatole, +2 giorni → **accettato**, email inviata (Resend
   `200 OK`, verificato in `net._http_response`).
4. Faital, **Fogli**, oggi → **accettato** (baia non coinvolta dalla
   regola di anticipo), email inviata comunque (la notifica non ha
   restrizioni di baia).
5. CMF (non Faital), Scatole, oggi → **accettato**, **nessuna email**
   inviata (verificato: nessuna nuova riga in `net._http_response`).
6. Admin, Faital, Scatole, oggi → **accettato** (bypass sulla regola di
   anticipo; la notifica email scatta comunque, è corretto: segnala
   anche le prenotazioni create dall'admin per conto di Faital).

## Limite attuale sull'email (stesso del promemoria Fogli)

Finché non si verifica un dominio su Resend, l'email arriva **solo** a
`saicapackitalia@gmail.com`. I destinatari finali voluti sono **5**:
`giacomo.rigamonti@saica.com`, `linda.ingallina@saica.com`,
`michele.cassone@saica.com`, `aurora.pergola@saica.com`,
`annalisa.mauri@saica.com`. Per estendere l'invio, stessa procedura già
documentata in `docs/PROMEMORIA_EMAIL_FOGLI.md`.

## Lato sito

- `js/config.js`: aggiunto `{id:'faital', nome:'Faital'}` a
  `TRASPORTATORI`.
- `js/slots.js`: nuova funzione `isTooSoonFaitalScatole(vehicleId, dataStr, nome)`
  (accanto alle altre regole di anticipo, stessa posizione per lo stesso
  motivo: deve restare visibile da `js/bookings-api.js`, caricato prima
  di `js/app-ui.js` che è un'unica IIFE).
- `js/app-ui.js`: collegata a `renderGrid()` (slot non cliccabile,
  etichetta "Min. 2 giorni"), `updateStats()` (escluso dai "liberi").
- `js/bookings-api.js`: pre-check in `createBooking()` per il messaggio
  immediato prima di contattare il server.

**Verificato con test in browser headless**: tutti i casi corretti
(oggi/domani respinti, +2 giorni e Fogli accettati, CMF non coinvolto),
nessun errore di scope cross-file.
