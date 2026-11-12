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

⚠️ En algunas fases (cuadrangulares y finales de 2025) `matchdays` llega como `0` aunque sí tienen jornadas. El recolector lo resuelve recorriendo jornadas hasta encontrar una vacía (ver [recolección](recoleccion.md)).

### `get_dynamic_content_v5` — contenido (HTML)

| Parámetro | Ejemplo | Notas |
|---|---|---|
| `type` | `partidos` | `partidos`, `posiciones`, `goleadores`, `descenso` o `reclasificacion` |
| `competition_id` | `186027` | |
| `competition_type` | `Liga BetPlay` | |
| `phase_id` | `186219` | |
| `matchday` | `19` | Solo importa para `partidos`. Vacío = todas las jornadas de la fase. |
| `is_live` | `0` | |
| `live_provider` | `comet` | |

Respuesta: `{ "success": true, "data": { "html": "<div ...>...</div>" } }`. El HTML se procesa en `parsers.js`.

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
| Estado | Clase extra de `.match-card__score`: `finalizado`, `programado`, etc. |
| ID del partido | `data-match-api-id` (solo existe en partidos jugados). |
| Estadio | `span` del primer `.match-card__detail` que no sea `.channel-logo`. |

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

**Cómo investigar un cambio:** abre la página de la liga en el navegador, herramientas de desarrollador (F12) → pestaña *Red* → filtra por `admin-ajax`. Cambia de temporada o de jornada y mira qué `action` y parámetros envía, y qué HTML responde. Ajusta `dimayor.js` y `parsers.js` según eso.
