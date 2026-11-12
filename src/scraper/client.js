// Cliente HTTP de bajo nivel para dimayor.com.co.
// El sitio carga sus datos con peticiones AJAX a admin-ajax.php que exigen un
// "nonce" (token temporal de WordPress) incrustado en el HTML de la página.
import * as cheerio from 'cheerio';
import { config } from '../config.js';

const NONCE_TTL_MS = 60 * 60 * 1000; // el nonce de WordPress dura ~12-24h; lo renovamos cada hora

let session = null; // { nonce, seasons, fetchedAt }
let lastRequestAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Garantiza una pausa mínima entre peticiones consecutivas.
async function throttle() {
  const wait = lastRequestAt + config.requestDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function httpFetch(url, options = {}) {
  await throttle();
  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': config.userAgent, ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

// Descarga la página de la liga y extrae el nonce y la lista de temporadas.
async function loadSession() {
  const html = await httpFetch(config.dimayorPage);
  const nonce = html.match(/const nonce\s*=\s*"([a-f0-9]+)"/)?.[1];
  if (!nonce) throw new Error('No se encontró el nonce en la página de Dimayor (¿cambió el sitio?)');

  const $ = cheerio.load(html);
  const seasons = $('select.season-filter').first().find('option')
    .map((_, el) => ({ id: Number($(el).attr('value')), anio: Number($(el).text().trim()) }))
    .get()
    .filter((s) => s.id && s.anio);

  session = { nonce, seasons, fetchedAt: Date.now() };
  return session;
}

export async function getSession({ force = false } = {}) {
  if (force || !session || Date.now() - session.fetchedAt > NONCE_TTL_MS) {
    await loadSession();
  }
  return session;
}

// Llama a una acción AJAX de Dimayor. Si falla (p. ej. nonce vencido),
// renueva la sesión y reintenta una vez.
export async function ajax(action, params = {}, { retry = true } = {}) {
  const { nonce } = await getSession();
  const body = new URLSearchParams({ action, nonce, ...stringify(params) });
  const text = await httpFetch(config.dimayorAjax, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!json?.success) {
    if (retry) {
      await getSession({ force: true });
      return ajax(action, params, { retry: false });
    }
    throw new Error(`Dimayor respondió con error en "${action}": ${text.slice(0, 200)}`);
  }
  return json.data;
}

// Consulta la API REST de Dimayor (/wp-json/dimayor/v1/...), usada para el detalle de partidos.
// No requiere nonce. Devuelve null si el recurso no existe (404).
export async function rest(ruta) {
  try {
    return JSON.parse(await httpFetch(`${config.dimayorRest}${ruta}`));
  } catch (err) {
    if (/HTTP 404/.test(err.message)) return null;
    throw err;
  }
}

function stringify(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
  );
}
