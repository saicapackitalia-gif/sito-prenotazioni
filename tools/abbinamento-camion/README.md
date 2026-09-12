# Abbinamento camion non pieni per zone limitrofe

Script Python standalone (non collegato al sito prenotazioni) che legge un
file Excel con gli ordini della settimana successiva e propone quali camion
**non pieni** possono essere **uniti** perché diretti verso destinazioni
vicine tra loro, per ridurre il numero di viaggi.

> ⚠️ Questo tool è uno strumento di **supporto decisionale**: propone
> abbinamenti plausibili in base alle regole descritte sotto, ma il
> responsabile trasporti deve sempre validare la proposta (orari di consegna,
> compatibilità merce, vincoli del cliente, ecc.) prima di applicarla.

## Regola di calcolo del risparmio

Come indicato dall'azienda: **il costo di un viaggio è sempre la tariffa
calcolata sulla destinazione più lontana** (dal punto di partenza/stabilimento),
anche se il camion fa più tappe.

Da questa regola discende (non è un'ipotesi aggiuntiva, è una conseguenza
matematica): se si uniscono due carichi A e B in un solo viaggio,

```
risparmio = costo(A da solo) + costo(B da solo) - costo(A+B insieme)
          = tariffa_km × min(distanza_A, distanza_B)
```

cioè si risparmia **sempre l'intero costo del carico più vicino**, a patto
che l'unione sia fisicamente fattibile (capacità del camion e destinazioni
abbastanza vicine tra loro).

## Cosa serve fornire (parametri obbligatori)

| Parametro | Perché è obbligatorio |
|---|---|
| `--origin-cap` | CAP dello stabilimento/punto di partenza: serve per calcolare la distanza alla destinazione più lontana, base della tariffa. **Non viene assunto nessun valore di default** perché non è un dato che possiamo indovinare. |
| file Excel di input | deve contenere almeno CAP destinazione e riempimento (ml o pallet) di ogni ordine — vedi formato sotto. |

Tutti gli altri parametri hanno un default ragionevole ma **vanno verificati**
prima di fidarsi del risultato (capacità camion, raggio, soglia di
riempimento, tariffa/km — vedi `python truck_matching.py --help`).

## Formato del file Excel di input

Una riga per ordine. Nomi di colonna riconosciuti (case-insensitive, sono
accettate le varianti più comuni):

| Dato | Nomi di colonna accettati | Obbligatorio |
|---|---|---|
| CAP destinazione | `CAP`, `CAP destinazione` | Sì |
| Riempimento | `Ml occupati` **oppure** `N. pallet` (in questo caso serve anche `--ml-per-pallet`) | Sì (una delle due) |
| Data consegna | `Data`, `Data consegna` | No (se assente, tutti gli ordini sono trattati come un unico giorno) |
| Camion/Viaggio | `Camion`, `Viaggio` | No — se presente, il file rispecchia carichi/viaggi già pianificati e lo script ragiona su quelli; se assente, lo script raggruppa da solo gli ordini in carichi (vedi sotto) |
| Cliente, Comune, Rif. ordine | `Cliente`, `Comune`, `Rif. ordine` | No, solo per leggibilità nell'output |

Se il file **non ha** una colonna Camion/Viaggio, lo script raggruppa da
solo gli ordini grezzi in carichi (per data, unendo destinazioni vicine fino
a saturare la capacità) prima di cercare gli abbinamenti tra i carichi
risultanti non pieni.

## Installazione

```bash
cd tools/abbinamento-camion
pip install -r requirements.txt
```

## Uso

```bash
python truck_matching.py ordini_settimana.xlsx \
    --origin-cap 20100 \
    --capacity-ml 13.6 \
    --radius-km 20 \
    --fill-threshold 0.95 \
    --rate-per-km 1.50 \
    --output abbinamenti_proposti.xlsx
```

Per un esempio funzionante con dati fittizi:

```bash
python genera_esempio.py
python truck_matching.py ordini_esempio.xlsx \
    --origin-cap 26100 \
    --cap-coords cap_coordinates_esempio.csv --no-pgeocode \
    --rate-per-km 1.5 \
    --output abbinamenti_esempio.xlsx
```

Il file di output ha 4-5 fogli: **Riepilogo abbinamenti**, **Dettaglio
abbinamenti**, **Non abbinati**, **Camion già pieni** e (se presenti)
**CAP non geolocalizzati**.

## Come vengono trovate le coordinate dei CAP

In ordine di priorità:

1. Un file CSV proprio, passato con `--cap-coords file.csv` (colonne
   `cap,lat,lon`) — consigliato se avete già un dato interno affidabile o se
   non avete accesso a internet dalla macchina che esegue lo script.
2. La libreria `pgeocode` (dati open **GeoNames**), scaricati automaticamente
   al primo utilizzo — richiede internet la prima volta.

Se un CAP non viene trovato in nessuna delle due fonti, l'ordine/carico
corrispondente **non** viene considerato per gli abbinamenti e viene elencato
a parte nel foglio "CAP non geolocalizzati".

## Limiti importanti — leggere prima di fidarsi del risultato

- **Distanza in linea d'aria, non stradale.** Le distanze sono calcolate con
  la formula di haversine tra le coordinate del CAP (centroide approssimato),
  non con un vero instradamento stradale. Due punti a 20 km in linea d'aria
  possono essere a 30-35 km di strada reale. Il parametro `--road-factor`
  permette di applicare un moltiplicatore correttivo grezzo (es. `1.3`), ma
  resta una stima. Per un dato preciso servirebbe un servizio di routing
  stradale (Google Distance Matrix, OSRM, ecc.), non incluso in questo script.
- **Coordinate dei CAP approssimate.** Sia il CSV di esempio incluso sia i
  dati GeoNames usati da `pgeocode` rappresentano un punto centrale/medio del
  CAP, non l'indirizzo esatto del cliente. Per CAP molto estesi (grandi
  città) l'approssimazione può essere di qualche km.
- **Algoritmo euristico, non ottimo garantito.** Il raggruppamento e gli
  abbinamenti usano un algoritmo greedy (semplice e trasparente, non una
  "scatola nera"): trova buone soluzioni pratiche ma il problema è in
  generale NP-difficile, quindi non è garantito l'abbinamento
  matematicamente migliore possibile.
- **Il modello di costo considera solo il km-rate sulla destinazione più
  lontana.** Se nella realtà esistono anche costi fissi per tappa aggiuntiva,
  limiti di orario di guida, finestre di consegna dei clienti o vincoli di
  compatibilità merce, questo script non li conosce e non li applica.
- **Capacità camion default (13.6 ml).** È il valore tipico di un
  semirimorchio standard europeo, ma va verificato/corretto con
  `--capacity-ml` in base alla flotta reale dell'azienda.
- **Nessun dato aziendale reale è incluso.** Il file
  `cap_coordinates_esempio.csv` contiene coordinate di alcune città italiane
  note, usate solo per la demo in `genera_esempio.py`; non è un database
  completo dei CAP italiani e non va usato in produzione al posto di un dato
  verificato o di `pgeocode`.

## Prossimi passi possibili (non implementati)

- Instradamento stradale reale al posto della distanza in linea d'aria.
- Vincoli aggiuntivi (finestre orarie, compatibilità merce, max soste).
- Interfaccia web/upload invece di riga di comando, se utile all'uso
  quotidiano.
