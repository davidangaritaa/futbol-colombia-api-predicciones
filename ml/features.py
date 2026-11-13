"""Variables previas al partido (sin fuga de información).

Los partidos se recorren en orden cronológico, día por día. Las variables de
cada partido se calculan con el estado ANTERIOR a ese día, y solo después se
actualiza el estado con los resultados. Así ningún partido "ve" su propio
resultado ni el de partidos jugados el mismo día o después.
"""
from collections import defaultdict, deque

import numpy as np
import pandas as pd

ELO_INICIAL = 1500.0
ELO_K = 40.0  # elegido con ajustar_elo.py (validación 2024-07 a 2025-06)
ELO_VENTAJA_LOCAL = 60.0
VENTANA_FORMA = 5
PALABRAS_ELIMINATORIA = ("CUADRANG", "FINAL", "CUARTOS", "SEMI", "OCTAVOS", "LLAVE", "ELIMINA")


def resultado(gl: int, gv: int) -> int:
    """0 = gana el local, 1 = empate, 2 = gana el visitante."""
    return 0 if gl > gv else (1 if gl == gv else 2)


def _puntos(gf: int, gc: int) -> int:
    return 3 if gf > gc else (1 if gf == gc else 0)


def _media(valores, campo):
    return float(np.mean([v[campo] for v in valores])) if valores else np.nan


class _Ratings(dict):
    """Diccionario equipo -> Elo que asigna el rating inicial la primera vez que ve un equipo."""
    def __init__(self, inicial):
        super().__init__()
        self.inicial = inicial

    def __missing__(self, equipo):
        self[equipo] = self.inicial(equipo)
        return self[equipo]


class Estado:
    def __init__(self, k=ELO_K, ventaja=ELO_VENTAJA_LOCAL, elo_inicial=None):
        self.k, self.ventaja = k, ventaja
        # elo_inicial: función equipo -> rating de partida (p. ej. más bajo para los ascendidos).
        inicial = elo_inicial or (lambda _equipo: ELO_INICIAL)
        self.elo = _Ratings(inicial)
        self.historial = defaultdict(lambda: deque(maxlen=10))        # todos los partidos del equipo
        self.historial_local = defaultdict(lambda: deque(maxlen=VENTANA_FORMA))
        self.historial_visita = defaultdict(lambda: deque(maxlen=VENTANA_FORMA))
        self.torneo = defaultdict(lambda: {"pj": 0, "pts": 0, "gf": 0, "gc": 0})  # (torneo_id, equipo)
        self.ultimo = {}                                               # equipo -> fecha del último partido
        self.partidos_jugados = defaultdict(int)

    def variables_equipo(self, equipo, torneo_id, fecha, condicion):
        h = list(self.historial[equipo])
        h5 = h[-VENTANA_FORMA:]
        propio = self.historial_local[equipo] if condicion == "local" else self.historial_visita[equipo]
        t = self.torneo[(torneo_id, equipo)]
        ultimo = self.ultimo.get(equipo)
        return {
            "elo": self.elo[equipo],
            "pj_total": self.partidos_jugados[equipo],
            "ppp5": _media(h5, "pts"),
            "gf5": _media(h5, "gf"),
            "gc5": _media(h5, "gc"),
            "ppp10": _media(h, "pts"),
            "ppp_condicion": _media(list(propio), "pts"),
            "pj_torneo": t["pj"],
            "ppp_torneo": t["pts"] / t["pj"] if t["pj"] else np.nan,
            "dg_torneo": (t["gf"] - t["gc"]) / t["pj"] if t["pj"] else np.nan,
            "descanso": min((fecha - ultimo).days, 30) if ultimo is not None else np.nan,
            "rojas_ultimo": h[-1]["rojas"] if h else 0,
        }

    def actualizar(self, p):
        l, v = p.local_id, p.visitante_id
        gl, gv = int(p.goles_local), int(p.goles_visitante)

        # Elo con multiplicador por diferencia de gol.
        esperado_l = 1 / (1 + 10 ** ((self.elo[v] - self.elo[l] - self.ventaja) / 400))
        real_l = 1.0 if gl > gv else (0.5 if gl == gv else 0.0)
        mult = 1.0 if abs(gl - gv) <= 1 else (1.5 if abs(gl - gv) == 2 else (11 + abs(gl - gv)) / 8)
        delta = self.k * mult * (real_l - esperado_l)
        self.elo[l] += delta
        self.elo[v] -= delta

        for eq, gf, gc, rojas, hist_cond in (
            (l, gl, gv, p.rojas_local, self.historial_local),
            (v, gv, gl, p.rojas_visitante, self.historial_visita),
        ):
            reg = {"pts": _puntos(gf, gc), "gf": gf, "gc": gc, "rojas": rojas}
            self.historial[eq].append(reg)
            hist_cond[eq].append(reg)
            t = self.torneo[(p.torneo_id, eq)]
            t["pj"] += 1
            t["pts"] += reg["pts"]
            t["gf"] += gf
            t["gc"] += gc
            self.ultimo[eq] = p.momento.normalize()
            self.partidos_jugados[eq] += 1


def construir(df: pd.DataFrame, k=ELO_K, ventaja=ELO_VENTAJA_LOCAL, elo_inicial=None) -> pd.DataFrame:
    """Una fila por partido con variables previas y, si se jugó, el resultado (columna `y`)."""
    estado = Estado(k, ventaja, elo_inicial)
    filas = []
    df = df.copy()
    df["dia"] = df.momento.dt.normalize()

    for dia, grupo in df.groupby("dia", sort=True):
        for p in grupo.itertuples():
            vl = estado.variables_equipo(p.local_id, p.torneo_id, dia, "local")
            vv = estado.variables_equipo(p.visitante_id, p.torneo_id, dia, "visita")
            fila = {
                "clave": p.clave, "api_id": p.api_id, "momento": p.momento, "anio": p.anio,
                "competicion": p.competicion, "rama": p.rama, "torneo": p.torneo, "fase": p.fase,
                "local": p.local, "visitante": p.visitante, "estado": p.estado,
                "administrativo": bool(p.administrativo),
                "goles_local": p.goles_local, "goles_visitante": p.goles_visitante,
                "eliminatoria": int(any(k in (p.fase or "").upper() for k in PALABRAS_ELIMINATORIA)),
            }
            fila.update({f"l_{k}": x for k, x in vl.items()})
            fila.update({f"v_{k}": x for k, x in vv.items()})
            fila["elo_dif"] = vl["elo"] - vv["elo"]
            fila["ppp5_dif"] = vl["ppp5"] - vv["ppp5"]
            fila["ppp_torneo_dif"] = vl["ppp_torneo"] - vv["ppp_torneo"]
            fila["dg_torneo_dif"] = vl["dg_torneo"] - vv["dg_torneo"]
            filas.append(fila)

        # Recién al terminar el día se incorporan los resultados.
        for p in grupo.itertuples():
            if p.estado == "finalizado" and pd.notna(p.goles_local) and pd.notna(p.goles_visitante):
                estado.actualizar(p)

    out = pd.DataFrame(filas)
    jugado = (out.estado == "finalizado") & out.goles_local.notna()
    out["y"] = [resultado(a, b) if j else -1
                for a, b, j in zip(out.goles_local, out.goles_visitante, jugado)]
    return out


VARIABLES = [
    "l_elo", "v_elo", "elo_dif",
    "l_ppp5", "v_ppp5", "ppp5_dif", "l_gf5", "v_gf5", "l_gc5", "v_gc5",
    "l_ppp10", "v_ppp10", "l_ppp_condicion", "v_ppp_condicion",
    "l_pj_torneo", "v_pj_torneo", "l_ppp_torneo", "v_ppp_torneo", "ppp_torneo_dif",
    "l_dg_torneo", "v_dg_torneo", "dg_torneo_dif",
    "l_descanso", "v_descanso", "l_rojas_ultimo", "v_rojas_ultimo",
    "eliminatoria", "comp_liga", "comp_torneo", "comp_copa", "comp_superliga", "comp_femenina",
]


def agregar_dummies(tabla: pd.DataFrame) -> pd.DataFrame:
    for c in ("liga", "torneo", "copa", "superliga", "femenina"):
        tabla[f"comp_{c}"] = (tabla.competicion == c).astype(int)
    return tabla
