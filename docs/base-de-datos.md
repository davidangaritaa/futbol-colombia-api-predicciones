# Base de datos

- Motor: **SQLite** mediante el módulo integrado `node:sqlite` de Node 24.
- Archivo: `data/futbol.db` (configurable con `DB_PATH`). La carpeta se crea sola.
- Modo `WAL` (permite leer mientras se escribe) y claves foráneas activadas.
- El esquema se crea automáticamente al iniciar, en `src/db/database.js`.

## Versión del esquema

La versión se guarda en `PRAGMA user_version` (constante `VERSION_ESQUEMA`, hoy **2**).

Si al arrancar se encuentra una base con una versión anterior, **se borra y se recrea vacía**, y aparece este mensaje:

```
[db] Esquema v0 obsoleto: se recrea la base en v2. Vuelve a recolectar los datos.
```

Esto es posible porque todos los datos se pueden volver a descargar de Dimayor. Después de una actualización así, ejecuta de nuevo `npm run scrape -- --anio <año>` por cada temporada.

| Versión | Cambios |
|---|---|
| 1 | Esquema inicial (solo Liga BetPlay). |
| 2 | Varias competiciones (`torneos.competicion`), ramas (`equipos.rama`), IDs de fase de texto, grupos (`partidos.grupo`, `tablas.grupo`) y canales de TV (`partidos.canales`). |

## Diagrama

```
temporadas 1───* torneos 1───* fases
                 (competicion)    │
                    │             │
                    *             *
                 partidos ────────┘
                  │    │
        local_id  │    │ visitante_id
                  ▼    ▼
                  equipos (nombre + rama) ◄──── tablas      (posiciones / reclasificación)
                     ▲
                     └──────── descenso

goleadores  (por torneo; el equipo es texto)
meta        (clave/valor)
```

## Tablas

### temporadas

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | ID de Dimayor (`season_id`). |
| `anio` | INTEGER UNIQUE | Año. |

### torneos

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | ID de Dimayor (`competition_id`). |
| `temporada_id` | INTEGER → temporadas | |
| `competicion` | TEXT | `liga`, `torneo`, `femenina`, `copa` o `superliga`. |
| `nombre` | TEXT | Ej. `LIGA BETPLAY DIMAYOR II 2026`. |

Índice: `idx_torneos_competicion (competicion, temporada_id)`.

### fases

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | ID de Dimayor (`phase_id`). Número como texto (`"186219"`) o texto en fases por grupos (`"group-FASE+II+CUADRANGULARES-186614"`). |
| `torneo_id` | INTEGER → torneos | |
| `nombre` | TEXT | Ej. `FASE I - TODOS CONTRA TODOS`. |
| `jornadas` | INTEGER | Número de jornadas (real si Dimayor informaba 0). |
| `orden` | INTEGER | Posición cronológica de la fase en el torneo (1 = primera). |

**¿Por qué `orden`?** Ni los IDs de Dimayor ni el orden en que entrega las fases son cronológicos: en el Apertura 2026, "Cuartos de final" tiene un ID menor que "Todos contra todos", y en 2025 la final llega antes que los cuadrangulares. El recolector ordena las fases por la fecha de su primer partido.

### equipos

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | ID propio de esta API. |
| `nombre` | TEXT | Nombre tal como lo escribe Dimayor en partidos y tablas. |
| `rama` | TEXT | `masculino` o `femenino`. |
| `escudo` | TEXT | URL de la imagen. |

Clave única: `(nombre, rama)`.

- El "América de Cali" masculino y el femenino son **dos equipos**.
- Un equipo masculino es **el mismo** en Liga, Primera B, Copa y Superliga (por ejemplo, un club que desciende conserva su ID).
- Los equipos se identifican por **nombre exacto**. Los nombres alternativos conocidos se unifican antes de guardar (lista `ALIAS_EQUIPOS` en `src/scraper/parsers.js`); un nombre alternativo nuevo aparecería como otro equipo hasta agregarlo a esa lista.

### partidos

| Columna | Tipo | Descripción |
|---|---|---|
| `clave` | TEXT PK | `torneoId-faseId-jornada-Local-Visitante`. |
| `api_id` | TEXT | ID de Dimayor; `NULL` hasta que el partido se juega. |
| `torneo_id` | INTEGER → torneos | |
| `fase_id` | TEXT → fases | |
| `grupo` | TEXT | Grupo en fases por grupos (`A`, `B`…); `NULL` en las demás. |
| `jornada` | INTEGER | `0` = sin jornada asignada por Dimayor. |
| `fecha` | TEXT | `YYYY-MM-DD`. |
| `hora` | TEXT | `HH:MM`, hora de Colombia. |
| `local_id`, `visitante_id` | INTEGER → equipos | |
| `goles_local`, `goles_visitante` | INTEGER | `NULL` si no se ha jugado. |
| `estado` | TEXT | `finalizado`, `programado` o `por definir` (aplazado o sin programar). |
| `estadio` | TEXT | |
| `canales` | TEXT (JSON) | `[{"nombre":"Win+ Fútbol","logo":"https://..."}]`; `[]` si no hay. |
| `actualizado` | TEXT | Fecha ISO de la última recolección que tocó la fila. |

Índices: `idx_partidos_torneo (torneo_id, fase_id, jornada)` e `idx_partidos_fecha (fecha)`.

**¿Por qué una clave de texto?** Los partidos programados no tienen `api_id` todavía. La clave permite que el mismo partido pase de `programado` a `finalizado` sin duplicarse.

### tablas

Posiciones por fase (y grupo) y reclasificación anual.

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `fase_id` | TEXT | ID de fase; **vacío (`''`)** para la reclasificación. |
| `tipo` | TEXT | `posiciones` o `reclasificacion`. |
| `grupo` | TEXT | `A`, `B`… en fases por grupos; `''` en las demás. |
| `posicion` | INTEGER | |
| `equipo_id` | INTEGER → equipos | |
| `puntos`, `jugados`, `ganados`, `empatados`, `perdidos` | INTEGER | |
| `goles_favor`, `goles_contra`, `diferencia` | INTEGER | |

PK: `(torneo_id, fase_id, tipo, grupo, equipo_id)`.

### goleadores

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `jugador_id` | TEXT | ID de Dimayor (o `nombre-equipo` si faltara). |
| `posicion`, `goles`, `jugados` | INTEGER | |
| `jugador`, `foto`, `equipo` | TEXT | `equipo` es texto libre (ver nota en [endpoints](endpoints.md#get-apigoleadores)). |

PK: `(torneo_id, jugador_id)`.

### descenso

Solo para la Liga BetPlay.

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `equipo_id` | INTEGER → equipos | |
| `posicion`, `jugados`, `puntos` | INTEGER | Totales de 3 años. |
| `por_anio` | TEXT (JSON) | `[{"anio":2024,"jugados":0,"puntos":0}, ...]` |
| `promedio` | REAL | |

PK: `(torneo_id, equipo_id)`.

### Detalle de partidos

Estas tablas se añadieron sin cambiar `VERSION_ESQUEMA`: se crean solas en bases existentes, sin borrar datos. Se relacionan con `partidos` por `api_id`.

```
partidos (api_id) 1───1 detalles
                  1───* eventos       ──► personas
                  1───* alineaciones  ──► personas, equipos
                  1───* tecnicos      ──► personas, equipos
                  1───* arbitros
```

#### detalles

Control de qué partidos ya tienen detalle.

| Columna | Tipo | Descripción |
|---|---|---|
| `api_id` | TEXT PK | ID del partido en Dimayor. |
| `estado` | TEXT | `ok` o `sin_datos` (Dimayor no tiene eventos ni alineaciones). |
| `recolectado` | TEXT | Fecha ISO. |

#### personas

Jugadores y cuerpo técnico.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | `personId` de COMET: estable entre temporadas y equipos. |
| `nombre` | TEXT | `APELLIDO NOMBRE`, p. ej. `PAIVA GUILLERMO`. |
| `nombre_corto` | TEXT | |
| `fifa_id` | TEXT | |
| `foto` | TEXT | ID de imagen de COMET. |

> El ID de persona permite seguir a un jugador aunque cambie de equipo. El texto de `goleadores.jugador_id` es el mismo ID.

#### alineaciones

| Columna | Tipo | Descripción |
|---|---|---|
| `api_id` | TEXT | Partido. |
| `persona_id` | INTEGER → personas | |
| `equipo_id` | INTEGER → equipos | |
| `es_local` | INTEGER | 1 = local. |
| `titular` | INTEGER | 1 = titular, 0 = suplente (convocado). |
| `capitan` | INTEGER | |
| `posicion` | TEXT | Solo `G` (arquero); el resto vacío. |
| `dorsal` | INTEGER | |

PK: `(api_id, persona_id)`.

#### tecnicos

| Columna | Tipo | Descripción |
|---|---|---|
| `api_id`, `persona_id`, `equipo_id`, `es_local` | | Como en `alineaciones`. |
| `rol` | TEXT | `Head Coach`, `Assistant Coach`, `Goalkeeper coach`, `Physical trainer`, `Doctor`… |

#### eventos

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | `eventId` de COMET. |
| `api_id` | TEXT | Partido. |
| `tipo` | TEXT | `GOAL`, `PENALTY`, `OWN_GOAL`, `YELLOW`, `SECOND_YELLOW`, `RED`, `EXPULSION`, `SUBSTITUTION`, `START`, `END`, `FULL_TIME`. |
| `periodo` | TEXT | `FIRST_HALF`, `SECOND_HALF`… |
| `minuto` | INTEGER | Minuto del partido (1–90+). |
| `minuto_periodo` | INTEGER | Minuto dentro del periodo. |
| `adicion` | INTEGER | Minutos de tiempo añadido (45+2 → 2). |
| `es_local`, `equipo_id` | | Equipo **del jugador** del evento. |
| `persona_id` | INTEGER → personas | Jugador. En cambios: **el que entra**. |
| `persona2_id` | INTEGER → personas | En cambios: **el que sale**. |
| `orden` | INTEGER | Orden dentro del partido. |

⚠️ En `OWN_GOAL`, `equipo_id` es el del jugador que lo marcó; el gol cuenta para el **rival**.

#### arbitros

| Columna | Tipo | Descripción |
|---|---|---|
| `api_id` | TEXT | Partido. |
| `rol` | TEXT | `central`, `asistente1`, `asistente2`, `cuarto`, `var`, `avar`. |
| `nombre` | TEXT | `APELLIDO NOMBRE`. |

PK: `(api_id, rol)`.

### meta

Pares clave/valor con valores en JSON.

| Clave | Valor |
|---|---|
| `activo:<competicion>` | `{"torneoId":186027,"faseId":"186219","jornada":19}` (una por competición) |
| `ultima_recoleccion` | `{"temporada":2026,"torneos":{"liga":[...]},"avisos":[...],"segundos":124,"fecha":"..."}` |
| `ultima_recoleccion_detalles` | `{"procesados":3575,"ok":3575,"sinDatos":0,"errores":0,"segundos":6500,"fecha":"..."}` |

## Consultas útiles

Abrir la base: cualquier visor SQLite sirve (por ejemplo [DB Browser for SQLite](https://sqlitebrowser.org/)), o con Node:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('data/futbol.db'); console.table(db.prepare('SELECT * FROM torneos').all())"
```

Partidos y torneos por competición:

```sql
SELECT t.competicion, COUNT(DISTINCT t.id) AS torneos, COUNT(p.clave) AS partidos
FROM torneos t LEFT JOIN partidos p ON p.torneo_id = t.id
GROUP BY t.competicion;
```

Resultados de un equipo (masculino) en cualquier competición:

```sql
SELECT t.competicion, p.fecha, l.nombre AS local, p.goles_local, p.goles_visitante, v.nombre AS visitante
FROM partidos p
JOIN torneos t ON t.id = p.torneo_id
JOIN equipos l ON l.id = p.local_id
JOIN equipos v ON v.id = p.visitante_id
WHERE 'América de Cali' IN (l.nombre, v.nombre) AND l.rama = 'masculino' AND p.estado = 'finalizado'
ORDER BY p.fecha DESC;
```

Partidos con más goles:

```sql
SELECT t.competicion, p.fecha, l.nombre, p.goles_local, p.goles_visitante, v.nombre,
       p.goles_local + p.goles_visitante AS total
FROM partidos p
JOIN torneos t ON t.id = p.torneo_id
JOIN equipos l ON l.id = p.local_id
JOIN equipos v ON v.id = p.visitante_id
WHERE p.goles_local IS NOT NULL
ORDER BY total DESC LIMIT 10;
```

Partidos por canal de TV:

```sql
SELECT json_extract(c.value, '$.nombre') AS canal, COUNT(*) AS partidos
FROM partidos p, json_each(p.canales) c
GROUP BY canal ORDER BY partidos DESC;
```

Árbitros con más tarjetas por partido (con al menos 10 partidos):

```sql
SELECT a.nombre, COUNT(DISTINCT a.api_id) AS partidos,
       ROUND(1.0 * SUM(e.tipo IN ('YELLOW', 'SECOND_YELLOW', 'RED')) / COUNT(DISTINCT a.api_id), 2) AS tarjetas_por_partido
FROM arbitros a LEFT JOIN eventos e ON e.api_id = a.api_id
WHERE a.rol = 'central'
GROUP BY a.nombre HAVING partidos >= 10
ORDER BY tarjetas_por_partido DESC LIMIT 10;
```

Minutos en que se marcan los goles (por tramos de 15):

```sql
SELECT (MIN(minuto, 90) - 1) / 15 * 15 + 1 AS desde, COUNT(*) AS goles
FROM eventos WHERE tipo IN ('GOAL', 'PENALTY', 'OWN_GOAL')
GROUP BY desde ORDER BY desde;
```

## Respaldo y reinicio

- **Respaldo:** detén el servidor y copia `data/futbol.db` (y los archivos `-wal` / `-shm` si existen).
- **Empezar de cero:** detén el servidor, borra la carpeta `data/` y vuelve a ejecutar `npm run scrape -- --anio <año>` por cada temporada que quieras.
