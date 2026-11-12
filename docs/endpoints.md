# Referencia de la API

URL base: `http://localhost:3000/api` (el puerto se cambia con `PORT`).

- Todas las respuestas son JSON con codificación UTF-8.
- CORS está habilitado para cualquier origen (`Access-Control-Allow-Origin: *`).
- Los IDs de temporadas, torneos y fases son los mismos que usa Dimayor. Los IDs de equipos son propios de esta API.

## Competiciones

| `competicion` | Competición | Rama |
|---|---|---|
| `liga` *(por defecto)* | Liga BetPlay (primera división) | masculino |
| `torneo` | Torneo BetPlay (Primera B) | masculino |
| `femenina` | Liga Femenina | femenino |
| `copa` | Copa BetPlay | masculino |
| `superliga` | Superliga | masculino |

**Torneo por defecto:** cuando un endpoint acepta `torneo` y no se envía, se usa el torneo **activo** de la `competicion` indicada (o de `liga` si tampoco se envía). Si el torneo activo no se conoce, se usa el más reciente con partidos. Si se envía `torneo`, `competicion` se ignora.

## Índice

| Método | Ruta | Descripción |
|---|---|---|
| GET | [`/api`](#get-api) | Lista de endpoints |
| GET | [`/api/estado`](#get-apiestado) | Estado de la recolección y conteos |
| GET | [`/api/competiciones`](#get-apicompeticiones) | Competiciones disponibles |
| GET | [`/api/temporadas`](#get-apitemporadas) | Temporadas |
| GET | [`/api/torneos`](#get-apitorneos) | Torneos |
| GET | [`/api/torneos/:id`](#get-apitorneosid) | Torneo con sus fases |
| GET | [`/api/equipos`](#get-apiequipos) | Equipos |
| GET | [`/api/equipos/:id`](#get-apiequiposid) | Equipo con sus partidos |
| GET | [`/api/partidos`](#get-apipartidos) | Partidos con filtros |
| GET | [`/api/partidos/:apiId`](#get-apipartidosapiid) | Detalle de un partido: eventos, alineaciones, técnicos, árbitros |
| GET | [`/api/posiciones`](#get-apiposiciones) | Tabla de posiciones |
| GET | [`/api/reclasificacion`](#get-apireclasificacion) | Tabla de reclasificación |
| GET | [`/api/descenso`](#get-apidescenso) | Tabla del descenso (solo Liga) |
| GET | [`/api/goleadores`](#get-apigoleadores) | Goleadores |
| POST | [`/api/recolectar`](#post-apirecolectar) | Lanza una recolección |

---

## GET /api

Devuelve el nombre de la API, la fuente de datos, las competiciones y la lista de endpoints. La raíz `/` redirige aquí.

---

## GET /api/estado

```json
{
  "recoleccionEnCurso": false,
  "ultimaRecoleccion": {
    "temporada": 2026,
    "torneos": {
      "liga": ["LIGA BETPLAY DIMAYOR I 2026", "LIGA BETPLAY DIMAYOR II 2026"],
      "torneo": ["Torneo Betplay 2026 Apertura", "Torneo Betplay 2026 Clausura"],
      "femenina": ["Liga Femenina 2026"],
      "copa": ["Copa Betplay Dimayor 2026"],
      "superliga": ["Super LIga Betplay 2026"]
    },
    "avisos": ["Posiciones de \"Torneo Betplay 2026 Apertura\" / \"FASE II - CUADRANGULARES\": HTTP 500 en ..."],
    "segundos": 118,
    "fecha": "2026-11-12T18:08:31.513Z"
  },
  "activos": {
    "liga": { "torneoId": 186027, "faseId": "186219", "jornada": 19 },
    "torneo": { "torneoId": 186614, "faseId": "group-FASE+II+CUADRANGULARES-186614", "jornada": 6 },
    "femenina": { "torneoId": 171697, "faseId": "190901", "jornada": 0 },
    "copa": { "torneoId": 177346, "faseId": "192876", "jornada": 1 },
    "superliga": { "torneoId": 169680, "faseId": "170169", "jornada": 2 }
  },
  "conteos": { "torneos": 28, "equipos": 61, "partidos": 3660, "goleadores": 3960 }
}
```

| Campo | Descripción |
|---|---|
| `recoleccionEnCurso` | `true` mientras se está recolectando. |
| `ultimaRecoleccion` | Resumen de la última recolección terminada (`null` si nunca se ha recolectado). |
| `ultimaRecoleccion.errores` | Competiciones que fallaron por completo (solo aparece si hubo). |
| `ultimaRecoleccion.avisos` | Tablas que no se pudieron descargar; el resto sí se guardó (solo aparece si hubo). |
| `activos` | Por competición: torneo, fase y jornada que Dimayor marca como actuales. |
| `detallesEnCurso` | `true` mientras el servidor descarga detalles de partidos (no ve un `npm run detalles` lanzado en otra terminal). |
| `ultimaRecoleccionDetalles` | Resumen de la última descarga de detalles. |
| `conteos.partidosConDetalle` / `detallesPendientes` | Cuántos partidos finalizados tienen detalle y cuántos faltan. |
| `conteos.personas` / `eventos` | Jugadores y técnicos registrados, y eventos (goles, tarjetas, cambios). |

---

## GET /api/competiciones

```json
[
  {
    "clave": "liga",
    "nombre": "Liga BetPlay",
    "rama": "masculino",
    "tablas": ["posiciones", "reclasificacion", "descenso", "goleadores"],
    "torneos": 8,
    "partidos": 1710
  }
]
```

`tablas` indica qué tablas ofrece Dimayor para esa competición. `torneos` y `partidos` son los que hay en la base.

---

## GET /api/temporadas

```json
[
  { "id": 169678, "anio": 2026 },
  { "id": 165413, "anio": 2025 }
]
```

---

## GET /api/torneos

| Parámetro | Tipo | Descripción |
|---|---|---|
| `temporada` | número (opcional) | Año, por ejemplo `2026`. |
| `competicion` | texto (opcional) | Filtra por competición. Sin él, se listan todas. |

```json
[
  { "id": 186027, "nombre": "LIGA BETPLAY DIMAYOR II 2026", "competicion": "liga", "temporada": 2026 },
  { "id": 171697, "nombre": "Liga Femenina 2026", "competicion": "femenina", "temporada": 2026 }
]
```

---

## GET /api/torneos/:id

Torneo con sus fases en orden cronológico (`orden` = 1 es la primera fase).

```json
{
  "id": 169679,
  "temporada_id": 169678,
  "competicion": "liga",
  "nombre": "LIGA BETPLAY DIMAYOR I 2026",
  "fases": [
    { "id": "180742", "nombre": "FASE I - TODOS CONTRA TODOS", "jornadas": 19, "orden": 1 },
    { "id": "177351", "nombre": "FASE II - CUARTOS DE FINAL", "jornadas": 1, "orden": 2 },
    { "id": "184867", "nombre": "FASE III - SEMIFINALES", "jornadas": 1, "orden": 3 },
    { "id": "185488", "nombre": "FASE IV - FINAL", "jornadas": 1, "orden": 4 }
  ]
}
```

- Los IDs de fase son **texto**. Pueden ser números (`"180742"`) o, en fases por grupos, textos como `"group-FASE+II+CUADRANGULARES-186614"`. Al usarlos en una URL, codifícalos (`encodeURIComponent`): el `+` debe enviarse como `%2B`.
- Los IDs no siguen el orden del torneo; usa siempre `orden`.

Error `404` si el torneo no existe.

---

## GET /api/equipos

| Parámetro | Tipo | Descripción |
|---|---|---|
| `competicion` | texto (opcional) | Solo equipos que han jugado en esa competición. |
| `rama` | `masculino` / `femenino` (opcional) | Filtra por rama. |

```json
[
  { "id": 8, "nombre": "América de Cali", "rama": "masculino", "escudo": "https://..." },
  { "id": 50, "nombre": "América de Cali", "rama": "femenino", "escudo": "https://..." }
]
```

Un mismo club tiene **un equipo por rama**: el América masculino y el femenino son equipos distintos. Un equipo masculino es el mismo en Liga, Primera B, Copa y Superliga.

---

## GET /api/equipos/:id

Equipo con **todos** sus partidos registrados (de cualquier competición), del más reciente al más antiguo. Cada partido tiene el formato de [`/api/partidos`](#get-apipartidos).

Error `404` si el equipo no existe.

---

## GET /api/partidos

| Parámetro | Tipo | Descripción |
|---|---|---|
| `competicion` | texto | Competición (por defecto `liga`). |
| `torneo` | número | ID del torneo (por defecto, el activo de la competición). |
| `fase` | texto | ID de la fase. |
| `grupo` | texto | Grupo en fases por grupos (`A`, `B`…; no distingue mayúsculas). |
| `jornada` | número | Número de jornada. `0` = partidos sin jornada asignada por Dimayor. |
| `equipo` | número | ID de equipo (como local o visitante). |
| `estado` | texto | `finalizado`, `programado` o `por definir` (aplazado o sin hora confirmada; se escribe `por%20definir` en la URL). |
| `fecha` | `YYYY-MM-DD` | Día del partido. |

Ordenados por fase (cronológicamente), jornada, fecha y hora.

```json
{
  "torneo": { "id": 186614, "nombre": "Torneo Betplay 2026 Clausura", "competicion": "torneo" },
  "total": 2,
  "partidos": [
    {
      "apiId": "416255440",
      "competicion": "torneo",
      "torneoId": 186614,
      "faseId": "group-FASE+II+CUADRANGULARES-186614",
      "fase": "FASE II - CUADRANGULARES",
      "grupo": "A",
      "jornada": 1,
      "fecha": "2026-10-29",
      "hora": "14:00",
      "estado": "finalizado",
      "estadio": "ESTADIO POLIDEPORTIVO SUR",
      "canales": [
        { "nombre": "Win+ Fútbol", "logo": "https://dimayor.com.co/wp-content/uploads/2025/11/WIN-MAS1.png" }
      ],
      "local":     { "id": 9, "nombre": "Envigado F.C.", "escudo": "https://...", "goles": 2 },
      "visitante": { "id": 21, "nombre": "Independiente Valle del Cauca", "escudo": "https://...", "goles": 0 }
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `apiId` | ID del partido en Dimayor. `null` mientras está programado. |
| `grupo` | `null` si la fase no es por grupos. |
| `jornada` | `0` si Dimayor no lo asigna a ninguna jornada (pasa en algunas finales). |
| `fecha`, `hora` | Hora local de Colombia, como la publica Dimayor. |
| `canales` | Canales de TV. `nombre` es `null` si el logo no es de un canal conocido. Lista vacía si Dimayor no informa canal. |
| `goles` | `null` si el partido no se ha jugado. |

Ejemplos:

```bash
curl "http://localhost:3000/api/partidos?jornada=19"
curl "http://localhost:3000/api/partidos?competicion=femenina&estado=finalizado"
curl "http://localhost:3000/api/partidos?competicion=torneo&grupo=A"
curl "http://localhost:3000/api/partidos?equipo=8&fecha=2026-11-14"
```

---

## GET /api/partidos/:apiId

Detalle de un partido jugado. `:apiId` es el campo `apiId` de [`/api/partidos`](#get-apipartidos). Incluye todos los campos del partido más:

```json
{
  "apiId": "371462107",
  "fecha": "2026-11-09",
  "local":     { "id": 1, "nombre": "Junior F.C.", "goles": 2 },
  "visitante": { "id": 26, "nombre": "Cúcuta Deportivo", "goles": 0 },
  "detalle": { "estado": "ok", "recolectado": "2026-11-12T18:39:27.969Z" },
  "arbitros": {
    "central": "ROLDAN WILMAR", "asistente1": "WILCHES VICTOR", "asistente2": "ZAMBRANO JHON",
    "cuarto": "HERRERA JEEFRY", "var": "JIMENEZ KEINER", "avar": "CORTES GUSTAVO"
  },
  "alineaciones": {
    "local": [
      { "id": 2436614, "nombre": "SILVEIRA MAURO", "dorsal": 1, "posicion": "G", "titular": true, "capitan": false }
    ],
    "visitante": [ "..." ]
  },
  "tecnicos": {
    "local": [ { "id": 3772807, "nombre": "VIERA MARIO", "rol": "Assistant Coach" } ],
    "visitante": [ { "id": 3037639, "nombre": "CHIESA NICOLAS", "rol": "Head Coach" } ]
  },
  "eventos": [
    { "tipo": "GOAL", "periodo": "FIRST_HALF", "minuto": 35, "adicion": 0, "equipo": "local",
      "jugador": { "id": 2335901, "nombre": "PAIVA GUILLERMO" } },
    { "tipo": "SUBSTITUTION", "periodo": "FIRST_HALF", "minuto": 43, "adicion": 0, "equipo": "local",
      "jugador": { "id": 1792349, "nombre": "CELIS GUILLERMO" },
      "entra": { "id": 1792349, "nombre": "CELIS GUILLERMO" },
      "sale":  { "id": 2511037, "nombre": "RIVAS JESUS" } }
  ]
}
```


| Campo | Descripción |
|---|---|
| `detalle` | `null` si aún no se ha recolectado el detalle de ese partido; `estado: "sin_datos"` si Dimayor no lo tiene. |
| `alineaciones` | Titulares primero, luego suplentes, ordenados por dorsal. `posicion` solo viene para arqueros (`G`). |
| `tecnicos` | Cuerpo técnico. Puede faltar el `Head Coach` (p. ej. técnico sancionado). |
| `eventos[].equipo` | `local` / `visitante`: equipo **del jugador**. En `OWN_GOAL` el gol cuenta para el otro equipo. |
| `eventos[].adicion` | Minutos de tiempo añadido (minuto 45 + `adicion` 2 = 45+2). |
| `entra` / `sale` | Solo en `SUBSTITUTION`. |

Tipos de evento: `GOAL`, `PENALTY` (gol de penal), `OWN_GOAL`, `YELLOW`, `SECOND_YELLOW`, `RED`, `EXPULSION`, `SUBSTITUTION`, `START`, `END`, `FULL_TIME`.

Error `404` si no existe un partido con ese `apiId`.

---

## GET /api/posiciones

| Parámetro | Tipo | Descripción |
|---|---|---|
| `competicion` | texto | Competición (por defecto `liga`). |
| `torneo` | número | ID del torneo (por defecto, el activo). |
| `fase` | texto | ID de la fase (por defecto, la primera fase del torneo con tabla; normalmente "todos contra todos"). |

```json
{
  "torneo": { "id": 186027, "nombre": "LIGA BETPLAY DIMAYOR II 2026", "competicion": "liga" },
  "fase": { "id": "186219", "nombre": "FASE I - TODOS CONTRA TODOS" },
  "tabla": [
    {
      "grupo": null,
      "posicion": 1,
      "equipo": { "id": 6, "nombre": "Atlético Nacional", "escudo": "https://..." },
      "puntos": 39, "jugados": 18, "ganados": 12, "empatados": 3, "perdidos": 3,
      "golesFavor": 37, "golesContra": 17, "diferencia": 20
    }
  ]
}
```

En fases por grupos (cuadrangulares), cada fila trae su `grupo` (`"A"`, `"B"`) y la tabla viene ordenada por grupo y posición. Para verla, pasa el ID de esa fase:

```bash
curl "http://localhost:3000/api/posiciones?competicion=torneo&fase=group-FASE%2BII%2BCUADRANGULARES-186614"
```

---

## GET /api/reclasificacion

| Parámetro | Tipo | Descripción |
|---|---|---|
| `competicion` | texto | `liga`, `torneo` o `femenina` (las únicas con reclasificación). |
| `torneo` | número | ID del torneo (por defecto, el activo). |

Mismo formato de `tabla` que [`/api/posiciones`](#get-apiposiciones), acumulando todos los torneos del año.

---

## GET /api/descenso

Solo existe para la **Liga BetPlay**: el parámetro `competicion` se ignora.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `torneo` | número | ID del torneo de la Liga (por defecto, el activo). |

```json
{
  "torneo": { "id": 186027, "nombre": "LIGA BETPLAY DIMAYOR II 2026", "competicion": "liga" },
  "tabla": [
    {
      "posicion": 20,
      "equipo": { "id": 18, "nombre": "Jaguares F.C.", "escudo": "https://..." },
      "porAnio": [
        { "anio": 2024, "jugados": 0, "puntos": 0 },
        { "anio": 2025, "jugados": 0, "puntos": 0 },
        { "anio": 2026, "jugados": 37, "puntos": 31 }
      ],
      "jugados": 37,
      "puntos": 31,
      "promedio": 0.8378
    }
  ]
}
```

`promedio` = puntos ÷ partidos jugados en las 3 temporadas.

---

## GET /api/goleadores

| Parámetro | Tipo | Descripción |
|---|---|---|
| `competicion` | texto | Competición (por defecto `liga`). |
| `torneo` | número | ID del torneo (por defecto, el activo). |
| `limite` | número | Máximo de jugadores (por defecto 50, máximo 500). |

```json
{
  "torneo": { "id": 171697, "nombre": "Liga Femenina 2026", "competicion": "femenina" },
  "goleadores": [
    {
      "posicion": 1,
      "jugadorId": "2465864",
      "jugador": "GONZALEZ MANUELA",
      "foto": "https://dimayor.com.co/wp-json/dimayor/v1/image/...",
      "equipo": "ATL. NACIONAL",
      "goles": 15,
      "jugados": 20
    }
  ]
}
```

> `equipo` aquí es texto tal como lo escribe Dimayor en su tabla de goleadores (en mayúsculas y a veces abreviado, p. ej. `ATL. BUCARAMANGA`), por eso no está enlazado al ID de equipo.

---

## POST /api/recolectar

Lanza una recolección en segundo plano y responde de inmediato.

Body JSON (opcional):

| Campo | Tipo | Descripción |
|---|---|---|
| `anio` | número | Temporada (por defecto, la más reciente). |
| `todo` | booleano | `true` = todos los torneos del año; `false` (por defecto) = solo los activos. |
| `competiciones` | lista de texto | Competiciones a recolectar, p. ej. `["liga", "femenina"]`. Por defecto, todas. |

Header `x-admin-token` obligatorio si se configuró `ADMIN_TOKEN` (ver [configuración](configuracion.md)).

```bash
curl -X POST http://localhost:3000/api/recolectar \
  -H "Content-Type: application/json" \
  -d '{"anio": 2024, "todo": true, "competiciones": ["liga", "copa"]}'
```

| Código | Significado |
|---|---|
| `202` | Recolección iniciada. Sigue el progreso en `GET /api/estado`. |
| `400` | Competición desconocida o `competiciones` no es una lista. |
| `401` | Token de administrador inválido. |
| `409` | Ya hay una recolección en curso. |

---

## Errores

Todos los errores tienen la forma:

```json
{ "error": "Competición \"nada\" no existe. Válidas: liga, torneo, femenina, copa, superliga" }
```

| Código | Cuándo |
|---|---|
| `400` | Parámetro inválido (por ejemplo, una competición que no existe). |
| `401` | Falta o es incorrecto `x-admin-token`. |
| `404` | Recurso inexistente, ruta desconocida o base vacía para esa competición. |
| `409` | Recolección ya en curso. |
| `500` | Error interno (se registra en la consola). |
