# Fix: prenotazione propria non visibile/modificabile su slot non pieno (Scatole)

## Il problema

Su una baia che permette più di una prenotazione per slot (oggi solo
**Scatole**, `maxPerSlot=2`), quando un trasportatore aveva già una propria
prenotazione in uno slot **non ancora pieno** (es. 1 prenotazione su 2
posti disponibili), la griglia:

- mostrava lo slot genericamente come "Disponibile (1/2)", senza
  evidenziarlo come proprio (nessuna classe `mine`, nessun "✓");
- al clic apriva la modale **"Nuova prenotazione"** invece di **"La mia
  prenotazione"** (modifica/cancellazione).

Scoperto mentre si verificava che Faital potesse vedere e modificare le
proprie prenotazioni (richiesta 25/11/2026): la sua prenotazione su
Scatole 09:00 risultava correttamente contata in "1 Miei" nelle
statistiche, ma non era raggiungibile dalla griglia per modificarla.

**Non è un problema introdotto da Faital né dal database**: verificato con
un test reale (`trasportatore_update_booking` via RPC) che la modifica
lato server funzionava correttamente anche a slot non pieno — il bug era
solo nel rendering/click-handler lato client (`js/app-ui.js`). Riguarda
quindi chiunque abbia una prenotazione su Scatole quando lo slot non è al
completo (2/2), non solo Faital.

## Causa

In `renderGrid()` (`js/app-ui.js`), sia lo stile (`cls`/`txt`) sia il
gestore del clic trattavano "è mia" come un caso speciale **solo dentro
il ramo `isFull && b`**. Se lo slot non era pieno (`isFull === false`),
quel ramo non veniva mai eseguito, quindi:
- restava lo stile generico "Disponibile (x/max)" impostato prima,
  indipendentemente da chi fosse il proprietario;
- il clic ricadeva nella condizione `!isFull && ...` che apre sempre
  `openBookingModal` (nuova prenotazione).

## Fix

Spostato il controllo `b && b.mine` **prima** del controllo `isFull`, sia
nello stile che nel gestore del clic: una propria prenotazione è
evidenziata ("✓ ...", classe `mine`) e apre `openUserEditModal` a
prescindere dal fatto che lo slot sia pieno o no. Quando non è pieno,
l'etichetta mostra anche il conteggio, es. "✓ Ungheria - MHG (1/2)", per
restare chiaro che c'è ancora posto per altri.

Nessuna modifica lato database: la regola di business e i permessi erano
già corretti.

## Verifica

- **Database** (RPC reali, dato di prova `targa='TEST999'`, cancellato
  subito dopo): creata una prenotazione Faital su Scatole con slot ancora
  1/2 occupato; confermato che `trasportatore_update_booking` la modifica
  comunque con successo — nessuna restrizione lato server legata al fatto
  che lo slot non sia pieno.
- **Browser headless (Playwright)**, sito reale servito in locale con
  `window.supabase` simulato (prenotazione Faital, Scatole, slot 09:00,
  1/2 occupato):
  - prima del fix: `outerHTML` dello slot aveva classe `free`, etichetta
    "Disponibile (1/2)"; il clic apriva `modal-overlay` ("Nuova
    prenotazione").
  - dopo il fix: classe `mine`, etichetta "✓ Ungheria - MHG (1/2)"; il
    clic apre `user-edit-overlay` ("La mia prenotazione").
