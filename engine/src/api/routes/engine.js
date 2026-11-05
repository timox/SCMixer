import { route } from '../async-route.js';

/** Charge utile de GET /api/state et de l'événement stateChanged. */
export function statePayload(engine, session = engine.session()) {
  return {
    engine: engine.state(),
    sources: session.sources,
    outputs: session.outputs,
  };
}

export function registerEngineRoutes(api, engine) {
  api.get('/state', route((req, res) => res.json(statePayload(engine))));
  api.get('/engine', route((req, res) => res.json(engine.state())));
  api.post('/engine/start', route(async (req, res) => res.json(await engine.start())));
  api.post('/engine/stop', route(async (req, res) => res.json(await engine.stop())));
  api.post('/engine/restart', route(async (req, res) => res.json(await engine.restart())));
  api.get('/engine/runtime', route((req, res) => res.json(engine.runtime())));
  api.get('/engine/node-tree', route(async (req, res) => res.json(await engine.nodeTree())));
}
