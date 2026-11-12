import express from 'express';
import { config } from './config.js';
import { api } from './routes/api.js';
import { recolectar } from './collector.js';
import { recolectarDetalles } from './detalles.js';
import { getMeta } from './db/database.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

app.get('/', (req, res) => res.redirect('/api'));
app.use('/api', api);
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}/api`);
});

// Recolección automática periódica: torneos activos de todas las competiciones y, después,
// el detalle (eventos, alineaciones, árbitros) de los partidos que terminaron desde la última vez.
if (config.scrapeIntervalMin > 0) {
  const correr = async () => {
    try {
      await recolectar();
      await recolectarDetalles();
    } catch (err) {
      console.error('[recolector] Error:', err.message);
    }
  };
  if (!getMeta('ultima_recoleccion')) correr(); // primera vez: llenar la base al arrancar
  setInterval(correr, config.scrapeIntervalMin * 60 * 1000);
  console.log(`Recolección automática cada ${config.scrapeIntervalMin} minutos`);
}
