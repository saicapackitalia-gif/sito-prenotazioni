#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Abbinamento camion non pieni per zone limitrofe
================================================

Legge un file Excel con gli ordini della settimana successiva e propone
abbinamenti tra carichi (camion) non pieni le cui destinazioni sono
vicine tra loro (entro un raggio configurabile), per ridurre il numero
di viaggi.

Regola di tariffazione applicata (come indicato dall'azienda):
    il costo di un viaggio (anche con più tappe/destinazioni) è pari
    alla tariffa calcolata sulla destinazione più lontana DAL PUNTO DI
    PARTENZA (stabilimento). Le tappe intermedie non aggiungono costo.

Conseguenza (dimostrazione, non un'assunzione aggiuntiva):
    se due carichi A e B vengono uniti in un solo viaggio, il nuovo
    costo è  rate * max(distA, distB)  (dove distX = distanza dal punto
    di partenza alla destinazione più lontana del carico X).
    Il risparmio è quindi:
        risparmio = costo(A) + costo(B) - costo(A unito a B)
                  = rate * distA + rate * distB - rate * max(distA, distB)
                  = rate * min(distA, distB)
    cioè si risparmia sempre l'intero costo del carico "più corto",
    a patto che l'unione sia fisicamente possibile (capacità e raggio).

LIMITI IMPORTANTI (leggere prima dell'uso):
  - Le distanze sono calcolate "in linea d'aria" (formula di haversine)
    tra le coordinate del CAP, eventualmente corrette con un fattore
    "--road-factor" per approssimare la distanza stradale reale. NON è
    la distanza stradale effettiva: per un dato preciso servirebbe un
    servizio di routing stradale (es. Google Distance Matrix, OSRM).
  - Le coordinate dei CAP vengono cercate, in ordine di priorità:
      1) nel file CSV passato con --cap-coords (se fornito),
      2) tramite la libreria "pgeocode" (dati GeoNames, scaricati al
         primo utilizzo: richiede una connessione internet la prima
         volta che si esegue lo script; i dati sono centroidi
         approssimati del CAP, non l'indirizzo esatto).
    Se un CAP non viene trovato in nessuna delle due fonti, l'ordine/
    carico corrispondente NON viene considerato per gli abbinamenti e
    viene segnalato a parte nel file di output.
  - L'algoritmo di raggruppamento e abbinamento è euristico (greedy):
    trova buone soluzioni pratiche ma non garantisce l'ottimo assoluto
    (il problema è, in generale, NP-difficile).
  - Il modello di costo assume che l'unica variabile sia il km-rate
    sulla destinazione più lontana. Se nella realtà esistono costi fissi
    per tappa, tempi di guida massimi, finestre orarie di consegna o
    vincoli di compatibilità merce, questo script non li considera:
    va usato come supporto decisionale, non come automatismo cieco.

Formato del file Excel di input (nomi colonna case-insensitive, sono
accettate varianti comuni indicate tra parentesi):
  - CAP destinazione (anche solo "CAP")                    [obbligatoria]
  - Ml occupati (metri lineari occupati sul camion)         [obbligatoria
    OPPURE, in alternativa, "N. pallet" + parametro --ml-per-pallet]     se manca Ml occupati]
  - Data consegna (anche solo "Data")                       [opzionale:
    se assente, tutti gli ordini sono trattati come un unico giorno]
  - Camion / Viaggio (id del carico, se gli ordini sono già
    raggruppati in viaggi da un altro sistema)               [opzionale:
    se assente, lo script raggruppa da solo gli ordini in carichi]
  - Cliente, Comune, Rif. ordine                             [opzionali,
    solo per leggibilità nell'output]

Esempio d'uso:
    python truck_matching.py ordini_settimana.xlsx \
        --origin-cap 20100 \
        --capacity-ml 13.6 \
        --radius-km 20 \
        --fill-threshold 0.95 \
        --rate-per-km 1.50 \
        --output abbinamenti_proposti.xlsx
"""

from __future__ import annotations

import argparse
import math
import sys
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd


# --------------------------------------------------------------------------
# Utility
# --------------------------------------------------------------------------

def _normalize(name: str) -> str:
    """Normalizza un nome di colonna per un confronto tollerante
    (minuscolo, senza accenti, senza spazi/punti extra)."""
    name = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    name = name.lower().strip()
    for ch in [".", "_", "-"]:
        name = name.replace(ch, " ")
    return " ".join(name.split())


COLUMN_ALIASES = {
    "cap": ["cap", "cap destinazione", "codice postale", "cap dest"],
    "ml": ["ml occupati", "ml", "metri lineari", "metri lineari occupati"],
    "pallet": ["n pallet", "numero pallet", "pallet", "n. pallet"],
    "data": ["data consegna", "data", "data spedizione", "data di consegna"],
    "camion": ["camion", "viaggio", "id camion", "id viaggio", "truck"],
    "cliente": ["cliente", "ragione sociale"],
    "comune": ["comune", "citta", "città"],
    "rif_ordine": ["rif ordine", "riferimento ordine", "n ordine", "numero ordine", "ordine"],
}


def _find_column(df: pd.DataFrame, key: str) -> Optional[str]:
    normalized = {_normalize(c): c for c in df.columns}
    for alias in COLUMN_ALIASES[key]:
        if alias in normalized:
            return normalized[alias]
    return None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distanza in linea d'aria (great-circle) in km tra due punti."""
    r = 6371.0088  # raggio medio terrestre in km
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------
# Caricamento coordinate CAP
# --------------------------------------------------------------------------

def load_cap_coordinates(csv_path: Optional[str], needed_caps: set[str],
                          use_pgeocode: bool) -> tuple[dict[str, tuple[float, float]], list[str]]:
    """Restituisce {cap: (lat, lon)} costruito unendo (in ordine di
    priorità) il CSV utente e pgeocode. Ritorna anche la lista dei CAP
    richiesti che NON sono stati trovati."""
    coords: dict[str, tuple[float, float]] = {}

    if csv_path:
        df = pd.read_csv(csv_path, dtype=str)
        cap_col = _find_column(df, "cap") or "cap"
        lat_col = next((c for c in df.columns if _normalize(c) in ("lat", "latitudine")), None)
        lon_col = next((c for c in df.columns if _normalize(c) in ("lon", "lng", "longitudine")), None)
        if cap_col not in df.columns or lat_col is None or lon_col is None:
            raise ValueError(
                f"Il file --cap-coords deve avere colonne 'cap', 'lat', 'lon' "
                f"(trovate: {list(df.columns)})"
            )
        for _, row in df.iterrows():
            cap = str(row[cap_col]).strip().zfill(5)
            try:
                coords[cap] = (float(row[lat_col]), float(row[lon_col]))
            except (TypeError, ValueError):
                continue

    missing = sorted(c for c in needed_caps if c not in coords)

    if missing and use_pgeocode:
        try:
            import pgeocode  # import ritardato: opzionale e richiede internet al primo uso
            nomi = pgeocode.Nominatim("IT")
            res = nomi.query_postal_code(missing)
            # query_postal_code puo' restituire una Series (1 cap) o un DataFrame
            if isinstance(res, pd.Series):
                res = res.to_frame().T
            for _, row in res.iterrows():
                cap = str(row.get("postal_code", "")).strip().zfill(5)
                lat, lon = row.get("latitude"), row.get("longitude")
                if cap and pd.notna(lat) and pd.notna(lon):
                    coords[cap] = (float(lat), float(lon))
        except Exception as exc:  # rete assente, libreria non installata, ecc.
            print(f"[ATTENZIONE] Impossibile usare pgeocode ({exc}). "
                  f"Proseguo solo con le coordinate fornite in --cap-coords, se presenti.",
                  file=sys.stderr)

    still_missing = sorted(c for c in needed_caps if c not in coords)
    return coords, still_missing


# --------------------------------------------------------------------------
# Lettura ordini
# --------------------------------------------------------------------------

@dataclass
class Order:
    idx: int
    cap: str
    ml: float
    data: str
    cliente: str = ""
    comune: str = ""
    rif_ordine: str = ""
    camion_originale: Optional[str] = None


def load_orders(path: str, ml_per_pallet: Optional[float]) -> list[Order]:
    df = pd.read_excel(path)

    col_cap = _find_column(df, "cap")
    if col_cap is None:
        raise ValueError(
            "Colonna CAP destinazione non trovata nel file Excel. "
            f"Colonne presenti: {list(df.columns)}"
        )

    col_ml = _find_column(df, "ml")
    col_pallet = _find_column(df, "pallet")
    if col_ml is None and col_pallet is None:
        raise ValueError(
            "Nessuna colonna di riempimento trovata: serve 'Ml occupati' "
            "oppure 'N. pallet' (in questo caso specificare anche --ml-per-pallet). "
            f"Colonne presenti: {list(df.columns)}"
        )
    if col_ml is None and col_pallet is not None and ml_per_pallet is None:
        raise ValueError(
            "Il file usa 'N. pallet' ma non è stato indicato --ml-per-pallet "
            "(metri lineari occupati da un pallet sul tuo camion). "
            "Non uso un valore di default: indicalo esplicitamente per evitare stime errate."
        )

    col_data = _find_column(df, "data")
    col_camion = _find_column(df, "camion")
    col_cliente = _find_column(df, "cliente")
    col_comune = _find_column(df, "comune")
    col_rif = _find_column(df, "rif_ordine")

    orders: list[Order] = []
    for i, row in df.iterrows():
        cap_raw = row[col_cap]
        if pd.isna(cap_raw):
            continue
        cap = str(cap_raw).strip()
        cap = cap.split(".")[0]  # nel caso Excel l'abbia letto come numero float
        cap = cap.zfill(5)

        if col_ml is not None and pd.notna(row[col_ml]):
            ml = float(row[col_ml])
        else:
            n_pallet = float(row[col_pallet]) if pd.notna(row[col_pallet]) else 0.0
            ml = n_pallet * ml_per_pallet

        data_val = str(row[col_data]) if col_data is not None and pd.notna(row[col_data]) else "N/D"
        camion_val = str(row[col_camion]) if col_camion is not None and pd.notna(row[col_camion]) else None

        orders.append(Order(
            idx=i,
            cap=cap,
            ml=ml,
            data=data_val,
            cliente=str(row[col_cliente]) if col_cliente is not None and pd.notna(row[col_cliente]) else "",
            comune=str(row[col_comune]) if col_comune is not None and pd.notna(row[col_comune]) else "",
            rif_ordine=str(row[col_rif]) if col_rif is not None and pd.notna(row[col_rif]) else "",
            camion_originale=camion_val,
        ))

    return orders


# --------------------------------------------------------------------------
# Costruzione carichi (fase 1)
# --------------------------------------------------------------------------

@dataclass
class Load:
    id: str
    data: str
    orders: list[Order] = field(default_factory=list)

    @property
    def ml_totali(self) -> float:
        return sum(o.ml for o in self.orders)


def pairwise_max_distance(caps_a: list[str], caps_b: list[str], coords: dict) -> float:
    return max(
        haversine_km(*coords[a], *coords[b])
        for a in caps_a for b in caps_b
    )


def build_loads_from_orders(orders: list[Order], coords: dict, capacity_ml: float,
                             radius_km: float) -> list[Load]:
    """Se gli ordini non sono già raggruppati in camion/viaggi, li
    raggruppa da solo: greedy per data, aggregando ordini le cui
    destinazioni restano reciprocamente entro il raggio indicato,
    fino a saturare la capacità del camion."""
    loads: list[Load] = []
    by_date: dict[str, list[Order]] = {}
    for o in orders:
        by_date.setdefault(o.data, []).append(o)

    for data, day_orders in by_date.items():
        geolocated = [o for o in day_orders if o.cap in coords]
        remaining = sorted(geolocated, key=lambda o: o.ml, reverse=True)
        counter = 1
        while remaining:
            seed = remaining.pop(0)
            current = [seed]
            used_ml = seed.ml
            changed = True
            while changed:
                changed = False
                best, best_dist = None, None
                for cand in remaining:
                    maxd = pairwise_max_distance([o.cap for o in current], [cand.cap], coords)
                    if maxd <= radius_km and used_ml + cand.ml <= capacity_ml:
                        if best is None or maxd < best_dist:
                            best, best_dist = cand, maxd
                if best is not None:
                    current.append(best)
                    used_ml += best.ml
                    remaining.remove(best)
                    changed = True
            loads.append(Load(id=f"AUTO-{data}-{counter}", data=data, orders=current))
            counter += 1

    return loads


def build_loads_from_existing_grouping(orders: list[Order]) -> list[Load]:
    groups: dict[tuple[str, str], Load] = {}
    for o in orders:
        key = (o.data, o.camion_originale or "")
        if key not in groups:
            groups[key] = Load(id=str(o.camion_originale), data=o.data)
        groups[key].orders.append(o)
    return list(groups.values())


# --------------------------------------------------------------------------
# Fase 2: individuazione carichi non pieni e proposta di abbinamenti
# --------------------------------------------------------------------------

def farthest_distance_from_origin(load: Load, origin: tuple[float, float], coords: dict) -> float:
    return max(haversine_km(origin[0], origin[1], *coords[o.cap]) for o in load.orders)


def try_merge_underfilled(loads: list[Load], coords: dict, origin: tuple[float, float],
                           capacity_ml: float, radius_km: float, fill_threshold: float,
                           rate_per_km: Optional[float], road_factor: float):
    """Raggruppa (per data) i carichi sotto soglia di riempimento e
    prova a unirli con un algoritmo greedy analogo alla fase 1, ma
    controllando anche il vincolo di capacità del carico unito."""
    merge_groups = []  # lista di liste di Load unite insieme
    unmerged = []       # Load rimasti da soli (sotto soglia ma senza abbinamento)
    full_loads = []     # Load già pieni, non toccati

    by_date: dict[str, list[Load]] = {}
    for l in loads:
        by_date.setdefault(l.data, []).append(l)

    for data, day_loads in by_date.items():
        underfilled, fulls = [], []
        for l in day_loads:
            geolocated_all = all(o.cap in coords for o in l.orders)
            if not geolocated_all:
                unmerged.append(l)  # non geolocalizzabile del tutto -> non abbinabile
                continue
            if l.ml_totali < capacity_ml * fill_threshold:
                underfilled.append(l)
            else:
                fulls.append(l)
        full_loads.extend(fulls)

        remaining = sorted(underfilled, key=lambda l: l.ml_totali, reverse=True)
        while remaining:
            seed = remaining.pop(0)
            group = [seed]
            used_ml = seed.ml_totali
            changed = True
            while changed:
                changed = False
                best, best_dist = None, None
                current_caps = [o.cap for l in group for o in l.orders]
                for cand in remaining:
                    cand_caps = [o.cap for o in cand.orders]
                    maxd = pairwise_max_distance(current_caps, cand_caps, coords)
                    if maxd <= radius_km and used_ml + cand.ml_totali <= capacity_ml:
                        if best is None or maxd < best_dist:
                            best, best_dist = cand, maxd
                if best is not None:
                    group.append(best)
                    used_ml += best.ml_totali
                    remaining.remove(best)
                    changed = True
            if len(group) > 1:
                merge_groups.append(group)
            else:
                unmerged.append(group[0])

    def cost(load_or_group):
        loads_in = load_or_group if isinstance(load_or_group, list) else [load_or_group]
        all_orders = [o for l in loads_in for o in l.orders]
        dist = max(haversine_km(origin[0], origin[1], *coords[o.cap]) for o in all_orders) * road_factor
        return dist, (dist * rate_per_km if rate_per_km is not None else None)

    return merge_groups, unmerged, full_loads, cost


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def write_output(path: str, merge_groups, unmerged, full_loads, cost_fn,
                  rate_per_km: Optional[float], missing_caps: list[str]):
    rows_merge = []
    for gi, group in enumerate(merge_groups, start=1):
        merged_dist, merged_cost = cost_fn(group)
        for l in group:
            solo_dist, solo_cost = cost_fn(l)
            rows_merge.append({
                "Gruppo abbinamento": f"G{gi}",
                "Data": l.data,
                "Camion/Carico originale": l.id,
                "N. ordini": len(l.orders),
                "Ml occupati carico": round(l.ml_totali, 2),
                "CAP destinazioni": ", ".join(sorted({o.cap for o in l.orders})),
                "Distanza da origine se da solo (km)": round(solo_dist, 1),
                "Costo se da solo (€)": round(solo_cost, 2) if solo_cost is not None else "",
                "Distanza gruppo unito (km)": round(merged_dist, 1),
                "Costo gruppo unito (€)": round(merged_cost, 2) if merged_cost is not None else "",
            })
    df_merge = pd.DataFrame(rows_merge)

    riepilogo = []
    for gi, group in enumerate(merge_groups, start=1):
        merged_dist, merged_cost = cost_fn(group)
        somma_costi_singoli = sum(cost_fn(l)[1] for l in group) if rate_per_km is not None else None
        ml_tot = sum(l.ml_totali for l in group)
        capacity_note = ""
        riepilogo.append({
            "Gruppo abbinamento": f"G{gi}",
            "N. carichi uniti": len(group),
            "Ml totali carico unito": round(ml_tot, 2),
            "Distanza destinazione più lontana (km)": round(merged_dist, 1),
            "Costo viaggi separati (€)": round(somma_costi_singoli, 2) if somma_costi_singoli is not None else "",
            "Costo viaggio unico (€)": round(merged_cost, 2) if merged_cost is not None else "",
            "Risparmio stimato (€)": round(somma_costi_singoli - merged_cost, 2) if somma_costi_singoli is not None else "",
        })
    df_riepilogo = pd.DataFrame(riepilogo)

    rows_unmerged = []
    for l in unmerged:
        can_price = all(o.cap not in missing_caps for o in l.orders)
        dist, cst = cost_fn(l) if can_price else (None, None)
        rows_unmerged.append({
            "Data": l.data,
            "Camion/Carico": l.id,
            "N. ordini": len(l.orders),
            "Ml occupati": round(l.ml_totali, 2),
            "CAP destinazioni": ", ".join(sorted({o.cap for o in l.orders})),
            "Motivo": "CAP non geolocalizzato" if not can_price else "Nessuna zona vicina abbinabile entro il raggio/capacità",
            "Distanza da origine (km)": round(dist, 1) if dist is not None else "",
            "Costo (€)": round(cst, 2) if cst is not None else "",
        })
    df_unmerged = pd.DataFrame(rows_unmerged)

    rows_full = []
    for l in full_loads:
        dist, cst = cost_fn(l)
        rows_full.append({
            "Data": l.data,
            "Camion/Carico": l.id,
            "N. ordini": len(l.orders),
            "Ml occupati": round(l.ml_totali, 2),
            "CAP destinazioni": ", ".join(sorted({o.cap for o in l.orders})),
            "Distanza da origine (km)": round(dist, 1),
            "Costo (€)": round(cst, 2) if cst is not None else "",
        })
    df_full = pd.DataFrame(rows_full)

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df_riepilogo.to_excel(writer, sheet_name="Riepilogo abbinamenti", index=False)
        df_merge.to_excel(writer, sheet_name="Dettaglio abbinamenti", index=False)
        df_unmerged.to_excel(writer, sheet_name="Non abbinati", index=False)
        df_full.to_excel(writer, sheet_name="Camion già pieni", index=False)
        if missing_caps:
            pd.DataFrame({"CAP non trovato": missing_caps}).to_excel(
                writer, sheet_name="CAP non geolocalizzati", index=False)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(
        description="Propone abbinamenti tra camion non pieni per zone limitrofe.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", help="File Excel con gli ordini della settimana")
    p.add_argument("--output", default="abbinamenti_proposti.xlsx", help="File Excel di output")
    p.add_argument("--origin-cap", required=True,
                   help="CAP del punto di partenza (stabilimento): serve per calcolare la "
                        "distanza alla destinazione più lontana, base della tariffa. "
                        "Obbligatorio: non viene assunto un valore di default.")
    p.add_argument("--capacity-ml", type=float, default=13.6,
                   help="Capacità massima del camion in metri lineari (default: 13.6, "
                        "valore tipico di un semirimorchio standard: VERIFICARE che "
                        "corrisponda ai propri mezzi).")
    p.add_argument("--radius-km", type=float, default=20.0,
                   help="Raggio (km) entro cui due destinazioni sono considerate 'vicine' (default: 20).")
    p.add_argument("--fill-threshold", type=float, default=0.95,
                   help="Soglia di riempimento sotto la quale un camion è considerato "
                        "'non pieno' (default: 0.95 = 95%%).")
    p.add_argument("--rate-per-km", type=float, default=None,
                   help="Tariffa in euro/km, per stimare il risparmio in euro. "
                        "Se omessa, il report mostra solo le distanze (km).")
    p.add_argument("--road-factor", type=float, default=1.0,
                   help="Fattore moltiplicativo per approssimare la distanza stradale a "
                        "partire dalla distanza in linea d'aria (default: 1.0, nessuna "
                        "correzione). Esempio: 1.3 se si stima che le strade siano "
                        "mediamente il 30%% più lunghe del rettilineo.")
    p.add_argument("--ml-per-pallet", type=float, default=None,
                   help="Metri lineari occupati da un pallet sul camion. Obbligatorio "
                        "solo se il file di input usa 'N. pallet' invece di 'Ml occupati'.")
    p.add_argument("--cap-coords", default=None,
                   help="CSV opzionale con colonne cap,lat,lon: coordinate note dei CAP, "
                        "usate con priorità rispetto a pgeocode.")
    p.add_argument("--no-pgeocode", action="store_true",
                   help="Non usare la libreria pgeocode (utile se non c'è connessione "
                        "internet): verranno usate solo le coordinate di --cap-coords.")
    args = p.parse_args()

    origin_cap = str(args.origin_cap).strip().zfill(5)

    print(f"[INFO] Capacità camion: {args.capacity_ml} ml — verificare che sia corretta per la propria flotta.")
    print(f"[INFO] Raggio di vicinanza: {args.radius_km} km | Soglia 'non pieno': {args.fill_threshold*100:.0f}%")
    if args.rate_per_km is None:
        print("[INFO] Nessuna tariffa (--rate-per-km) indicata: il report mostrerà solo le distanze in km, non il risparmio in euro.")

    try:
        orders = load_orders(args.input, args.ml_per_pallet)
    except ValueError as exc:
        print(f"[ERRORE] {exc}", file=sys.stderr)
        sys.exit(1)
    if not orders:
        print("[ERRORE] Nessun ordine valido trovato nel file di input.", file=sys.stderr)
        sys.exit(1)

    needed_caps = {o.cap for o in orders} | {origin_cap}
    try:
        coords, missing = load_cap_coordinates(args.cap_coords, needed_caps, use_pgeocode=not args.no_pgeocode)
    except ValueError as exc:
        print(f"[ERRORE] {exc}", file=sys.stderr)
        sys.exit(1)

    if origin_cap in missing:
        print(f"[ERRORE] Impossibile geolocalizzare il CAP di origine {origin_cap}. "
              f"Fornisci --cap-coords con questa voce, oppure verifica la connessione a internet per pgeocode.",
              file=sys.stderr)
        sys.exit(1)
    origin = coords[origin_cap]

    if missing:
        print(f"[ATTENZIONE] {len(missing)} CAP non geolocalizzati (esclusi dagli abbinamenti): {missing}")

    has_existing_grouping = any(o.camion_originale for o in orders)
    if has_existing_grouping:
        print("[INFO] Rilevata colonna Camion/Viaggio: uso il raggruppamento già presente nel file.")
        loads = build_loads_from_existing_grouping(orders)
    else:
        print("[INFO] Nessuna colonna Camion/Viaggio trovata: raggruppo gli ordini in carichi automaticamente.")
        loads = build_loads_from_orders(orders, coords, args.capacity_ml, args.radius_km)

    merge_groups, unmerged, full_loads, cost_fn = try_merge_underfilled(
        loads, coords, origin, args.capacity_ml, args.radius_km, args.fill_threshold,
        args.rate_per_km, args.road_factor,
    )

    write_output(args.output, merge_groups, unmerged, full_loads, cost_fn, args.rate_per_km, missing)

    print(f"[OK] {len(loads)} carichi analizzati -> {len(merge_groups)} abbinamenti proposti, "
          f"{len(unmerged)} carichi non pieni senza abbinamento, {len(full_loads)} già pieni.")
    print(f"[OK] Report salvato in: {args.output}")


if __name__ == "__main__":
    main()
