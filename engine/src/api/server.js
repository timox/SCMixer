import express from 'express';
import { WebSocketServer } from 'ws';
import { ApiError } from '../contract/errors.js';
import { registerEngineRoutes, statePayload } from './routes/engine.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerOutputRoutes } from './routes/outputs.js';
import { registerParameterRoutes } from './routes/parameters.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerBenchRoutes } from './routes/benches.js';

const notFound = (req) => new ApiError('NOT_FOUND', 404, `Route inconnue : ${req.method} ${req.path}.`);

/**
 * Serveur HTTP + WebSocket du moteur. `engine` est l'unique point d'accès à la session ;
 * `presets` est réservé aux routes de presets.
 */
export function createServer({ engine, presets }) {
  const app = express();
  app.disable('x-powered-by');
  const api = express.Router();
  api.use(express.json());
  registerEngineRoutes(api, engine);
  registerSourceRoutes(api, engine);
  registerOutputRoutes(api, engine);
  registerParameterRoutes(api);
  registerPresetRoutes(api, engine, presets);
  registerBenchRoutes(api, engine);
  app.use('/api', api);

  app.use((req, res, next) => next(notFound(req)));
  // Express reconnaît un gestionnaire d'erreurs à ses quatre paramètres.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    let status;
    let body;
    if (err instanceof ApiError) {
      status = err.status;
      body = { code: err.code, message: err.message };
    } else if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      status = 400;
      body = { code: 'VALIDATION', message: 'Corps de requête JSON invalide.' };
    } else {
      console.error('Erreur interne :', err);
      status = 500;
      body = { code: 'INTERNAL', message: 'Erreur interne du moteur ; consulter le journal du service.' };
    }
    res.status(status).json({ error: body });
  });

  /** Routes enregistrées sous /api : [{ method, path }] (chemins complets, paramètres `:nom`). */
  const routes = () => api.stack.filter((l) => l.route).flatMap((l) => (
    Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: `/api${l.route.path}` }))));

  function attachWebSocket(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/api/ws' });
    const send = (type, data) => {
      const text = JSON.stringify({ type, data });
      for (const client of wss.clients) if (client.readyState === 1) client.send(text);
    };
    const handlers = {
      session: ({ session }) => send('stateChanged', statePayload(engine, session)),
      state: (state) => send('engineStateChanged', state),
      runtime: (event) => send('engineRuntimeChanged', event.data),
      meter: (event) => send(event.type, event.data),
      log: (line) => send('engineLog', line),
    };
    for (const [name, handler] of Object.entries(handlers)) engine.on(name, handler);
    wss.on('connection', (ws) => {
      ws.on('error', (e) => { console.error('Erreur client WebSocket :', e.message); ws.terminate(); });
      ws.send(JSON.stringify({ type: 'stateChanged', data: statePayload(engine) }));
    });
    wss.on('error', (e) => console.error('Erreur serveur WebSocket :', e.message));
    wss.on('close', () => {
      for (const [name, handler] of Object.entries(handlers)) engine.off(name, handler);
    });
    return wss;
  }

  return { app, routes, attachWebSocket, presets };
}
