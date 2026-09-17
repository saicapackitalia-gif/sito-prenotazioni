# Nota: versione nei link a CSS/JS (cache-busting)

## Il problema

`index.html` ha sempre impedito al browser di tenere in cache **la pagina
stessa** (i meta tag `Cache-Control`/`Pragma`/`Expires` in `<head>`). Questo
però non copre i file `.js`/`.css` che la pagina carica separatamente
(`<script src="js/...">`, `<link href="css/...">`): quelli restano soggetti
alla cache normale del browser. Risultato pratico: dopo aver pubblicato una
correzione, un browser che aveva già visitato il sito poteva continuare a
usare una versione vecchia di un file JavaScript anche per giorni, pur
vedendo l'HTML aggiornato — dando l'impressione che una correzione non
fosse stata applicata quando in realtà lo era, solo non ancora "vista" da
quel browser.

## La correzione

Ogni riferimento a un file locale (`css/*.css`, `js/*.js`) ora include
`?v=AAAAMMGGx` in fondo all'URL (es. `js/slots.js?v=20260910a`). Cambiare
questa stringa forza tutti i browser a scaricare di nuovo il file, perché
per il browser è un URL diverso.

**Da fare ad ogni futura modifica a un file CSS o JS**: aggiornare la
stringa di versione su TUTTI i riferimenti in `index.html` (undici in
totale: 4 CSS + 6 JS + il tag `<script>` di `app-ui.js`), non solo sul file
effettivamente cambiato — così è sempre ovvio, guardando `index.html`, se
tutto è alla stessa versione. Se in futuro qualcuno segnala "ho aggiornato
ma non vedo la modifica", il primo sospetto è la cache del browser
(consigliare Ctrl+Shift+R / Cmd+Shift+R) — ma controllare comunque che
`index.html` abbia davvero la stringa di versione aggiornata.
