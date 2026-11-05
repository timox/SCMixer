import { ApiError } from './errors.js';

const OUTPUTS = ['master', 'cue'];

/**
 * Refuse un modèle de compression indisponible (aucun remplacement silencieux).
 * `sessionOrOutputs` : une session (`.outputs`) ou directement `{ master?, cue? }`.
 */
export function assertModelsAvailable(sessionOrOutputs, models) {
  const outputs = sessionOrOutputs?.outputs ?? sessionOrOutputs ?? {};
  for (const name of OUTPUTS) {
    const model = outputs[name]?.compressor?.model;
    if (model !== undefined && models?.[model] !== true) {
      throw new ApiError('MODEL_UNAVAILABLE', 409, `Le modèle de compression ${model} (sortie ${name}) n'est pas disponible ; état inchangé.`);
    }
  }
}
