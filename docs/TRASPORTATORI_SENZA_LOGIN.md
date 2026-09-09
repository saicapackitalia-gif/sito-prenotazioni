# Trasportatori senza login + password per trasportatore + regola slot consecutivi per baia

## Cosa cambia

Su richiesta, l'accesso per i trasportatori non passa più da un account
(email/password personale) o da un modulo "ospite": si sceglie il proprio
nome da un elenco fisso (menu a tendina) e si inserisce la password di
quel trasportatore — il sito riconosce automaticamente quell'identità per
applicare le regole di business. L'amministratore continua a fare login
vero con email e password.

## Password per trasportatore (aggiunta dopo la prima versione)

Nella prima versione la scelta del nome bastava da sola, senza alcuna
verifica — chiunque poteva "diventare" un trasportatore con un clic. Su
segnalazione esplicita ("se io entro e dico che sono un trasportatore posso
modificare per dispetto"), ogni trasportatore ha ora una password,
verificata sul database prima di:
- entrare come quel trasportatore ("Chi sei?");
- creare una nuova prenotazione;
- rivedere le proprie prenotazioni con i dettagli completi;
- modificare o cancellare una prenotazione (e solo se è davvero la
  propria: nemmeno con la password giusta si può toccare la prenotazione
  di un trasportatore diverso — verificato con un test dedicato).

L'amministratore resta esente da queste password (ha già il suo vero
login).

**Le password non seguono più una formula legata al nome** (una prima
versione usava `Saica-<Nome>`, scartata su richiesta perché prevedibile
da chiunque conoscesse lo schema). Sono invece parola-comune + due cifre,
facili da leggere/digitare ma senza relazione con il nome dell'azienda —
consegnate al committente in chat, non scritte in questo repository per
non renderle pubbliche insieme al codice sorgente. Per cambiarle in
futuro: `update public.trasportatori set password_hash = crypt('nuova-password', gen_salt('bf')) where id = '...';`
su Supabase.

Restano comunque salvate **cifrate** nel database (mai in chiaro) e
verificate lato server ad ogni operazione, non solo all'ingresso — quindi
non basta aggirare la schermata iniziale per bypassarle.

Un limite più profondo, già segnalato in `PIANO_REFACTORING.md` e non
affrontato da questa modifica: il sito incorpora lato client una chiave
`service_role` che bypassa tutte queste protezioni per chi la estrae dal
codice sorgente della pagina. La password ai trasportatori non chiude
questa via più tecnica — resta un problema distinto, di dimensioni
maggiori, da valutare separatamente se necessario.

### Dove sono salvate le informazioni sul browser

- **Identità scelta** (quale trasportatore): in `localStorage`, a lungo
  termine — per questo le visite successive vengono "riconosciute" senza
  dover riselezionare il nome dalla tendina.
- **Password**: SOLO in `sessionStorage`, che si svuota chiudendo la
  scheda/il browser — non resta salvata a lungo termine sul dispositivo.
  Di conseguenza: ricaricare la pagina nella stessa scheda non richiede di
  reinserirla; riaprire il sito in una scheda/browser nuovo sì (il nome
  resta pre-selezionato per comodità, ma la password va reinserita).

Se in futuro servisse un controllo più stretto (password non prevedibili,
uniche per persona invece che per azienda, ecc.), andrebbe ripensato da
capo.

## Elenco trasportatori (fisso, in `js/config.js`)

Zini (riservato alla baia Depositi), Tavola, CMF, Soc. Coop. Evolution,
Autotrasporti Colombo, World Express. Per aggiungere/togliere un
trasportatore, modificare l'array `TRASPORTATORI` in quel file.

## Regola "slot consecutivi", ora per baia

- **Fogli**: nessuno slot consecutivo per lo stesso trasportatore (come prima).
- **Scatole**: fino a 2 slot consecutivi ammessi (es. 15:00 e 15:30), il 3°
  di fila viene bloccato.
- **Depositi**: nessuna regola sui consecutivi (come prima).
- L'amministratore resta sempre esente, anche quando prenota per conto di
  un trasportatore.

Il limite per baia è configurato in due posti che devono restare
sincronizzati: `js/config.js` (`VEHICLES[].maxConsecutiveSlots`, usato dal
sito per l'anteprima nella griglia) e la colonna `mezzi.max_slot_consecutivi`
su Supabase (usata dal trigger per l'applicazione reale).

## Flusso

1. **Prima visita**: si apre il sito e appare "Chi sei?" con il menu a
   tendina dei trasportatori (al posto della schermata di login).
2. **Scelta salvata**: una volta scelto un nome, viene ricordato in questo
   browser (localStorage) — le visite successive vengono riconosciute
   automaticamente, saltando la schermata di scelta. Un pulsante "Cambia" in
   alto permette di cambiare identità in qualsiasi momento (utile se un
   dispositivo condiviso viene usato da trasportatori diversi).
3. **Prenotazione**: nella scheda "Nuova prenotazione", il campo
   "Trasportatore" è già impostato sul nome scelto (comunque modificabile);
   restano da compilare Destinazione e Targa.
4. **Amministratore**: fa login con email/password come prima, vede tutto
   nel pannello, e quando aggiunge una prenotazione sceglie lui il
   trasportatore dalla stessa tendina (che parte vuota, deve scegliere ogni
   volta per chi sta prenotando).
5. **Baia Depositi**: visibile e prenotabile solo scegliendo "Zini" o da
   amministratore.

## Cosa è stato tolto

- Login/registrazione per i trasportatori (nessun account, nessuna email,
  nessuna password).
- Modulo "Prenota senza account" con nome libero + telefono + azienda.
- Le funzioni `signUp`/`doRegister`/`startGuestMode`/`getGuestTokens`/
  `saveGuestToken` (codice morto una volta rimossa la UI che le usava).

Il campo telefono/azienda non serve più: il trasportatore è già
identificato dalla scelta nell'elenco. Le colonne `telefono`/`azienda`
restano nel database (per lo storico), semplicemente non vengono più
scritte da nuove prenotazioni.

## Correzioni lato database emerse durante l'implementazione

Applicate direttamente su Supabase (non tracciate in questo repo, come le
precedenti — vedi `docs/CORREZIONE_PRIVACY_PRENOTAZIONI.md`):

1. **Nuova colonna** `mezzi.max_slot_consecutivi` (1 per Fogli, 2 per
   Scatole, nullo per Depositi).
2. **Trigger `verifica_slot_non_consecutivi` riscritto**: non più basato su
   account/telefono ma sul nome del trasportatore (confronto
   case-insensitive), con un conteggio della "sequenza consecutiva" invece
   di un semplice controllo binario — per supportare il limite di 2 su
   Scatole. L'esenzione admin ora guarda a chi sta davvero facendo la
   richiesta (`auth.uid()`), non al campo `user_id` della riga, così vale
   anche quando l'admin prenota per conto di un trasportatore.
3. **Trigger `verifica_rate_limit_ospite`**: aggiunta esenzione per l'admin
   (prima si applicava solo controllando `user_id`, ma ora tutte le
   prenotazioni dei trasportatori hanno `user_id` nullo, quindi senza
   questa esenzione l'admin sarebbe stato limitato anche lui durante
   inserimenti multipli).
4. **Policy di inserimento** (`insert_own_or_guest`): estesa per permettere
   all'admin di inserire righe con `user_id` nullo usando la propria
   sessione autenticata (prima poteva farlo solo bypassando la sicurezza
   con la chiave service_role).
5. **Nuova funzione** `get_bookings_by_trasportatore(nome, data)`: permette
   di rivedere le prenotazioni complete di un trasportatore tramite il
   nome (non è un segreto, è pubblico — coerente con la scelta di
   un'identità condivisa, vedi avviso sopra).
6. **Bug trovato e corretto durante il test**: un trasportatore (o un
   ospite, con la vecchia policy della correzione precedente) poteva
   INSERIRE una prenotazione ma non RILEGGERLA subito dopo (la policy di
   lettura, correttamente, non permette a chi non è loggato di leggere
   righe create da altri con `user_id` nullo — ma questo blocca anche il
   rileggere la propria riga appena creata). Corretto con una nuova
   funzione `create_prenotazione(...)` che inserisce e restituisce la riga
   in un solo passaggio protetto (stesso principio già usato per
   `guest_get_booking` in precedenza). Scoperto testando un vero
   inserimento con il ruolo "anon" prima di scrivere il codice del sito,
   non dopo — evitato così di scoprirlo in produzione.

## Verifica fatta

- **Database**: ogni caso testato direttamente su Supabase simulando i
  ruoli reali (anon, utente normale, admin) con righe di prova create e
  cancellate subito dopo — mai toccato dati reali. Confermato: Fogli
  blocca il 2° slot consecutivo, Scatole ammette 2 ma blocca il 3° (da
  entrambi i lati), nomi diversi non si bloccano a vicenda, Depositi non
  ha la regola, l'admin è sempre esente, la nuova funzione di lettura per
  nome restituisce solo le righe giuste.
- **Sito**: test end-to-end in browser headless con più "trasportatori"
  diversi: prima visita mostra la scelta, prenotazione riuscita, slot
  consecutivo bloccato in anteprima, un altro trasportatore vede lo slot
  come occupato senza alcun dato personale in memoria (`currentBookings`),
  Depositi nascosta per un trasportatore normale e visibile per Zini,
  identità riconosciuta automaticamente dopo un ricaricamento della
  pagina, flusso admin (login → aggiungi prenotazione → sceglie
  trasportatore da tendina → conferma) verificato per intero.

## Verifica fatta per la password (aggiunta successiva)

- **Database**: password giusta accettata, password sbagliata respinta con
  errore chiaro (sia all'ingresso sia su creazione/lettura/modifica/
  cancellazione); l'admin non ne ha bisogno; **anche con una password
  valida ma di un trasportatore diverso, non si può modificare o
  cancellare la prenotazione di un altro trasportatore** (verificato con
  un tentativo esplicito: CMF con la propria password corretta non riesce
  a toccare una prenotazione di Tavola). Migrazione corretta al volo dopo
  aver trovato, testando, due problemi tecnici: la funzione `crypt()` di
  PostgreSQL vive in uno schema (`extensions`) diverso da quello
  configurato di default per le funzioni, e la ridefinizione delle
  funzioni con un parametro in più aveva lasciato una versione vecchia
  duplicata invece di sostituirla — entrambi corretti e riverificati
  prima di considerare la migrazione conclusa.
- **Sito**: password sbagliata all'ingresso → resta sulla schermata con
  errore, non entra; password giusta → entra; il campo "Trasportatore"
  nella scheda di prenotazione è bloccato (non modificabile) per chi non è
  admin, proprio perché l'identità è già stata verificata con password
  all'ingresso; ricaricare la pagina nella stessa scheda riconosce ancora
  il trasportatore senza richiedere di nuovo la password (sessionStorage);
  aprire il sito in un browser/contesto nuovo richiede scelta e password
  da capo; un secondo trasportatore, con la propria password valida, vede
  comunque la prenotazione altrui solo come "Occupato" senza alcun dato
  personale in memoria.
