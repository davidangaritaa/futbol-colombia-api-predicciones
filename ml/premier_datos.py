"""Datos de la Premier League desde el archivo público de Fantasy Premier League.

Fuente: https://github.com/vaastav/Fantasy-Premier-League (un CSV por temporada con una
fila por jugador y partido: minutos, titularidad, goles, tarjetas y, desde 2022-23, xG)
más la API oficial de FPL para la temporada en curso.

Uso:  ml/.venv/Scripts/python ml/premier_datos.py [--refrescar]

Guarda en data/premier.db:
  partidos(clave, temporada, fixture, momento, local, visitante, goles_local, goles_visitante, terminado)
  jugadores(clave, jugador, equipo, es_local, minutos, titular, goles, asistencias, xg, xa,
            puntos, amarillas, rojas)
"""
import argparse
import io
import re
import sqlite3
import time
import urllib.request
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "data" / "premier" / "raw"
DB_PATH = RAIZ / "data" / "premier.db"
BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
FPL_API = "https://fantasy.premierleague.com/api"
TEMPORADAS = [f"{a}-{str(a + 1)[2:]}" for a in range(2016, 2027)]  # 2016-17 … 2026-27
UA = "APIFutbol/1.0 (proyecto personal de análisis)"

# Mismos clubes con nombres distintos entre temporadas.
ALIAS = {"Man Utd": "Man United", "Spurs": "Tottenham", "Nott'm Forest": "Nottingham Forest",
         "Sheffield Utd": "Sheffield United",
         "Hull City": "Hull", "Ipswich Town": "Ipswich"}


def descargar(url: str, destino: Path, refrescar: bool) -> bytes:
    if destino.exists() and not refrescar:
        return destino.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        datos = r.read()
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(datos)
    time.sleep(0.5)
    return datos


def csv(url, destino, refrescar):
    return pd.read_csv(io.BytesIO(descargar(url, destino, refrescar)), encoding="latin-1", low_memory=False)


def nombres_equipos(temporada, refrescar):
    """id FPL del equipo -> nombre, para una temporada (los ids cambian cada año)."""
    try:
        t = csv(f"{BASE}/{temporada}/teams.csv", CACHE / temporada / "teams.csv", refrescar)
        return dict(zip(t["id"], t["name"]))
    except urllib.error.HTTPError:
        m = csv(f"{BASE}/master_team_list.csv", CACHE / "master_team_list.csv", refrescar)
        m = m[m.season == temporada]
        return dict(zip(m["team"], m["team_name"]))


def limpiar_jugador(nombre: str) -> str:
    """'Aaron_Cresswell_454' -> 'Aaron Cresswell' (formato de las primeras temporadas)."""
    return re.sub(r"_\d+$", "", str(nombre)).replace("_", " ").strip()


def procesar_temporada(temporada, refrescar):
    gw = csv(f"{BASE}/{temporada}/gws/merged_gw.csv", CACHE / temporada / "merged_gw.csv", refrescar)
    equipos = nombres_equipos(temporada, refrescar)
    gw["was_home"] = gw.was_home.astype(str).str.lower() == "true"
    gw["rival"] = gw.opponent_team.map(equipos).replace(ALIAS)

    # Local y visitante de cada partido se deducen del rival de cada jugador.
    loc = gw[~gw.was_home].groupby("fixture").rival.first().rename("local")
    vis = gw[gw.was_home].groupby("fixture").rival.first().rename("visitante")
    p = gw.groupby("fixture").agg(momento=("kickoff_time", "first"),
                                  goles_local=("team_h_score", "first"),
                                  goles_visitante=("team_a_score", "first"),
                                  minutos=("minutes", "sum"))
    p = p.join(loc).join(vis).dropna(subset=["local", "visitante"]).reset_index()
    p["temporada"] = temporada
    p["clave"] = temporada + "-" + p.fixture.astype(str)
    p["terminado"] = p.minutos > 0
    p = p.drop(columns="minutos")

    gw = gw.merge(p[["fixture", "local", "visitante", "clave"]], on="fixture")
    gw["equipo"] = gw.local.where(gw.was_home, gw.visitante)
    col = lambda c: gw[c] if c in gw else pd.Series(pd.NA, index=gw.index)
    j = pd.DataFrame({
        "clave": gw.clave, "jugador": gw.name.map(limpiar_jugador), "equipo": gw.equipo,
        "es_local": gw.was_home.astype(int), "minutos": gw.minutes,
        # 'starts' existe desde 2022-23; antes se aproxima con 60+ minutos.
        "titular": col("starts").fillna((gw.minutes >= 60).astype(int)) if "starts" in gw else (gw.minutes >= 60).astype(int),
        "goles": gw.goals_scored, "asistencias": gw.assists,
        "xg": pd.to_numeric(col("expected_goals"), errors="coerce"),
        "xa": pd.to_numeric(col("expected_assists"), errors="coerce"),
        "puntos": gw.total_points, "amarillas": gw.yellow_cards, "rojas": gw.red_cards,
    })
    # Un jugador puede aparecer dos veces en el mismo partido por errores del archivo.
    j = j.drop_duplicates(["clave", "jugador", "equipo"])
    return p, j


def partidos_pendientes_api(temporada_actual, partidos, refrescar):
    """Agrega los partidos de la temporada en curso que aún no están en el archivo (programados)."""
    fx = pd.read_json(io.BytesIO(descargar(f"{FPL_API}/fixtures/", CACHE / temporada_actual / "api_fixtures.json", True)))
    boot = descargar(f"{FPL_API}/bootstrap-static/", CACHE / temporada_actual / "api_bootstrap.json", True)
    equipos = {t["id"]: t["name"] for t in pd.read_json(io.BytesIO(boot), typ="series")["teams"]}
    fx = fx.dropna(subset=["kickoff_time"])
    nuevos = pd.DataFrame({
        "fixture": fx.id, "momento": fx.kickoff_time,
        "goles_local": fx.team_h_score, "goles_visitante": fx.team_a_score,
        "local": fx.team_h.map(equipos).replace(ALIAS), "visitante": fx.team_a.map(equipos).replace(ALIAS),
        "terminado": fx.finished.astype(bool),
    })
    nuevos["temporada"] = temporada_actual
    nuevos["clave"] = temporada_actual + "-" + nuevos.fixture.astype(str)
    nuevos = nuevos[~nuevos.clave.isin(partidos.clave)]
    return pd.concat([partidos, nuevos], ignore_index=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refrescar", action="store_true", help="Vuelve a descargar todo (si no, usa la caché)")
    args = ap.parse_args()

    todos_p, todos_j = [], []
    for t in TEMPORADAS:
        # La temporada en curso siempre se refresca: cambia cada jornada.
        p, j = procesar_temporada(t, args.refrescar or t == TEMPORADAS[-1])
        print(f"{t}: {len(p)} partidos ({int(p.terminado.sum())} jugados), {len(j)} filas de jugadores")
        todos_p.append(p)
        todos_j.append(j)

    partidos = partidos_pendientes_api(TEMPORADAS[-1], pd.concat(todos_p, ignore_index=True), args.refrescar)
    partidos = partidos[["clave", "temporada", "fixture", "momento", "local", "visitante",
                         "goles_local", "goles_visitante", "terminado"]]
    partidos["momento"] = pd.to_datetime(partidos.momento, utc=True).dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    jugadores = pd.concat(todos_j, ignore_index=True)

    con = sqlite3.connect(DB_PATH)
    partidos.to_sql("partidos", con, if_exists="replace", index=False)
    jugadores.to_sql("jugadores", con, if_exists="replace", index=False)
    con.execute("CREATE INDEX IF NOT EXISTS idx_jug_clave ON jugadores(clave)")
    con.commit()
    con.close()
    print(f"\nGuardado en {DB_PATH}: {len(partidos)} partidos, {len(jugadores)} filas de jugadores")
    print("Equipos:", sorted(set(partidos.local)))


if __name__ == "__main__":
    main()
