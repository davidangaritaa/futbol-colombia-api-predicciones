// Funciones de alto nivel para consultar Dimayor.
import { ajax, getSession } from './client.js';
import { parseDescenso, parseGoleadores, parsePartidos, parseTablaPosiciones } from './parsers.js';
import { config } from '../config.js';

const tipo = config.competitionType;

export async function getTemporadas() {
  return (await getSession()).seasons; // [{ id, anio }]
}

// Torneo, fase y jornada que Dimayor considera "activos" ahora mismo.
export async function getActivo(seasonId) {
  const data = await ajax('get_active_filters', { season_id: seasonId, competition_type: tipo });
  return { torneoId: data.competition_id, faseId: data.phase_id, jornada: data.matchday };
}

export async function getTorneos(seasonId) {
  const data = await ajax('get_competitions_for_season_ajax_v5', { season_id: seasonId, competition_type: tipo });
  return data.map((c) => ({ id: c.id, nombre: c.name }));
}

export async function getFases(torneoId) {
  const data = await ajax('get_phases_for_competition', { competition_id: torneoId });
  return data.map((f) => ({ id: f.id, nombre: f.name, jornadas: Number(f.matchdays) || 0 }));
}

// type: partidos | posiciones | goleadores | descenso | reclasificacion
async function contenido(type, { torneoId, faseId, jornada = '' }) {
  const data = await ajax('get_dynamic_content_v5', {
    type,
    competition_id: torneoId,
    competition_type: tipo,
    phase_id: faseId,
    matchday: jornada,
    is_live: 0,
    live_provider: 'comet',
  });
  return data?.html ?? '';
}

export const getPartidos = async (q) => parsePartidos(await contenido('partidos', q));
export const getPosiciones = async (q) => parseTablaPosiciones(await contenido('posiciones', q));
export const getReclasificacion = async (q) => parseTablaPosiciones(await contenido('reclasificacion', q));
export const getGoleadores = async (q) => parseGoleadores(await contenido('goleadores', q));
export const getDescenso = async (q) => parseDescenso(await contenido('descenso', q));
