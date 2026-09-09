# Trasportatori senza login + regola slot consecutivi per baia

## Cosa cambia

Su richiesta, l'accesso per i trasportatori non passa più da un account
(email/password) o da un modulo "ospite": si sceglie il proprio nome da un
elenco fisso (menu a tendina), e il sito riconosce automaticamente
quell'identità per applicare le regole di business. L'amministratore
continua a fare login vero con email e password.

**Avviso importante, già discusso e accettato**: questo NON è un sistema di
autenticazione. Chiunque può scegliere qualunque nome dall'elenco — non c'è
verifica che chi seleziona "Tavola" sia davvero un incaricato di Tavola. È
una semplificazione consapevole per un ambiente controllato (i trasportatori
che arrivano allo stabilimento sono comunque persone note), non un controllo
di sicurezza. Se in futuro servisse un controllo più stretto, andrebbe
ripensato da capo (es. un codice/PIN per azienda).

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
