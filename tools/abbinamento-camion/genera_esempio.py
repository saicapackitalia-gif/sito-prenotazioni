#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera un file Excel di ESEMPIO (dati fittizi) per provare truck_matching.py.

Uso:
    python genera_esempio.py
    python truck_matching.py ordini_esempio.xlsx --origin-cap 20100 \
        --cap-coords cap_coordinates_esempio.csv --no-pgeocode \
        --rate-per-km 1.5 --output abbinamenti_esempio.xlsx
"""

import pandas as pd

righe = [
    # Data,        Camion, CAP,     Cliente,               Ml occupati
    ("2026-09-21", "T1", "20100", "Cliente A - Milano",  5.0),   # non pieno -> si abbina a T2 (14.9 km)
    ("2026-09-21", "T2", "20900", "Cliente B - Monza",   4.0),   # non pieno -> si abbina a T1
    ("2026-09-21", "T3", "00100", "Cliente C - Roma",   13.0),   # già pieno (95.6%): non toccato
    ("2026-09-21", "T4", "24121", "Cliente D - Bergamo", 3.5),   # non pieno, nessuna zona vicina entro 20 km
    ("2026-09-22", "T5", "10121", "Cliente E - Torino",  6.0),   # non pieno, isolato
    ("2026-09-22", "T6", "40121", "Cliente F - Bologna", 6.5),   # non pieno, isolato
    ("2026-09-22", "T7", "25121", "Cliente G - Brescia", 4.5),   # non pieno, isolato
    ("2026-09-22", "T8", "26100", "Cliente H - Cremona", 3.0),   # non pieno, isolato
]

df = pd.DataFrame(righe, columns=["Data consegna", "Camion", "CAP destinazione", "Cliente", "Ml occupati"])
df.to_excel("ordini_esempio.xlsx", index=False)
print("Creato ordini_esempio.xlsx con", len(df), "ordini di esempio.")
