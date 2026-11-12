// Recolector de detalle de partidos: eventos, alineaciones, cuerpo técnico y árbitros.
// Solo procesa partidos finalizados con api_id que aún no tienen detalle (tabla "detalles"),
// así que se puede interrumpir y volver a lanzar: continúa donde quedó.
import { db, transaction, setMeta } from './db/database.js';
import { getDetallePartido } from './scraper/detalle.js';

const log = (...args) => console.log(`[detalles ${new Date().toISOString()}]`, ...args);

// Si Dimayor falla muchas veces seguidas (caída o bloqueo), se detiene para no insistir.
const MAX_FALLOS_SEGUIDOS = 10;

const stmt = {
  persona: db.prepare(`INSERT INTO personas (id, nombre, nombre_corto, fifa_id, foto) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = COALESCE(excluded.nombre, personas.nombre),
      nombre_corto = COALESCE(excluded.nombre_corto, personas.nombre_corto),
      fifa_id = COALESCE(excluded.fifa_id, personas.fifa_id), foto = COALESCE(excluded.foto, personas.foto)`),
  alineacion: db.prepare(`INSERT OR REPLACE INTO alineaciones (api_id, persona_id, equipo_id, es_local, titular, capitan, posicion, dorsal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  tecnico: db.prepare(`INSERT OR REPLACE INTO tecnicos (api_id, persona_id, equipo_id, es_local, rol) VALUES (?, ?, ?, ?, ?)`),
  evento: db.prepare(`INSERT OR REPLACE INTO eventos (id, api_id, tipo, periodo, minuto, minuto_periodo, adicion, es_local,
      equipo_id, persona_id, persona2_id, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  arbitro: db.prepare('INSERT OR REPLACE INTO arbitros (api_id, rol, nombre) VALUES (?, ?, ?)'),
  detalle: db.prepare(`INSERT OR REPLACE INTO detalles (api_id, estado, recolectado) VALUES (?, ?, ?)`),
};

const guardarPersona = (p) => {
  if (p) stmt.persona.run(p.id, p.nombre, p.nombreCorto, p.fifaId, p.foto);
  return p?.id ?? null;
};

function guardarDetalle(partido, { eventos, jugadores, tecnicos, arbitros }) {
  const { api_id: apiId, local_id: localId, visitante_id: visitanteId } = partido;
  const equipo = (esLocal) => (esLocal === null ? null : esLocal ? localId : visitanteId);
  const sinDatos = !eventos.length && !jugadores.length;

  transaction(() => {
    for (const t of ['eventos', 'alineaciones', 'tecnicos', 'arbitros']) {
      db.prepare(`DELETE FROM ${t} WHERE api_id = ?`).run(apiId);
    }
    for (const j of jugadores) {
      stmt.alineacion.run(apiId, guardarPersona(j.jugador), equipo(j.esLocal), j.esLocal ? 1 : 0,
        j.titular ? 1 : 0, j.capitan ? 1 : 0, j.posicion, j.dorsal);
    }
    for (const t of tecnicos) {
      stmt.tecnico.run(apiId, guardarPersona(t.persona), equipo(t.esLocal), t.esLocal ? 1 : 0, t.rol);
    }
    for (const e of eventos) {
      stmt.evento.run(e.id, apiId, e.tipo, e.periodo, e.minuto, e.minutoPeriodo, e.adicion,
        e.esLocal === null ? null : e.esLocal ? 1 : 0, equipo(e.esLocal),
        guardarPersona(e.jugador), guardarPersona(e.jugador2), e.orden);
    }
    for (const a of arbitros) stmt.arbitro.run(apiId, a.rol, a.nombre);
    stmt.detalle.run(apiId, sinDatos ? 'sin_datos' : 'ok', new Date().toISOString());
  });
  return !sinDatos;
}

let enCurso = null;
export const detallesEnCurso = () => Boolean(enCurso);

/**
 * Descarga el detalle de los partidos finalizados que aún no lo tienen.
 * @param {object} opciones
 * @param {number} [opciones.limite]          Máximo de partidos a procesar en esta ejecución.
 * @param {number} [opciones.anio]            Solo partidos de esa temporada.
 * @param {string[]} [opciones.competiciones] Solo esas competiciones.
 */
export function recolectarDetalles(opciones = {}) {
  if (enCurso) return enCurso;
  enCurso = ejecutar(opciones).finally(() => { enCurso = null; });
  return enCurso;
}

async function ejecutar({ limite, anio, competiciones } = {}) {
  const filtros = [`p.estado = 'finalizado'`, 'p.api_id IS NOT NULL', 'd.api_id IS NULL'];
  const params = [];
  if (anio) { filtros.push('s.anio = ?'); params.push(Number(anio)); }
  if (competiciones?.length) {
    filtros.push(`t.competicion IN (${competiciones.map(() => '?').join(', ')})`);
    params.push(...competiciones);
  }
  // Primero los más recientes: son los más útiles y así un corte a mitad deja lo nuevo listo.
  const pendientes = db.prepare(`
    SELECT p.api_id, p.local_id, p.visitante_id
    FROM partidos p
    JOIN torneos t ON t.id = p.torneo_id
    JOIN temporadas s ON s.id = t.temporada_id
    LEFT JOIN detalles d ON d.api_id = p.api_id
    WHERE ${filtros.join(' AND ')}
    GROUP BY p.api_id
    ORDER BY p.fecha DESC
    ${limite ? 'LIMIT ?' : ''}`).all(...params, ...(limite ? [Number(limite)] : []));

  const inicio = Date.now();
  log(`${pendientes.length} partido(s) pendientes de detalle`);
  let ok = 0; let sinDatos = 0; let fallos = 0; let fallosSeguidos = 0;

  for (const [i, partido] of pendientes.entries()) {
    try {
      const detalle = await getDetallePartido(partido.api_id);
      if (guardarDetalle(partido, detalle)) ok++; else sinDatos++;
      fallosSeguidos = 0;
    } catch (err) {
      fallos++; fallosSeguidos++;
      log(`  Error en partido ${partido.api_id}: ${err.message}`);
      if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
        log(`  ${MAX_FALLOS_SEGUIDOS} errores seguidos: se detiene. Vuelve a lanzarlo más tarde; continuará donde quedó.`);
        break;
      }
    }
    if ((i + 1) % 50 === 0) {
      const seg = (Date.now() - inicio) / 1000;
      const restantes = Math.round(((pendientes.length - i - 1) * seg) / (i + 1) / 60);
      log(`  ${i + 1}/${pendientes.length} (ok ${ok}, sin datos ${sinDatos}, errores ${fallos}) · faltan ~${restantes} min`);
    }
  }

  const resumen = {
    procesados: ok + sinDatos, ok, sinDatos, errores: fallos,
    segundos: Math.round((Date.now() - inicio) / 1000), fecha: new Date().toISOString(),
  };
  setMeta('ultima_recoleccion_detalles', resumen);
  log('Detalles completos', JSON.stringify(resumen));
  return resumen;
}
