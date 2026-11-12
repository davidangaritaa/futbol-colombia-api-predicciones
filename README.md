# API Liga BetPlay Dimayor ⚽🇨🇴

API REST con datos de la liga colombiana de fútbol, recolectados por **web scraping** del sitio oficial [dimayor.com.co](https://dimayor.com.co).

📚 **Documentación completa en [`docs/`](docs/README.md)**: arquitectura, referencia de la API, scraper, recolección, base de datos, configuración y guía de desarrollo.

## Cómo funciona

```
dimayor.com.co ──(scraper)──► recolector ──► SQLite (data/futbol.db) ──► API Express
```

1. **Scraper** (`src/scraper/`): descarga la página de la liga para obtener el *nonce* (token de WordPress) y luego consulta los mismos endpoints AJAX que usa el sitio (`admin-ajax.php`). El HTML que devuelven se convierte en objetos con [cheerio](https://cheerio.js.org/).
2. **Recolector** (`src/collector.js`): recorre temporadas → torneos → fases → jornadas y guarda todo en la base de datos.
3. **API** (`src/routes/api.js`): sirve los datos desde la base local, así que es rápida y no depende de que Dimayor esté en línea.

Entre petición y petición a Dimayor hay una pausa (600 ms por defecto) para no sobrecargar su servidor.

## Requisitos

- Node.js 24 o superior (usa la base SQLite integrada `node:sqlite`, sin instalar nada extra).

## Uso

```bash
npm install

# Recolectar datos
npm run scrape                   # solo el torneo activo
npm run scrape -- --todo         # todos los torneos de la temporada actual
npm run scrape -- --anio 2025    # todos los torneos de 2025 (disponibles: 2023-2026)

# Iniciar la API (http://localhost:3000/api)
npm start
npm run dev                      # se reinicia al editar archivos
```

Al arrancar, el servidor recolecta automáticamente el torneo activo cada 6 horas (y al inicio si la base está vacía).

## Endpoints

Si no se indica `torneo`, se usa el torneo activo.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/estado` | Última recolección y conteos |
| GET | `/api/temporadas` | Temporadas disponibles |
| GET | `/api/torneos?temporada=2026` | Torneos (Apertura/Clausura) |
| GET | `/api/torneos/:id` | Torneo con sus fases |
| GET | `/api/equipos` | Todos los equipos con escudo |
| GET | `/api/equipos/:id` | Equipo con todos sus partidos |
| GET | `/api/partidos` | Partidos. Filtros: `torneo`, `fase`, `jornada`, `equipo`, `estado` (`finalizado`/`programado`), `fecha` (YYYY-MM-DD) |
| GET | `/api/posiciones?torneo=&fase=` | Tabla de posiciones |
| GET | `/api/reclasificacion?torneo=` | Tabla acumulada del año |
| GET | `/api/descenso?torneo=` | Tabla del descenso (promedios de 3 años) |
| GET | `/api/goleadores?torneo=&limite=50` | Tabla de goleadores |
| POST | `/api/recolectar` | Lanza una recolección. Body: `{ "anio": 2025, "todo": true }` |

Ejemplos:

```bash
curl http://localhost:3000/api/posiciones
curl "http://localhost:3000/api/partidos?jornada=19"
curl -X POST http://localhost:3000/api/recolectar -H "Content-Type: application/json" -d '{"anio":2024,"todo":true}'
```

## Configuración (variables de entorno)

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DB_PATH` | `data/futbol.db` | Archivo de la base de datos |
| `SCRAPE_INTERVAL_MIN` | `360` | Minutos entre recolecciones automáticas (`0` = desactivar) |
| `REQUEST_DELAY_MS` | `600` | Pausa entre peticiones a Dimayor |
| `ADMIN_TOKEN` | *(vacío)* | Si se define, `POST /api/recolectar` exige el header `x-admin-token` |

## Notas

- El scraping depende de la estructura del sitio de Dimayor. Si cambian su HTML o sus endpoints, hay que ajustar `src/scraper/parsers.js` o `src/scraper/dimayor.js`.
- Los datos pertenecen a Dimayor. Úsalos de forma responsable y revisa los términos del sitio antes de un uso comercial.
