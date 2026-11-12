// Endpoints públicos de la API. Todos leen de la base de datos local (no del sitio de Dimayor).
import { Router } from 'express';
import { db, getMeta } from '../db/database.js';
import { recolectar, recoleccionEnCurso } from '../collector.js';
import { config } from '../config.js';

export const api = Router();

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Torneo por defecto: el activo según Dimayor, o el más reciente con datos.
function resolverTorneo(valor) {
  if (valor) {
    const t = get('SELECT * FROM torneos WHERE id = ?', Number(valor));
    if (!t) throw new HttpError(404, `Torneo ${valor} no existe`);
    return t;
  }
  const activoId = getMeta('activo')?.torneoId;
  const t = get(`SELECT * FROM torneos WHERE id = ? OR id = (SELECT MAX(torneo_id) FROM partidos)
                 ORDER BY id = ? DESC LIMIT 1`, activoId ?? -1, activoId ?? -1);
  if (!t) throw new HttpError(404, 'Aún no hay datos. Ejecuta "npm run scrape" o POST /api/recolectar');
  return t;
}

const PARTIDO_SQL = `
  SELECT p.api_id AS apiId, p.torneo_id AS torneoId, p.fase_id AS faseId, f.nombre AS fase, p.jornada,
         p.fecha, p.hora, p.estado, p.estadio,
         json_object('id', l.id, 'nombre', l.nombre, 'escudo', l.escudo, 'goles', p.goles_local) AS local,
         json_object('id', v.id, 'nombre', v.nombre, 'escudo', v.escudo, 'goles', p.goles_visitante) AS visitante
  FROM partidos p
  JOIN equipos l ON l.id = p.local_id
  JOIN equipos v ON v.id = p.visitante_id
  JOIN fases f ON f.id = p.fase_id`;

const mapPartido = (r) => ({ ...r, local: JSON.parse(r.local), visitante: JSON.parse(r.visitante) });

const TABLA_SQL = `
  SELECT t.posicion, json_object('id', e.id, 'nombre', e.nombre, 'escudo', e.escudo) AS equipo,
         t.puntos, t.jugados, t.ganados, t.empatados, t.perdidos,
         t.goles_favor AS golesFavor, t.goles_contra AS golesContra, t.diferencia
  FROM tablas t JOIN equipos e ON e.id = t.equipo_id
  WHERE t.torneo_id = ? AND t.fase_id = ? AND t.tipo = ?
  ORDER BY t.posicion`;

const mapTabla = (r) => ({ ...r, equipo: JSON.parse(r.equipo) });

// ---------- Rutas ----------

api.get('/', (req, res) => {
  res.json({
    nombre: 'API Liga BetPlay Dimayor',
    fuente: 'https://dimayor.com.co (web scraping)',
    endpoints: [
      'GET  /api/estado',
      'GET  /api/temporadas',
      'GET  /api/torneos?temporada=2026',
      'GET  /api/torneos/:id',
      'GET  /api/equipos',
      'GET  /api/equipos/:id',
      'GET  /api/partidos?torneo=&fase=&jornada=&equipo=&estado=&fecha=YYYY-MM-DD',
      'GET  /api/posiciones?torneo=&fase=',
      'GET  /api/reclasificacion?torneo=',
      'GET  /api/descenso?torneo=',
      'GET  /api/goleadores?torneo=&limite=',
      'POST /api/recolectar  { "anio": 2026, "todo": false }',
    ],
  });
});

api.get('/estado', (req, res) => {
  res.json({
    recoleccionEnCurso: recoleccionEnCurso(),
    ultimaRecoleccion: getMeta('ultima_recoleccion'),
    activo: getMeta('activo'),
    conteos: get(`SELECT (SELECT COUNT(*) FROM torneos) AS torneos, (SELECT COUNT(*) FROM equipos) AS equipos,
                         (SELECT COUNT(*) FROM partidos) AS partidos, (SELECT COUNT(*) FROM goleadores) AS goleadores`),
  });
});

api.get('/temporadas', (req, res) => {
  res.json(all('SELECT id, anio FROM temporadas ORDER BY anio DESC'));
});

api.get('/torneos', (req, res) => {
  const { temporada } = req.query;
  const rows = all(`SELECT t.id, t.nombre, s.anio AS temporada FROM torneos t JOIN temporadas s ON s.id = t.temporada_id
                    WHERE ? IS NULL OR s.anio = ? ORDER BY t.id DESC`, temporada ?? null, Number(temporada) || null);
  res.json(rows);
});

api.get('/torneos/:id', (req, res) => {
  const torneo = resolverTorneo(req.params.id);
  const fases = all('SELECT id, nombre, jornadas FROM fases WHERE torneo_id = ? ORDER BY id', torneo.id);
  res.json({ ...torneo, fases });
});

api.get('/equipos', (req, res) => {
  res.json(all('SELECT id, nombre, escudo FROM equipos ORDER BY nombre'));
});

api.get('/equipos/:id', (req, res) => {
  const equipo = get('SELECT id, nombre, escudo FROM equipos WHERE id = ?', Number(req.params.id));
  if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
  const partidos = all(`${PARTIDO_SQL} WHERE p.local_id = ? OR p.visitante_id = ? ORDER BY p.fecha DESC, p.hora DESC`,
    equipo.id, equipo.id).map(mapPartido);
  res.json({ ...equipo, partidos });
});

api.get('/partidos', (req, res) => {
  const { fase, jornada, equipo, estado, fecha } = req.query;
  const torneo = resolverTorneo(req.query.torneo);
  const where = ['p.torneo_id = ?'];
  const params = [torneo.id];
  if (fase) { where.push('p.fase_id = ?'); params.push(Number(fase)); }
  if (jornada) { where.push('p.jornada = ?'); params.push(Number(jornada)); }
  if (equipo) { where.push('(p.local_id = ? OR p.visitante_id = ?)'); params.push(Number(equipo), Number(equipo)); }
  if (estado) { where.push('p.estado = ?'); params.push(estado); }
  if (fecha) { where.push('p.fecha = ?'); params.push(fecha); }
  const rows = all(`${PARTIDO_SQL} WHERE ${where.join(' AND ')} ORDER BY p.fase_id, p.jornada, p.fecha, p.hora`, ...params);
  res.json({ torneo: torneo.nombre, total: rows.length, partidos: rows.map(mapPartido) });
});

api.get('/posiciones', (req, res) => {
  const torneo = resolverTorneo(req.query.torneo);
  const fase = req.query.fase
    ? get('SELECT * FROM fases WHERE id = ? AND torneo_id = ?', Number(req.query.fase), torneo.id)
    : get(`SELECT f.* FROM fases f WHERE f.torneo_id = ? AND EXISTS
             (SELECT 1 FROM tablas t WHERE t.fase_id = f.id AND t.tipo = 'posiciones') ORDER BY f.id LIMIT 1`, torneo.id);
  if (!fase) throw new HttpError(404, 'Fase no encontrada para este torneo');
  res.json({ torneo: torneo.nombre, fase: fase.nombre, tabla: all(TABLA_SQL, torneo.id, fase.id, 'posiciones').map(mapTabla) });
});

api.get('/reclasificacion', (req, res) => {
  const torneo = resolverTorneo(req.query.torneo);
  res.json({ torneo: torneo.nombre, tabla: all(TABLA_SQL, torneo.id, 0, 'reclasificacion').map(mapTabla) });
});

api.get('/descenso', (req, res) => {
  const torneo = resolverTorneo(req.query.torneo);
  const rows = all(`SELECT d.posicion, json_object('id', e.id, 'nombre', e.nombre, 'escudo', e.escudo) AS equipo,
                           d.por_anio AS porAnio, d.jugados, d.puntos, d.promedio
                    FROM descenso d JOIN equipos e ON e.id = d.equipo_id WHERE d.torneo_id = ? ORDER BY d.posicion`, torneo.id);
  res.json({
    torneo: torneo.nombre,
    tabla: rows.map((r) => ({ ...r, equipo: JSON.parse(r.equipo), porAnio: JSON.parse(r.porAnio) })),
  });
});

api.get('/goleadores', (req, res) => {
  const torneo = resolverTorneo(req.query.torneo);
  const limite = Math.min(Number(req.query.limite) || 50, 500);
  const rows = all(`SELECT posicion, jugador_id AS jugadorId, jugador, foto, equipo, goles, jugados
                    FROM goleadores WHERE torneo_id = ? ORDER BY goles DESC, jugados ASC LIMIT ?`, torneo.id, limite);
  res.json({ torneo: torneo.nombre, goleadores: rows });
});

// Lanza una recolección en segundo plano.
api.post('/recolectar', (req, res) => {
  if (config.adminToken && req.get('x-admin-token') !== config.adminToken) {
    throw new HttpError(401, 'Token de administrador inválido');
  }
  if (recoleccionEnCurso()) return res.status(409).json({ error: 'Ya hay una recolección en curso' });
  const { anio, todo } = req.body ?? {};
  recolectar({ anio, todo: Boolean(todo) }).catch((err) => console.error('[recolector] Error:', err.message));
  res.status(202).json({ mensaje: 'Recolección iniciada. Consulta GET /api/estado para ver el progreso.' });
});

// Manejo de errores
api.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});
