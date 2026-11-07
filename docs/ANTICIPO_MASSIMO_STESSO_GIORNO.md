# Anticipo massimo per prenotazioni Tavola/Zini fatte lo stesso giorno

## Cosa fa

Per i trasportatori **Tavola** e **Zini**, su **Fogli** e **Scatole**, una
prenotazione fatta per **oggi** è permessa solo se lo slot scelto inizia
entro **3 ore e 15 minuti** da adesso — altrimenti viene respinta.

**Eccezione**: la fascia **06:00–08:00** resta sempre prenotabile
liberamente, anche lo stesso giorno, senza questo limite.

**Non tocca**:
- gli altri trasportatori (CMF, Soc. Coop. Evolution, Autotrasporti
  Colombo, World Express, Vitrans, TML) — nessuna restrizione per loro;
- Depositi — regola non richiesta per questa baia;
- prenotazioni fatte con giorni di anticipo per una data futura — nessun
  limite, resta sempre possibile prenotare in anticipo;
- l'admin — sempre esente, come per tutte le altre regole già esistenti.

## Lato database (autorevole)

Nuovo trigger `trg_anticipo_massimo_stesso_giorno` (funzione
`verifica_anticipo_massimo_stesso_giorno`), indipendente dal trigger
`trg_anticipo_minimo` già esistente (oggi inattivo, nessun valore
configurato) — regola diversa per forma: scoped per nome trasportatore e
fascia oraria esente, non un semplice numero minimo per baia.

Stesso pattern delle altre regole di business: `SECURITY DEFINER`, bypass
se `auth.uid()` è l'admin, e su UPDATE si applica solo se baia/data/slot
cambiano davvero (modificare destinazione/targa di una prenotazione già
confermata non si blocca retroattivamente).

**Verificato con test reali** (attraverso la stessa RPC
`create_prenotazione` usata dal sito, con dati di prova cancellati subito
dopo), il 07/11/2026:
1. Tavola, Fogli, oggi, slot entro 3h15 → **accettato**.
2. Tavola, Fogli, oggi, slot oltre 3h15 → **respinto**, messaggio chiaro.
3. Zini, Scatole, oggi, slot oltre 3h15 → **respinto** (stessa regola,
   baia diversa).
4. CMF (non Tavola/Zini), stesso slot oltre 3h15 → **accettato** (la
   regola non lo riguarda).
5. Admin, Tavola, stesso slot oltre 3h15 → **accettato** (bypass).
6. Tavola, Fogli, **domani**, slot qualsiasi → **accettato** (la regola
   vale solo per oggi).

La fascia esente 06:00–08:00 è stata verificata leggendo direttamente
l'orario calcolato da `orario_da_slot()` per i primi slot di Fogli/Scatole
(confermato il confronto `>= 06:00 AND < 08:00`), non con un inserimento
dal vivo: essendo già passate le 10 del mattino al momento della verifica,
quella fascia era già nel passato per oggi e non testabile end-to-end in
quel momento senza aspettare il giorno dopo molto presto.

## Lato sito

- `js/slots.js`: nuova funzione `isTooFarAheadToday(vehicleId, dataStr, slotIdx, nome)`
  (accanto a `isTooSoon`, stesso motivo di posizionamento: deve restare
  visibile sia dalla griglia sia da `createBooking()` in
  `js/bookings-api.js`, che è un file caricato prima di `js/app-ui.js` —
  quest'ultimo è un'unica IIFE, vedi `docs/ANTICIPO_MINIMO_PRENOTAZIONE.md`
  per il bug di scope già corretto in passato per lo stesso motivo).
- `js/app-ui.js`: `renderGrid()` (slot non cliccabile, etichetta "Non
  prenotabile oggi"), `updateStats()` (escluso dai "liberi"),
  `openUserEditModal()` (escluso dalla tendina di spostamento).
- `js/bookings-api.js`: pre-check in `createBooking()` per il messaggio
  immediato prima di contattare il server.

**Verificato con test in browser headless** (non solo controllo
sintattico — lezione imparata dal bug precedente): slot oltre 3h15 per
Tavola respinto correttamente con il messaggio giusto; slot entro 3h15
accettato; CMF (non coinvolto) sempre accettato indipendentemente dalla
distanza. Nessun errore di scope cross-file.
