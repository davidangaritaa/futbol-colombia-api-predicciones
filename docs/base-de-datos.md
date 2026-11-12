# Base de datos

- Motor: **SQLite** mediante el módulo integrado `node:sqlite` de Node 24.
- Archivo: `data/futbol.db` (configurable con `DB_PATH`). La carpeta se crea sola.
- Modo `WAL` (permite leer mientras se escribe) y claves foráneas activadas.
- El esquema se crea automáticamente al iniciar (`CREATE TABLE IF NOT EXISTS` en `src/db/database.js`). Los cambios de columnas en bases existentes se aplican ahí mismo con `ALTER TABLE` (hoy solo `fases.orden`).

## Diagrama

```
temporadas 1───* torneos 1───* fases
                    │             │
                    │             │
                    *             *
                 partidos ────────┘
                  │    │
        local_id  │    │ visitante_id
                  ▼    ▼
                  equipos ◄──── tablas      (posiciones / reclasificación)
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
| `nombre` | TEXT | Ej. `LIGA BETPLAY DIMAYOR II 2026`. |

### fases

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | ID de Dimayor (`phase_id`). |
| `torneo_id` | INTEGER → torneos | |
| `nombre` | TEXT | Ej. `FASE I - TODOS CONTRA TODOS`. |
| `jornadas` | INTEGER | Número de jornadas (real si Dimayor informaba 0). |
| `orden` | INTEGER | Posición cronológica de la fase en el torneo (1 = primera). |

**¿Por qué `orden`?** Ni los IDs de Dimayor ni el orden en que entrega las fases son cronológicos: en el Apertura 2026, "Cuartos de final" tiene un ID menor que "Todos contra todos", y en 2025 la final llega antes que los cuadrangulares. El recolector ordena las fases por la fecha de su primer partido.

La columna se agrega sola (`ALTER TABLE`) en bases creadas antes de que existiera; vuelve a recolectar para llenarla.

### equipos

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | ID propio de esta API. |
| `nombre` | TEXT UNIQUE | Nombre tal como lo escribe Dimayor en partidos y tablas. |
| `escudo` | TEXT | URL de la imagen. |

> Los equipos se identifican por **nombre exacto**. Si Dimayor cambia cómo escribe un nombre (por ejemplo `Junior F.C.` → `Junior`), aparecería un equipo nuevo.

### partidos

| Columna | Tipo | Descripción |
|---|---|---|
| `clave` | TEXT PK | `torneoId-faseId-jornada-Local-Visitante`. |
| `api_id` | TEXT | ID de Dimayor; `NULL` hasta que el partido se juega. |
| `torneo_id` | INTEGER → torneos | |
| `fase_id` | INTEGER → fases | |
| `jornada` | INTEGER | |
| `fecha` | TEXT | `YYYY-MM-DD`. |
| `hora` | TEXT | `HH:MM`, hora de Colombia. |
| `local_id`, `visitante_id` | INTEGER → equipos | |
| `goles_local`, `goles_visitante` | INTEGER | `NULL` si no se ha jugado. |
| `estado` | TEXT | `finalizado`, `programado`, … |
| `estadio` | TEXT | |
| `actualizado` | TEXT | Fecha ISO de la última recolección que tocó la fila. |

Índice: `idx_partidos_torneo (torneo_id, fase_id, jornada)`.

**¿Por qué una clave de texto?** Los partidos programados no tienen `api_id` todavía. La clave permite que el mismo partido pase de `programado` a `finalizado` sin duplicarse.

### tablas

Posiciones por fase y reclasificación anual.

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `fase_id` | INTEGER | ID de fase; **0** para la reclasificación. |
| `tipo` | TEXT | `posiciones` o `reclasificacion`. |
| `posicion` | INTEGER | |
| `equipo_id` | INTEGER → equipos | |
| `puntos`, `jugados`, `ganados`, `empatados`, `perdidos` | INTEGER | |
| `goles_favor`, `goles_contra`, `diferencia` | INTEGER | |

PK: `(torneo_id, fase_id, tipo, equipo_id)`.

### goleadores

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `jugador_id` | TEXT | ID de Dimayor (o `nombre-equipo` si faltara). |
| `posicion`, `goles`, `jugados` | INTEGER | |
| `jugador`, `foto`, `equipo` | TEXT | `equipo` es texto libre (ver nota en [endpoints](endpoints.md#get-apigoleadores)). |

PK: `(torneo_id, jugador_id)`.

### descenso

| Columna | Tipo | Descripción |
|---|---|---|
| `torneo_id` | INTEGER | |
| `equipo_id` | INTEGER → equipos | |
| `posicion`, `jugados`, `puntos` | INTEGER | Totales de 3 años. |
| `por_anio` | TEXT (JSON) | `[{"anio":2024,"jugados":0,"puntos":0}, ...]` |
| `promedio` | REAL | |

PK: `(torneo_id, equipo_id)`.

### meta

Pares clave/valor con valores en JSON.

| Clave | Valor |
|---|---|
| `activo` | `{"torneoId":186027,"faseId":186219,"jornada":19}` |
| `ultima_recoleccion` | `{"temporada":2026,"torneos":[...],"segundos":14,"fecha":"..."}` |

## Consultas útiles

Abrir la base: cualquier visor SQLite sirve (por ejemplo [DB Browser for SQLite](https://sqlitebrowser.org/)), o con Node:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('data/futbol.db'); console.table(db.prepare('SELECT * FROM torneos').all())"
```

Resultados de un equipo:

```sql
SELECT p.fecha, l.nombre AS local, p.goles_local, p.goles_visitante, v.nombre AS visitante
FROM partidos p
JOIN equipos l ON l.id = p.local_id
JOIN equipos v ON v.id = p.visitante_id
WHERE 'América de Cali' IN (l.nombre, v.nombre) AND p.estado = 'finalizado'
ORDER BY p.fecha DESC;
```

Partidos con más goles:

```sql
SELECT p.fecha, l.nombre, p.goles_local, p.goles_visitante, v.nombre,
       p.goles_local + p.goles_visitante AS total
FROM partidos p JOIN equipos l ON l.id = p.local_id JOIN equipos v ON v.id = p.visitante_id
WHERE p.goles_local IS NOT NULL
ORDER BY total DESC LIMIT 10;
```

Rendimiento como local por equipo:

```sql
SELECT e.nombre,
       SUM(p.goles_local > p.goles_visitante) AS ganados,
       SUM(p.goles_local = p.goles_visitante) AS empatados,
       SUM(p.goles_local < p.goles_visitante) AS perdidos
FROM partidos p JOIN equipos e ON e.id = p.local_id
WHERE p.goles_local IS NOT NULL
GROUP BY e.id ORDER BY ganados DESC;
```

## Respaldo y reinicio

- **Respaldo:** detén el servidor y copia `data/futbol.db` (y los archivos `-wal` / `-shm` si existen).
- **Empezar de cero:** detén el servidor, borra la carpeta `data/` y vuelve a ejecutar `npm run scrape -- --anio <año>` por cada temporada que quieras.
