# Mappa struttura attuale e piano di scomposizione — `index.html`

> Documento di analisi, non di implementazione: nessun codice funzionale è stato
> modificato. Obiettivo: mappare lo stato attuale di `index.html` e proporre un
> piano di scomposizione in moduli separati, **senza alterare backend Supabase
> e regole di business già testate**. Le decisioni finali (formato moduli,
> quali file toccare per primi, se pulire i file obsoleti) restano da
> confermare col committente prima di procedere all'esecuzione.

## 1. Cosa ho verificato prima di scrivere il piano

- Letto `index.html` per intero (4226 righe, ~171 KB) mappandone i confini di
  sezione (`grep` sui marcatori `<style>`/`<script>` e sui commenti a banner
  `// ===== ... =====`), poi letto a campione i punti di giuntura per
  confermare cosa contengono davvero.
- Confrontato lo stato del repo con il briefing: **`admin.html`, `booking.html`,
  `backend/` e `README.md` sono un prototipo precedente**, non l'app in
  produzione. Prova concreta: puntano a un backend Node/Express su
  `http://localhost:3000/api` (JWT, PostgreSQL) e il loro ultimo commit è del
  **18/06/2026**, mentre `index.html` (Supabase, `jmhwxpgwakrqmnwefqrs.supabase.co`,
  gestione ospiti con `management_token`, ecc. — tutto ciò che descrive il
  briefing) è stato aggiornato l'**08/09/2026**. Il sito pubblicato su GitHub
  Pages serve solo `index.html`. Questo non è un compito che mi è stato dato
  esplicitamente ora, ma è un fatto rilevante per chi lavorerà al repo: **non
  ho toccato né cancellato questi file**, perché una cancellazione è
  un'azione poco reversibile che deve essere confermata esplicitamente.
- Non ho eseguito query sul database né modificato Supabase: questo compito è
  di sola lettura/analisi sul codice frontend.

## 2. Mappa di `index.html` (stato attuale)

| Blocco | Righe | Dimensione | Contenuto |
|---|---|---|---|
| `<head>` | 1–10 | — | meta, viewport, favicon |
| `<style>` | 11–1961 | ~1950 righe | CSS, ben commentato a blocchi ma con **sezioni duplicate** (es. `DATE NAV` e `VEHICLE TABS` compaiono due volte, segno di override accumulati nel tempo) |
| `<script src=supabase-js>` | 1962 | — | libreria Supabase via CDN |
| Markup: setup / login / app | 1969–2452 | ~490 righe | pagina di setup (prima configurazione), pagina di login, shell dell'app (step 1 selezione data+baia, step 2 griglia slot, pannello admin) |
| `<script>` (IIFE unica) | 2453–4227 | ~1774 righe | tutta la logica applicativa, in una sola closure `(function(){ ... })()` |

Il blocco `<script>` (il cuore del debito tecnico) si scompone così, in ordine
di apparizione:

| Sezione (righe) | Responsabilità |
|---|---|
| 2457–2469 | Tema chiaro/scuro |
| 2471–2519 | Utility generiche (`toast`, `formatDate`, `formatDateIT`, `isPast`, `isWeekend`, `showPage`) |
| 2521–2545 | Config Supabase, stato ospite (`getGuestTokens`/`saveGuestToken`/`isBookingMine`), **costanti admin e chiave `service_role` incorporata in chiaro** (riga 2545) |
| 2547–2665 | Client Supabase (`sbClient`, `adminClient`) e funzioni dati: auth (`signUp/signIn/signOut/getUser`) e prenotazioni (`fetchBookings/createBooking/deleteBooking/updateBooking`) — qui vivono anche i controlli di business lato client (baia riservata ZINI, slot consecutivi, capacità condivisa) prima dell'insert |
| 2667–2707 | Definizione `VEHICLES` (le 3 baie, **duplicata come dato hardcoded** rispetto alla tabella `mezzi` su Supabase) e generazione slot (`slotTimeRange`, `generateSlotsForVehicle`, `generateSlots`) |
| 2709–2825 | Stato applicativo globale (variabili di modulo: `selectedDate`, `currentVehicle`, `currentBookings`, `SLOTS`, ecc.), rendering tabs, `loadAndRender` |
| 2794–2967 | Logica di disponibilità cross-baia (`countBookingsForSlot`, `totalBusyInRange`, `hasConsecutiveConflict`, `canBookSlot`, `maxAllowedForSlot`) e rendering griglia slot (`renderGrid`, `updateStats`) |
| 2967–3108 | Modali di prenotazione/cancellazione, date picker, logout, scorciatoia Esc |
| 3109–3355 | UI di autenticazione (login/registrazione/ospite) e schermata di setup iniziale |
| 3355–3465 | Pannello admin: elenco di tutte le prenotazioni, filtri, azioni bulk |
| 3465–3820 | Flusso "2 step" (scelta baia → griglia), incluso il flusso di aggiunta prenotazione lato admin |
| 3820–4000 | Modali di modifica (utente e admin) |
| 4000–4032 | Riepilogo orari utente (`renderUserSchedule`) |
| 4032–4226 | Export CSV/Excel (IIFE annidata separata) |

**Osservazione trasversale**: la maggior parte di queste sezioni comunica
tramite un insieme comune di variabili `let` dichiarate nello scope della IIFE
principale (`SLOTS`, `currentBookings`, `currentVehicle`, `selectedDate`,
`currentUser`, `isGuest`, `offlineMode`, `offlineDb`, `TOTAL_CARRELLISTI`,
`VEHICLES`...). Ho contato **111 riferimenti complessivi** a queste variabili
sparsi nel file: è la causa diretta del bug già corretto ("SLOTS riutilizzata
dall'ultimo mezzo caricato") descritto nel briefing, ed è il rischio
principale di qualunque scomposizione: va preservato l'ordine di
inizializzazione e la semantica di "stato condiviso mutabile", non solo
spostato il codice in file diversi.

## 3. Interpretazione dei limiti del contesto (da confermare)

Il briefing chiede di "proporre un piano", non di eseguirlo. Ipotesi più
probabile — su cui ho lavorato — è che il compito richiesto ora sia
**produrre questo documento di analisi**, lasciando l'esecuzione a un
passaggio successivo esplicitamente autorizzato, perché:
1. `index.html` è il sorgente di un sito in produzione senza test automatici;
   una scomposizione errata rompe silenziosamente una regola di business già
   verificata a mano.
2. Il briefing stesso lo presenta come "un buon primo compito", non come
   un'implementazione già decisa nei dettagli (formato moduli, quanti file,
   quando toccare la sicurezza della `service_role` key).

Se invece l'intento era già "esegui la scomposizione", non l'ho fatta in
questo passaggio: **prima di modificare `index.html` chiedo conferma**,
perché è un cambiamento ad alto impatto e difficile da verificare senza test
automatici — coerente con la richiesta di prudenza dell'utente.

## 4. Piano di scomposizione proposto

### 4.1 Vincoli non negoziabili

- Nessuna modifica a schema Supabase, funzioni/trigger Postgres, RLS policy.
- Nessuna modifica al comportamento delle regole di business già testate
  (capacità condivisa, slot non consecutivi, rate limit ospiti, baia
  Depositi riservata ZINI).
- L'app resta un sito statico deployabile su GitHub Pages: niente bundler
  obbligatorio, niente step di build che GitHub Pages non esegue di default.
- Deve restare possibile aprire `index.html` direttamente e vederlo
  funzionare come oggi (stesso URL pubblico, stesso comportamento).

### 4.2 Struttura di destinazione proposta

Uso **ES Modules nativi del browser** (`<script type="module">`), supportati
da GitHub Pages senza bundler, invece di un'unica IIFE:

```
index.html                  # solo markup + tag <script type="module" src="js/main.js">
css/
  tokens.css                 # design tokens, font, base
  layout.css                 # topbar, layout principale, cards, date-nav
  components.css             # bottoni, badge, toast, modali, griglia slot
  admin.css                  # pannello admin, filtri, azioni bulk
  responsive.css             # tutte le media query mobile/tablet
js/
  config.js                  # SB_URL/SB_KEY, ADMIN_EMAIL_CONST, ADMIN_UID
                              #   -> qui isolo la chiave service_role per
                              #      renderla un problema visibile e unico,
                              #      non eliminarla (non è nello scope di
                              #      questo piano toccare la sicurezza RLS)
  state.js                   # stato applicativo condiviso (oggetto unico
                              #   esportato, non variabili sciolte) + VEHICLES
  supabaseClient.js           # initSupabaseClient, sbClient, adminClient
  auth.js                     # signUp/signIn/signOut/getUser, guest tokens
  bookings-api.js              # fetchBookings/createBooking/updateBooking/deleteBooking
  slots.js                     # slotTimeRange, generateSlots, canBookSlot,
                                #   hasConsecutiveConflict, totalBusyInRange
                                #   (unico punto di calcolo orario — elimina
                                #   per costruzione il bug della SLOTS globale)
  render-grid.js               # renderGrid, renderTabs, updateStats
  modals.js                    # booking/delete/edit modal (utente e admin)
  admin.js                     # renderAdminBookings, filtri, bulk, add booking
  step-flow.js                  # flusso 2-step, baia cards
  export.js                     # CSV + Excel (già abbastanza isolato oggi)
  main.js                       # bootstrap: init, routing tra le pagine, listeners
```

Punto chiave: **`state.js` esporta un solo oggetto di stato** (es. `export const state = {...}`)
invece di variabili module-level sciolte, così ogni modulo che legge/scrive
`selectedDate` o `currentVehicle` lo fa esplicitamente su `state.selectedDate`
— stesso comportamento, ma il flusso dei dati diventa tracciabile con un
semplice grep su `state.`, cosa impossibile oggi con variabili implicite.

### 4.3 Fasi di esecuzione (incrementali, verificabili una alla volta)

1. **Estrazione CSS** (rischio più basso): spostare il contenuto di
   `<style>` nei file `css/*.css`, un `<link>` per file. Verifica: diff
   visivo pagina per pagina, nessuna riga di JS toccata.
2. **Estrazione dati/costanti pure** (`VEHICLES`, costanti admin, config):
   nessuna logica, solo spostamento. Verifica: build manuale, la pagina deve
   comportarsi identica.
3. **Estrazione layer dati** (`supabaseClient.js`, `auth.js`,
   `bookings-api.js`): sono già le funzioni più isolate oggi (comunicano
   soprattutto per parametri/ritorno, non per variabili globali). Verifica:
   ripetere manualmente i test già fatti in passato per i trigger (rate
   limit ospiti, capacità condivisa, slot consecutivi) — checklist in §5.
4. **Estrazione `slots.js`**: è il punto più delicato per via del bug storico
   della `SLOTS` globale. Va accompagnato da una verifica esplicita che
   `slotTimeRange(vehicleId, slotIdx)` resti l'unica via di calcolo orario e
   che nessun modulo nuovo reintroduca un accesso diretto a una variabile
   "griglia dell'ultimo mezzo caricato".
5. **Estrazione rendering e modali** (`render-grid.js`, `modals.js`,
   `admin.js`, `step-flow.js`): più rischiosa per volume di codice, va
   fatta un modulo alla volta con verifica manuale della UI ad ogni step.
6. **Estrazione `export.js`**: a rischio minimo, è già una IIFE quasi
   autonoma oggi.
7. **`main.js`**: ultimo, collega tutto e sostituisce l'IIFE originale.

Ad ogni fase: commit separato, deploy su un branch/ambiente di verifica
prima di toccare `main`, e la checklist manuale di §5 rieseguita per intero
prima di considerare la fase conclusa.

## 5. Checklist di verifica manuale (non esiste test automatico oggi)

Da ripetere ad ogni fase del piano, replicando le verifiche già fatte "a
mano" nello sviluppo originale:

- [ ] Login utente registrato, login come ospite, login admin.
- [ ] Prenotazione Fogli (45 min, 1 carrellista) e verifica overlap corretto.
- [ ] Prenotazione Scatole (30 min, max 2) fino a saturazione dello slot.
- [ ] Tentativo di prenotare Depositi da utente non-ZINI e non-admin → deve
      essere respinto con lo stesso messaggio di oggi.
- [ ] Due slot consecutivi sulla stessa baia (Fogli/Scatole) dallo stesso
      utente → bloccato; da admin → permesso.
- [ ] Capacità condivisa: saturare 2 carrellisti fra baie diverse con orari
      sovrapposti (non necessariamente stesso `slot_index`) → il 3° tentativo
      va respinto.
- [ ] Rate limit prenotazioni ospite (5/15min per telefono, 20/2min globali).
- [ ] Modifica ed eliminazione prenotazione da pannello admin, incluso il
      calcolo dell'orario mostrato (punto già bacato in passato).
- [ ] Export CSV ed Excel: colonne, orari e conteggi corretti su un intervallo
      con prenotazioni su più baie con step diversi.
- [ ] Toggle tema chiaro/scuro, viewport mobile e tablet.

## 6. Rischi noti da tenere a mente, non affrontati in questo piano

- **Chiave `service_role` incorporata lato client** (riga 2545): la
  scomposizione la isola in un unico file (`config.js`) invece di lasciarla
  sparsa, ma **non la rimuove** — è un problema di sicurezza indipendente
  dalla riorganizzazione dei file, che richiede RLS granulari o un endpoint
  backend dedicato. Segnalo che la modularizzazione da sola non lo risolve,
  per evitare che venga percepito come "sistemato" per errore.
- **`VEHICLES` hardcoded nel JS** duplica i dati della tabella `mezzi` su
  Supabase: un cambio futuro di `slot_step_minuti`/`durata_slot_minuti` in
  DB richiede comunque un aggiornamento manuale sincronizzato del JS, come
  oggi. Il piano non introduce un fetch dinamico da `mezzi`, per non
  cambiare comportamento oltre lo scope richiesto — è un possibile
  miglioramento futuro da valutare separatamente.
- File obsoleti in repo (`admin.html`, `booking.html`, `backend/`,
  `README.md` — vedi §1): non li ho toccati. Se si vuole, propongo come
  passo separato di aggiornare il `README.md` per riflettere l'architettura
  reale (Supabase, non Node/PostgreSQL) e di decidere se archiviare o
  rimuovere gli altri tre.

## 7. Stato di avanzamento

- ✅ **Fase 1 — estrazione CSS completata** (commit successivo a questo
  documento). Il blocco `<style>` di ~1950 righe è stato spostato in 4 file
  sotto `css/` (`01-base.css`, `02-layout-slots.css`, `03-mobile-misc.css`,
  `04-admin-2step.css`), **preservando esattamente l'ordine originale delle
  regole** (fondamentale: in CSS l'ordine determina quale regola vince a
  parità di specificità). Verifica fatta:
  - diff testuale: la concatenazione dei 4 file nuovi è **byte-per-byte
    identica** al CSS originale estratto da `index.html`;
  - verifica visiva: pagina caricata in un browser headless (Chromium via
    Playwright) con un client Supabase finto (per evitare chiamate reali),
    screenshot della schermata di login confrontato prima/dopo la modifica
    → **hash SHA-256 identico**, nessuna differenza di un solo pixel.
  - Nessuna riga di JavaScript è stata toccata in questa fase.
- ✅ **Fase 2 — estrazione costanti/dati completata** (commit successivo).
  `VEHICLES` (elenco baie), `ADMIN_EMAIL_CONST`, `ADMIN_UID` e `SB_SVC`
  (chiave service_role) sono stati spostati in `js/config.js`, caricato con
  un normale `<script>` (non un modulo) prima dello script principale:
  restano dichiarazioni "top-level" visibili per nome anche nel file
  successivo, quindi nessun riferimento nel codice esistente è cambiato.
  Anche i valori di default di `SB_URL`/`SB_KEY` (URL progetto e chiave
  anon) sono stati spostati come costanti `SUPABASE_URL_DEFAULT` /
  `SUPABASE_ANON_KEY_DEFAULT`, mantenendo invariata la logica che le
  assegna/sovrascrive a runtime (modalità offline, pagina di setup).
  La chiave `service_role` **resta incorporata lato client come prima**
  (isolata in un file dedicato per essere facile da individuare, non
  rimossa: è un problema di sicurezza indipendente, fuori scope qui).
  Verifica fatta:
  - controllo sintassi (`node --check`) sia sul file di configurazione sia
    sullo script principale modificato;
  - rendering in Chromium headless con client Supabase finto, sia sulla
    schermata di login (screenshot identico byte-per-byte a prima della
    modifica) sia **simulando un utente già autenticato**, per far
    eseguire davvero il codice che usa `VEHICLES` in profondità (schermata
    di scelta baia): risultato corretto, "Fogli" e "Scatole" mostrate con
    i rispettivi conteggi di slot liberi, "Depositi" correttamente nascosta
    perché l'utente demo non è ZINI né admin — la regola di business è
    rimasta intatta.
- ⏳ Fasi 3–7 (layer Supabase, calcolo slot, rendering, admin, export) non
  ancora eseguite: toccano la logica applicativa condivisa (le variabili
  `let` di stato) e vanno fatte una alla volta con verifica funzionale
  approfondita — vedi rischi al §2 e §6.

## 8. Prossimi passi

1. Confermare se procedere con le fasi successive (2–7) e in che ordine.
2. Decidere se aggiornare/rimuovere i file obsoleti di cui al §1/§6.
3. Se si procede, eseguire una fase alla volta, con verifica della checklist
   di §5 dopo ciascuna, prima di passare alla successiva.
