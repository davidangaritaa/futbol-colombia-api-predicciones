// Base de datos SQLite usando el módulo integrado de Node (node:sqlite), sin dependencias nativas.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Subir este número cuando cambie el esquema de forma incompatible.
// Como todos los datos se pueden volver a descargar de Dimayor, una base con una
// versión anterior se borra y se recrea (hay que volver a recolectar).
const VERSION_ESQUEMA = 2;

const TABLAS = [
  'eventos', 'alineaciones', 'tecnicos', 'arbitros', 'detalles', 'personas',
  'partidos', 'tablas', 'goleadores', 'descenso', 'fases', 'torneos', 'temporadas', 'equipos', 'meta',
];

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const version = db.prepare('PRAGMA user_version').get().user_version;
const tieneTablas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;
if (tieneTablas && version < VERSION_ESQUEMA) {
  console.warn(`[db] Esquema v${version} obsoleto: se recrea la base en v${VERSION_ESQUEMA}. Vuelve a recolectar los datos.`);
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of TABLAS) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec('PRAGMA foreign_keys = ON;');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS temporadas (
    id   INTEGER PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE
  );

  -- competicion: liga | torneo | femenina | copa | superliga (ver COMPETICIONES en config.js)
  CREATE TABLE IF NOT EXISTS torneos (
    id           INTEGER PRIMARY KEY,
    temporada_id INTEGER NOT NULL REFERENCES temporadas(id),
    competicion  TEXT NOT NULL,
    nombre       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_torneos_competicion ON torneos(competicion, temporada_id);

  -- id es texto: Dimayor usa números (186219) o textos para fases por grupos ("group-FASE+II+...-186614").
  CREATE TABLE IF NOT EXISTS fases (
    id        TEXT PRIMARY KEY,
    torneo_id INTEGER NOT NULL REFERENCES torneos(id),
    nombre    TEXT NOT NULL,
    jornadas  INTEGER NOT NULL DEFAULT 0,
    orden     INTEGER NOT NULL DEFAULT 0  -- posición cronológica (los IDs de Dimayor no siguen el orden)
  );

  -- rama separa equipos homónimos: "Atlético Nacional" masculino y femenino son equipos distintos.
  CREATE TABLE IF NOT EXISTS equipos (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    rama   TEXT NOT NULL,
    escudo TEXT,
    UNIQUE (nombre, rama)
  );

  -- "clave" identifica el partido aunque Dimayor aún no le haya asignado ID (partidos programados).
  CREATE TABLE IF NOT EXISTS partidos (
    clave           TEXT PRIMARY KEY,
    api_id          TEXT,
    torneo_id       INTEGER NOT NULL REFERENCES torneos(id),
    fase_id         TEXT NOT NULL REFERENCES fases(id),
    grupo           TEXT,
    jornada         INTEGER NOT NULL,
    fecha           TEXT,
    hora            TEXT,
    local_id        INTEGER NOT NULL REFERENCES equipos(id),
    visitante_id    INTEGER NOT NULL REFERENCES equipos(id),
    goles_local     INTEGER,
    goles_visitante INTEGER,
    estado          TEXT,
    estadio         TEXT,
    canales         TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ "nombre": "Win+ Fútbol", "logo": "https://..." }]
    actualizado     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_partidos_torneo ON partidos(torneo_id, fase_id, jornada);
  CREATE INDEX IF NOT EXISTS idx_partidos_fecha ON partidos(fecha);

  -- tipo: 'posiciones' (por fase y grupo) o 'reclasificacion' (acumulado del año, fase_id = '')
  CREATE TABLE IF NOT EXISTS tablas (
    torneo_id INTEGER NOT NULL,
    fase_id   TEXT NOT NULL,
    tipo      TEXT NOT NULL,
    grupo     TEXT NOT NULL DEFAULT '',
    posicion  INTEGER, equipo_id INTEGER NOT NULL REFERENCES equipos(id),
    puntos INTEGER, jugados INTEGER, ganados INTEGER, empatados INTEGER, perdidos INTEGER,
    goles_favor INTEGER, goles_contra INTEGER, diferencia INTEGER,
    PRIMARY KEY (torneo_id, fase_id, tipo, grupo, equipo_id)
  );

  CREATE TABLE IF NOT EXISTS goleadores (
    torneo_id  INTEGER NOT NULL,
    jugador_id TEXT NOT NULL,
    posicion INTEGER, jugador TEXT, foto TEXT, equipo TEXT, goles INTEGER, jugados INTEGER,
    PRIMARY KEY (torneo_id, jugador_id)
  );

  CREATE TABLE IF NOT EXISTS descenso (
    torneo_id INTEGER NOT NULL,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id),
    posicion INTEGER, por_anio TEXT, jugados INTEGER, puntos INTEGER, promedio REAL,
    PRIMARY KEY (torneo_id, equipo_id)
  );

  -- ===== Detalle de partidos (API REST de Dimayor / COMET) =====
  -- Tablas añadidas sin cambiar VERSION_ESQUEMA: se crean en bases existentes sin borrar datos.

  -- Control de qué partidos ya tienen detalle. estado: 'ok' | 'sin_datos'
  CREATE TABLE IF NOT EXISTS detalles (
    api_id      TEXT PRIMARY KEY,
    estado      TEXT NOT NULL,
    recolectado TEXT NOT NULL
  );

  -- Personas (jugadores y cuerpo técnico) con el ID de COMET, estable entre temporadas y equipos.
  CREATE TABLE IF NOT EXISTS personas (
    id           INTEGER PRIMARY KEY,
    nombre       TEXT,
    nombre_corto TEXT,
    fifa_id      TEXT,
    foto         TEXT
  );

  CREATE TABLE IF NOT EXISTS alineaciones (
    api_id     TEXT NOT NULL,
    persona_id INTEGER NOT NULL REFERENCES personas(id),
    equipo_id  INTEGER NOT NULL REFERENCES equipos(id),
    es_local   INTEGER NOT NULL,
    titular    INTEGER NOT NULL,
    capitan    INTEGER NOT NULL,
    posicion   TEXT,   -- COMET solo marca 'G' (arquero); el resto viene vacío
    dorsal     INTEGER,
    PRIMARY KEY (api_id, persona_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alineaciones_persona ON alineaciones(persona_id);

  CREATE TABLE IF NOT EXISTS tecnicos (
    api_id     TEXT NOT NULL,
    persona_id INTEGER NOT NULL REFERENCES personas(id),
    equipo_id  INTEGER NOT NULL REFERENCES equipos(id),
    es_local   INTEGER NOT NULL,
    rol        TEXT,   -- 'Head Coach', 'Assistant Coach', 'Physical trainer'…
    PRIMARY KEY (api_id, persona_id)
  );

  -- tipo: GOAL, PENALTY, YELLOW, SECOND_YELLOW, RED, EXPULSION, SUBSTITUTION, START, END, FULL_TIME…
  CREATE TABLE IF NOT EXISTS eventos (
    id             INTEGER PRIMARY KEY,   -- eventId de COMET
    api_id         TEXT NOT NULL,
    tipo           TEXT NOT NULL,
    periodo        TEXT,
    minuto         INTEGER,
    minuto_periodo INTEGER,
    adicion        INTEGER,
    es_local       INTEGER,
    equipo_id      INTEGER REFERENCES equipos(id),
    persona_id     INTEGER REFERENCES personas(id),   -- en cambios: el que ENTRA; en autogoles: quien lo hizo
    persona2_id    INTEGER REFERENCES personas(id),   -- en cambios: el que SALE
    orden          INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_eventos_partido ON eventos(api_id);
  CREATE INDEX IF NOT EXISTS idx_eventos_persona ON eventos(persona_id, tipo);

  -- rol: central, asistente1, asistente2, cuarto, var, avar
  CREATE TABLE IF NOT EXISTS arbitros (
    api_id TEXT NOT NULL,
    rol    TEXT NOT NULL,
    nombre TEXT NOT NULL,
    PRIMARY KEY (api_id, rol)
  );
  CREATE INDEX IF NOT EXISTS idx_arbitros_nombre ON arbitros(nombre, rol);

  CREATE INDEX IF NOT EXISTS idx_partidos_api ON partidos(api_id);

  CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );
`);
db.exec(`PRAGMA user_version = ${VERSION_ESQUEMA}`);

// Ejecuta fn dentro de una transacción.
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getMeta(clave) {
  const row = db.prepare('SELECT valor FROM meta WHERE clave = ?').get(clave);
  return row ? JSON.parse(row.valor) : null;
}

export function setMeta(clave, valor) {
  db.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, JSON.stringify(valor));
}
