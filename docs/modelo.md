# Modelo de predicción (1X2)

Predice la probabilidad de **victoria local, empate o victoria visitante** a partir de los datos que recolecta la API. Está en Python, en la carpeta `ml/`, y lee directamente `data/futbol.db`.

## Instalación y uso

```bash
py -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt

ml/.venv/Scripts/python ml/entrenar.py                 # entrena, evalúa y guarda el modelo
ml/.venv/Scripts/python ml/entrenar.py --corte 2026-01-01
ml/.venv/Scripts/python ml/ajustar_elo.py              # busca los parámetros del Elo
```

Requiere haber ejecutado antes `npm run scrape -- --anio <año>` para cada temporada y `npm run detalles`.

| Archivo | Qué hace |
|---|---|
| `ml/datos.py` | Carga los partidos, los goles según los eventos y las tarjetas rojas. Marca los **resultados administrativos**. |
| `ml/features.py` | Calcula las variables previas a cada partido, sin fuga de información. |
| `ml/entrenar.py` | División temporal, referencias, modelos, métricas e importancia de variables. Guarda `ml/modelos/modelo_1x2.joblib` y `evaluacion.json`. |
| `ml/ajustar_elo.py` | Elige K y la ventaja de local del Elo usando solo datos anteriores al periodo de prueba. |

`ml/.venv/` y `ml/modelos/` no se suben a git.

## Sin fuga de información

Las tablas de posiciones de la base son una "foto" del estado actual, así que **no se usan** como variables: un partido de marzo vería la tabla de noviembre. En su lugar, `features.py` recorre los partidos **día por día** en orden cronológico. Las variables de un partido se calculan con lo ocurrido **antes de ese día**, y solo al terminar el día se incorporan los resultados.

## Variables

Para el local (`l_`) y el visitante (`v_`):

| Variable | Descripción |
|---|---|
| `elo` | Rating Elo, actualizado con todos los partidos de su rama (Liga, B, Copa, Superliga). K=40, con multiplicador por diferencia de gol. |
| `ppp5`, `ppp10` | Puntos por partido en los últimos 5 y 10 partidos. |
| `gf5`, `gc5` | Goles a favor y en contra por partido, últimos 5. |
| `ppp_condicion` | Puntos por partido en los últimos 5 de local (para el local) o de visitante (para el visitante). |
| `pj_torneo`, `ppp_torneo`, `dg_torneo` | Partidos, puntos y diferencia de gol por partido en el torneo actual (la tabla recalculada a esa fecha). |
| `descanso` | Días desde su último partido (máximo 30). |
| `rojas_ultimo` | Expulsados en su último partido (aproxima las suspensiones). |

Además: diferencias (`elo_dif`, `ppp5_dif`, `ppp_torneo_dif`, `dg_torneo_dif`), si la fase es eliminatoria, y la competición.

## Evaluación

- **Entrenamiento:** partidos del 2023-04-01 al 2025-06-30. Los primeros meses de 2023 solo sirven para "calentar" el Elo y la forma.
- **Prueba:** partidos desde el 2025-07-01 (1.325), que el modelo nunca vio.
- Se excluyen los **7 resultados administrativos** (3-0 de escritorio, distintos de lo que se jugó).
- Métricas: **acierto** (% de veces que la opción más probable fue la correcta), **log loss** y **Brier** (calidad de las probabilidades; menor es mejor). Para apostar o analizar importan más las probabilidades que el acierto.

### Resultados (noviembre de 2026, todas las competiciones)

| Modelo | Acierto | Log loss | Brier |
|---|--:|--:|--:|
| Referencia: siempre gana el local | 44,3 % | 4,234 | 1,112 |
| Referencia: frecuencias históricas | 44,3 % | 1,075 | 0,650 |
| **Referencia: solo diferencia de Elo** | **47,8 %** | **1,029** | **0,618** |
| Regresión logística (todas las variables) | 46,7 % | 1,037 | 0,623 |
| LightGBM | 46,9 % | 1,048 | 0,630 |
| Promedio regresión + LightGBM | 47,2 % | 1,036 | 0,623 |

Por competición, el Elo acierta 47 % en la Liga, 45 % en la Primera B, 54 % en la Liga Femenina y 51 % en la Copa.

**Conclusión:** con unos 2.000 partidos de entrenamiento, el **Elo bien ajustado es la mejor señal** y las demás variables todavía no lo mejoran: agregan ruido. Es un resultado común en fútbol; el empate (29 %) es casi impredecible y la liga colombiana es muy pareja.

Variables más importantes según LightGBM: `elo_dif`, diferencia de gol y puntos por partido en el torneo, y el Elo de cada equipo.

## Próximos pasos

1. **Modelo de goles (Poisson / Dixon-Coles):** predecir el marcador y derivar 1X2, más/menos goles y ambos marcan.
2. **Variables de plantel** a partir de las alineaciones: cuántos titulares habituales juegan, rotación, suspendidos por acumulación de amarillas.
3. **Selección de variables** más compacta alrededor del Elo, y Elo separado de local y visitante.
4. Más historia: Dimayor solo ofrece desde 2023.
