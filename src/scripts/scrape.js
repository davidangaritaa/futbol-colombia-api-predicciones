// Recolección manual desde la terminal.
//   npm run scrape                  -> torneo activo de la temporada actual
//   npm run scrape -- --todo        -> todos los torneos de la temporada actual
//   npm run scrape -- --anio 2025   -> todos los torneos de 2025
import { parseArgs } from 'node:util';
import { recolectar } from '../collector.js';

const { values } = parseArgs({
  options: {
    anio: { type: 'string' },
    todo: { type: 'boolean', default: false },
  },
});

try {
  // Pedir un año concreto implica recolectar todos sus torneos.
  await recolectar({ anio: values.anio, todo: values.todo || Boolean(values.anio) });
} catch (err) {
  console.error('Error:', err.message);
  process.exitCode = 1;
}
