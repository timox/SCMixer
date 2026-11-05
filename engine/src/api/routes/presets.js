import { route } from '../async-route.js';
import { PresetCreate } from '../../contract/schemas.js';
import { assertModelsAvailable } from '../../contract/models.js';
import { parse, applyPreset } from '../../session/session-model.js';
import { applyPresetCode } from '../../sc/commands.js';
import { statePayload } from './engine.js';

/**
 * Presets : instantanés complets de la session (sources, réglages, Master, Cue).
 * L'application remplace toute la session en une seule mutation ; le contenu est validé
 * (canaux à la lecture du fichier, modèles disponibles ici) avant tout code sclang.
 */
export function registerPresetRoutes(api, engine, presets) {
  api.get('/presets', route((req, res) => res.json(presets.list())));

  api.post('/presets', route((req, res) => {
    const { name } = parse(PresetCreate, req.body, 'Preset');
    const { id, createdAt } = presets.create(name, engine.session());
    res.status(201).json({ id, name, createdAt });
  }));

  api.delete('/presets/:id', route((req, res) => {
    presets.remove(req.params.id);
    res.status(204).end();
  }));

  api.post('/presets/:id/apply', route(async (req, res) => {
    const { content } = presets.get(req.params.id);
    const session = await engine.mutate((current, { meterIdFor }) => {
      const next = applyPreset(current, content);
      assertModelsAvailable(next, engine.state().models);
      return { session: next, code: applyPresetCode(current, next, meterIdFor) };
    });
    res.json(statePayload(engine, session));
  }));
}
