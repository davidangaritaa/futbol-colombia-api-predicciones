"""Modelos de totales: córners, goles, tarjetas amarillas y ambos marcan.

Uso:
  ml/.venv/Scripts/python ml/totales.py --liga colombia          # goles y amarillas (con árbitro)
  ml/.venv/Scripts/python ml/totales.py --liga europa             # Premier (E0): córners, goles, amarillas
  ml/.venv/Scripts/python ml/totales.py --liga europa --division SP1   # LaLiga u otra división

Predice el número esperado (regresión de Poisson) y de ahí la probabilidad de
"más de X" para las líneas habituales. Todas las variables son previas al partido.

Fuentes:
  colombia  data/futbol.db (API de este proyecto: eventos y árbitros de Dimayor)
  europa    data/europa/raw/Matches.csv, copia de football-data.co.uk publicada en
            https://github.com/xgabora/Club-Football-Match-Data (licencia MIT): resultados,
            córners, tarjetas, tiros y cuotas desde 2000. Se descarga con --descargar.
"""
import argparse
import json
import sqlite3
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.metrics import log_loss, mean_absolute_error, mean_poisson_deviance
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

CARPETA = Path(__file__).resolve().parent
EUROPA_CSV = CARPETA.parent / "data" / "europa" / "raw" / "Matches.csv"
EUROPA_URL = "https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data/main/data/Matches.csv"
VENTANA = 10        # partidos recientes por equipo
SUAVIZADO = 8       # partidos "ficticios" con la media de la liga para equipos/árbitros con poca historia

# estadística -> (columna local, columna visitante)
ESTADISTICAS = {
    "corners": ("co_local", "co_visitante"),
    "goles": ("goles_local", "goles_visitante"),
    "amarillas": ("am_local", "am_visitante"),
    "tiros": ("ti_local", "ti_visitante"),       # solo como variable para predecir córners
}
OBJETIVOS = {"corners": [8.5, 9.5, 10.5, 11.5], "goles": [1.5, 2.5, 3.5], "amarillas": [3.5, 4.5, 5.5, 6.5]}


# ----------------------------------------------------------------------------- carga

def cargar_colombia():
    from datos import DB_PATH, cargar_partidos
    df = cargar_partidos()
    con = sqlite3.connect(DB_PATH)
    am = pd.read_sql("""SELECT api_id,
                          SUM(CASE WHEN es_local=1 THEN 1 ELSE 0 END) AS am_local,
                          SUM(CASE WHEN es_local=0 THEN 1 ELSE 0 END) AS am_visitante
                        FROM eventos WHERE tipo IN ('YELLOW','SECOND_YELLOW') GROUP BY api_id""", con)
    arb = pd.read_sql("SELECT api_id, nombre AS arbitro FROM arbitros WHERE rol='central'", con)
    con.close()
    df = df.merge(am, on="api_id", how="left").merge(arb, on="api_id", how="left")
    con_detalle = df.ev_local.notna()  # tiene eventos descargados
    df.loc[con_detalle, ["am_local", "am_visitante"]] = df.loc[con_detalle, ["am_local", "am_visitante"]].fillna(0)
    df["eliminatoria"] = df.fase.str.upper().str.contains("CUADRANG|FINAL|CUARTOS|SEMI|OCTAVOS|LLAVE").astype(int)
    df["jugado"] = (df.estado == "finalizado") & df.goles_local.notna() & ~df.administrativo & con_detalle
    return df.rename(columns={"local_id": "local", "visitante_id": "visitante"})[
        ["clave", "momento", "competicion", "local", "visitante", "arbitro", "eliminatoria", "jugado",
         "goles_local", "goles_visitante", "am_local", "am_visitante"]]


def cargar_europa(division, descargar=False):
    if descargar or not EUROPA_CSV.exists():
        EUROPA_CSV.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(EUROPA_URL, headers={"User-Agent": "APIFutbol/1.0"})
        with urllib.request.urlopen(req, timeout=300) as r:
            EUROPA_CSV.write_bytes(r.read())
    m = pd.read_csv(EUROPA_CSV, low_memory=False)
    m = m[m.Division == division].copy()
    if m.empty:
        raise SystemExit(f"No hay partidos de la división {division}")
    df = pd.DataFrame({
        "momento": pd.to_datetime(m.MatchDate + " " + m.MatchTime.fillna("15:00").str.slice(0, 5)),
        "local": m.HomeTeam, "visitante": m.AwayTeam,
        "goles_local": m.FTHome, "goles_visitante": m.FTAway,
        "co_local": m.HomeCorners, "co_visitante": m.AwayCorners,
        "am_local": m.HomeYellow, "am_visitante": m.AwayYellow,
        "ti_local": m.HomeShots, "ti_visitante": m.AwayShots,
        "cuota_mas25": m.Over25, "cuota_menos25": m.Under25,
    })
    df["clave"] = division + "-" + m.MatchDate + "-" + m.HomeTeam + "-" + m.AwayTeam
    df = df.assign(competicion=division, arbitro=None, eliminatoria=0)
    df["jugado"] = df.goles_local.notna()
    return df.sort_values("momento").reset_index(drop=True)


# ------------------------------------------------------------------------ variables

def construir(df: pd.DataFrame) -> pd.DataFrame:
    """Variables previas, día por día (mismo esquema sin fuga que features.py).

    Para cada estadística s disponible:
      l_s_favor / l_s_contra   lo que hace el local y lo que le hacen sus rivales (últimos 10, suavizado)
      s_liga                   media reciente de la competición (total del partido)
      s_esperados              combinación ingenua: favor de uno + contra del otro, para ambos lados
    """
    stats = [s for s, (a, _) in ESTADISTICAS.items() if a in df]
    hist = defaultdict(lambda: deque(maxlen=VENTANA))   # equipo -> [{s: (favor, contra)}]
    arbitro = defaultdict(lambda: [0, 0])               # árbitro -> [partidos, amarillas]
    liga = defaultdict(lambda: deque(maxlen=300))       # competición -> [{s: total}]

    filas = []
    df = df.sort_values(["momento", "clave"]).copy()
    df["dia"] = df.momento.dt.normalize()
    for _, grupo in df.groupby("dia", sort=True):
        for p in grupo.itertuples():
            f = {"clave": p.clave, "momento": p.momento, "competicion": p.competicion,
                 "jugado": p.jugado, "eliminatoria": p.eliminatoria}
            L = liga[p.competicion]
            for s in stats:
                vals = [x[s] for x in L if not np.isnan(x[s])]
                por_equipo = np.mean(vals) / 2 if vals else np.nan
                f[f"{s}_liga"] = 2 * por_equipo
                for lado, eq in (("l", p.local), ("v", p.visitante)):
                    h = [x[s] for x in hist[eq] if not np.isnan(x[s][0])]
                    for i, tipo in ((0, "favor"), (1, "contra")):
                        f[f"{lado}_{s}_{tipo}"] = ((sum(x[i] for x in h) + SUAVIZADO * por_equipo) / (len(h) + SUAVIZADO)
                                                   if vals else np.nan)
                f[f"{s}_esperados"] = (f[f"l_{s}_favor"] + f[f"v_{s}_contra"] + f[f"v_{s}_favor"]
                                       + f[f"l_{s}_contra"] - 2 * por_equipo)
                a, b = ESTADISTICAS[s]
                f[s] = getattr(p, a) + getattr(p, b) if p.jugado else np.nan
            if "amarillas" in stats:
                n, suma = arbitro[p.arbitro] if p.arbitro else (0, 0)
                f["arbitro_am"] = ((suma + SUAVIZADO * f["amarillas_liga"]) / (n + SUAVIZADO)
                                   if p.arbitro and not np.isnan(f["amarillas_liga"]) else np.nan)
            if p.jugado:
                f["ambos_marcan"] = float(p.goles_local > 0 and p.goles_visitante > 0)
            if hasattr(p, "cuota_mas25") and p.cuota_mas25 > 1 and p.cuota_menos25 > 1:
                im, iu = 1 / p.cuota_mas25, 1 / p.cuota_menos25
                f["mercado_mas25"] = im / (im + iu)          # probabilidad implícita sin margen
            filas.append(f)

        for p in grupo.itertuples():
            if not p.jugado:
                continue
            reg_l, reg_v, tot = {}, {}, {}
            for s in stats:
                a, b = ESTADISTICAS[s]
                x, y = float(getattr(p, a)), float(getattr(p, b))
                reg_l[s], reg_v[s], tot[s] = (x, y), (y, x), x + y
            hist[p.local].append(reg_l)
            hist[p.visitante].append(reg_v)
            liga[p.competicion].append(tot)
            if p.arbitro and "amarillas" in stats and not np.isnan(tot["amarillas"]):
                arbitro[p.arbitro][0] += 1
                arbitro[p.arbitro][1] += tot["amarillas"]
    return pd.DataFrame(filas)


def variables(objetivo, tabla):
    s = objetivo
    cols = [f"{s}_liga", f"{s}_esperados", f"l_{s}_favor", f"l_{s}_contra", f"v_{s}_favor", f"v_{s}_contra",
            "eliminatoria"]
    if objetivo == "corners":   # quien remata mucho suele sacar muchos córners
        cols += ["tiros_esperados", "l_tiros_favor", "v_tiros_favor", "l_tiros_contra", "v_tiros_contra"]
    if objetivo == "amarillas":
        cols += ["arbitro_am"]
    return [c for c in cols if c in tabla and tabla[c].notna().any() and tabla[c].nunique() > 1]


# --------------------------------------------------------------------- evaluación

def prob_mas_de(media, linea):
    return 1 - poisson.cdf(np.floor(linea), media)


def evaluar_lineas(objetivo, y, pred):
    r = {"mae": round(mean_absolute_error(y, pred), 3), "devianza": round(mean_poisson_deviance(y, pred), 4)}
    for linea in OBJETIVOS[objetivo]:
        p = np.clip(prob_mas_de(pred, linea), 1e-6, 1 - 1e-6)
        real = (y > linea).astype(int)
        r[f"mas_{linea}"] = {"log_loss": round(log_loss(real, p, labels=[0, 1]), 4),
                             "acierto": round(float(np.mean((p > 0.5) == real)), 3),
                             "predicho": round(float(p.mean()), 3), "real": round(float(real.mean()), 3)}
    return r


def modelo_poisson():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), PoissonRegressor(alpha=0.01, max_iter=1000))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--liga", choices=["colombia", "europa"], default="colombia")
    ap.add_argument("--division", default="E0", help="Con --liga europa: E0 Premier, SP1 LaLiga, I1, D1, F1…")
    ap.add_argument("--corte", default=None)
    ap.add_argument("--descargar", action="store_true", help="Vuelve a descargar el CSV de europa")
    args = ap.parse_args()

    if args.liga == "colombia":
        datos, corte, inicio, nombre = cargar_colombia(), args.corte or "2025-07-01", "2023-04-01", "colombia"
    else:
        datos = cargar_europa(args.division, args.descargar)
        corte = args.corte or "2024-07-01"
        inicio = str(datos.momento.min() + pd.Timedelta(days=365))[:10]
        nombre = args.division

    tabla = construir(datos)
    validos = tabla[tabla.jugado & (tabla.momento >= inicio)]
    train, test = validos[validos.momento < corte], validos[validos.momento >= corte]
    print(f"Liga: {nombre} · entrenamiento {len(train)} ({inicio} a {corte}) · prueba {len(test)}\n")

    salida = {}
    for objetivo in OBJETIVOS:
        if objetivo not in validos or validos[objetivo].isna().all():
            print(f"=== {objetivo.upper()}: sin datos en esta liga\n")
            continue
        tr, te = train[train[objetivo].notna()], test[test[objetivo].notna()]
        cols = variables(objetivo, tr)
        yte = te[objetivo].values
        preds = {"ref_media_liga": te[f"{objetivo}_liga"].values,
                 "poisson": modelo_poisson().fit(tr[cols], tr[objetivo]).predict(te[cols])}
        if "arbitro_am" in cols:
            sin = [c for c in cols if c != "arbitro_am"]
            preds["poisson_sin_arbitro"] = modelo_poisson().fit(tr[sin], tr[objetivo]).predict(te[sin])

        print(f"=== {objetivo.upper()} (media real en prueba: {yte.mean():.2f}, partidos {len(te)})")
        salida[objetivo] = {}
        for n, pr in preds.items():
            r = evaluar_lineas(objetivo, yte, pr)
            salida[objetivo][n] = r
            lineas = "  ".join(f"+{l}: {r[f'mas_{l}']['log_loss']:.3f}" for l in OBJETIVOS[objetivo])
            print(f"  {n:20s} MAE {r['mae']:.2f}  devianza {r['devianza']:.3f}  | log loss  {lineas}")

        if objetivo == "goles" and "mercado_mas25" in te and te.mercado_mas25.notna().any():
            con = te[te.mercado_mas25.notna()]
            real = (con.goles > 2.5).astype(int)
            pm = modelo_poisson().fit(tr[cols], tr[objetivo]).predict(con[cols])
            p_mod = np.clip(prob_mas_de(pm, 2.5), 1e-6, 1 - 1e-6)
            mezcla = (p_mod + con.mercado_mas25) / 2
            print(f"  Comparación con las casas de apuestas, +2.5 goles ({len(con)} partidos con cuota):")
            for n, p in (("casas de apuestas", con.mercado_mas25), ("modelo", p_mod), ("promedio de ambos", mezcla)):
                print(f"    {n:20s} log loss {log_loss(real, p, labels=[0, 1]):.4f}  acierto {np.mean((p > .5) == real):.1%}")
            salida[objetivo]["mercado_mas25"] = {
                "log_loss_mercado": round(log_loss(real, con.mercado_mas25, labels=[0, 1]), 4),
                "log_loss_modelo": round(log_loss(real, p_mod, labels=[0, 1]), 4)}

        best = salida[objetivo]["poisson"]
        print("  Calibración (predicho / real):",
              "  ".join(f"+{l}: {best[f'mas_{l}']['predicho']:.2f}/{best[f'mas_{l}']['real']:.2f}" for l in OBJETIVOS[objetivo]))
        print()

    # Ambos marcan: a partir de los goles esperados de cada equipo
    cols = variables("goles", train)
    tot = modelo_poisson().fit(train[cols], train.goles).predict(test[cols])
    reparto = (test.l_goles_favor + test.v_goles_contra) / (
        test.l_goles_favor + test.v_goles_contra + test.v_goles_favor + test.l_goles_contra)
    p_btts = (1 - np.exp(-tot * reparto)) * (1 - np.exp(-tot * (1 - reparto)))
    yb = test.ambos_marcan.values
    print("=== AMBOS MARCAN")
    for n, p in (("ref_frecuencia", np.full(len(yb), train.ambos_marcan.mean())), ("poisson", p_btts)):
        print(f"  {n:20s} log loss {log_loss(yb, p, labels=[0, 1]):.4f}  predicho {np.mean(p):.2f} vs real {yb.mean():.2f}")

    (CARPETA / "modelos").mkdir(exist_ok=True)
    (CARPETA / "modelos" / f"totales_{nombre}.json").write_text(
        json.dumps({"corte": corte, "resultados": salida}, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
