// Detalle de un partido jugado: eventos (goles, tarjetas, cambios), alineaciones y árbitros.
// Viene de la API REST de Dimayor (datos del sistema COMET de la FCF), en JSON.
//   /matches/{apiId}/events     /matches/{apiId}/lineups     /matches/{apiId}/officials
// El apiId es el data-match-api-id de cada partido (columna partidos.api_id).
import { rest } from './client.js';

const jugador = (p) => (p?.personId ? {
  id: p.personId,
  nombre: p.name ?? null,
  nombreCorto: p.shortName ?? null,
  fifaId: p.fifaId ?? null,
  foto: p.picture ?? null,
} : null);

// Rol del árbitro en COMET -> clave propia.
const ROLES_ARBITRO = {
  referee: 'central',
  assistantrefereeone: 'asistente1',
  assistantrefereetwo: 'asistente2',
  fourthofficial: 'cuarto',
  videoassistantreferee: 'var',
  assistantvideoassistantreferee: 'avar',
};

export function parseEventos(data) {
  if (!Array.isArray(data)) return [];
  return data.map((e) => ({
    id: e.eventId ?? null,
    tipo: e.eventType?.fcdName ?? null,            // GOAL, PENALTY, YELLOW, SECOND_YELLOW, RED, EXPULSION, SUBSTITUTION, START, END, FULL_TIME…
    periodo: e.matchPhase?.fcdName ?? null,        // FIRST_HALF, SECOND_HALF…
    minuto: e.minuteFull ?? null,                  // minuto del partido (46 = minuto 1 del segundo tiempo)
    minutoPeriodo: e.minute ?? null,
    adicion: e.stoppageTime ?? 0,                  // minutos de tiempo añadido (45+2 -> 2)
    esLocal: typeof e.homeTeam === 'boolean' ? e.homeTeam : null,
    // En cambios (SUBSTITUTION), player es el que ENTRA y player2 el que SALE
    // (verificado: en 237 de 237 cambios, player era suplente y player2 titular).
    jugador: jugador(e.player),
    jugador2: jugador(e.player2),
    orden: e.orderNumber ?? null,
  })).filter((e) => e.id && e.tipo);
}

export function parseAlineaciones(data) {
  const jugadores = [];
  const tecnicos = [];
  for (const [lado, esLocal] of [['home', true], ['away', false]]) {
    for (const p of data?.[lado]?.players ?? []) {
      if (!p.personId) continue;
      jugadores.push({
        jugador: jugador(p), esLocal,
        titular: Boolean(p.starting), capitan: Boolean(p.captain),
        posicion: p.position ?? null, dorsal: p.shirtNumber ?? null,
      });
    }
    for (const o of data?.[lado]?.officials ?? []) {
      if (!o.personId) continue;
      tecnicos.push({ persona: jugador(o), esLocal, rol: o.role ?? null });
    }
  }
  return { jugadores, tecnicos };
}

export function parseArbitros(data) {
  if (!data) return [];
  if (Array.isArray(data.all_officials) && data.all_officials.length) {
    return data.all_officials
      .filter((o) => o.name)
      .map((o) => ({ rol: ROLES_ARBITRO[String(o.role ?? '').toLowerCase()] ?? o.role ?? 'otro', nombre: o.name }));
  }
  return Object.entries(data)
    .filter(([clave, v]) => ROLES_ARBITRO[clave.toLowerCase()] && v?.name)
    .map(([clave, v]) => ({ rol: ROLES_ARBITRO[clave.toLowerCase()], nombre: v.name }));
}

export async function getDetallePartido(apiId) {
  const eventos = parseEventos(await rest(`/matches/${apiId}/events`));
  const { jugadores, tecnicos } = parseAlineaciones(await rest(`/matches/${apiId}/lineups`));
  const arbitros = parseArbitros(await rest(`/matches/${apiId}/officials`));
  return { eventos, jugadores, tecnicos, arbitros };
}
