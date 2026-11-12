# Referencia de la API

URL base: `http://localhost:3000/api` (el puerto se cambia con `PORT`).

- Todas las respuestas son JSON con codificación UTF-8.
- CORS está habilitado para cualquier origen (`Access-Control-Allow-Origin: *`).
- **Torneo por defecto:** cuando un endpoint acepta `torneo` y no se envía, se usa el torneo activo según Dimayor (o, si no se conoce, el más reciente con partidos).
- Los IDs de temporadas, torneos y fases son los mismos que usa Dimayor. Los IDs de equipos son propios de esta API.

## Índice

| Método | Ruta | Descripción |
|---|---|---|
| GET | [`/api`](#get-api) | Lista de endpoints |
| GET | [`/api/estado`](#get-apiestado) | Estado de la recolección y conteos |
| GET | [`/api/temporadas`](#get-apitemporadas) | Temporadas |
| GET | [`/api/torneos`](#get-apitorneos) | Torneos |
| GET | [`/api/torneos/:id`](#get-apitorneosid) | Torneo con sus fases |
| GET | [`/api/equipos`](#get-apiequipos) | Equipos |
| GET | [`/api/equipos/:id`](#get-apiequiposid) | Equipo con sus partidos |
| GET | [`/api/partidos`](#get-apipartidos) | Partidos con filtros |
| GET | [`/api/posiciones`](#get-apiposiciones) | Tabla de posiciones |
| GET | [`/api/reclasificacion`](#get-apireclasificacion) | Tabla de reclasificación |
| GET | [`/api/descenso`](#get-apidescenso) | Tabla del descenso |
| GET | [`/api/goleadores`](#get-apigoleadores) | Goleadores |
| POST | [`/api/recolectar`](#post-apirecolectar) | Lanza una recolección |

---

## GET /api

Devuelve el nombre de la API, la fuente de datos y la lista de endpoints. La raíz `/` redirige aquí.

---

## GET /api/estado

Estado de la última recolección y conteos de la base.

```json
{
  "recoleccionEnCurso": false,
  "ultimaRecoleccion": {
    "temporada": 2026,
    "torneos": ["LIGA BETPLAY DIMAYOR II 2026"],
    "segundos": 14,
    "fecha": "2026-11-12T17:18:27.250Z"
  },
  "activo": { "torneoId": 186027, "faseId": 186219, "jornada": 19 },
  "conteos": { "torneos": 4, "equipos": 22, "partidos": 808, "goleadores": 405 }
}
```

| Campo | Descripción |
|---|---|
| `recoleccionEnCurso` | `true` mientras se está recolectando. |
| `ultimaRecoleccion` | Resumen de la última recolección terminada (`null` si nunca se ha recolectado). |
| `activo` | Torneo, fase y jornada que Dimayor marca como actuales. |

---

## GET /api/temporadas

```json
[
  { "id": 169678, "anio": 2026 },
  { "id": 165413, "anio": 2025 }
]
```

Solo aparecen las temporadas que ya se han registrado en alguna recolección.

---

## GET /api/torneos

| Parámetro | Tipo | Descripción |
|---|---|---|
| `temporada` | número (opcional) | Año, por ejemplo `2026`. |

```json
[
  { "id": 186027, "nombre": "LIGA BETPLAY DIMAYOR II 2026", "temporada": 2026 },
  { "id": 169679, "nombre": "LIGA BETPLAY DIMAYOR I 2026", "temporada": 2026 }
]
```

---

## GET /api/torneos/:id

Torneo con sus fases en orden cronológico (`orden` = 1 es la primera fase).

```json
{
  "id": 169679,
  "temporada_id": 169678,
  "nombre": "LIGA BETPLAY DIMAYOR I 2026",
  "fases": [
    { "id": 180742, "nombre": "FASE I - TODOS CONTRA TODOS", "jornadas": 19, "orden": 1 },
    { "id": 177351, "nombre": "FASE II - CUARTOS DE FINAL", "jornadas": 1, "orden": 2 },
    { "id": 184867, "nombre": "FASE III - SEMIFINALES", "jornadas": 1, "orden": 3 },
    { "id": 185488, "nombre": "FASE IV - FINAL", "jornadas": 1, "orden": 4 }
  ]
}
```

> Fíjate en que los IDs de fase no siguen el orden del torneo (cuartos tiene un ID menor que la fase I). Usa siempre `orden`.

Error `404` si el torneo no existe.

---

## GET /api/equipos

```json
[
  { "id": 5, "nombre": "América de Cali", "escudo": "https://dimayor.com.co/wp-content/uploads/..." },
  { "id": 7, "nombre": "Atlético Nacional", "escudo": "https://dimayor.com.co/wp-content/uploads/..." }
]
```

Incluye todos los equipos vistos en cualquier temporada recolectada (también los que ya descendieron).

---

## GET /api/equipos/:id

Equipo con **todos** sus partidos registrados, del más reciente al más antiguo. Cada partido tiene el mismo formato que en [`/api/partidos`](#get-apipartidos).

```json
{
  "id": 1,
  "nombre": "Deportivo Pereira",
  "escudo": "https://...",
  "partidos": [ { "...": "..." } ]
}
```

Error `404` si el equipo no existe.

---

## GET /api/partidos

| Parámetro | Tipo | Descripción |
|---|---|---|
| `torneo` | número | ID del torneo (por defecto, el activo). |
| `fase` | número | ID de la fase. |
| `jornada` | número | Número de jornada. |
| `equipo` | número | ID de equipo (como local o visitante). |
| `estado` | texto | `finalizado` o `programado` (se usa el valor que da Dimayor). |
| `fecha` | `YYYY-MM-DD` | Día del partido. |

Ordenados por fase (cronológicamente), jornada, fecha y hora.

```json
{
  "torneo": "LIGA BETPLAY DIMAYOR II 2026",
  "total": 10,
  "partidos": [
    {
      "apiId": null,
      "torneoId": 186027,
      "faseId": 186219,
      "fase": "FASE I - TODOS CONTRA TODOS",
      "jornada": 19,
      "fecha": "2026-11-12",
      "hora": "17:00",
      "estado": "programado",
      "estadio": "ESTADIO DEPARTAMENTAL LIBERTAD",
      "local":     { "id": 11, "nombre": "Deportivo Pasto", "escudo": "https://...", "goles": null },
      "visitante": { "id": 15, "nombre": "Junior F.C.",     "escudo": "https://...", "goles": null }
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `apiId` | ID del partido en Dimayor. Es `null` mientras el partido está programado. |
| `fecha`, `hora` | Hora local de Colombia, como la publica Dimayor. |
| `goles` | `null` si el partido no se ha jugado. |

Ejemplos:

```bash
curl "http://localhost:3000/api/partidos?jornada=19"
curl "http://localhost:3000/api/partidos?equipo=5&estado=finalizado"
curl "http://localhost:3000/api/partidos?fecha=2026-11-14"
```

---

## GET /api/posiciones

| Parámetro | Tipo | Descripción |
|---|---|---|
| `torneo` | número | ID del torneo (por defecto, el activo). |
| `fase` | número | ID de la fase (por defecto, la primera fase del torneo con tabla, normalmente "todos contra todos"). |

```json
{
  "torneo": "LIGA BETPLAY DIMAYOR II 2026",
  "fase": "FASE I - TODOS CONTRA TODOS",
  "tabla": [
    {
      "posicion": 1,
      "equipo": { "id": 7, "nombre": "Atlético Nacional", "escudo": "https://..." },
      "puntos": 39, "jugados": 18, "ganados": 12, "empatados": 3, "perdidos": 3,
      "golesFavor": 37, "golesContra": 17, "diferencia": 20
    }
  ]
}
```

Para ver la tabla de un cuadrangular, pasa el ID de esa fase (consúltalo en `/api/torneos/:id`).

---

## GET /api/reclasificacion

| Parámetro | Tipo | Descripción |
|---|---|---|
| `torneo` | número | ID del torneo (por defecto, el activo). |

Mismo formato de `tabla` que [`/api/posiciones`](#get-apiposiciones), pero acumulando todos los torneos del año.

---

## GET /api/descenso

| Parámetro | Tipo | Descripción |
|---|---|---|
| `torneo` | número | ID del torneo (por defecto, el activo). |

```json
{
  "torneo": "LIGA BETPLAY DIMAYOR II 2026",
  "tabla": [
    {
      "posicion": 20,
      "equipo": { "id": 13, "nombre": "Jaguares F.C.", "escudo": "https://..." },
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
| `torneo` | número | ID del torneo (por defecto, el activo). |
| `limite` | número | Máximo de jugadores (por defecto 50, máximo 500). |

```json
{
  "torneo": "LIGA BETPLAY DIMAYOR II 2026",
  "goleadores": [
    {
      "posicion": 1,
      "jugadorId": "2506345",
      "jugador": "GUZMAN YEISON",
      "foto": "https://dimayor.com.co/wp-json/dimayor/v1/image/...",
      "equipo": "AMERICA DE CALI",
      "goles": 10,
      "jugados": 18
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
| `anio` | número | Temporada a recolectar (por defecto, la más reciente). |
| `todo` | booleano | `true` = todos los torneos del año; `false` (por defecto) = solo el activo. |

Header `x-admin-token` obligatorio si se configuró `ADMIN_TOKEN` (ver [configuración](configuracion.md)).

```bash
curl -X POST http://localhost:3000/api/recolectar \
  -H "Content-Type: application/json" \
  -d '{"anio": 2024, "todo": true}'
```

| Código | Significado |
|---|---|
| `202` | Recolección iniciada. Sigue el progreso en `GET /api/estado`. |
| `401` | Token de administrador inválido. |
| `409` | Ya hay una recolección en curso. |

Si la recolección falla (por ejemplo, un año que no existe), el error se escribe en la consola del servidor.

---

## Errores

Todos los errores tienen la forma:

```json
{ "error": "Torneo 999 no existe" }
```

| Código | Cuándo |
|---|---|
| `401` | Falta o es incorrecto `x-admin-token`. |
| `404` | Recurso inexistente, ruta desconocida o base vacía (todavía no se ha recolectado). |
| `409` | Recolección ya en curso. |
| `500` | Error interno (se registra en la consola). |
