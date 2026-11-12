// Endpoints públicos de la API. Todos leen de la base de datos local (no del sitio de Dimayor).
import { Router } from 'express';
import { db, getMeta } from '../db/database.js';
import { recolectar, recoleccionEnCurso } from '../collector.js';
import { detallesEnCurso } from '../detalles.js';
import { config, COMPETICIONES, COMPETICION_POR_DEFECTO } from '../config.js';

export const api = Router();

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function resolverCompeticion(valor) {
  const slug = valor ?? COMPETICION_POR_DEFECTO;
  if (!COMPETICIONES[slug]) {
    throw new HttpError(400, `Competición "${slug}" no existe. Válidas: ${Object.keys(COMPETICIONES).join(', ')}`);
  }
  return slug;
}

// Torneo pedido por ID, o el torneo activo de la competición (o el más reciente con partidos).
function resolverTorneo(query) {
  if (query.torneo) {
    const t = get('SELECT * FROM torneos WHERE id = ?', Number(query.torneo));
    if (!t) throw new HttpError(404, `Torneo ${query.torneo} no existe`);
    return t;
  }
  const slug = resolverCompeticion(query.competicion);
  const activoId = getMeta(`activo:${slug}`)?.torneoId ?? -1;
  const t = get(`SELECT * FROM torneos WHERE competicion = ? AND (id = ? OR id = (
                   SELECT MAX(p.torneo_id) FROM partidos p JOIN torneos x ON x.id = p.torneo_id WHERE x.competicion = ?))
                 ORDER BY id = ? DESC LIMIT 1`, slug, activoId, slug, activoId);
  if (!t) throw new HttpError(404, `Aún no hay datos de "${slug}". Ejecuta "npm run scrape" o POST /api/recolectar`);
  return t;
}

const PARTIDO_SQL = `
  SELECT p.api_id AS apiId, t.competicion, p.torneo_id AS torneoId, p.fase_id AS faseId, f.nombre AS fase,
         p.grupo, p.jornada, p.fecha, p.hora, p.estado, p.estadio, p.canales,
         json_object('id', l.id, 'nombre', l.nombre, 'escudo', l.escudo, 'goles', p.goles_local) AS local,
         json_object('id', v.id, 'nombre', v.nombre, 'escudo', v.escudo, 'goles', p.goles_visitante) AS visitante
  FROM partidos p
  JOIN torneos t ON t.id = p.torneo_id
  JOIN equipos l ON l.id = p.local_id
  JOIN equipos v ON v.id = p.visitante_id
  JOIN fases f ON f.id = p.fase_id`;

const mapPartido = (r) => ({
  ...r, canales: JSON.parse(r.canales), local: JSON.parse(r.local), visitante: JSON.parse(r.visitante),
});

const TABLA_SQL = `
  SELECT NULLIF(t.grupo, '') AS grupo, t.posicion,
         json_object('id', e.id, 'nombre', e.nombre, 'escudo', e.escudo) AS equipo,
         t.puntos, t.jugados, t.ganados, t.empatados, t.perdidos,
         t.goles_favor AS golesFavor, t.goles_contra AS golesContra, t.diferencia
  FROM tablas t JOIN equipos e ON e.id = t.equipo_id
  WHERE t.torneo_id = ? AND t.fase_id = ? AND t.tipo = ?
  ORDER BY t.grupo, t.posicion`;

const mapTabla = (r) => ({ ...r, equipo: JSON.parse(r.equipo) });

const infoTorneo = (t) => ({ id: t.id, nombre: t.nombre, competicion: t.competicion });

// ---------- Rutas ----------

api.get('/', (req, res) => {
  res.json({
    nombre: 'API fútbol colombiano (Dimayor)',
    fuente: 'https://dimayor.com.co (web scraping)',
    competiciones: Object.keys(COMPETICIONES),
    nota: `Los endpoints con "competicion" usan "${COMPETICION_POR_DEFECTO}" por defecto.`,
    endpoints: [
      'GET  /api/estado',
      'GET  /api/competiciones',
      'GET  /api/temporadas',
      'GET  /api/torneos?competicion=&temporada=2026',
      'GET  /api/torneos/:id',
      'GET  /api/equipos?competicion=&rama=masculino|femenino',
      'GET  /api/equipos/:id',
      'GET  /api/partidos?competicion=&torneo=&fase=&grupo=&jornada=&equipo=&estado=&fecha=YYYY-MM-DD',
      'GET  /api/partidos/:apiId  (detalle: eventos, alineaciones, técnicos, árbitros)',
      'GET  /api/posiciones?competicion=&torneo=&fase=',
      'GET  /api/reclasificacion?competicion=&torneo=',
      'GET  /api/descenso?torneo=',
      'GET  /api/goleadores?competicion=&torneo=&limite=',
      'POST /api/recolectar  { "anio": 2026, "todo": false, "competiciones": ["liga"] }',
    ],
  });
});

api.get('/estado', (req, res) => {
  res.json({
    recoleccionEnCurso: recoleccionEnCurso(),
    ultimaRecoleccion: getMeta('ultima_recoleccion'),
    detallesEnCurso: detallesEnCurso(),
    ultimaRecoleccionDetalles: getMeta('ultima_recoleccion_detalles'),
    activos: Object.fromEntries(Object.keys(COMPETICIONES).map((c) => [c, getMeta(`activo:${c}`)])),
    conteos: get(`SELECT (SELECT COUNT(*) FROM torneos) AS torneos, (SELECT COUNT(*) FROM equipos) AS equipos,
                         (SELECT COUNT(*) FROM partidos) AS partidos, (SELECT COUNT(*) FROM goleadores) AS goleadores,
                         (SELECT COUNT(*) FROM detalles WHERE estado = 'ok') AS partidosConDetalle,
                         (SELECT COUNT(DISTINCT api_id) FROM partidos WHERE estado = 'finalizado' AND api_id IS NOT NULL
                            AND api_id NOT IN (SELECT api_id FROM detalles)) AS detallesPendientes,
                         (SELECT COUNT(*) FROM personas) AS personas, (SELECT COUNT(*) FROM eventos) AS eventos`),
  });
});

api.get('/competiciones', (req, res) => {
  const conteos = Object.fromEntries(all(`SELECT t.competicion, COUNT(DISTINCT t.id) AS torneos, COUNT(p.clave) AS partidos
    FROM torneos t LEFT JOIN partidos p ON p.torneo_id = t.id GROUP BY t.competicion`).map((r) => [r.competicion, r]));
  res.json(Object.entries(COMPETICIONES).map(([clave, c]) => ({
    clave, nombre: c.nombre, rama: c.rama, tablas: c.tablas,
    torneos: conteos[clave]?.torneos ?? 0, partidos: conteos[clave]?.partidos ?? 0,
  })));
});

api.get('/temporadas', (req, res) => {
  res.json(all('SELECT id, anio FROM temporadas ORDER BY anio DESC'));
});

api.get('/torneos', (req, res) => {
  const { temporada, competicion } = req.query;
  if (competicion) resolverCompeticion(competicion);
  const rows = all(`SELECT t.id, t.nombre, t.competicion, s.anio AS temporada
                    FROM torneos t JOIN temporadas s ON s.id = t.temporada_id
                    WHERE (? IS NULL OR s.anio = ?) AND (? IS NULL OR t.competicion = ?)
                    ORDER BY s.anio DESC, t.competicion, t.id DESC`,
  temporada ?? null, Number(temporada) || null, competicion ?? null, competicion ?? null);
  res.json(rows);
});

api.get('/torneos/:id', (req, res) => {
  const torneo = resolverTorneo({ torneo: req.params.id });
  const fases = all('SELECT id, nombre, jornadas, orden FROM fases WHERE torneo_id = ? ORDER BY orden, id', torneo.id);
  res.json({ ...torneo, fases });
});

api.get('/equipos', (req, res) => {
  const { competicion, rama } = req.query;
  if (competicion) resolverCompeticion(competicion);
  // Con "competicion", solo los equipos que han jugado en ella.
  const rows = all(`SELECT e.id, e.nombre, e.rama, e.escudo FROM equipos e
                    WHERE (? IS NULL OR e.rama = ?)
                      AND (? IS NULL OR EXISTS (SELECT 1 FROM partidos p JOIN torneos t ON t.id = p.torneo_id
                             WHERE t.competicion = ? AND e.id IN (p.local_id, p.visitante_id)))
                    ORDER BY e.rama, e.nombre`, rama ?? null, rama ?? null, competicion ?? null, competicion ?? null);
  res.json(rows);
});

api.get('/equipos/:id', (req, res) => {
  const equipo = get('SELECT id, nombre, rama, escudo FROM equipos WHERE id = ?', Number(req.params.id));
  if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
  const partidos = all(`${PARTIDO_SQL} WHERE p.local_id = ? OR p.visitante_id = ? ORDER BY p.fecha DESC, p.hora DESC`,
    equipo.id, equipo.id).map(mapPartido);
  res.json({ ...equipo, partidos });
});

api.get('/partidos', (req, res) => {
  const { fase, grupo, jornada, equipo, estado, fecha } = req.query;
  const torneo = resolverTorneo(req.query);
  const where = ['p.torneo_id = ?'];
  const params = [torneo.id];
  if (fase) { where.push('p.fase_id = ?'); params.push(String(fase)); }
  if (grupo) { where.push('p.grupo = ?'); params.push(String(grupo).toUpperCase()); }
  if (jornada) { where.push('p.jornada = ?'); params.push(Number(jornada)); }
  if (equipo) { where.push('(p.local_id = ? OR p.visitante_id = ?)'); params.push(Number(equipo), Number(equipo)); }
  if (estado) { where.push('p.estado = ?'); params.push(estado); }
  if (fecha) { where.push('p.fecha = ?'); params.push(fecha); }
  const rows = all(`${PARTIDO_SQL} WHERE ${where.join(' AND ')} ORDER BY f.orden, p.jornada, p.fecha, p.hora`, ...params);
  res.json({ torneo: infoTorneo(torneo), total: rows.length, partidos: rows.map(mapPartido) });
});

// Detalle de un partido jugado: eventos, alineaciones, cuerpo técnico y árbitros.
api.get('/partidos/:apiId', (req, res) => {
  const apiId = String(req.params.apiId);
  const partido = get(`${PARTIDO_SQL} WHERE p.api_id = ?`, apiId);
  if (!partido) throw new HttpError(404, `Partido ${apiId} no existe`);
  const detalle = get('SELECT estado, recolectado FROM detalles WHERE api_id = ?', apiId);

  const lado = (esLocal) => (esLocal === null ? null : esLocal ? 'local' : 'visitante');
  const persona = (id, nombre) => (id ? { id, nombre } : null);

  const eventos = all(`SELECT e.tipo, e.periodo, e.minuto, e.adicion, e.es_local AS esLocal,
                              e.persona_id AS p1, a.nombre AS n1, e.persona2_id AS p2, b.nombre AS n2
                       FROM eventos e LEFT JOIN personas a ON a.id = e.persona_id LEFT JOIN personas b ON b.id = e.persona2_id
                       WHERE e.api_id = ? ORDER BY e.minuto, e.adicion, e.orden`, apiId)
    .map((e) => ({
      tipo: e.tipo, periodo: e.periodo, minuto: e.minuto, adicion: e.adicion, equipo: lado(e.esLocal),
      jugador: persona(e.p1, e.n1),
      // En cambios, persona_id es el que entra y persona2_id el que sale.
      ...(e.tipo === 'SUBSTITUTION' && { entra: persona(e.p1, e.n1), sale: persona(e.p2, e.n2) }),
    }));

  const alineacion = (esLocal) => all(`
    SELECT a.persona_id AS id, pe.nombre, a.dorsal, a.posicion, a.titular, a.capitan
    FROM alineaciones a JOIN personas pe ON pe.id = a.persona_id
    WHERE a.api_id = ? AND a.es_local = ? ORDER BY a.titular DESC, a.dorsal`, apiId, esLocal)
    .map((j) => ({ ...j, titular: Boolean(j.titular), capitan: Boolean(j.capitan) }));

  const tecnicos = (esLocal) => all(`SELECT t.persona_id AS id, pe.nombre, t.rol FROM tecnicos t JOIN personas pe ON pe.id = t.persona_id
                                     WHERE t.api_id = ? AND t.es_local = ?`, apiId, esLocal);

  res.json({
    ...mapPartido(partido),
    detalle: detalle ? { estado: detalle.estado, recolectado: detalle.recolectado } : null,
    arbitros: Object.fromEntries(all('SELECT rol, nombre FROM arbitros WHERE api_id = ?', apiId).map((a) => [a.rol, a.nombre])),
    alineaciones: { local: alineacion(1), visitante: alineacion(0) },
    tecnicos: { local: tecnicos(1), visitante: tecnicos(0) },
    eventos,
  });
});

api.get('/posiciones', (req, res) => {
  const torneo = resolverTorneo(req.query);
  const fase = req.query.fase
    ? get('SELECT * FROM fases WHERE id = ? AND torneo_id = ?', String(req.query.fase), torneo.id)
    : get(`SELECT f.* FROM fases f WHERE f.torneo_id = ? AND EXISTS
             (SELECT 1 FROM tablas t WHERE t.fase_id = f.id AND t.tipo = 'posiciones') ORDER BY f.orden, f.id LIMIT 1`, torneo.id);
  if (!fase) throw new HttpError(404, 'No hay tabla de posiciones para este torneo/fase');
  res.json({
    torneo: infoTorneo(torneo),
    fase: { id: fase.id, nombre: fase.nombre },
    tabla: all(TABLA_SQL, torneo.id, fase.id, 'posiciones').map(mapTabla),
  });
});

api.get('/reclasificacion', (req, res) => {
  const torneo = resolverTorneo(req.query);
  res.json({ torneo: infoTorneo(torneo), tabla: all(TABLA_SQL, torneo.id, '', 'reclasificacion').map(mapTabla) });
});

api.get('/descenso', (req, res) => {
  const torneo = resolverTorneo({ ...req.query, competicion: 'liga' }); // el descenso solo existe en la Liga
  const rows = all(`SELECT d.posicion, json_object('id', e.id, 'nombre', e.nombre, 'escudo', e.escudo) AS equipo,
                           d.por_anio AS porAnio, d.jugados, d.puntos, d.promedio
                    FROM descenso d JOIN equipos e ON e.id = d.equipo_id WHERE d.torneo_id = ? ORDER BY d.posicion`, torneo.id);
  res.json({
    torneo: infoTorneo(torneo),
    tabla: rows.map((r) => ({ ...r, equipo: JSON.parse(r.equipo), porAnio: JSON.parse(r.porAnio) })),
  });
});

api.get('/goleadores', (req, res) => {
  const torneo = resolverTorneo(req.query);
  const limite = Math.min(Number(req.query.limite) || 50, 500);
  const rows = all(`SELECT posicion, jugador_id AS jugadorId, jugador, foto, equipo, goles, jugados
                    FROM goleadores WHERE torneo_id = ? ORDER BY goles DESC, jugados ASC LIMIT ?`, torneo.id, limite);
  res.json({ torneo: infoTorneo(torneo), goleadores: rows });
});

// Lanza una recolección en segundo plano.
api.post('/recolectar', (req, res) => {
  if (config.adminToken && req.get('x-admin-token') !== config.adminToken) {
    throw new HttpError(401, 'Token de administrador inválido');
  }
  if (recoleccionEnCurso()) return res.status(409).json({ error: 'Ya hay una recolección en curso' });
  const { anio, todo, competiciones } = req.body ?? {};
  if (competiciones !== undefined) {
    if (!Array.isArray(competiciones)) throw new HttpError(400, '"competiciones" debe ser una lista, p. ej. ["liga"]');
    competiciones.forEach(resolverCompeticion);
  }
  recolectar({ anio, todo: Boolean(todo), competiciones }).catch((err) => console.error('[recolector] Error:', err.message));
  res.status(202).json({ mensaje: 'Recolección iniciada. Consulta GET /api/estado para ver el progreso.' });
});

// Manejo de errores
api.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});
