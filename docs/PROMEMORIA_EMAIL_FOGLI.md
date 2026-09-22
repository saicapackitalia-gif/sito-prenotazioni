# Promemoria email: prenotazioni Fogli, un'ora prima

## Cosa fa

Un'ora prima dell'orario di ogni prenotazione sulla baia **Fogli**, il
database invia automaticamente un'email di avviso — nessuna modifica al
sito o al codice JavaScript: è tutto lato database (Supabase), come le
altre regole di business già esistenti (capacità condivisa, slot
consecutivi).

Contenuto dell'email: orario, data, trasportatore, destinazione, targa
della prenotazione in arrivo.

## Come funziona (architettura)

- **`pg_cron`**: un job (`promemoria-fogli-1h`) esegue un controllo ogni 5
  minuti.
- **`public.invia_promemoria_fogli()`**: la funzione controllata dal job.
  Cerca le prenotazioni su `baia-1` (Fogli) il cui orario REALE — calcolato
  dai parametri della baia in `mezzi`, fuso orario `Europe/Rome` (gestisce
  correttamente il cambio ora legale/solare) — cade tra 55 e 60 minuti da
  adesso. La finestra di 5 minuti combacia con la cadenza del job: ogni
  prenotazione viene quindi esaminata esattamente una volta dalla finestra
  giusta.
- **`public.promemoria_fogli_inviati`**: tabella che tiene traccia di quali
  prenotazioni hanno già ricevuto l'avviso (evita invii doppi se il job
  gira più volte sulla stessa finestra, o come rete di sicurezza in caso di
  un'esecuzione mancata). Tabella separata invece di una colonna su
  `prenotazioni`, apposta: quella tabella ha due trigger (slot consecutivi,
  capacità condivisa) agganciati anche a `UPDATE`, che scatterebbero
  inutilmente ad ogni "segna come inviato".
- **`pg_net`**: invia la richiesta HTTP a Resend (asincrona, non blocca la
  transazione).
- **Resend**: servizio di invio email. La API key è salvata cifrata nel
  **Supabase Vault** (`vault.create_secret`, nome `resend_api_key`) — non è
  mai stata scritta né nel codice del sito né in questo repository.

## Limite attuale: un solo destinatario reale

Il dominio del mittente non è ancora verificato su Resend. Finché non lo
sarà, Resend permette di inviare **solo** all'indirizzo con cui è stato
creato l'account Resend (`saicapackitalia@gmail.com`, registrato via
GitHub) — non ai 4 destinatari finali voluti
(`giacomo.rigamonti@saica.com`, `linda.ingallina@saica.com`,
`michele.cassone@saica.com`, `aurora.pergola@saica.com`).

**Per estendere l'invio a tutti e 4**: verificare un dominio su Resend
(es. `saica.com` o un sottodominio dedicato), aggiungendo i record DNS che
Resend indica — richiede accesso al pannello DNS del dominio aziendale.
Fatto quello, basta aggiornare il campo `to` nella funzione
`invia_promemoria_fogli()` (attualmente
`jsonb_build_array('saicapackitalia@gmail.com')`) con l'elenco completo.

## Verifica fatta prima di considerarlo attivo

Test end-to-end reale (non solo lettura del codice), il 22/09/2026:
1. Creata una prenotazione di prova su Fogli con orario scelto apposta per
   cadere nella finestra "55-60 minuti da adesso".
2. Il job pianificato è partito da solo, l'ha trovata, ha chiamato Resend
   (risposta `200 OK`, email accettata) e l'ha segnata come inviata.
3. Email di prova ricevuta e confermata dall'utente sulla casella
   `saicapackitalia@gmail.com`.
4. Prenotazione e riga di tracciamento di prova cancellate subito dopo
   (cascata automatica tramite foreign key) — nessun dato reale toccato.

## Cosa NON è incluso in questa prima versione

- Solo la baia **Fogli** — su richiesta esplicita. Estendere a
  Scatole/Depositi richiede solo togliere il filtro
  `p.vehicle_id = 'baia-1'` nella funzione (e decidere se con la stessa
  finestra di un'ora o diversa per baia).
- Nessun avviso per modifiche o cancellazioni successive alla creazione
  della prenotazione (es. se un trasportatore cambia orario dopo che
  l'email è già stata segnata come inviata, non parte un secondo avviso
  per il nuovo orario) — miglioramento possibile in futuro, non richiesto
  ora.
