// Convierte el HTML que devuelve Dimayor en objetos JavaScript.
import * as cheerio from 'cheerio';

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const int = (txt) => {
  const n = parseInt(String(txt).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};
const clean = (txt) => String(txt ?? '').replace(/\s+/g, ' ').trim();
const absUrl = (url) => (url ? url.replace(/^http:\/\//, 'https://') : null);

// "SÁBADO, 7 DE NOVIEMBRE DE 2026" -> "2026-11-07"
export function parseFechaEs(texto) {
  const m = clean(texto).toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/);
  if (!m || !MESES[m[2]]) return null;
  return `${m[3]}-${String(MESES[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Tabla de posiciones y tabla de reclasificación (misma estructura).
export function parseTablaPosiciones(html) {
  const $ = cheerio.load(html);
  return $('table.dimayor-table tbody tr').map((_, tr) => {
    const td = (cls) => $(tr).find(`td.${cls}`);
    const stats = td('col-stat').map((_, el) => int($(el).text())).get(); // PJ PG PE PP GF GC
    return {
      posicion: int(td('col-pos').text()),
      equipo: clean(td('col-team').find('.team-name-small').text()),
      escudo: absUrl(td('col-team').find('img').attr('src')),
      puntos: int(td('col-pts').text()),
      jugados: stats[0], ganados: stats[1], empatados: stats[2], perdidos: stats[3],
      golesFavor: stats[4], golesContra: stats[5],
      diferencia: int(td('col-dg').text()),
    };
  }).get().filter((r) => r.equipo);
}

// Partidos de una jornada. Los partidos vienen agrupados bajo encabezados de fecha.
export function parsePartidos(html) {
  const $ = cheerio.load(html);
  const partidos = [];
  let fecha = null;

  $('.fixture-wrapper').children().each((_, el) => {
    const $el = $(el);
    if ($el.is('h4.fixture-date-header')) { fecha = parseFechaEs($el.text()); return; }
    if (!$el.is('.match-card')) return;

    const $score = $el.find('.match-card__score');
    const marcador = clean($score.text()).match(/^(\d+)\s*-\s*(\d+)$/);
    const estado = ($score.attr('class') ?? '').replace('match-card__score', '').trim() || null;
    const detalles = $el.find('.match-card__detail').not('.channel-logo');

    partidos.push({
      apiId: $el.find('[data-match-api-id]').attr('data-match-api-id') ?? null,
      fecha,
      hora: clean($el.find('.match-card__time').text()) || null,
      local: clean($el.find('.team--home .team__name').text()),
      localEscudo: absUrl($el.find('.team--home img').attr('src')),
      visitante: clean($el.find('.team--away .team__name').text()),
      visitanteEscudo: absUrl($el.find('.team--away img').attr('src')),
      golesLocal: marcador ? Number(marcador[1]) : null,
      golesVisitante: marcador ? Number(marcador[2]) : null,
      estado,
      estadio: clean(detalles.first().find('span').text()) || null,
    });
  });
  return partidos.filter((p) => p.local && p.visitante);
}

export function parseGoleadores(html) {
  const $ = cheerio.load(html);
  return $('table.dimayor-table tbody tr').map((_, tr) => {
    const tds = $(tr).find('td');
    return {
      jugadorId: $(tr).attr('data-player-id') ?? null,
      posicion: int(tds.eq(0).text()),
      jugador: clean(tds.eq(1).find('.team-name-small').text()),
      foto: absUrl(tds.eq(1).find('img').attr('src')),
      equipo: clean(tds.eq(2).text()),
      goles: int(tds.eq(3).text()),
      jugados: int(tds.eq(4).text()),
    };
  }).get().filter((g) => g.jugador);
}

// Tabla del descenso: puntos y partidos de las últimas 3 temporadas + promedio.
export function parseDescenso(html) {
  const $ = cheerio.load(html);
  const anios = $('table.dimayor-table th.year-header').map((_, th) => int($(th).text())).get();

  return $('table.dimayor-table tbody tr').map((_, tr) => {
    const tds = $(tr).find('td');
    const nums = tds.slice(2).map((_, td) => clean($(td).text())).get();
    const porAnio = anios.map((anio, i) => ({ anio, jugados: int(nums[i * 2]), puntos: int(nums[i * 2 + 1]) }));
    const base = anios.length * 2;
    return {
      posicion: int(tds.eq(0).text()),
      equipo: clean(tds.eq(1).find('.team-name-small').text()),
      escudo: absUrl(tds.eq(1).find('img').attr('src')),
      porAnio,
      jugados: int(nums[base]),
      puntos: int(nums[base + 1]),
      promedio: Number(String(nums[base + 2] ?? '').replace(',', '.')) || 0,
    };
  }).get().filter((r) => r.equipo);
}
