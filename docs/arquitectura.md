# Arquitectura

## Visión general

El proyecto separa dos responsabilidades que suceden en momentos distintos:

1. **Recolectar** — leer los datos de dimayor.com.co y guardarlos (lento: decenas de peticiones con pausas).
2. **Servir** — responder consultas HTTP desde la base local (rápido: milisegundos).

La API **nunca** consulta a Dimayor durante una petición de un usuario. Así es rápida, no depende de que Dimayor esté en línea y no genera tráfico hacia su sitio por cada visita.

```
                ┌───────────────────────── Recolección (periódica / manual) ─────────────────────────┐
                │                                                                                     │
 dimayor.com.co │  client.js            dimayor.js              parsers.js           collector.js     │
 ───────────────┼─► (nonce, pausa,  ──► (acciones AJAX    ──►   (HTML → objetos ──► (recorre torneos, │
   HTML + AJAX  │    reintentos)        de alto nivel)          con cheerio)         fases, jornadas) │
                │                                                                          │          │
                └──────────────────────────────────────────────────────────────────────────┼──────────┘
                                                                                           ▼
                                                                                 SQLite: data/futbol.db
                                                                                           │
                ┌──────────────────────────── Servicio (por cada petición) ────────────────┼──────────┐
                │                                                                          ▼          │
   Cliente ◄────┼──── JSON ◄──── routes/api.js (Express) ◄──── consultas SQL ◄──── database.js       │
                └─────────────────────────────────────────────────────────────────────────────────────┘
```

## Componentes

| Archivo | Responsabilidad |
|---|---|
| `src/config.js` | Configuración central; lee variables de entorno y define las competiciones (`COMPETICIONES`). |
| `src/scraper/client.js` | HTTP de bajo nivel: obtiene el *nonce*, aplica la pausa entre peticiones, timeout de 30 s y un reintento con nonce nuevo si Dimayor responde con error. |
| `src/scraper/dimayor.js` | Funciones con nombre de negocio (`getTorneos`, `getPartidos`, `getPosiciones`…) que llaman a las acciones AJAX de Dimayor. |
| `src/scraper/parsers.js` | Convierte el HTML recibido en objetos JavaScript. Es el único archivo que conoce las clases CSS de Dimayor. |
| `src/scraper/detalle.js` | Descarga y convierte el detalle de un partido (eventos, alineaciones, árbitros) desde la API REST de Dimayor. |
| `src/detalles.js` | Recolector del detalle de partidos: procesa los finalizados que aún no lo tienen; se puede interrumpir y reanudar. |
| `src/scripts/detalles.js` | Descarga de detalles desde la terminal (`npm run detalles`). |
| `src/collector.js` | Orquesta la recolección y escribe en la base con transacciones. Impide dos recolecciones simultáneas. |
| `src/db/database.js` | Abre la base SQLite, crea el esquema y expone utilidades (`transaction`, `getMeta`, `setMeta`). |
| `src/routes/api.js` | Endpoints REST. Solo lee de la base, excepto `POST /api/recolectar`. |
| `src/server.js` | Arranca Express, habilita CORS y programa la recolección automática. |
| `src/scripts/scrape.js` | Recolección desde la terminal (`npm run scrape`). |

## Estructura de carpetas

```
APIFUTBOL/
├── data/                  # Base de datos SQLite (no se sube a git)
│   └── futbol.db
├── docs/                  # Esta documentación
├── src/
│   ├── config.js
│   ├── server.js
│   ├── collector.js
│   ├── db/
│   │   └── database.js
│   ├── routes/
│   │   └── api.js
│   ├── scraper/
│   │   ├── client.js
│   │   ├── dimayor.js
│   │   └── parsers.js
│   └── scripts/
│       └── scrape.js
├── package.json
└── README.md
```

## Decisiones de diseño

| Decisión | Motivo |
|---|---|
| **Node.js + Express** | Simple, conocido, y Node ya estaba instalado. |
| **SQLite integrado (`node:sqlite`)** | Viene con Node 24: no hay que compilar módulos nativos en Windows ni instalar un servidor de base de datos. Un solo archivo, fácil de respaldar. |
| **cheerio** para el HTML | Ligero y rápido; no hace falta un navegador (Puppeteer) porque Dimayor devuelve el HTML ya armado desde su servidor. |
| **Usar los endpoints AJAX de Dimayor** en vez de la página completa | Permiten pedir cualquier temporada, torneo, fase y jornada, no solo lo que muestra la portada. |
| **Clave textual para partidos** | Los partidos programados aún no tienen ID en Dimayor; se identifican por `torneo-fase-jornada-local-visitante`. Ver [base de datos](base-de-datos.md#partidos). |
| **Competiciones como configuración** | Las 5 competiciones usan las mismas acciones AJAX; solo cambia `competition_type` y qué tablas ofrecen. Agregar una es añadir una entrada en `COMPETICIONES`. |
| **Equipos por rama** | Clubes con equipo masculino y femenino comparten nombre; se distinguen con `(nombre, rama)`. Un equipo masculino es el mismo en Liga, B, Copa y Superliga. |
| **IDs de fase como texto** | Las fases por grupos tienen IDs como `group-FASE+II+CUADRANGULARES-186614`. |
| **Tolerancia a fallos por niveles** | Si falla una tabla se registra un aviso; si falla una competición, se sigue con las demás. Ver [recolección](recoleccion.md#tolerancia-a-fallos). |
| **Esquema versionado y regenerable** | Como todo se puede volver a descargar, un cambio incompatible de esquema recrea la base en vez de migrarla. |
| **Orden de fases por fecha** | Los IDs y el orden de fases de Dimayor no son cronológicos; se ordenan por la fecha del primer partido (columna `fases.orden`). |
| **Tablas "foto" (snapshots)** | Posiciones, goleadores y descenso se reemplazan completas en cada recolección, porque Dimayor solo da su estado actual. |
| **Pausa entre peticiones** | Respeto con el servidor de Dimayor y menor riesgo de bloqueo. |

## Dependencias

| Paquete | Uso |
|---|---|
| `express` | Servidor HTTP y enrutamiento. |
| `cheerio` | Parseo del HTML de Dimayor. |

Módulos integrados de Node usados: `node:sqlite`, `node:fs`, `node:path`, `node:util` (`parseArgs`) y `fetch` global.
