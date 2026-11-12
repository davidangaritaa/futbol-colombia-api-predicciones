// Recolección manual desde la terminal.
//   npm run scrape                              -> torneos activos de todas las competiciones
//   npm run scrape -- --todo                    -> todos los torneos de la temporada actual
//   npm run scrape -- --anio 2025               -> todos los torneos de 2025
//   npm run scrape -- --competicion femenina    -> solo una competición (se puede repetir)
//
// Competiciones: liga, torneo, femenina, copa, superliga
import { parseArgs } from 'node:util';
import { recolectar } from '../collector.js';

const { values } = parseArgs({
  options: {
    anio: { type: 'string' },
    todo: { type: 'boolean', default: false },
    competicion: { type: 'string', multiple: true },
  },
});

try {
  // Pedir un año concreto implica recolectar todos sus torneos.
  await recolectar({
    anio: values.anio,
    todo: values.todo || Boolean(values.anio),
    competiciones: values.competicion,
  });
} catch (err) {
  console.error('Error:', err.message);
  process.exitCode = 1;
}
