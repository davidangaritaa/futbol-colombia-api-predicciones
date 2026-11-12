// Configuración central. Todo se puede sobreescribir con variables de entorno.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? 'data/futbol.db',

  // Página de la que se obtiene el "nonce" (token de WordPress) y las temporadas.
  dimayorPage: 'https://dimayor.com.co/liga-betplay-dimayor/',
  dimayorAjax: 'https://dimayor.com.co/wp-admin/admin-ajax.php',
  userAgent: 'Mozilla/5.0 (compatible; APIFutbolColombia/1.0)',

  // Pausa mínima entre peticiones a Dimayor, para no sobrecargar su servidor.
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS ?? 600),

  // Cada cuántos minutos se recolecta automáticamente el torneo activo (0 = desactivado).
  scrapeIntervalMin: Number(process.env.SCRAPE_INTERVAL_MIN ?? 360),

  // Si se define, POST /api/recolectar exige el header "x-admin-token" con este valor.
  adminToken: process.env.ADMIN_TOKEN ?? '',

  competitionType: 'Liga BetPlay',
};
