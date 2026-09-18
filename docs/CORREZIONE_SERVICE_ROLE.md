# Correzione: chiave service_role incorporata lato client + credenziali reali committate

## Segnalazione e cosa ho verificato

Segnalazione ricevuta: la chiave `service_role` di Supabase era incorporata
in chiaro in `js/config.js`, file servito pubblicamente da GitHub Pages a
chiunque visitasse il sito. Inoltre `backend/.env` (un prototipo precedente
con backend Node/Express, poi dismesso a favore di Supabase) era committato
nel repository con credenziali reali in chiaro.

Ho verificato entrambi i punti leggendo direttamente i file nel repository:

1. **`js/config.js`**: conteneva davvero la chiave `service_role` (JWT con
   `"role":"service_role"`, senza scadenza pratica — anno 2097). Questa
   chiave bypassa **tutte** le Row Level Security del database: chiunque
   avesse aperto il sorgente della pagina (view-source o F12) aveva accesso
   completo in lettura/scrittura/cancellazione a tutta la tabella
   `prenotazioni`, indipendentemente da qualunque login. Il rischio era già
   documentato in `docs/PIANO_REFACTORING.md` §6 fin dalla prima fase del
   refactoring, ma non era mai stato risolto.
2. **`backend/.env`**: presente nel repository fin dal **primissimo commit**
   (nessun `.gitignore` è mai esistito per escluderlo). Conteneva, in
   chiaro: una API key di Resend (invio email) dall'aspetto reale e valido,
   username/password dell'admin del vecchio prototipo, e un JWT secret
   usato da quel backend per firmare i propri token. `admin.html` e
   `booking.html` (altri residui dello stesso prototipo) non contengono
   segreti propri: puntano solo a un backend Node su Railway che, per
   quanto verificabile da qui, non risulta più raggiungibile/mantenuto.

## Perché il primo problema era più delicato del previsto

Controllando le policy RLS reali sulla tabella `prenotazioni` prima di
togliere la chiave, ho trovato che:
- **SELECT**: la policy `select_own_or_admin` già permette all'admin
  autenticato (login vero, via Supabase Auth) di leggere tutte le righe
  con la sola chiave pubblica `anon` — per questo, la lettura non aveva
  affatto bisogno della chiave service_role.
- **UPDATE/DELETE**: le policy `update_own`/`delete_own` permettono solo al
  proprietario della riga (`auth.uid() = user_id`) di modificarla/
  cancellarla. Da quando i trasportatori non hanno più account (vedi
  `docs/TRASPORTATORI_SENZA_LOGIN.md`), quasi tutte le righe hanno
  `user_id` nullo: l'admin non aveva quindi nessun percorso RLS diretto per
  modificare o cancellare prenotazioni altrui — da qui la scelta originale
  di usare la chiave service_role per bypassare del tutto le RLS.
  Semplicemente togliere la chiave, senza altro, avrebbe rotto la modifica
  e la cancellazione delle prenotazioni da parte dell'admin.

## Correzione applicata

### Lato database (Supabase, migrazione `admin_update_delete_rpc_no_service_role`)

Due nuove funzioni `SECURITY DEFINER`, stesso pattern già in uso per
`trasportatore_update_booking`/`trasportatore_delete_booking`: eseguono con
i permessi del proprietario del database (bypassano le RLS), ma **solo
dopo aver verificato internamente** che chi chiama sia davvero autenticato
come l'admin (`auth.uid()` uguale allo uid dell'account admin) — non più un
bypass incondizionato per chiunque conosca una chiave statica.

- `admin_update_booking(p_id, p_nome, p_destinazione, p_targa, p_slot_index)`
- `admin_delete_booking(p_id)`

**Verificato direttamente sul database prima di toccare il sito**
(simulando le tre situazioni possibili, con una prenotazione di prova
creata e ripulita subito dopo):
- chiamata anonima (nessuna sessione) → respinta ("Non autorizzato");
- chiamata autenticata ma con un altro utente (uid diverso dall'admin) →
  respinta ("Non autorizzato");
- chiamata autenticata con lo uid reale dell'admin → update e delete
  eseguiti correttamente.

### Lato sito (questa correzione)

- `js/supabase-client.js`: rimosso `adminClient` (il client creato con la
  chiave service_role) e la sua inizializzazione.
- `js/config.js`: rimossa la costante `SB_SVC` (la chiave stessa).
- `js/bookings-api.js`:
  - `refreshBookingsForDate()`: la lettura di tutte le prenotazioni per
    l'admin ora usa `sbClient` (chiave `anon` + sessione admin autenticata)
    invece di `adminClient` — la policy `select_own_or_admin` la permette
    già, come verificato sopra;
  - `deleteBooking()`/`updateBooking()`: il ramo admin ora chiama
    `admin_delete_booking`/`admin_update_booking` via RPC invece di operare
    direttamente sulla tabella con la chiave service_role.
- `backend/` rimosso interamente dal repository (conteneva `backend/.env`
  con le credenziali reali).
- Nessuna regola di business o comportamento visibile cambiato: stesso
  identico funzionamento per admin e trasportatori, solo il meccanismo di
  autorizzazione sottostante è cambiato.

## Azioni che DEVI fare tu, fuori da questo repository (urgenti)

Rimuovere una chiave dal codice **non la invalida**: se era già pubblica,
va considerata compromessa a prescindere da questa correzione. Il codice
qui sistemato riguarda solo il "come" il sito farà le cose da ora in poi,
non annulla l'esposizione già avvenuta. Consiglio di fare queste cose il
prima possibile, indipendentemente da quando questa PR verrà messa online:

1. **Chiave `service_role` di Supabase** — su
   supabase.com/dashboard → progetto → *Project Settings → API* →
   rigenerare (o resettare il JWT secret del progetto, che rigenera insieme
   sia la chiave `anon` sia la `service_role`). Dopo la rigenerazione del
   JWT secret andrà aggiornata anche `SUPABASE_ANON_KEY_DEFAULT` in
   `js/config.js` con la nuova chiave anon, altrimenti il sito smette di
   funzionare. La nuova chiave service_role invece non va più incorporata
   da nessuna parte: dopo questa correzione il sito non ne ha più bisogno.
2. **API key Resend** trovata in `backend/.env` — va revocata sul pannello
   resend.com (Settings → API Keys). Il backend che la usava risulta
   dismesso, quindi con ogni probabilità basta eliminarla senza sostituirla.
3. **Password `admin123` / username `giacomo`** trovati in `backend/.env`
   — erano credenziali del vecchio prototipo, non (per quanto verificabile
   da qui) quelle dell'account admin reale su Supabase Auth
   (`giacomo.rigamonti@saica.com`). Ti consiglio comunque di verificare che
   la password reale dell'account admin non sia questa o una simile, e
   cambiarla per sicurezza se hai il minimo dubbio: non posso verificarlo
   da qui.
4. **JWT secret del vecchio backend** (`backend/.env`) — rischio pratico
   basso se quel backend Node/Railway non è più online (sembra così, da
   quanto verificabile in questo repository), ma se hai ancora accesso a
   quel progetto Railway/Vercel ti consiglio di spegnerlo/eliminarlo
   comunque, invece di lasciarlo abbandonato con questo secret ancora
   valido.

## Cosa NON ho fatto (limite di questa correzione)

- **Non ho riscritto la cronologia Git**: `backend/.env` resta leggibile
  nei commit vecchi del repository (era presente fin dal primo commit).
  Rimuoverlo davvero dalla cronologia richiederebbe riscrivere tutti i
  commit e un push forzato — un'operazione invasiva (chiunque abbia clonato
  il repository dovrebbe riclonarlo) che ho preferito non fare senza il tuo
  assenso esplicito, anche perché **la rotazione delle credenziali sopra è
  la protezione reale**: una chiave revocata non è più utilizzabile da chi
  la trova nella cronologia, quindi la riscrittura della cronologia
  diventerebbe un'operazione di igiene ulteriore, non urgente. Fammi sapere
  se la vuoi comunque.
- **Non ho toccato `admin.html`/`booking.html`/`README.md`**: restano
  residui del vecchio prototipo, già segnalati come obsoleti in
  `docs/PIANO_REFACTORING.md` §1/§6, ma senza segreti propri — pulizia
  possibile ma separata da questo intervento di sicurezza.
