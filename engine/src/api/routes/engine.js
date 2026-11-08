import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import { assertModelsAvailable } from '../../contract/models.js';
import { resetAllProcessing } from '../../session/session-model.js';
import { sourceProcessingCode, outputCode } from '../../sc/commands.js';

/** Charge utile de GET /api/state et de l'événement stateChanged. */
export function statePayload(engine, session = engine.session()) {
  return {
    engine: engine.state(),
    sources: session.sources,
    outputs: session.outputs,
    outputChannels: session.outputChannels,
    recording: engine.recorder.state(),
  };
}

export function registerEngineRoutes(api, engine) {
  api.get('/state', route((req, res) => res.json(statePayload(engine))));
  api.get('/engine', route((req, res) => res.json(engine.state())));
  api.post('/engine/start', route(async (req, res) => res.json(await engine.start())));
  api.post('/engine/stop', route(async (req, res) => res.json(await engine.stop())));
  api.post('/engine/restart', route(async (req, res) => res.json(await engine.restart())));
  api.get('/engine/log', route((req, res) => {
    const { after = '0' } = req.query;
    if (typeof after !== 'string' || !/^(0|[1-9][0-9]*)$/.test(after)) {
      throw new ApiError('VALIDATION', 400, 'Paramètre after invalide : entier positif ou nul attendu.');
    }
    res.json(engine.log(Number(after)));
  }));
  api.post('/processing/reset', route(async (req, res) => {
    const session = await engine.mutate((current) => {
      const next = resetAllProcessing(current);
      assertModelsAvailable(next, engine.state().models);
      const code = [
        ...next.sources.map((s) => sourceProcessingCode(s.id, s.processing)),
        outputCode('master', next.outputs.master),
        outputCode('cue', next.outputs.cue),
      ].join('; ');
      return { session: next, code };
    });
    res.json(statePayload(engine, session));
  }));
  api.get('/engine/runtime', route((req, res) => res.json(engine.runtime())));
  api.get('/engine/node-tree', route(async (req, res) => {
    const { controls } = req.query;
    if (controls !== undefined && controls !== 'true' && controls !== 'false') {
      throw new ApiError('VALIDATION', 400, 'Paramètre controls invalide : true ou false attendu.');
    }
    res.json(await engine.nodeTree({ controls: controls === 'true' }));
  }));
}
