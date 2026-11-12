// Recolector: hace scraping de Dimayor y guarda los resultados en la base de datos.
import { db, transaction, setMeta } from './db/database.js';
import * as dimayor from './scraper/dimayor.js';

const MAX_JORNADAS_SIN_DECLARAR = 30;

const log = (...args) => console.log(`[recolector ${new Date().toISOString()}]`, ...args);

// ---------- Escritura en la base ----------

const stmt = {
  temporada: db.prepare('INSERT INTO temporadas (id, anio) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET anio = excluded.anio'),
  torneo: db.prepare(`INSERT INTO torneos (id, temporada_id, nombre) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, temporada_id = excluded.temporada_id`),
  fase: db.prepare(`INSERT INTO fases (id, torneo_id, nombre, jornadas, orden) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, jornadas = excluded.jornadas, orden = excluded.orden`),
  equipo: db.prepare(`INSERT INTO equipos (nombre, escudo) VALUES (?, ?)
    ON CONFLICT(nombre) DO UPDATE SET escudo = COALESCE(excluded.escudo, equipos.escudo) RETURNING id`),
  partido: db.prepare(`INSERT INTO partidos (clave, api_id, torneo_id, fase_id, jornada, fecha, hora, local_id, visitante_id,
      goles_local, goles_visitante, estado, estadio, actualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET api_id = COALESCE(excluded.api_id, partidos.api_id), fecha = excluded.fecha,
      hora = excluded.hora, goles_local = excluded.goles_local, goles_visitante = excluded.goles_visitante,
      estado = excluded.estado, estadio = excluded.estadio, actualizado = excluded.actualizado`),
  tabla: db.prepare(`INSERT INTO tablas (torneo_id, fase_id, tipo, posicion, equipo_id, puntos, jugados, ganados,
      empatados, perdidos, goles_favor, goles_contra, diferencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  goleador: db.prepare(`INSERT OR REPLACE INTO goleadores (torneo_id, jugador_id, posicion, jugador, foto, equipo, goles, jugados)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  descenso: db.prepare(`INSERT INTO descenso (torneo_id, equipo_id, posicion, por_anio, jugados, puntos, promedio)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
};

const equipoId = (nombre, escudo) => stmt.equipo.get(nombre, escudo ?? null).id;

function guardarPartidos(torneoId, faseId, jornada, partidos) {
  const ahora = new Date().toISOString();
  transaction(() => {
    for (const p of partidos) {
      const clave = `${torneoId}-${faseId}-${jornada}-${p.local}-${p.visitante}`;
      stmt.partido.run(clave, p.apiId, torneoId, faseId, jornada, p.fecha, p.hora,
        equipoId(p.local, p.localEscudo), equipoId(p.visitante, p.visitanteEscudo),
        p.golesLocal, p.golesVisitante, p.estado, p.estadio, ahora);
    }
  });
}

function guardarTabla(torneoId, faseId, tipo, filas) {
  if (!filas.length) return;
  transaction(() => {
    db.prepare('DELETE FROM tablas WHERE torneo_id = ? AND fase_id = ? AND tipo = ?').run(torneoId, faseId, tipo);
    for (const f of filas) {
      stmt.tabla.run(torneoId, faseId, tipo, f.posicion, equipoId(f.equipo, f.escudo), f.puntos, f.jugados,
        f.ganados, f.empatados, f.perdidos, f.golesFavor, f.golesContra, f.diferencia);
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

function guardarDescenso(torneoId, filas) {
  if (!filas.length) return;
  transaction(() => {
    db.prepare('DELETE FROM descenso WHERE torneo_id = ?').run(torneoId);
    for (const d of filas) {
      stmt.descenso.run(torneoId, equipoId(d.equipo, d.escudo), d.posicion, JSON.stringify(d.porAnio), d.jugados, d.puntos, d.promedio);
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

async function recolectarTorneo(torneo) {
  const fases = await dimayor.getFases(torneo.id);
  fases.forEach((fase, i) => { fase.orden = i + 1; }); // Dimayor entrega las fases en orden
  for (const fase of fases) stmt.fase.run(fase.id, torneo.id, fase.nombre, fase.jornadas, fase.orden);
  log(`Torneo "${torneo.nombre}": ${fases.length} fase(s)`);

  for (const fase of fases) {
    const q = { torneoId: torneo.id, faseId: fase.id };
    // Algunas fases (cuadrangulares, finales) no declaran cuántas jornadas tienen:
    // en ese caso se avanza jornada por jornada hasta encontrar una vacía.
    const declaradas = fase.jornadas;
    const maximo = declaradas || MAX_JORNADAS_SIN_DECLARAR;
    let jornadas = 0;
    for (let jornada = 1; jornada <= maximo; jornada++) {
      const partidos = await dimayor.getPartidos({ ...q, jornada });
      if (!declaradas && !partidos.length) break;
      guardarPartidos(torneo.id, fase.id, jornada, partidos);
      jornadas = jornada;
    }
    if (!declaradas && jornadas) stmt.fase.run(fase.id, torneo.id, fase.nombre, jornadas, fase.orden);
    guardarTabla(torneo.id, fase.id, 'posiciones', await dimayor.getPosiciones(q));
    log(`  Fase "${fase.nombre}": ${jornadas} jornada(s) recolectadas`);
  }

  ordenarFasesPorFecha(torneo.id);

  // Tablas generales del torneo (se consultan con la primera fase)
  if (fases.length) {
    const q = { torneoId: torneo.id, faseId: fases[0].id };
    guardarGoleadores(torneo.id, await dimayor.getGoleadores(q));
    guardarTabla(torneo.id, 0, 'reclasificacion', await dimayor.getReclasificacion(q));
    guardarDescenso(torneo.id, await dimayor.getDescenso(q));
  }
}

let enCurso = null;

/**
 * Recolecta datos de Dimayor y los guarda en la base.
 * @param {object} opciones
 * @param {number} [opciones.anio]    Año de la temporada (por defecto, la más reciente).
 * @param {boolean} [opciones.todo]   true = todos los torneos del año; false = solo el torneo activo.
 */
export function recolectar(opciones = {}) {
  if (enCurso) return enCurso; // evita dos recolecciones simultáneas
  enCurso = ejecutar(opciones).finally(() => { enCurso = null; });
  return enCurso;
}

export const recoleccionEnCurso = () => Boolean(enCurso);

async function ejecutar({ anio, todo = false } = {}) {
  const inicio = Date.now();
  const temporadas = await dimayor.getTemporadas();
  transaction(() => temporadas.forEach((t) => stmt.temporada.run(t.id, t.anio)));

  const temporada = anio ? temporadas.find((t) => t.anio === Number(anio)) : temporadas[0];
  if (!temporada) throw new Error(`Temporada ${anio} no disponible. Disponibles: ${temporadas.map((t) => t.anio).join(', ')}`);

  const torneos = await dimayor.getTorneos(temporada.id);
  transaction(() => torneos.forEach((t) => stmt.torneo.run(t.id, temporada.id, t.nombre)));

  // El torneo "activo" solo tiene sentido en la temporada actual.
  const activo = temporada.id === temporadas[0].id ? await dimayor.getActivo(temporada.id) : null;
  if (activo) setMeta('activo', activo);

  let objetivo = torneos;
  if (!todo) {
    objetivo = torneos.filter((t) => t.id === activo?.torneoId);
    if (!objetivo.length) objetivo = torneos.slice(-1);
  }

  for (const torneo of objetivo) await recolectarTorneo(torneo);

  const resumen = {
    temporada: temporada.anio,
    torneos: objetivo.map((t) => t.nombre),
    segundos: Math.round((Date.now() - inicio) / 1000),
    fecha: new Date().toISOString(),
  };
  setMeta('ultima_recoleccion', resumen);
  log('Recolección completa', resumen);
  return resumen;
}
