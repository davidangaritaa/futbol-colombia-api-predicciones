"""Carga los partidos desde la base SQLite de la API (data/futbol.db)."""
import sqlite3
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "futbol.db"

# Goles según los eventos (sin definiciones por penales). Sirve para detectar
# marcadores administrativos: el resultado oficial no coincide con lo jugado.
SQL_GOLES_EVENTOS = """
SELECT api_id,
  SUM(CASE WHEN (tipo IN ('GOAL','PENALTY') AND es_local=1) OR (tipo='OWN_GOAL' AND es_local=0) THEN 1 ELSE 0 END) AS ev_local,
  SUM(CASE WHEN (tipo IN ('GOAL','PENALTY') AND es_local=0) OR (tipo='OWN_GOAL' AND es_local=1) THEN 1 ELSE 0 END) AS ev_visitante
FROM eventos GROUP BY api_id
"""

# Tarjetas rojas por equipo y partido (RED, SECOND_YELLOW y EXPULSION implican suspensión).
SQL_ROJAS = """
SELECT api_id,
  SUM(CASE WHEN es_local=1 THEN 1 ELSE 0 END) AS rojas_local,
  SUM(CASE WHEN es_local=0 THEN 1 ELSE 0 END) AS rojas_visitante
FROM eventos WHERE tipo IN ('RED','SECOND_YELLOW','EXPULSION') GROUP BY api_id
"""

SQL_PARTIDOS = """
SELECT p.clave, p.api_id, p.torneo_id, p.fase_id, p.grupo, p.jornada, p.fecha, p.hora,
       p.local_id, p.visitante_id, p.goles_local, p.goles_visitante, p.estado,
       t.competicion, t.nombre AS torneo, s.anio, f.nombre AS fase, f.orden AS fase_orden,
       el.nombre AS local, el.rama, ev.nombre AS visitante
FROM partidos p
JOIN torneos t ON t.id = p.torneo_id
JOIN temporadas s ON s.id = t.temporada_id
JOIN fases f ON f.id = p.fase_id
JOIN equipos el ON el.id = p.local_id
JOIN equipos ev ON ev.id = p.visitante_id
WHERE p.fecha IS NOT NULL
"""


def cargar_partidos() -> pd.DataFrame:
    """Todos los partidos con fecha, con goles por eventos, rojas y bandera de resultado administrativo."""
    if not DB_PATH.exists():
        raise FileNotFoundError(f"No existe {DB_PATH}. Ejecuta antes `npm run scrape` y `npm run detalles`.")
    con = sqlite3.connect(DB_PATH)
    try:
        df = pd.read_sql(SQL_PARTIDOS, con)
        goles = pd.read_sql(SQL_GOLES_EVENTOS, con)
        rojas = pd.read_sql(SQL_ROJAS, con)
    finally:
        con.close()

    # Un mismo partido (api_id) nunca debe contarse dos veces.
    con_id = df[df.api_id.notna()].drop_duplicates("api_id")
    df = pd.concat([con_id, df[df.api_id.isna()]], ignore_index=True)

    df = df.merge(goles, on="api_id", how="left").merge(rojas, on="api_id", how="left")
    df[["rojas_local", "rojas_visitante"]] = df[["rojas_local", "rojas_visitante"]].fillna(0)

    jugado = df.estado == "finalizado"
    tiene_eventos = df.ev_local.notna()
    df["administrativo"] = jugado & tiene_eventos & (
        (df.ev_local != df.goles_local) | (df.ev_visitante != df.goles_visitante)
    )

    df["momento"] = pd.to_datetime(df.fecha + " " + df.hora.fillna("00:00").str.slice(0, 5), errors="coerce")
    df["momento"] = df.momento.fillna(pd.to_datetime(df.fecha))
    return df.sort_values(["momento", "clave"]).reset_index(drop=True)
