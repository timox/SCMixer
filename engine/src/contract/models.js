import { ApiError } from './errors.js';

const OUTPUTS = ['master', 'cue'];

/**
 * Refuse un modèle indisponible seulement s'il est inséré ; un insert retiré reste retirable/remplaçable.
 * `sessionOrOutputs` : une session (`.outputs`) ou directement `{ master?, cue? }`.
 */
export function assertModelsAvailable(sessionOrOutputs, models) {
  const outputs = sessionOrOutputs?.outputs ?? sessionOrOutputs ?? {};
  for (const name of OUTPUTS) {
    const compressor = outputs[name]?.compressor;
    const model = compressor?.model;
    if (compressor?.inserted !== false && model !== undefined && models?.[model] !== true) {
      throw new ApiError('MODEL_UNAVAILABLE', 409, `Le modèle de compression ${model} (sortie ${name}) n'est pas disponible ; état inchangé.`);
    }
  }
}
