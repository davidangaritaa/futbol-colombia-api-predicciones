// Configuración central. Todo se puede sobreescribir con variables de entorno.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? 'data/futbol.db',

  // Página de la que se obtiene el "nonce" (token de WordPress) y las temporadas.
  dimayorPage: 'https://dimayor.com.co/liga-betplay-dimayor/',
  dimayorAjax: 'https://dimayor.com.co/wp-admin/admin-ajax.php',
  dimayorRest: 'https://dimayor.com.co/wp-json/dimayor/v1',
  userAgent: 'Mozilla/5.0 (compatible; APIFutbolColombia/1.0)',

  // Pausa mínima entre peticiones a Dimayor, para no sobrecargar su servidor.
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS ?? 600),

  // Cada cuántos minutos se recolectan automáticamente los torneos activos (0 = desactivado).
  scrapeIntervalMin: Number(process.env.SCRAPE_INTERVAL_MIN ?? 360),

  // Si se define, POST /api/recolectar exige el header "x-admin-token" con este valor.
  adminToken: process.env.ADMIN_TOKEN ?? '',
};

/**
 * Competiciones de Dimayor que se recolectan.
 * - clave (slug): identificador usado en la API (?competicion=liga).
 * - tipo: valor de "competition_type" que espera Dimayor.
 * - rama: separa equipos masculinos y femeninos que tienen el mismo nombre.
 * - tablas: pestañas que Dimayor ofrece para esa competición.
 */
export const COMPETICIONES = {
  liga: {
    nombre: 'Liga BetPlay', tipo: 'Liga BetPlay', rama: 'masculino',
    tablas: ['posiciones', 'reclasificacion', 'descenso', 'goleadores'],
  },
  torneo: {
    nombre: 'Torneo BetPlay (Primera B)', tipo: 'Torneo BetPlay', rama: 'masculino',
    tablas: ['posiciones', 'reclasificacion', 'goleadores'],
  },
  femenina: {
    nombre: 'Liga Femenina', tipo: 'Liga Femenina', rama: 'femenino',
    tablas: ['posiciones', 'reclasificacion', 'goleadores'],
  },
  copa: {
    nombre: 'Copa BetPlay', tipo: 'Copa BetPlay', rama: 'masculino',
    tablas: ['posiciones', 'goleadores'],
  },
  superliga: {
    nombre: 'Superliga', tipo: 'Superliga', rama: 'masculino',
    tablas: ['posiciones', 'goleadores'],
  },
};

export const COMPETICION_POR_DEFECTO = 'liga';
