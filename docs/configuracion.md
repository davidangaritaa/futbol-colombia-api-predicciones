# Configuración y despliegue

## Requisitos

- **Node.js 24 o superior** (por `node:sqlite`). Verifica con `node --version`.
- Acceso a internet hacia `dimayor.com.co` para recolectar.

## Variables de entorno

Se leen en `src/config.js`.

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP de la API. |
| `DB_PATH` | `data/futbol.db` | Ruta del archivo SQLite (relativa a la carpeta desde la que se ejecuta). |
| `SCRAPE_INTERVAL_MIN` | `360` | Minutos entre recolecciones automáticas de los torneos activos de las 5 competiciones (~1–1,5 min cada una). `0` las desactiva. |
| `REQUEST_DELAY_MS` | `600` | Pausa mínima entre peticiones a Dimayor. No conviene bajarla. |
| `ADMIN_TOKEN` | *(vacío)* | Si se define, `POST /api/recolectar` exige el header `x-admin-token` con este valor. |

Valores fijos en `config.js` (no son variables de entorno): URL de la página de la liga, URL de `admin-ajax.php`, User-Agent, las competiciones (`COMPETICIONES`) y la competición por defecto de la API (`COMPETICION_POR_DEFECTO = 'liga'`).

### Cómo definirlas

PowerShell (Windows):

```powershell
$env:PORT = "8080"; $env:SCRAPE_INTERVAL_MIN = "120"; npm start
```

Git Bash / Linux / macOS:

```bash
PORT=8080 SCRAPE_INTERVAL_MIN=120 npm start
```

O con un archivo `.env` (ya está en `.gitignore`) y la opción integrada de Node:

```bash
node --env-file=.env src/server.js
```

```ini
# .env
PORT=8080
SCRAPE_INTERVAL_MIN=120
ADMIN_TOKEN=pon-aqui-un-valor-largo-y-aleatorio
```

## Recomendaciones de intervalo

| Momento | `SCRAPE_INTERVAL_MIN` sugerido |
|---|---|
| Sin partidos (entre torneos) | `720` – `1440` |
| Temporada normal | `360` (por defecto) |
| Fin de semana con partidos | `60` – `120` |

Recolectar más seguido que cada 30–60 minutos no aporta mucho: Dimayor actualiza los resultados al terminar cada partido.

## Puesta en producción

1. Copia el proyecto al servidor (sin `node_modules/` ni `data/`).
2. Instala solo dependencias de producción:
   ```bash
   npm ci --omit=dev
   ```
3. Carga los datos históricos que quieras (unos 2 minutos por año, las 5 competiciones):
   ```bash
   npm run scrape -- --anio 2023
   npm run scrape -- --anio 2024
   npm run scrape -- --anio 2025
   npm run scrape -- --anio 2026
   ```
4. Define `ADMIN_TOKEN` (importante si la API es pública).
5. Arranca con un gestor de procesos para que se reinicie si se cae, por ejemplo [PM2](https://pm2.keymetrics.io/):
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name api-futbol
   pm2 save
   ```
6. Opcional: pon un proxy inverso (Nginx, Caddy) delante para HTTPS.

> El servidor necesita un **disco persistente** para `data/futbol.db`. Plataformas con disco efímero (algunas capas gratuitas) pierden la base en cada reinicio; ahí la base se vuelve a llenar sola al arrancar, pero solo con los torneos activos.

## Seguridad

- **`ADMIN_TOKEN`:** sin él, cualquiera que llegue a tu API puede lanzar recolecciones (y por tanto peticiones a Dimayor). Defínelo siempre en un servidor público.
- **CORS abierto:** `server.js` permite cualquier origen. Si solo tu web debe consumir la API, cambia `'*'` por tu dominio.
- **Solo lectura:** salvo `/api/recolectar`, todos los endpoints son de lectura; las consultas SQL usan parámetros (sin riesgo de inyección SQL).
- **Sin límite de peticiones:** si la API será pública, considera añadir un *rate limit* (por ejemplo, el paquete `express-rate-limit`).

## Uso responsable de los datos

Los datos son de Dimayor. El proyecto limita su impacto (pausas, peticiones secuenciales, caché local), pero antes de un uso público o comercial revisa los términos del sitio y cita la fuente.
