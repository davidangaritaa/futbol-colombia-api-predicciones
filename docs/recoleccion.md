# Recolección de datos

El recolector (`src/collector.js`) usa el [scraper](scraper.md) para leer Dimayor y guarda el resultado en la [base de datos](base-de-datos.md).

## Formas de lanzarlo

| Forma | Qué recolecta |
|---|---|
| `npm run scrape` | El torneo activo de **cada competición**, temporada actual. |
| `npm run scrape -- --todo` | Todos los torneos de todas las competiciones, temporada actual. |
| `npm run scrape -- --anio 2025` | Todos los torneos de 2025. Pedir un año implica `--todo`. |
| `npm run scrape -- --competicion femenina` | Solo esa competición. Se puede repetir: `--competicion liga --competicion copa`. |
| `POST /api/recolectar` | Lo mismo, con `{ "anio", "todo", "competiciones" }` en el body. Ver [endpoints](endpoints.md#post-apirecolectar). |
| Automática | El servidor recolecta el torneo activo de cada competición cada `SCRAPE_INTERVAL_MIN` minutos (360 por defecto) y al arrancar si la base está vacía. |

Competiciones: `liga`, `torneo` (Primera B), `femenina`, `copa`, `superliga`. Se definen en `COMPETICIONES` de `src/config.js`.

Temporadas disponibles en Dimayor: **2023, 2024, 2025 y 2026**.

> Ejecuta `npm run scrape` con el servidor detenido o encendido: ambos usan la misma base. SQLite en modo WAL permite leer mientras se escribe.

## Flujo paso a paso

```
1. Leer temporadas                (página de la liga)            → temporadas
2. Elegir temporada               (--anio o la más reciente)
3. Para cada competición:
   a. Leer torneos del año        get_competitions_for_season    → torneos (con su competición)
   b. Leer torneo activo          get_active_filters             → meta "activo:<competicion>"  (solo temporada actual)
   c. Elegir torneos              (activo, o todos con --todo)
   d. Para cada torneo:
      i.   Leer fases             get_phases_for_competition     → fases
      ii.  Para cada fase:
           - jornada 1..N         get_dynamic_content(partidos)  → partidos, equipos
           - fase completa        get_dynamic_content(partidos, sin jornada) → partidos "sueltos" (jornada 0)
           - tabla de la fase     get_dynamic_content(posiciones) → tablas (con grupo)
      iii. Ordenar fases          por la fecha de su primer partido → fases.orden
      iv.  Tablas del torneo, según la competición:
           - goleadores           → goleadores
           - reclasificación      → tablas (tipo reclasificacion)
           - descenso (solo Liga) → descenso
4. Guardar resumen                → meta "ultima_recoleccion"
```

Qué tablas pide cada competición (según lo que ofrece Dimayor):

| Competición | Posiciones | Reclasificación | Descenso | Goleadores |
|---|:-:|:-:|:-:|:-:|
| `liga` | ✔ | ✔ | ✔ | ✔ |
| `torneo` | ✔ | ✔ | | ✔ |
| `femenina` | ✔ | ✔ | | ✔ |
| `copa` | ✔ | | | ✔ |
| `superliga` | ✔ | | | ✔ |

### Fases sin número de jornadas

Dimayor a veces informa `0` jornadas en cuadrangulares y finales. En ese caso el recolector pide la jornada 1, 2, 3… y **se detiene en la primera jornada sin partidos** (máximo 30, constante `MAX_JORNADAS_SIN_DECLARAR`). Luego actualiza la fase con el número real de jornadas encontradas.

### Partidos sin jornada

Algunos partidos no aparecen en ninguna jornada numerada, pero sí al pedir la fase completa. Pasa, por ejemplo, con la final del Torneo BetPlay 2026 y la final de la Liga Femenina 2026. Por eso, después de recorrer las jornadas, el recolector pide la fase completa y guarda con **`jornada = 0`** los partidos que no había visto. Para saber si ya los había visto, compara local, visitante y fecha.

### Orden de las fases

Los IDs de fase de Dimayor y el orden en que las entrega no son cronológicos. Al terminar cada torneo, `ordenarFasesPorFecha()` numera las fases según la fecha de su primer partido (las fases sin partidos quedan al final). Ver [base de datos → fases](base-de-datos.md#fases).

## Detalle de partidos

El detalle (eventos, alineaciones, cuerpo técnico y árbitros) lo recolecta un módulo aparte, `src/detalles.js`, desde la [API REST de Dimayor](scraper.md#api-rest-de-detalle-de-partidos).

| Forma | Qué hace |
|---|---|
| `npm run detalles` | Descarga el detalle de **todos** los partidos finalizados que aún no lo tienen. |
| `npm run detalles -- --limite 100` | Como máximo 100 partidos. |
| `npm run detalles -- --anio 2026` | Solo una temporada. |
| `npm run detalles -- --competicion liga` | Solo una competición (se puede repetir). |
| Automática | El servidor, después de cada recolección automática, descarga el detalle de los partidos que terminaron desde la vez anterior. |

Funcionamiento:

- Son **3 peticiones por partido** (events, lineups, officials). La primera vez, con ~3.600 partidos, tarda unas **2 horas**; después solo procesa los partidos nuevos (segundos).
- Va **del partido más reciente al más antiguo**.
- La tabla `detalles` registra qué partidos ya se procesaron, así que **se puede interrumpir** (Ctrl+C) y al volver a lanzarlo continúa donde quedó.
- Si un partido falla, se registra el error y se sigue con el siguiente (se reintentará en la próxima ejecución). Si fallan **10 seguidos** (Dimayor caído o bloqueo), se detiene.
- Si Dimayor no tiene eventos ni alineaciones de un partido, se marca `sin_datos` y no se vuelve a pedir.
- Cada 50 partidos escribe el progreso y una estimación del tiempo restante:
  ```
  [detalles ...]   250/3575 (ok 250, sin datos 0, errores 0) · faltan ~105 min
  ```

## Tolerancia a fallos

| Nivel | Qué pasa si falla | Dónde queda registrado |
|---|---|---|
| Una **tabla** (posiciones, goleadores, reclasificación, descenso) | Se omite esa tabla; el resto se guarda. Si ya había una versión anterior, se conserva. | `ultimaRecoleccion.avisos` |
| Una **competición** entera | Se pasa a la siguiente competición. | `ultimaRecoleccion.errores` |
| La lista de **temporadas** | La recolección termina con error. | Consola |

Caso conocido: la tabla de cuadrangulares del **Torneo BetPlay 2026 Apertura** responde **HTTP 500** desde Dimayor, y esa fase tampoco devuelve partidos. Es un fallo del lado de Dimayor y queda como aviso.

## Cómo se guardan los datos

| Dato | Estrategia |
|---|---|
| Temporadas, torneos, fases | *Upsert*: se insertan o se actualizan. |
| Equipos | *Upsert* por nombre exacto **y rama**. El escudo se actualiza si llega uno nuevo. |
| Partidos | *Upsert* por clave `torneo-fase-jornada-local-visitante`. Un partido programado se convierte en finalizado en la siguiente recolección. |
| Posiciones, reclasificación, goleadores, descenso | Se **borran y se vuelven a insertar** (foto del momento). Si Dimayor devuelve una tabla vacía o falla, se conserva la anterior. |

Cada bloque de escritura va en una **transacción**: o se guarda completo o no se guarda nada.

## Concurrencia

Solo puede haber una recolección a la vez **dentro de un mismo proceso**. Si llega otra mientras corre una, `recolectar()` devuelve la que ya está en curso y la API responde `409`.

> Un `npm run scrape` en la terminal es un proceso aparte del servidor; evita lanzarlo justo cuando corre la recolección automática.

## Tiempos de referencia

Con la pausa por defecto de 600 ms:

| Recolección | Tiempo aprox. |
|---|---|
| Torneos activos de las 5 competiciones (`npm run scrape`) | 1–1,5 min |
| Temporada completa de las 5 competiciones (`--anio`) | 2 min |
| Solo la Liga, temporada completa | 40 s |

## Registro (logs)

El recolector escribe en consola con el prefijo `[recolector <fecha ISO>]`:

```
[recolector ...] [Torneo BetPlay (Primera B)] "Torneo Betplay 2026 Apertura": 3 fase(s)
[recolector ...]   Aviso: Posiciones de "Torneo Betplay 2026 Apertura" / "FASE II - CUADRANGULARES": HTTP 500 en ...
[recolector ...]   Fase "FASE III - FINAL": 1 jornada(s), 2 partido(s) (2 sin jornada)
[recolector ...] Recolección completa {"temporada":2026,"torneos":{...},"avisos":[...],"segundos":124,...}
```

Para diagnosticar errores, ver [scraper → cuando se rompe](scraper.md#cuando-el-scraper-se-rompe).
