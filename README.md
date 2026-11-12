# API fútbol colombiano (Dimayor) ⚽🇨🇴

API REST con datos del fútbol profesional colombiano, recolectados por **web scraping** del sitio oficial [dimayor.com.co](https://dimayor.com.co).

📚 **Documentación completa en [`docs/`](docs/README.md)**: arquitectura, referencia de la API, scraper, recolección, base de datos, configuración y guía de desarrollo.

## Qué datos tiene

| Competición | Clave |
|---|---|
| Liga BetPlay (primera división) | `liga` |
| Torneo BetPlay (Primera B) | `torneo` |
| Liga Femenina | `femenina` |
| Copa BetPlay | `copa` |
| Superliga | `superliga` |

Temporadas **2023 a 2026**. Para cada una: torneos, fases, equipos con escudo, partidos (fecha, hora, estadio, marcador, grupo y canal de TV), tablas de posiciones, reclasificación, descenso y goleadores.

Y para **cada partido jugado**: eventos con minuto (goles, penales, autogoles, tarjetas, cambios), alineaciones (titulares y suplentes), cuerpo técnico y árbitros (incluido VAR).

> **Objetivo:** estos datos son la base para análisis y predicción de partidos con machine learning. El modelo está en [`ml/`](docs/modelo.md).

## Cómo funciona

```
dimayor.com.co ──(scraper)──► recolector ──► SQLite (data/futbol.db) ──► API Express
```

1. **Scraper** (`src/scraper/`): descarga la página de la liga para obtener el *nonce* (token de WordPress) y luego consulta los mismos endpoints AJAX que usa el sitio (`admin-ajax.php`). El HTML que devuelven se convierte en objetos con [cheerio](https://cheerio.js.org/).
2. **Recolector** (`src/collector.js`): recorre competiciones → temporadas → torneos → fases → jornadas y guarda todo en la base de datos.
3. **API** (`src/routes/api.js`): sirve los datos desde la base local, así que es rápida y no depende de que Dimayor esté en línea.

Entre petición y petición a Dimayor hay una pausa (600 ms por defecto) para no sobrecargar su servidor.

## Requisitos

- Node.js 24 o superior (usa la base SQLite integrada `node:sqlite`, sin instalar nada extra).

## Uso

```bash
npm install

# Recolectar datos
npm run scrape                                 # torneos activos de las 5 competiciones
npm run scrape -- --todo                       # todos los torneos de la temporada actual
npm run scrape -- --anio 2025                  # todos los torneos de 2025 (disponibles: 2023-2026)
npm run scrape -- --competicion femenina       # solo una competición (se puede repetir)

# Detalle de partidos (eventos, alineaciones, árbitros)
npm run detalles                               # todos los pendientes (~2 h la primera vez; se puede interrumpir y reanudar)

# Iniciar la API (http://localhost:3000/api)
npm start
npm run dev                      # se reinicia al editar archivos
```

Con el servidor encendido, los torneos activos y el detalle de los partidos nuevos se recolectan automáticamente cada 6 horas (y al inicio si la base está vacía).

## Endpoints

Los endpoints con `competicion` usan `liga` por defecto. Si no se indica `torneo`, se usa el torneo activo de esa competición.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/estado` | Última recolección, avisos y conteos |
| GET | `/api/competiciones` | Competiciones disponibles |
| GET | `/api/temporadas` | Temporadas disponibles |
| GET | `/api/torneos?competicion=&temporada=` | Torneos |
| GET | `/api/torneos/:id` | Torneo con sus fases |
| GET | `/api/equipos?competicion=&rama=` | Equipos con escudo |
| GET | `/api/equipos/:id` | Equipo con todos sus partidos |
| GET | `/api/partidos` | Partidos. Filtros: `competicion`, `torneo`, `fase`, `grupo`, `jornada`, `equipo`, `estado`, `fecha` |
| GET | `/api/partidos/:apiId` | Detalle: eventos, alineaciones, técnicos y árbitros |
| GET | `/api/posiciones?competicion=&torneo=&fase=` | Tabla de posiciones (con grupos en cuadrangulares) |
| GET | `/api/reclasificacion?competicion=&torneo=` | Tabla acumulada del año |
| GET | `/api/descenso?torneo=` | Tabla del descenso (solo Liga) |
| GET | `/api/goleadores?competicion=&torneo=&limite=` | Goleadores |
| POST | `/api/recolectar` | Lanza una recolección. Body: `{ "anio": 2025, "todo": true, "competiciones": ["liga"] }` |

Ejemplos:

```bash
curl http://localhost:3000/api/posiciones
curl "http://localhost:3000/api/posiciones?competicion=femenina"
curl "http://localhost:3000/api/partidos?competicion=torneo&grupo=A"
curl -X POST http://localhost:3000/api/recolectar -H "Content-Type: application/json" -d '{"anio":2024,"todo":true}'
```

Referencia completa con respuestas de ejemplo: [docs/endpoints.md](docs/endpoints.md).

## Configuración (variables de entorno)

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DB_PATH` | `data/futbol.db` | Archivo de la base de datos |
| `SCRAPE_INTERVAL_MIN` | `360` | Minutos entre recolecciones automáticas (`0` = desactivar) |
| `REQUEST_DELAY_MS` | `600` | Pausa entre peticiones a Dimayor |
| `ADMIN_TOKEN` | *(vacío)* | Si se define, `POST /api/recolectar` exige el header `x-admin-token` |

## Notas

- El scraping depende de la estructura del sitio de Dimayor. Si cambian su HTML o sus endpoints, hay que ajustar `src/scraper/parsers.js` o `src/scraper/dimayor.js` (ver [docs/scraper.md](docs/scraper.md)).
- Al actualizar el proyecto, si cambió el esquema de la base, esta se recrea vacía y hay que volver a recolectar ([detalles](docs/base-de-datos.md#versión-del-esquema)).
- Los datos pertenecen a Dimayor. Úsalos de forma responsable y revisa los términos del sitio antes de un uso comercial.
