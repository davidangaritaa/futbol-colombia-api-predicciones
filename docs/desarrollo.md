# Guía de desarrollo

## Puesta en marcha

```bash
npm install
npm run scrape          # llena la base con el torneo activo
npm run dev             # servidor con recarga automática (node --watch)
```

Para desarrollar sin recolección automática:

```powershell
$env:SCRAPE_INTERVAL_MIN = "0"; npm run dev
```

## Scripts de npm

| Script | Comando | Uso |
|---|---|---|
| `start` | `node src/server.js` | Producción. |
| `dev` | `node --watch src/server.js` | Desarrollo; reinicia al guardar. |
| `scrape` | `node src/scripts/scrape.js` | Recolección manual (`--todo`, `--anio <año>`). |

## Convenciones

- **Módulos ES** (`"type": "module"`): `import` / `export`, con extensión `.js` en las rutas.
- **Español** en nombres de negocio, endpoints, campos JSON y comentarios (`partidos`, `golesLocal`). Inglés solo en lo que viene de Dimayor (`competition_id`) o de librerías.
- **JSON en camelCase** (`golesFavor`); **SQL en snake_case** (`goles_favor`). La conversión se hace con alias en las consultas (`AS golesFavor`).
- **Capas separadas:** solo `parsers.js` conoce el HTML; solo `dimayor.js` conoce las acciones AJAX; las rutas solo leen la base.

## Cómo agregar…

### …un nuevo endpoint

1. Agrega la ruta en `src/routes/api.js` usando los ayudantes `all()` / `get()`.
2. Para resolver el torneo por defecto usa `resolverTorneo(req.query.torneo)`.
3. Para errores, lanza `new HttpError(404, 'mensaje')`: el manejador al final del archivo lo convierte en JSON.
4. Añádelo a la lista de `GET /api` y documéntalo en [endpoints.md](endpoints.md).

### …un nuevo dato de Dimayor

Ejemplo: tarjetas por jugador.

1. **Investiga** en el navegador (F12 → Red → `admin-ajax`) qué acción y parámetros usa el sitio. Ver [scraper.md](scraper.md#cuando-el-scraper-se-rompe).
2. **Parser:** crea `parseTarjetas(html)` en `src/scraper/parsers.js`.
3. **Función:** expón `getTarjetas(q)` en `src/scraper/dimayor.js`.
4. **Tabla:** añade el `CREATE TABLE IF NOT EXISTS` en `src/db/database.js`.
5. **Recolector:** guarda los datos en `recolectarTorneo()` de `src/collector.js`, dentro de una `transaction()`.
6. **API:** agrega el endpoint y documenta todo.

### …una competición nueva

Las 5 competiciones actuales (Liga, Primera B, Femenina, Copa y Superliga) están en `COMPETICIONES` de `src/config.js`. Si Dimayor agrega otra con el mismo sistema:

1. Busca su `data-competition-type-name` en la página de la liga (ver [scraper](scraper.md#tipos-de-competición)) y qué pestañas (`data-type`) ofrece.
2. Agrega una entrada:
   ```js
   nueva: {
     nombre: 'Nombre para mostrar', tipo: 'valor de competition_type', rama: 'masculino',
     tablas: ['posiciones', 'goleadores'],
   },
   ```
3. Recolecta: `npm run scrape -- --anio 2026 --competicion nueva`.

No hace falta tocar la base ni las rutas.

### …un canal de TV

Si aparecen canales con `nombre: null`, agrega el patrón del nombre de archivo del logo a la lista `CANALES` en `src/scraper/parsers.js`. Los patrones se revisan en orden, así que los más específicos van primero.

### …un cambio en el esquema de la base

1. Modifica los `CREATE TABLE` en `src/db/database.js`.
2. Sube `VERSION_ESQUEMA`. Al arrancar, las bases antiguas se recrearán vacías.
3. Anota el cambio en la tabla de versiones de [base-de-datos.md](base-de-datos.md#versión-del-esquema).
4. Vuelve a recolectar las temporadas.

## Probar rápidamente

Probar un parser sin servidor ni base:

```bash
node --input-type=module -e "
import { getPosiciones } from './src/scraper/dimayor.js';
console.table(await getPosiciones({ tipo: 'Liga BetPlay', torneoId: 186027, faseId: '186219' }));
"
```

Probar los endpoints con el servidor encendido:

```bash
curl http://localhost:3000/api/estado
curl "http://localhost:3000/api/partidos?jornada=1"
```

> El proyecto aún no tiene pruebas automáticas. Un buen primer paso sería guardar HTML de ejemplo de Dimayor en una carpeta `test/fixtures/` y probar `parsers.js` con `node --test`, sin depender de internet.

## Solución de problemas

| Problema | Solución |
|---|---|
| `Error: Cannot find module 'node:sqlite'` | Actualiza a Node 24 o superior. |
| `ExperimentalWarning: SQLite is an experimental feature` | Es solo un aviso de algunas versiones de Node; no afecta. |
| `EADDRINUSE: address already in use :::3000` | Ya hay algo en ese puerto. Cierra el otro proceso o usa otro `PORT`. |
| `404 Aún no hay datos` | La base está vacía: ejecuta `npm run scrape`. |
| La tabla no muestra los últimos resultados | Ejecuta `npm run scrape` o `POST /api/recolectar`; revisa `GET /api/estado` para ver la fecha de la última recolección. |
| Errores al recolectar | Ver [scraper → cuando se rompe](scraper.md#cuando-el-scraper-se-rompe). |
| Aparece un equipo duplicado con otro nombre | Dimayor lo escribe de otra forma. Agrega el nombre alternativo a `ALIAS_EQUIPOS` en `src/scraper/parsers.js`, borra `data/` y vuelve a recolectar. |
| `[db] Esquema vN obsoleto: se recrea la base` | Se actualizó el esquema; la base quedó vacía. Vuelve a recolectar. |
| `Aviso: Posiciones de ...: HTTP 500` | Fallo de Dimayor en esa tabla; el resto se guardó. Ver [fallos conocidos](scraper.md#fallos-conocidos-de-dimayor). |

## Ideas para seguir

- Detalle de partido (goles, tarjetas, alineaciones): cada partido jugado tiene `data-match-api-id` y un botón "Detalles" en el sitio.
- Plantillas de jugadores por equipo.
- Pruebas automáticas de los parsers.
- *Rate limit* y caché HTTP (`Cache-Control`) en la API.
