// Descarga el detalle (eventos, alineaciones, árbitros) de los partidos finalizados que aún no lo tienen.
//   npm run detalles                          -> todos los pendientes (la primera vez tarda ~2 h)
//   npm run detalles -- --limite 100          -> como máximo 100 partidos
//   npm run detalles -- --anio 2026           -> solo una temporada
//   npm run detalles -- --competicion liga    -> solo una competición (se puede repetir)
// Se puede interrumpir con Ctrl+C: la próxima vez continúa donde quedó.
import { parseArgs } from 'node:util';
import { recolectarDetalles } from '../detalles.js';

const { values } = parseArgs({
  options: {
    limite: { type: 'string' },
    anio: { type: 'string' },
    competicion: { type: 'string', multiple: true },
  },
});

try {
  await recolectarDetalles({ limite: values.limite, anio: values.anio, competiciones: values.competicion });
} catch (err) {
  console.error('Error:', err.message);
  process.exitCode = 1;
}
