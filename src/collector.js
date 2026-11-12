// Recolector: hace scraping de Dimayor y guarda los resultados en la base de datos.
import { db, transaction, setMeta } from './db/database.js';
import * as dimayor from './scraper/dimayor.js';
import { COMPETICIONES } from './config.js';

const MAX_JORNADAS_SIN_DECLARAR = 30;

const log = (...args) => console.log(`[recolector ${new Date().toISOString()}]`, ...args);

// Problemas no fatales de la recolección en curso (p. ej. una tabla que Dimayor no pudo generar).
let avisos = [];

// Ejecuta una descarga opcional: si falla, se registra el aviso y la recolección continúa.
async function intentar(descripcion, fn) {
  try {
    return await fn();
  } catch (err) {
    avisos.push(`${descripcion}: ${err.message}`);
    log(`  Aviso: ${descripcion}: ${err.message}`);
    return null;
  }
}

const clavePartido = (p) => `${p.local}|${p.visitante}|${p.fecha}`;

// ---------- Escritura en la base ----------

const stmt = {
  temporada: db.prepare('INSERT INTO temporadas (id, anio) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET anio = excluded.anio'),
  torneo: db.prepare(`INSERT INTO torneos (id, temporada_id, competicion, nombre) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, temporada_id = excluded.temporada_id,
      competicion = excluded.competicion`),
  fase: db.prepare(`INSERT INTO fases (id, torneo_id, nombre, jornadas, orden) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, jornadas = excluded.jornadas, orden = excluded.orden`),
  buscarEquipo: db.prepare('SELECT id FROM equipos WHERE nombre = ? AND rama = ?'),
  nuevoEquipo: db.prepare('INSERT INTO equipos (nombre, rama, escudo) VALUES (?, ?, ?) RETURNING id'),
  escudoEquipo: db.prepare('UPDATE equipos SET escudo = ? WHERE id = ? AND escudo IS NOT ?'),
  partido: db.prepare(`INSERT INTO partidos (clave, api_id, torneo_id, fase_id, grupo, jornada, fecha, hora,
      local_id, visitante_id, goles_local, goles_visitante, estado, estadio, canales, actualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET api_id = COALESCE(excluded.api_id, partidos.api_id), grupo = excluded.grupo,
      fecha = excluded.fecha, hora = excluded.hora, goles_local = excluded.goles_local,
      goles_visitante = excluded.goles_visitante, estado = excluded.estado, estadio = excluded.estadio,
      canales = excluded.canales, actualizado = excluded.actualizado`),
  tabla: db.prepare(`INSERT OR REPLACE INTO tablas (torneo_id, fase_id, tipo, grupo, posicion, equipo_id, puntos, jugados,
      ganados, empatados, perdidos, goles_favor, goles_contra, diferencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  goleador: db.prepare(`INSERT OR REPLACE INTO goleadores (torneo_id, jugador_id, posicion, jugador, foto, equipo, goles, jugados)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  descenso: db.prepare(`INSERT OR REPLACE INTO descenso (torneo_id, equipo_id, posicion, por_anio, jugados, puntos, promedio)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
};

// Busca primero y solo inserta si no existe: un "INSERT ... ON CONFLICT" gastaría un ID
// autoincremental en cada intento y dejaría saltos en la numeración de equipos.
function equipoId(nombre, rama, escudo) {
  const existente = stmt.buscarEquipo.get(nombre, rama);
  if (!existente) return stmt.nuevoEquipo.get(nombre, rama, escudo ?? null).id;
  if (escudo) stmt.escudoEquipo.run(escudo, existente.id, escudo);
  return existente.id;
}

function guardarPartidos(torneoId, faseId, jornada, rama, partidos) {
  const ahora = new Date().toISOString();
  transaction(() => {
    for (const p of partidos) {
      const clave = `${torneoId}-${faseId}-${jornada}-${p.local}-${p.visitante}`;
      stmt.partido.run(clave, p.apiId, torneoId, faseId, p.grupo, jornada, p.fecha, p.hora,
        equipoId(p.local, rama, p.localEscudo), equipoId(p.visitante, rama, p.visitanteEscudo),
        p.golesLocal, p.golesVisitante, p.estado, p.estadio, JSON.stringify(p.canales), ahora);
    }
  });
}

// Reemplaza una tabla completa (foto del momento). Si Dimayor la devuelve vacía, se conserva la anterior.
function guardarTabla(torneoId, faseId, tipo, rama, filas) {
  if (!filas.length) return;
  transaction(() => {
    db.prepare('DELETE FROM tablas WHERE torneo_id = ? AND fase_id = ? AND tipo = ?').run(torneoId, faseId, tipo);
    for (const f of filas) {
      stmt.tabla.run(torneoId, faseId, tipo, f.grupo ?? '', f.posicion, equipoId(f.equipo, rama, f.escudo), f.puntos,
        f.jugados, f.ganados, f.empatados, f.perdidos, f.golesFavor, f.golesContra, f.diferencia);
    }
  });
}

function guardarGoleadores(torneoId, filas) {
  if (!filas.length) return;
  transaction(() => {
    db.prepare('DELETE FROM goleadores WHERE torneo_id = ?').run(torneoId);
    for (const g of filas) {
      stmt.goleador.run(torneoId, g.jugadorId ?? `${g.jugador}-${g.equipo}`, g.posicion, g.jugador, g.foto, g.equipo, g.goles, g.jugados);
    }
  });
}

function guardarDescenso(torneoId, rama, filas) {
  if (!filas.length) return;
  transaction(() => {
    db.prepare('DELETE FROM descenso WHERE torneo_id = ?').run(torneoId);
    for (const d of filas) {
      stmt.descenso.run(torneoId, equipoId(d.equipo, rama, d.escudo), d.posicion, JSON.stringify(d.porAnio), d.jugados, d.puntos, d.promedio);
    }
  });
}

// Ni los IDs ni el orden en que Dimayor entrega las fases son cronológicos
// (p. ej. en 2025 la final aparece antes que los cuadrangulares). Se ordenan por
// la fecha de su primer partido; las fases sin partidos quedan al final.
function ordenarFasesPorFecha(torneoId) {
  db.prepare(`
    UPDATE fases SET orden = (
      SELECT rn FROM (
        SELECT f.id, ROW_NUMBER() OVER (
          ORDER BY (SELECT MIN(p.fecha) FROM partidos p WHERE p.fase_id = f.id) IS NULL,
                   (SELECT MIN(p.fecha) FROM partidos p WHERE p.fase_id = f.id),
                   f.orden
        ) AS rn
        FROM fases f WHERE f.torneo_id = ?
      ) r WHERE r.id = fases.id
    ) WHERE torneo_id = ?`).run(torneoId, torneoId);
}

// ---------- Recolección ----------

async function recolectarTorneo(torneo, comp) {
  const { tipo, rama, tablas } = comp;
  const fases = await dimayor.getFases(torneo.id);
  fases.forEach((fase, i) => { fase.orden = i + 1; });
  for (const fase of fases) stmt.fase.run(fase.id, torneo.id, fase.nombre, fase.jornadas, fase.orden);
  log(`[${comp.nombre}] "${torneo.nombre}": ${fases.length} fase(s)`);

  for (const fase of fases) {
    const q = { tipo, torneoId: torneo.id, faseId: fase.id };
    // Algunas fases (cuadrangulares, finales) no declaran cuántas jornadas tienen:
    // en ese caso se avanza jornada por jornada hasta encontrar una vacía.
    const declaradas = fase.jornadas;
    const maximo = declaradas || MAX_JORNADAS_SIN_DECLARAR;
    let jornadas = 0;
    const vistos = new Set();
    for (let jornada = 1; jornada <= maximo; jornada++) {
      const partidos = await dimayor.getPartidos({ ...q, jornada });
      if (!declaradas && !partidos.length) break;
      guardarPartidos(torneo.id, fase.id, jornada, rama, partidos);
      partidos.forEach((p) => vistos.add(clavePartido(p)));
      jornadas = jornada;
    }
    if (!declaradas && jornadas) stmt.fase.run(fase.id, torneo.id, fase.nombre, jornadas, fase.orden);

    // Algunos partidos no aparecen en ninguna jornada numerada (p. ej. la final del Torneo BetPlay I 2026),
    // pero sí al pedir la fase completa. Se guardan con jornada 0 ("sin jornada asignada").
    const todos = await dimayor.getPartidos({ ...q, jornada: '' });
    const sueltos = todos.filter((p) => !vistos.has(clavePartido(p)));
    if (sueltos.length) guardarPartidos(torneo.id, fase.id, 0, rama, sueltos);

    if (tablas.includes('posiciones')) {
      const filas = await intentar(`Posiciones de "${torneo.nombre}" / "${fase.nombre}"`, () => dimayor.getPosiciones(q));
      if (filas) guardarTabla(torneo.id, fase.id, 'posiciones', rama, filas);
    }
    log(`  Fase "${fase.nombre}": ${jornadas} jornada(s), ${vistos.size + sueltos.length} partido(s)`
      + (sueltos.length ? ` (${sueltos.length} sin jornada)` : ''));
  }

  ordenarFasesPorFecha(torneo.id);

  // Tablas generales del torneo (se consultan con la primera fase cronológica)
  const primera = db.prepare('SELECT id FROM fases WHERE torneo_id = ? ORDER BY orden LIMIT 1').get(torneo.id);
  if (!primera) return;
  const q = { tipo, torneoId: torneo.id, faseId: primera.id };
  const desc = (tabla) => `${tabla} de "${torneo.nombre}"`;
  if (tablas.includes('goleadores')) {
    const filas = await intentar(desc('Goleadores'), () => dimayor.getGoleadores(q));
    if (filas) guardarGoleadores(torneo.id, filas);
  }
  if (tablas.includes('reclasificacion')) {
    const filas = await intentar(desc('Reclasificación'), () => dimayor.getReclasificacion(q));
    if (filas) guardarTabla(torneo.id, '', 'reclasificacion', rama, filas);
  }
  if (tablas.includes('descenso')) {
    const filas = await intentar(desc('Descenso'), () => dimayor.getDescenso(q));
    if (filas) guardarDescenso(torneo.id, rama, filas);
  }
}

async function recolectarCompeticion(slug, temporada, esActual, todo) {
  const comp = COMPETICIONES[slug];
  const torneos = await dimayor.getTorneos(temporada.id, comp.tipo);
  transaction(() => torneos.forEach((t) => stmt.torneo.run(t.id, temporada.id, slug, t.nombre)));
  if (!torneos.length) {
    log(`[${comp.nombre}] Sin torneos en ${temporada.anio}`);
    return [];
  }

  // El torneo "activo" solo tiene sentido en la temporada actual.
  const activo = esActual ? await dimayor.getActivo(temporada.id, comp.tipo).catch(() => null) : null;
  if (activo) setMeta(`activo:${slug}`, activo);

  let objetivo = torneos;
  if (!todo) {
    objetivo = torneos.filter((t) => t.id === activo?.torneoId);
    if (!objetivo.length) objetivo = torneos.slice(-1);
  }

  for (const torneo of objetivo) await recolectarTorneo(torneo, comp);
  return objetivo.map((t) => t.nombre);
}

let enCurso = null;

/**
 * Recolecta datos de Dimayor y los guarda en la base.
 * @param {object} opciones
 * @param {number} [opciones.anio]           Año de la temporada (por defecto, la más reciente).
 * @param {boolean} [opciones.todo]          true = todos los torneos del año; false = solo los activos.
 * @param {string[]} [opciones.competiciones] Claves de COMPETICIONES (por defecto, todas).
 */
export function recolectar(opciones = {}) {
  if (enCurso) return enCurso; // evita dos recolecciones simultáneas
  enCurso = ejecutar(opciones).finally(() => { enCurso = null; });
  return enCurso;
}

export const recoleccionEnCurso = () => Boolean(enCurso);

async function ejecutar({ anio, todo = false, competiciones = Object.keys(COMPETICIONES) } = {}) {
  const desconocidas = competiciones.filter((c) => !COMPETICIONES[c]);
  if (desconocidas.length) {
    throw new Error(`Competición desconocida: ${desconocidas.join(', ')}. Válidas: ${Object.keys(COMPETICIONES).join(', ')}`);
  }

  const inicio = Date.now();
  avisos = [];
  const temporadas = await dimayor.getTemporadas();
  transaction(() => temporadas.forEach((t) => stmt.temporada.run(t.id, t.anio)));

  const temporada = anio ? temporadas.find((t) => t.anio === Number(anio)) : temporadas[0];
  if (!temporada) throw new Error(`Temporada ${anio} no disponible. Disponibles: ${temporadas.map((t) => t.anio).join(', ')}`);
  const esActual = temporada.id === temporadas[0].id;

  // Si una competición falla, se registra el error y se sigue con las demás.
  const torneos = {};
  const errores = {};
  for (const slug of competiciones) {
    try {
      torneos[slug] = await recolectarCompeticion(slug, temporada, esActual, todo);
    } catch (err) {
      errores[slug] = err.message;
      log(`[${COMPETICIONES[slug].nombre}] Error: ${err.message}`);
    }
  }

  const resumen = {
    temporada: temporada.anio,
    torneos,
    ...(Object.keys(errores).length && { errores }),
    ...(avisos.length && { avisos }),
    segundos: Math.round((Date.now() - inicio) / 1000),
    fecha: new Date().toISOString(),
  };
  setMeta('ultima_recoleccion', resumen);
  log('Recolección completa', JSON.stringify(resumen));
  return resumen;
}
