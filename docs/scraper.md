# Scraper de Dimayor

Este documento explica **cómo obtiene los datos el proyecto** a partir de dimayor.com.co. Es la parte más frágil del sistema: si Dimayor cambia su sitio, aquí está lo que hay que revisar.

> Hallazgos verificados en noviembre de 2026. El sitio puede cambiar en cualquier momento.

## Cómo carga los datos el sitio de Dimayor

dimayor.com.co es un WordPress. La página de la liga (`/liga-betplay-dimayor/`) trae una tabla de posiciones en el HTML, pero el resto (partidos por jornada, goleadores, otras temporadas) lo carga el navegador con peticiones **AJAX** al endpoint estándar de WordPress:

```
POST https://dimayor.com.co/wp-admin/admin-ajax.php
Content-Type: application/x-www-form-urlencoded
```

Las provee un plugin propio de Dimayor (`dimayor-competition-management`). El scraper hace exactamente las mismas peticiones que hace el navegador.

### El nonce

Cada petición AJAX debe incluir un parámetro `nonce`: un token temporal de WordPress que viene dentro de un `<script>` de la página:

```js
const ajax_url = "https://dimayor.com.co/wp-admin/admin-ajax.php";
const nonce = "bef7203540";
```

`client.js` descarga la página, lo extrae con la expresión regular `/const nonce\s*=\s*"([a-f0-9]+)"/` y lo guarda en memoria durante **1 hora**. Si una petición falla, descarga la página de nuevo (nonce nuevo) y reintenta **una vez**.

### Temporadas

Las temporadas salen del primer `<select class="season-filter">` de la misma página:

```html
<select class="season-filter">
  <option value="169678"> 2026 </option>
  <option value="165413"> 2025 </option>
  <option value="165414"> 2024 </option>
  <option value="165415"> 2023 </option>
</select>
```

El `value` es el ID de la temporada; el texto es el año.

Todas las competiciones comparten estas mismas temporadas.

### Tipos de competición

La página tiene un bloque por competición (`<div class="dimayor-inner-wrapper" data-competition-type-name="...">`). Ese valor es el parámetro `competition_type` de las acciones AJAX:

| `competition_type` | Clave en la API | Pestañas que ofrece Dimayor |
|---|---|---|
| `Liga BetPlay` | `liga` | partidos, posiciones, reclasificación, descenso, goleadores |
| `Torneo BetPlay` | `torneo` | partidos, posiciones, reclasificación, goleadores |
| `Liga Femenina` | `femenina` | partidos, posiciones, reclasificación, goleadores |
| `Copa BetPlay` | `copa` | partidos, posiciones, goleadores |
| `Superliga` | `superliga` | partidos, posiciones, goleadores |

La correspondencia está en `COMPETICIONES` de `src/config.js`.

## Acciones AJAX utilizadas

Todas devuelven `{ "success": true, "data": ... }`. Siempre se envían `action` y `nonce`.

### `get_active_filters` — torneo activo

| Parámetro | Ejemplo |
|---|---|
| `season_id` | `169678` |
| `competition_type` | `Liga BetPlay` |

```json
{ "success": true, "data": { "competition_id": 186027, "phase_id": 186219, "matchday": 19 } }
```

### `get_competitions_for_season_ajax_v5` — torneos de una temporada

| Parámetro | Ejemplo |
|---|---|
| `season_id` | `169678` |
| `competition_type` | `Liga BetPlay` |

```json
{ "success": true, "data": [
  { "id": 169679, "name": "LIGA BETPLAY DIMAYOR I 2026" },
  { "id": 186027, "name": "LIGA BETPLAY DIMAYOR II 2026" }
]}
```

### `get_phases_for_competition` — fases de un torneo

| Parámetro | Ejemplo |
|---|---|
| `competition_id` | `186027` |

```json
{ "success": true, "data": [
  { "id": 186219, "name": "FASE I - TODOS CONTRA TODOS", "matchdays": "19" }
]}
```

Particularidades:

- ⚠️ En algunas fases (cuadrangulares y finales) `matchdays` llega como `0` aunque sí tienen jornadas. El recolector recorre jornadas hasta encontrar una vacía (ver [recolección](recoleccion.md#fases-sin-número-de-jornadas)).
- ⚠️ **Fases por grupos:** en las temporadas recientes los cuadrangulares vienen como **una sola fase** con ID de texto, que agrupa los grupos A y B:
  ```json
  { "id": "group-FASE+II+CUADRANGULARES-186614", "name": "FASE II - CUADRANGULARES", "matchdays": 6 }
  ```
  En 2025 la Liga los entregaba como fases separadas (`GRUPO A ...`, `GRUPO B ...`). Por eso los IDs de fase se tratan siempre como texto.
- `matchdays` puede llegar como número o como texto (`"19"`).
- `get_active_filters` también puede devolver un `phase_id` de texto.

### `get_dynamic_content_v5` — contenido (HTML)

| Parámetro | Ejemplo | Notas |
|---|---|---|
| `type` | `partidos` | `partidos`, `posiciones`, `goleadores`, `descenso` o `reclasificacion` |
| `competition_id` | `186027` | |
| `competition_type` | `Liga BetPlay` | |
| `phase_id` | `186219` | |
| `matchday` | `19` | Solo importa para `partidos`. Vacío = todos los partidos de la fase (incluye algunos que no aparecen en ninguna jornada numerada). |
| `is_live` | `0` | |
| `live_provider` | `comet` | |

Respuesta: `{ "success": true, "data": { "html": "<div ...>...</div>" } }`. El HTML se procesa en `parsers.js`.

## API REST de detalle de partidos

El botón "Detalles" de cada partido jugado abre una ventana que pide datos a una **API REST en JSON** (definida en `ui-modals.js` del plugin). No requiere nonce:

```
GET https://dimayor.com.co/wp-json/dimayor/v1/matches/{apiId}/events
GET https://dimayor.com.co/wp-json/dimayor/v1/matches/{apiId}/lineups
GET https://dimayor.com.co/wp-json/dimayor/v1/matches/{apiId}/officials
GET https://dimayor.com.co/wp-json/dimayor/v1/matches/{apiId}/timing      (no se usa)
```

`{apiId}` es el `data-match-api-id` de la tarjeta del partido (columna `partidos.api_id`). Los datos vienen del sistema **COMET** de la Federación y existen al menos desde 2023. Se procesan en `src/scraper/detalle.js`.

### events

Lista de eventos:

```json
{
  "eventId": 312541782,
  "eventType": { "eventTypeId": 7, "name": "Substitution", "fcdName": "SUBSTITUTION" },
  "matchPhase": { "fcdName": "SECOND_HALF" },
  "minute": 1, "minuteFull": 46, "stoppageTime": 0,
  "player":  { "personId": 3541944, "name": "RAMIREZ DELIO", "shirtNumber": 11 },
  "player2": { "personId": 5103191, "name": "PEREA YAEL", "shirtNumber": 22 },
  "homeTeam": true,
  "orderNumber": 5
}
```

| Campo | Significado |
|---|---|
| `eventType.fcdName` | `GOAL`, `PENALTY` (gol de penal), `OWN_GOAL`, `YELLOW`, `SECOND_YELLOW`, `RED`, `EXPULSION`, `SUBSTITUTION`, `START`, `END`, `FULL_TIME` |
| `minuteFull` | Minuto del partido (46 = minuto 1 del segundo tiempo). |
| `stoppageTime` | Minutos de tiempo añadido (45+2 → 2). |
| `homeTeam` | Equipo **del jugador** (`true` = local). Ausente en `START`/`END`/`FULL_TIME`. |
| `player` / `player2` | ⚠️ En **cambios**, `player` es el que **entra** y `player2` el que **sale** (verificado en 237 de 237 cambios con las alineaciones). |

⚠️ En **autogoles** (`OWN_GOAL`), `homeTeam` y `player` son del jugador que lo marcó: el gol **cuenta para el rival**.

### lineups

```json
{
  "home": {
    "players":   [{ "personId": 1790263, "name": "GRAZZIANI PIER", "shirtNumber": 30, "starting": true, "captain": false, "position": "G" }],
    "officials": [{ "personId": 3037639, "name": "CHIESA NICOLAS", "role": "Head Coach" }]
  },
  "away": { "players": [...], "officials": [...] }
}
```

- `starting`: titular. Normalmente 11 titulares y 7–9 suplentes por equipo.
- `position`: COMET solo marca `G` (arquero); en el resto viene vacío.
- `officials` es el cuerpo técnico (`Head Coach`, `Assistant Coach`, `Goalkeeper coach`, `Physical trainer`, `Doctor`…). En algunos partidos falta el `Head Coach` (p. ej. un técnico sancionado).
- `personId` es un ID estable de la persona entre temporadas y equipos.

### officials

Árbitros. Formato antiguo (`referee`, `assistantRefereeOne`, `assistantRefereeTwo`, `fourthOfficial`, `videoAssistantReferee`, `assistantVideoAssistantReferee`, cada uno con `name`) o lista `all_officials` con `role`. Se normalizan a `central`, `asistente1`, `asistente2`, `cuarto`, `var`, `avar`.

### timing

Tiempo añadido de cada mitad. No se recolecta: aporta poco y sumaría un 33 % más de peticiones.

### Acciones conocidas que no se usan

| Acción | Qué hace |
|---|---|
| `get_hoy_matches_ajax` | Partidos del día (parámetro `date_offset`). |
| `dmw_get_match_data`, `dmw_get_active_week` | Widget antiguo de partidos; respondía con error en las pruebas. |

## Estructura del HTML y cómo se parsea

### Partidos (`parsePartidos`)

Los partidos vienen agrupados bajo encabezados de fecha dentro de `.fixture-wrapper`:

```html
<div class="fixture-wrapper">
  <h4 class="fixture-date-header">SÁBADO, 7 DE NOVIEMBRE DE 2026</h4>
  <div class="match-card">
    <div class="match-card__body">
      <div class="team team--home">
        <span class="team__name">Boyacá Chicó F.C.</span>
        <img class="team__logo" src="http://dimayor.com.co/...png">
      </div>
      <div class="match-card__score-wrapper">
        <span class="match-card__time">18:00</span>
        <div class="match-card__score finalizado">2 - 1</div>
        <button class="match-action-btn" data-match-api-id="371462102" ...>Detalles</button>
      </div>
      <div class="team team--away"> ... </div>
    </div>
    <div class="match-card__footer">
      <div class="match-card__detail"><svg>...</svg><span>ESTADIO LA INDEPENDENCIA</span></div>
      <div class="match-card__detail channel-logo"><img src="...canal.png"></div>
    </div>
  </div>
</div>
```

| Dato | De dónde sale |
|---|---|
| Fecha | Último `h4.fixture-date-header` antes de la tarjeta. Se convierte a `YYYY-MM-DD` con `parseFechaEs` (los meses en español se mapean a número). |
| Hora | `.match-card__time` |
| Equipos y escudos | `.team--home` / `.team--away` → `.team__name` e `img` |
| Marcador | Texto de `.match-card__score` con formato `N - N`; si es `vs`, los goles quedan en `null`. |
| Estado | Clase extra de `.match-card__score`: `finalizado`, `programado`, etc. Si no tiene clase y contiene `.match-postponed-label` ("Hora por definir"), el estado es `por definir`. |
| ID del partido | `data-match-api-id` (solo existe en partidos jugados). |
| Estadio | `span` del primer `.match-card__detail` que no sea `.channel-logo`. |
| Canales de TV | Cada `img` dentro de `.channel-logo`. |
| Grupo | Último `h3.dimayor-daily-phase-name` antes de la tarjeta (solo en fases por grupos). |

En **fases por grupos**, las tarjetas vienen dentro de secciones por grupo:

```html
<div class="fixture-wrapper">
  <section class="dimayor-daily-phase">
    <div class="dimayor-daily-phase-header">
      <h3 class="dimayor-daily-phase-name">FASE II – CUADRANGULARES SEMIFINALES – GRUPO A</h3>
    </div>
    <h4 class="fixture-date-header">JUEVES, 29 DE OCTUBRE DE 2026</h4>
    <div class="match-card">...</div>
  </section>
  <section class="dimayor-daily-phase"> ... GRUPO B ... </section>
</div>
```

Por eso el parser no recorre los hijos directos, sino `h3.dimayor-daily-phase-name, h4.fixture-date-header, .match-card` **en orden de documento**: cada `h3` fija el grupo actual, cada `h4` la fecha actual, y cada tarjeta toma ambos. El grupo se extrae del título con `parseGrupo()` (`"… GRUPO A"` → `"A"`).

#### Canales de TV

Dimayor muestra el canal **solo como logo**, sin texto (`alt=""`). `nombreCanal()` lo reconoce por el nombre del archivo:

| Archivo contiene | Canal |
|---|---|
| `winywin` | Win Sports y Win+ Fútbol |
| `WIN-senal-colombia` | Win Sports y Señal Colombia |
| `Senales-WIN-Win-play` | Win+ Fútbol, Win Play y win.co |
| `Senales-WIN-CO` | Win+ Fútbol y winsports.co |
| `Senal_Colombia` | Señal Colombia |
| `youtube` | YouTube |
| `WIN-MAS`, `win+`, `winplus` | Win+ Fútbol |
| `Win-logo`, `win-sports` | Win Sports |

Los patrones se revisan en ese orden: los logos combinados van primero para que no los capture un patrón más general.

Si aparece un logo desconocido, el canal se guarda con `nombre: null` y la URL del logo. Para reconocerlo, agrega una línea a la lista `CANALES` de `parsers.js`.

#### Partidos aplazados o sin programar

No tienen clase de estado ni marcador; en su lugar muestran una etiqueta:

```html
<div class="match-card__score "><span class="match-postponed-label">Hora por definir</span></div>
```

Se guardan con `estado = "por definir"`, sin goles. Aparecen tanto en partidos futuros sin fecha confirmada como en partidos de temporadas pasadas que nunca se jugaron.

#### Nombres de equipos

Dimayor a veces escribe el mismo club de dos formas (por ejemplo `INDEPENDIENTE YUMBO S.A` en la Copa 2026 e `Independiente Yumbo` en el resto). `nombreEquipo()` aplica la lista `ALIAS_EQUIPOS` de `parsers.js` para unificarlos. Si aparece un duplicado nuevo, agrégalo ahí y vuelve a recolectar desde cero.

Las URLs `http://` de imágenes se convierten a `https://`.

### Posiciones y reclasificación (`parseTablaPosiciones`)

```html
<table class="dimayor-table"><tbody>
  <tr>
    <td class="col-pos">1</td>
    <td class="col-team"><div class="team-box"><img src="..."><span class="team-name-small">Atlético Nacional</span></div></td>
    <td class="col-pts">39</td>
    <td class="col-stat">18</td>  <!-- PJ -->
    <td class="col-stat">12</td>  <!-- PG -->
    <td class="col-stat">3</td>   <!-- PE -->
    <td class="col-stat">3</td>   <!-- PP -->
    <td class="col-stat">37</td>  <!-- GF -->
    <td class="col-stat">17</td>  <!-- GC -->
    <td class="col-dg">+20</td>
  </tr>
</tbody></table>
```

Las columnas `col-stat` se leen **por orden**: PJ, PG, PE, PP, GF, GC.

En **fases por grupos** hay una tabla por grupo, cada una precedida por un título:

```html
<div class="dmr-table-wrapper">
  <h5 class="dimayor-group-title">FASE II - CUADRANGULARES SEMIFINALES - GRUPO A</h5>
  <table class="dimayor-table">...</table>
  <h5 class="dimayor-group-title">FASE II - CUADRANGULARES SEMIFINALES - GRUPO B</h5>
  <table class="dimayor-table">...</table>
</div>
```

El parser recorre `h5.dimayor-group-title, table.dimayor-table` en orden y asigna a cada fila el grupo del último título.

### Goleadores (`parseGoleadores`)

Columnas por posición: Pos, Jugador (con foto en `img` y nombre en `.team-name-small`), Equipo (texto), Goles, PJ. El ID del jugador está en `tr[data-player-id]`.

### Descenso (`parseDescenso`)

Encabezado con años en `th.year-header` (por ejemplo 2024, 2025, 2026). Cada fila: posición, equipo, luego pares **PJ / PTS por año**, y al final **PJ total, PTS total y promedio**. El promedio usa coma decimal (`0,8378`) y se convierte a número.

## Buenas prácticas aplicadas

- **Pausa de 600 ms** entre peticiones (`REQUEST_DELAY_MS`).
- **Una sola petición a la vez**: todo es secuencial.
- **Timeout de 30 s** por petición.
- **User-Agent identificable**: `Mozilla/5.0 (compatible; APIFutbolColombia/1.0)`.
- La API sirve desde la base local: el tráfico a Dimayor no crece con el número de usuarios.

## Cuando el scraper se rompe

| Síntoma | Causa probable | Dónde arreglar |
|---|---|---|
| `No se encontró el nonce en la página de Dimayor` | Cambió el `<script>` o la URL de la página | Regex en `client.js` o `dimayorPage` en `config.js` |
| `Dimayor respondió con error en "..."` | Cambió el nombre de una acción (p. ej. `_v5` → `_v6`) o sus parámetros | `dimayor.js` |
| Recolección termina pero con 0 partidos o tablas vacías | Cambiaron clases CSS del HTML | `parsers.js` |
| `HTTP 403` / `429` | Bloqueo o límite de peticiones | Subir `REQUEST_DELAY_MS`, recolectar menos seguido |
| `HTTP 500` en una tabla concreta | Fallo del servidor de Dimayor para esa fase (ver abajo) | Nada que arreglar: queda como aviso |
| Canales con `nombre: null` | Logo de un canal nuevo | Lista `CANALES` en `parsers.js` |

### Fallos conocidos de Dimayor

| Dónde | Qué pasa |
|---|---|
| Torneo BetPlay 2026 Apertura, fase `group-FASE+II+-+CUADRANGULARES-169759` | No devuelve partidos (ni por jornada ni la fase completa) y su tabla de posiciones responde **HTTP 500**. |
| Finales del Torneo BetPlay 2026 y de la Liga Femenina 2026 | Sus partidos no aparecen en ninguna jornada numerada; solo al pedir la fase completa. El recolector los guarda con `jornada = 0`. |
| Widget `dmw_get_match_data` | Responde con error; no se usa. |

**Cómo investigar un cambio:** abre la página de la liga en el navegador, herramientas de desarrollador (F12) → pestaña *Red* → filtra por `admin-ajax`. Cambia de temporada o de jornada y mira qué `action` y parámetros envía, y qué HTML responde. Ajusta `dimayor.js` y `parsers.js` según eso.
