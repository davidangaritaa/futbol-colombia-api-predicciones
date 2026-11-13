"""Modelo 1X2 para la Premier League, con variables de plantel.

Uso:  ml/.venv/Scripts/python ml/premier_datos.py      # primero, descarga los datos
      ml/.venv/Scripts/python ml/premier_entrenar.py [--corte 2024-07-01]

Compara tres niveles de información, todos previos al partido:
  1. base       Elo, forma, tabla recalculada y descanso (lo mismo que en Colombia).
  2. +plantel   xG recientes y calidad media de los titulares habituales.
  3. +alineación  Calidad de los 11 titulares de ESE partido y rotaciones.
                 Las alineaciones se publican ~1 hora antes: sirve para predecir
                 justo antes del partido, no días antes.
"""
import argparse
import json
import sqlite3
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

from entrenar import ETIQUETAS, metricas, modelos
from features import ELO_INICIAL, construir

CARPETA = Path(__file__).resolve().parent
DB_PATH = CARPETA.parent / "data" / "premier.db"
INICIO_ENTRENAMIENTO = "2017-07-01"   # la primera temporada solo "calienta" el Elo y la forma
ELO_ASCENDIDO = ELO_INICIAL - 100     # un equipo nuevo en la liga suele ser de los más débiles
RATING_DESCONOCIDO = 2.0              # puntos FPL por partido supuestos para un jugador sin historial
VENTANA = 5

BASE = ["l_elo", "v_elo", "elo_dif", "l_ppp5", "v_ppp5", "ppp5_dif", "l_gf5", "v_gf5", "l_gc5", "v_gc5",
        "l_ppp10", "v_ppp10", "l_ppp_condicion", "v_ppp_condicion", "l_pj_torneo", "v_pj_torneo",
        "l_ppp_torneo", "v_ppp_torneo", "ppp_torneo_dif", "l_dg_torneo", "v_dg_torneo", "dg_torneo_dif",
        "l_descanso", "v_descanso", "l_rojas_ultimo", "v_rojas_ultimo"]
PLANTEL = ["l_xg5", "v_xg5", "l_xgc5", "v_xgc5", "xg_dif5", "l_calidad_habitual", "v_calidad_habitual",
           "calidad_habitual_dif"]
ALINEACION = ["l_calidad_xi", "v_calidad_xi", "calidad_xi_dif", "l_xi_vs_habitual", "v_xi_vs_habitual",
              "l_cambios_xi", "v_cambios_xi"]


def cargar():
    con = sqlite3.connect(DB_PATH)
    try:
        p = pd.read_sql("SELECT * FROM partidos", con)
        j = pd.read_sql("SELECT * FROM jugadores", con)
    finally:
        con.close()
    p["momento"] = pd.to_datetime(p.momento, utc=True).dt.tz_convert(None)
    return p, j


def variables_jugadores(p: pd.DataFrame, j: pd.DataFrame) -> pd.DataFrame:
    """Por (partido, equipo): xG del partido y calidad de los titulares, con ratings PREVIOS al partido."""
    j = j.merge(p[["clave", "momento"]], on="clave").sort_values(["momento", "clave"])

    # Rating del jugador = media de puntos FPL en sus 10 apariciones anteriores (shift: excluye este partido).
    jugo = j[j.minutos > 0].copy()
    jugo["rating"] = (jugo.groupby("jugador").puntos
                      .transform(lambda s: s.shift().rolling(10, min_periods=1).mean()))
    j = j.merge(jugo[["clave", "jugador", "equipo", "rating"]], on=["clave", "jugador", "equipo"], how="left")
    j["rating"] = j.rating.fillna(RATING_DESCONOCIDO)

    tit = j[j.titular == 1]
    eq = (j.groupby(["clave", "equipo"])
          .agg(momento=("momento", "first"), es_local=("es_local", "first"), xg=("xg", lambda s: s.sum(min_count=1)))
          .join(tit.groupby(["clave", "equipo"]).agg(calidad_xi=("rating", "sum"),
                                                     xi=("jugador", lambda s: frozenset(s))))
          .reset_index().sort_values(["momento", "clave"]))

    # xG en contra = xG del rival en el mismo partido.
    rival = eq[["clave", "equipo", "xg"]].rename(columns={"equipo": "rival", "xg": "xgc"})
    eq = eq.merge(rival, on="clave")
    eq = eq[eq.equipo != eq.rival]

    g = eq.groupby("equipo")
    previo = lambda col: g[col].transform(lambda s: s.shift().rolling(VENTANA, min_periods=1).mean())
    eq["xg5"] = previo("xg")
    eq["xgc5"] = previo("xgc")
    eq["calidad_habitual"] = previo("calidad_xi")
    eq["xi_vs_habitual"] = eq.calidad_xi - eq.calidad_habitual
    eq["xi_anterior"] = g.xi.shift()
    eq["cambios_xi"] = [len(a - b) if isinstance(a, frozenset) and isinstance(b, frozenset) else np.nan
                        for a, b in zip(eq.xi, eq.xi_anterior)]
    return eq[["clave", "es_local", "xg5", "xgc5", "calidad_habitual", "calidad_xi", "xi_vs_habitual", "cambios_xi"]]


def tabla_modelo():
    p, j = cargar()
    rojas = (j.groupby(["clave", "es_local"]).rojas.sum().unstack(fill_value=0)
             .rename(columns={1: "rojas_local", 0: "rojas_visitante"}).reset_index())
    df = p.merge(rojas, on="clave", how="left").fillna({"rojas_local": 0, "rojas_visitante": 0})
    df = df.assign(api_id=df.clave, anio=df.temporada, competicion="premier", rama="masculino",
                   torneo=df.temporada, torneo_id=df.temporada, fase="LIGA", administrativo=False,
                   local_id=df.local, visitante_id=df.visitante,
                   estado=np.where(df.terminado.astype(bool), "finalizado", "programado"))
    df = df.sort_values(["momento", "clave"]).reset_index(drop=True)

    primera = set(df[df.temporada == df.temporada.min()].local)
    tabla = construir(df, elo_inicial=lambda e: ELO_INICIAL if e in primera else ELO_ASCENDIDO)

    ej = variables_jugadores(p, j)
    for lado, es_local in (("l", 1), ("v", 0)):
        sub = ej[ej.es_local == es_local].drop(columns="es_local").add_prefix(f"{lado}_")
        tabla = tabla.merge(sub.rename(columns={f"{lado}_clave": "clave"}), on="clave", how="left")
    tabla["xg_dif5"] = tabla.l_xg5 - tabla.v_xg5
    tabla["calidad_habitual_dif"] = tabla.l_calidad_habitual - tabla.v_calidad_habitual
    tabla["calidad_xi_dif"] = tabla.l_calidad_xi - tabla.v_calidad_xi
    return tabla


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corte", default="2024-07-01", help="Fecha que separa entrenamiento y prueba")
    args = ap.parse_args()

    tabla = tabla_modelo()
    validos = tabla[(tabla.y >= 0) & (tabla.momento >= INICIO_ENTRENAMIENTO)]
    train, test = validos[validos.momento < args.corte], validos[validos.momento >= args.corte]
    ytr, yte = train.y.values, test.y.values
    print(f"Partidos: entrenamiento {len(train)} ({train.anio.min()} a {train.anio.max()}), "
          f"prueba {len(test)} ({test.anio.min()} a {test.anio.max()})")
    print("Distribución en prueba:", dict(zip(ETIQUETAS, np.round(np.bincount(yte, minlength=3) / len(yte), 3))), "\n")

    probs = {
        "ref_frecuencias": np.tile(np.bincount(ytr, minlength=3) / len(ytr), (len(test), 1)),
        "ref_solo_elo": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
                        .fit(train[["elo_dif"]], ytr).predict_proba(test[["elo_dif"]]),
    }
    conjuntos = {"base": BASE, "+plantel": BASE + PLANTEL, "+alineacion": BASE + PLANTEL + ALINEACION}
    for nombre_c, cols in conjuntos.items():
        for nombre_m, m in modelos().items():
            probs[f"{nombre_m[:6]} {nombre_c}"] = m.fit(train[cols], ytr).predict_proba(test[cols])

    resultados = {n: metricas(yte, pr) for n, pr in probs.items()}
    print(f"{'modelo':28s} {'acierto':>8s} {'log_loss':>9s} {'brier':>7s}")
    for n, r in resultados.items():
        print(f"{n:28s} {r['acierto']:8.3f} {r['log_loss']:9.4f} {r['brier']:7.4f}")

    lr = modelos()["regresion_logistica"].fit(train[conjuntos["+alineacion"]], ytr)
    coef = pd.Series(lr[-1].coef_[0] - lr[-1].coef_[2], index=conjuntos["+alineacion"])
    print("\nPeso de cada variable a favor del local (regresión logística, estandarizada):")
    print(coef.reindex(coef.abs().sort_values(ascending=False).index).head(10).round(3).to_string())

    (CARPETA / "modelos").mkdir(exist_ok=True)
    for nombre_c, cols in conjuntos.items():
        final = modelos()["regresion_logistica"].fit(validos[cols], validos.y.values)
        joblib.dump({"modelo": final, "variables": cols},
                    CARPETA / "modelos" / f"premier_{nombre_c.strip('+')}.joblib")
    (CARPETA / "modelos" / "premier_evaluacion.json").write_text(
        json.dumps({"corte": args.corte, "resultados": resultados}, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nModelos guardados en ml/modelos/premier_*.joblib")


if __name__ == "__main__":
    main()
