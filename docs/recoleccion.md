# Recolección de datos

El recolector (`src/collector.js`) usa el [scraper](scraper.md) para leer Dimayor y guarda el resultado en la [base de datos](base-de-datos.md).

## Formas de lanzarlo

| Forma | Qué recolecta |
|---|---|
| `npm run scrape` | El torneo activo de la temporada actual. |
| `npm run scrape -- --todo` | Todos los torneos de la temporada actual. |
| `npm run scrape -- --anio 2025` | Todos los torneos de 2025. Pedir un año implica `--todo`. |
| `POST /api/recolectar` | Igual que arriba, con `{ "anio": ..., "todo": ... }` en el body. Ver [endpoints](endpoints.md#post-apirecolectar). |
| Automática | El servidor recolecta el torneo activo cada `SCRAPE_INTERVAL_MIN` minutos (360 por defecto) y también al arrancar si la base está vacía. |

Temporadas disponibles en Dimayor: **2023, 2024, 2025 y 2026**.

> Ejecuta `npm run scrape` con el servidor detenido o encendido: ambos usan la misma base. SQLite en modo WAL permite leer mientras se escribe.

## Flujo paso a paso

```
1. Leer temporadas           (página de la liga)          → tabla temporadas
2. Elegir temporada          (--anio o la más reciente)
3. Leer torneos del año      get_competitions_for_season  → tabla torneos
4. Leer torneo activo        get_active_filters           → meta.activo   (solo temporada actual)
5. Elegir torneos            (activo, o todos con --todo)
6. Para cada torneo:
   a. Leer fases             get_phases_for_competition   → tabla fases
   b. Para cada fase:
      - jornada 1..N         get_dynamic_content(partidos)    → partidos, equipos
      - tabla de la fase     get_dynamic_content(posiciones)  → tablas (tipo posiciones)
   c. Ordenar fases          por la fecha de su primer partido → fases.orden
   d. Tablas del torneo:
      - goleadores           get_dynamic_content(goleadores)      → goleadores
      - reclasificación      get_dynamic_content(reclasificacion) → tablas (tipo reclasificacion, fase 0)
      - descenso             get_dynamic_content(descenso)        → descenso
7. Guardar resumen           → meta.ultima_recoleccion
```

### Fases sin número de jornadas

Dimayor a veces informa `0` jornadas en cuadrangulares y finales. En ese caso el recolector pide la jornada 1, 2, 3… y **se detiene en la primera jornada sin partidos** (máximo 30, constante `MAX_JORNADAS_SIN_DECLARAR`). Luego actualiza la fase con el número real de jornadas encontradas.

### Orden de las fases

Los IDs de fase de Dimayor y el orden en que las entrega no son cronológicos. Al terminar cada torneo, `ordenarFasesPorFecha()` numera las fases según la fecha de su primer partido (las fases sin partidos quedan al final). Ver [base de datos → fases](base-de-datos.md#fases).

## Cómo se guardan los datos

| Dato | Estrategia |
|---|---|
| Temporadas, torneos, fases | *Upsert*: se insertan o se actualizan. |
| Equipos | *Upsert* por nombre exacto. El escudo se actualiza si llega uno nuevo. |
| Partidos | *Upsert* por clave `torneo-fase-jornada-local-visitante`. Un partido programado se convierte en finalizado en la siguiente recolección. |
| Posiciones, reclasificación, goleadores, descenso | Se **borran y se vuelven a insertar** (foto del momento). Si Dimayor devuelve una tabla vacía, se conserva la anterior. |

Cada bloque de escritura va en una **transacción**: o se guarda completo o no se guarda nada.

## Concurrencia

Solo puede haber una recolección a la vez **dentro de un mismo proceso**. Si llega otra mientras corre una, `recolectar()` devuelve la que ya está en curso y la API responde `409`.

> Un `npm run scrape` en la terminal es un proceso aparte del servidor; evita lanzarlo justo cuando corre la recolección automática.

## Tiempos de referencia

Con la pausa por defecto de 600 ms:

| Recolección | Peticiones aprox. | Tiempo aprox. |
|---|---|---|
| Torneo activo (19 jornadas, 1 fase) | ~25 | 15 s |
| Temporada completa (2 torneos con playoffs) | ~70 | 35–45 s |

## Registro (logs)

El recolector escribe en consola con el prefijo `[recolector <fecha ISO>]`:

```
[recolector 2026-11-12T17:19:11.486Z]   Fase "FASE I  - LIGA BETPLAY DIMAYOR 2025 - I": 20 jornada(s) recolectadas
[recolector 2026-11-12T17:19:50.464Z] Recolección completa { temporada: 2025, torneos: [...], segundos: 42, ... }
```

Los errores aparecen como `[recolector] Error: <mensaje>`. Para diagnosticarlos, ver [scraper → cuando se rompe](scraper.md#cuando-el-scraper-se-rompe).
