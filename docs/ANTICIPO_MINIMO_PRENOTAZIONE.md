# Anticipo minimo di prenotazione (Fogli/Scatole)

> **Bug corretto il 22/09/2026, poche ore dopo la messa online**: un
> trasportatore (Zini) segnalava di non riuscire a prenotare Scatole per un
> orario ben oltre i 31 minuti richiesti. Non era la regola a bloccarlo: era
> un errore JavaScript reale (`isTooSoon is not defined`) che mandava in
> crash `createBooking()` PRIMA ancora di contattare il server, per
> qualunque prenotazione su Fogli/Scatole, indipendentemente dall'orario.
> Causa: `isTooSoon()` era stata definita dentro `js/app-ui.js`, che è
> l'intero file racchiuso in una IIFE — non visibile da `js/bookings-api.js`
> (un altro `<script>`, caricato prima), che la chiamava. La griglia
> mostrava tutto correttamente (stessa IIFE di `renderGrid()`), ma
> confermare la prenotazione falliva sempre. Corretto spostando la funzione
> in `js/slots.js` (già globale, già usata da entrambi i file per lo stesso
> motivo), con una firma basata su parametri diretti
> (`vehicleId, dataStr, slotIdx`) invece che sullo stato dell'interfaccia.
> Verificato con un test in browser headless: prenotazione ben nei tempi
> (+3h) ora va a buon fine, prenotazione troppo vicina (+10 min) continua a
> essere respinta correttamente con il messaggio giusto.

## Cosa fa

Un trasportatore non può più prenotare (o spostare una prenotazione su) uno
slot che parte tra meno di:
- **46 minuti** su **Fogli**
- **31 minuti** su **Scatole**

Obiettivo: evitare che qualcuno prenoti solo dopo essere già arrivato allo
stabilimento, lasciando il personale senza preavviso.

**L'admin è sempre esente**: può prenotare o modificare a qualsiasi orario,
come già per le altre regole di business (slot consecutivi, ecc.).

**Depositi non ha questa regola** (nessun valore configurato), su richiesta
esplicita — resta prenotabile come prima.

## Lato database (autorevole)

Migrazione `anticipo_minimo_prenotazione`:
- Nuova colonna `mezzi.min_anticipo_minuti` (nullable — NULL = nessuna
  regola). Valorizzata a 46 per `baia-1` (Fogli), 31 per `baia-2` (Scatole).
- Nuovo trigger `trg_anticipo_minimo` (BEFORE INSERT OR UPDATE su
  `prenotazioni`) con la funzione `verifica_anticipo_minimo()`: calcola
  l'orario reale dello slot (fuso `Europe/Rome`, stessa funzione
  `orario_da_slot()` già usata altrove) e lo confronta con `now()`.
  - Esente se `auth.uid()` è l'admin.
  - Su UPDATE, si applica **solo se baia/data/slot cambiano davvero** —
    modificare destinazione o targa di una prenotazione già confermata non
    si blocca retroattivamente solo perché nel frattempo l'orario si è
    avvicinato.

**Verificato con test reali** (attraverso la stessa RPC `create_prenotazione`
usata dal sito, non solo simulazioni dirette), il 22/09/2026:
1. Fogli, slot a ~4 minuti da adesso, trasportatore normale → **respinto**
   con messaggio chiaro.
2. Fogli, slot a ~1h33m da adesso, trasportatore normale → **accettato**.
3. Fogli, stesso slot troppo vicino del punto 1, ma come **admin** →
   **accettato** (bypass confermato).
4. Scatole, slot a ~2 minuti da adesso, trasportatore normale → **respinto**
   con la soglia corretta di 31 minuti (non 46, confermando che legge il
   valore giusto per baia).

Dati di prova cancellati subito dopo ogni test, nessun dato reale toccato.

## Lato sito (questa PR)

- `js/config.js`: nuovo campo `VEHICLES[].minAnticipoMinuti` (46 Fogli, 31
  Scatole, assente per Depositi).
- `js/app-ui.js`:
  - nuova funzione `isTooSoon(vehicleId, h, m)` (accanto a `isPast`), stesso
    principio: esente per l'admin, nessuna regola se `minAnticipoMinuti`
    non è configurato, sempre `false` per giorni futuri (l'anticipo è
    automaticamente sufficiente).
  - `renderGrid()`: gli slot troppo vicini per un trasportatore risultano
    non cliccabili, con etichetta "Anticipo minimo".
  - `updateStats()`: questi slot non vengono più contati come "liberi"
    nelle statistiche mostrate al trasportatore.
  - `openUserEditModal()`: la tendina per spostare una prenotazione esclude
    gli altri slot troppo vicini (lo slot attuale resta comunque selezionabile,
    coerentemente con la regola sul database).
- `js/bookings-api.js`: `createBooking()` ha un pre-check che mostra subito
  il messaggio, prima ancora di contattare il server — il trigger sul
  database resta comunque l'unica fonte autorevole.

Nessuna modifica alle altre regole di business (slot consecutivi, capacità
condivisa, riserva Depositi a ZINI).
