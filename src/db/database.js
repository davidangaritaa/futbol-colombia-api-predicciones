// Base de datos SQLite usando el módulo integrado de Node (node:sqlite), sin dependencias nativas.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS temporadas (
    id   INTEGER PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS torneos (
    id           INTEGER PRIMARY KEY,
    temporada_id INTEGER NOT NULL REFERENCES temporadas(id),
    nombre       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fases (
    id        INTEGER PRIMARY KEY,
    torneo_id INTEGER NOT NULL REFERENCES torneos(id),
    nombre    TEXT NOT NULL,
    jornadas  INTEGER NOT NULL DEFAULT 0,
    orden     INTEGER NOT NULL DEFAULT 0  -- posición de la fase en el torneo (los IDs de Dimayor no siguen el orden)
  );

  CREATE TABLE IF NOT EXISTS equipos (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    escudo TEXT
  );

  -- "clave" identifica el partido aunque Dimayor aún no le haya asignado ID (partidos programados).
  CREATE TABLE IF NOT EXISTS partidos (
    clave           TEXT PRIMARY KEY,
    api_id          TEXT,
    torneo_id       INTEGER NOT NULL REFERENCES torneos(id),
    fase_id         INTEGER NOT NULL REFERENCES fases(id),
    jornada         INTEGER NOT NULL,
    fecha           TEXT,
    hora            TEXT,
    local_id        INTEGER NOT NULL REFERENCES equipos(id),
    visitante_id    INTEGER NOT NULL REFERENCES equipos(id),
    goles_local     INTEGER,
    goles_visitante INTEGER,
    estado          TEXT,
    estadio         TEXT,
    actualizado     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_partidos_torneo ON partidos(torneo_id, fase_id, jornada);

  -- tipo: 'posiciones' (por fase) o 'reclasificacion' (acumulado del año)
  CREATE TABLE IF NOT EXISTS tablas (
    torneo_id INTEGER NOT NULL,
    fase_id   INTEGER NOT NULL,
    tipo      TEXT NOT NULL,
    posicion  INTEGER, equipo_id INTEGER NOT NULL REFERENCES equipos(id),
    puntos INTEGER, jugados INTEGER, ganados INTEGER, empatados INTEGER, perdidos INTEGER,
    goles_favor INTEGER, goles_contra INTEGER, diferencia INTEGER,
    PRIMARY KEY (torneo_id, fase_id, tipo, equipo_id)
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

  CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );
`);

// Migración para bases creadas antes de existir la columna fases.orden.
if (!db.prepare('PRAGMA table_info(fases)').all().some((c) => c.name === 'orden')) {
  db.exec('ALTER TABLE fases ADD COLUMN orden INTEGER NOT NULL DEFAULT 0');
}

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
