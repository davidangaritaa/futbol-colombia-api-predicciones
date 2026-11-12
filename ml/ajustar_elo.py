"""Busca los parámetros del Elo (K y ventaja de local) sin mirar el periodo de prueba.

Para cada combinación: se calcula el Elo, se ajusta una regresión logística con
`elo_dif` en [inicio, validacion) y se mide el log loss en [validacion, corte).

Uso:  ml/.venv/Scripts/python ml/ajustar_elo.py [--validacion 2024-07-01 --corte 2025-07-01]
"""
import argparse
import itertools

from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

from datos import cargar_partidos
from entrenar import INICIO_ENTRENAMIENTO
from features import construir


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validacion", default="2024-07-01")
    ap.add_argument("--corte", default="2025-07-01")
    args = ap.parse_args()

    df = cargar_partidos()
    filas = []
    for k, ventaja in itertools.product([10, 15, 20, 30, 40, 60], [0, 30, 60, 90]):
        t = construir(df, k=k, ventaja=ventaja)
        t = t[(t.y >= 0) & ~t.administrativo & (t.momento >= INICIO_ENTRENAMIENTO) & (t.momento < args.corte)]
        tr, va = t[t.momento < args.validacion], t[t.momento >= args.validacion]
        m = LogisticRegression(max_iter=1000).fit(tr[["elo_dif"]] / 100, tr.y)
        filas.append((log_loss(va.y, m.predict_proba(va[["elo_dif"]] / 100), labels=[0, 1, 2]), k, ventaja))

    for ll, k, v in sorted(filas)[:8]:
        print(f"K={k:3d}  ventaja={v:3d}  log_loss validación={ll:.4f}")


if __name__ == "__main__":
    main()
