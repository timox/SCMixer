import { z } from 'zod';
import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import { RecordingStart } from '../../contract/schemas.js';
import { parse } from '../../session/session-model.js';

const EmptyBody = z.strictObject({});

/** Enregistrement WAV de la sortie Master : chaque commande répond par l'état d'enregistrement. */
export function registerRecordingRoutes(api, engine) {
  const recorder = engine.recorder;
  const requireRunning = () => {
    if (engine.state().status !== 'running') throw new ApiError('ENGINE_NOT_RUNNING', 409, 'Le moteur n\'est pas démarré.');
  };
  api.get('/recording', route((req, res) => res.json(recorder.state())));
  api.post('/recording/start', route(async (req, res) => {
    const { sampleFormat } = parse(RecordingStart, req.body, 'Enregistrement');
    requireRunning();
    res.json(await recorder.start(sampleFormat));
  }));
  for (const action of ['pause', 'resume', 'stop']) {
    api.post(`/recording/${action}`, route(async (req, res) => {
      parse(EmptyBody, req.body ?? {}, 'Corps');
      res.json(await recorder[action]());
    }));
  }
}
