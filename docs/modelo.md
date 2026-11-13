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

## Premier League

Para probar el método con más datos, el proyecto también modela la Premier League. Es independiente de la API de Colombia: tiene su propia base, `data/premier.db`.

```bash
ml/.venv/Scripts/python ml/premier_datos.py        # descarga (usa caché en data/premier/raw/; --refrescar para todo)
ml/.venv/Scripts/python ml/premier_entrenar.py     # entrena y evalúa
```

### Fuente

- **Archivo público de Fantasy Premier League** ([vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League)): una fila por jugador y partido desde 2016-17, con minutos, titularidad, goles, asistencias, tarjetas, puntos FPL y, desde 2022-23, xG y xA.
- **API oficial de FPL**: completa los partidos de la temporada en curso que el archivo aún no tiene. Esos partidos tienen resultado, pero no datos de jugadores.
- No se usaron ni football-data.co.uk ni Understat: el primero corta la conexión desde la red actual y el segundo estaba fuera de servicio.

Datos: 4.180 partidos (10 temporadas completas más la actual) y unas 258.000 filas de jugador por partido. Los equipos con nombres distintos entre temporadas se unifican con `ALIAS` en `premier_datos.py`.

### Variables extra (de plantel)

| Variable | Descripción |
|---|---|
| `xg5`, `xgc5` | xG a favor y en contra, media de los últimos 5 partidos (solo desde 2022-23). |
| `calidad_habitual` | Calidad media del once titular en los últimos 5 partidos. La calidad de un jugador es su media de puntos FPL en sus 10 apariciones anteriores. |
| `calidad_xi` | Calidad del once titular de **ese** partido. Las alineaciones se publican ~1 hora antes. |
| `xi_vs_habitual` | `calidad_xi − calidad_habitual`: mide si faltan titulares (lesiones, rotación). |
| `cambios_xi` | Titulares distintos respecto al partido anterior. |

Los equipos ascendidos arrancan con un Elo 100 puntos por debajo del inicial.

### Resultados (entrenamiento 2017-18 a 2023-24, prueba desde 2024-25: 860 partidos)

| Modelo | Acierto | Log loss |
|---|--:|--:|
| Referencia: frecuencias | 41,7 % | 1,084 |
| **Referencia: solo Elo** | **50,9 %** | **1,014** |
| Regresión logística, base | 48,9 % | 1,028 |
| Regresión logística, + plantel | 49,3 % | 1,033 |
| Regresión logística, + alineación | 50,0 % | 1,038 |
| LightGBM, + alineación | 48,3 % | 1,042 |

Pruebas adicionales: modelos compactos (Elo más una o dos variables) y ajuste del K del Elo para la Premier (K=20–30 es apenas mejor que 40). Ninguna combinación mejora al Elo solo de forma clara. La mejor, Elo + calidad del once, empata con él (log loss 1,011 frente a 1,012).

**Conclusiones:**
- Igual que en Colombia, el **Elo resume casi toda la información útil**. La forma, el xG reciente y la calidad del once, medida con puntos FPL, ya están reflejados en el Elo.
- El periodo de prueba es más difícil que el de validación. La victoria local cayó al 41,7 %, y el mismo Elo que acertaba 55,7 % en 2022-24 acierta 50,3 % desde 2024.
- Para superar al Elo hace falta una medida de jugadores mejor que los puntos FPL, o un modelo de goles (Dixon-Coles). Sin cuotas no se puede comparar con el mercado.
