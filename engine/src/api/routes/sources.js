import { SOURCE_STAGES, BAND_GROUPS } from '../../contract/schemas.js';
import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import {
  addSource, patchSource, removeSource, setSourceStage, setSourceBand, resetSourceStage,
} from '../../session/session-model.js';
import {
  addSourceCode, replaceSourceCode, removeSourceCode, setSourceStageCode, setSourceBandCode, resetMoogCode,
} from '../../sc/commands.js';
import { sourceGraph } from '../../contract/chains.js';

/** Instruction sclang sans effet : une mutation de métadonnées ne touche pas le graphe audio. */
const NO_OP = 'nil';

const find = (session, id) => {
  const source = session.sources.find((s) => s.id === id);
  if (!source) throw new ApiError('NOT_FOUND', 404, `Source inconnue : ${id}.`);
  return source;
};

const known = (list, value, what) => {
  if (!list.includes(value)) throw new ApiError('NOT_FOUND', 404, `${what} inconnu : ${value}.`);
};

const sourceOf = (session, id) => structuredClone(find(session, id));

export function registerSourceRoutes(api, engine) {
  api.get('/sources', route((req, res) => res.json(engine.session().sources)));

  api.post('/sources', route(async (req, res) => {
    let created;
    const session = await engine.mutate((current, { meterIdFor }) => {
      const result = addSource(current, req.body);
      created = result.source;
      return { session: result.session, code: addSourceCode(created, meterIdFor(created.id)) };
    });
    res.status(201).json(sourceOf(session, created.id));
  }));

  api.get('/sources/:id', route((req, res) => res.json(sourceOf(engine.session(), req.params.id))));

  api.get('/sources/:id/processing-graph', route((req, res) => res.json(sourceGraph(find(engine.session(), req.params.id)))));

  api.patch('/sources/:id', route(async (req, res) => {
    const { id } = req.params;
    const session = await engine.mutate((current, { meterIdFor }) => {
      const before = find(current, id);
      const next = patchSource(current, id, req.body);
      const after = find(next, id);
      const moved = before.firstChannel !== after.firstChannel || before.width !== after.width;
      // ~mxReplaceSource construit d'abord les SynthDefs de la nouvelle largeur (jusqu'à environ 9 s pour 256, l'ancienne chaîne reste audible),
      // puis fait descendre l'ancienne chaîne et monter la nouvelle dans un seul bundle.
      const code = moved ? replaceSourceCode(after, meterIdFor(id)) : NO_OP;
      return { session: next, code };
    });
    res.json(sourceOf(session, id));
  }));

  api.delete('/sources/:id', route(async (req, res) => {
    const { id } = req.params;
    await engine.mutate((current) => ({ session: removeSource(current, id), code: removeSourceCode(id) }));
    res.status(204).end();
  }));

  // Routes littérales avant la route à paramètre `:stage`.
  api.put('/sources/:id/processing/bandCompressor/:band', route(async (req, res) => {
    const { id, band } = req.params;
    known(BAND_GROUPS, band, 'Bande');
    const session = await engine.mutate((current) => {
      const next = setSourceBand(current, id, band, req.body);
      return { session: next, code: setSourceBandCode(id, band, find(next, id).processing.bandCompressor[band]) };
    });
    res.json(sourceOf(session, id));
  }));

  for (const stage of ['hp', 'lp']) {
    api.post(`/sources/:id/processing/${stage}/reset`, route(async (req, res) => {
      const { id } = req.params;
      const session = await engine.mutate((current) => {
        const next = resetSourceStage(current, id, stage);
        return { session: next, code: setSourceStageCode(id, stage, find(next, id).processing[stage]) };
      });
      res.json(sourceOf(session, id));
    }));
  }

  api.post('/sources/:id/processing/lp/reset-state', route(async (req, res) => {
    const { id } = req.params;
    const session = await engine.mutate((current) => {
      if (find(current, id).processing.lp.model !== 'MoogFF') {
        throw new ApiError('VALIDATION', 400, 'La réinitialisation d\'état ne concerne que le modèle MoogFF.');
      }
      return { session: current, code: resetMoogCode(id) };
    });
    res.json(sourceOf(session, id));
  }));

  api.put('/sources/:id/processing/:stage', route(async (req, res) => {
    const { id, stage } = req.params;
    known(SOURCE_STAGES, stage, 'Étage de source');
    const session = await engine.mutate((current) => {
      const next = setSourceStage(current, id, stage, req.body);
      return { session: next, code: setSourceStageCode(id, stage, find(next, id).processing[stage]) };
    });
    res.json(sourceOf(session, id));
  }));
}
