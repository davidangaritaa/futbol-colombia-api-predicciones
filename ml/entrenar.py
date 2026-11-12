"""Entrena y evalúa el modelo 1X2 (local / empate / visitante).

Uso:  ml/.venv/Scripts/python ml/entrenar.py [--corte 2025-07-01]

- Entrena con los partidos anteriores a la fecha de corte y evalúa con los posteriores
  (división temporal: así se usaría en la realidad).
- Compara contra referencias simples para saber si el modelo aporta algo.
- Guarda el modelo final (entrenado con todos los partidos) en ml/modelos/.
"""
import argparse
import json
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from datos import cargar_partidos
from features import VARIABLES, agregar_dummies, construir

CARPETA = Path(__file__).resolve().parent
INICIO_ENTRENAMIENTO = "2023-04-01"  # los primeros meses sirven de "calentamiento" del Elo y la forma
ETIQUETAS = ["local", "empate", "visitante"]


def brier(y, prob):
    uno = np.eye(3)[y]
    return float(np.mean(np.sum((prob - uno) ** 2, axis=1)))


def metricas(y, prob):
    return {
        "acierto": round(accuracy_score(y, prob.argmax(1)), 4),
        "log_loss": round(log_loss(y, prob, labels=[0, 1, 2]), 4),
        "brier": round(brier(y, prob), 4),
    }


def modelos():
    return {
        "regresion_logistica": make_pipeline(
            SimpleImputer(strategy="median"), StandardScaler(),
            LogisticRegression(C=0.1, max_iter=2000),
        ),
        "lightgbm": lgb.LGBMClassifier(
            n_estimators=300, learning_rate=0.02, num_leaves=8, min_child_samples=40,
            subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1,
        ),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corte", default="2025-07-01", help="Fecha que separa entrenamiento y prueba")
    args = ap.parse_args()

    tabla = agregar_dummies(construir(cargar_partidos()))
    validos = tabla[(tabla.y >= 0) & ~tabla.administrativo & (tabla.momento >= INICIO_ENTRENAMIENTO)]
    train = validos[validos.momento < args.corte]
    test = validos[validos.momento >= args.corte]
    print(f"Partidos válidos: {len(validos)}  (entrenamiento {len(train)}, prueba {len(test)}; "
          f"excluidos {int(tabla.administrativo.sum())} resultados administrativos)")
    print("Distribución en entrenamiento:",
          dict(zip(ETIQUETAS, np.bincount(train.y, minlength=3) / len(train))), "\n")

    Xtr, ytr, Xte, yte = train[VARIABLES], train.y.values, test[VARIABLES], test.y.values
    resultados, probs = {}, {}

    # Referencias
    frec = np.bincount(ytr, minlength=3) / len(ytr)
    probs["ref_frecuencias"] = np.tile(frec, (len(test), 1))
    probs["ref_siempre_local"] = np.tile([0.999, 0.0005, 0.0005], (len(test), 1))
    elo = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(train[["elo_dif"]], ytr)
    probs["ref_solo_elo"] = elo.predict_proba(test[["elo_dif"]])

    for nombre, m in modelos().items():
        m.fit(Xtr, ytr)
        probs[nombre] = m.predict_proba(Xte)
    probs["promedio_rl_lgbm"] = (probs["regresion_logistica"] + probs["lightgbm"]) / 2

    segmentos = {"todo": np.ones(len(test), bool)}
    for c in ("liga", "torneo", "femenina", "copa"):
        segmentos[c] = (test.competicion == c).values

    for nombre, p in probs.items():
        resultados[nombre] = {s: metricas(yte[mask], p[mask]) | {"n": int(mask.sum())}
                              for s, mask in segmentos.items() if mask.sum() >= 30}

    print(f"{'modelo':22s} {'segmento':9s} {'n':>5s} {'acierto':>8s} {'log_loss':>9s} {'brier':>7s}")
    for nombre, segs in resultados.items():
        for s, r in segs.items():
            print(f"{nombre:22s} {s:9s} {r['n']:5d} {r['acierto']:8.3f} {r['log_loss']:9.4f} {r['brier']:7.4f}")
        print()

    # Importancia de variables (LightGBM, ganancia)
    lgbm = modelos()["lightgbm"].fit(Xtr, ytr)
    imp = pd.Series(lgbm.booster_.feature_importance("gain"), index=VARIABLES).sort_values(ascending=False)
    print("Variables más importantes (LightGBM):")
    print((imp / imp.sum()).head(12).round(3).to_string(), "\n")

    # Calibración: probabilidad media predicha vs frecuencia real en prueba
    p = probs["promedio_rl_lgbm"]
    print("Calibración (promedio RL+LGBM) — predicho vs real:")
    for i, e in enumerate(ETIQUETAS):
        print(f"  {e:9s} {p[:, i].mean():.3f} vs {np.mean(yte == i):.3f}")

    # Modelo final con todos los datos válidos
    (CARPETA / "modelos").mkdir(exist_ok=True)
    final = {n: m.fit(validos[VARIABLES], validos.y.values) for n, m in modelos().items()}
    joblib.dump({"modelos": final, "variables": VARIABLES}, CARPETA / "modelos" / "modelo_1x2.joblib")
    (CARPETA / "modelos" / "evaluacion.json").write_text(
        json.dumps({"corte": args.corte, "resultados": resultados}, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nModelo guardado en ml/modelos/modelo_1x2.joblib")


if __name__ == "__main__":
    main()
