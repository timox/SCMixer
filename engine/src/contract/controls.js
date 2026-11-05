/**
 * Règle de nommage des contrôles de SynthDef (voir l'en-tête de sc/graph.scd et openapi.yaml).
 *
 * Un contrôle de SynthDef porte exactement le nom du champ du contrat. Lorsqu'une SynthDef porte
 * plusieurs objets du contrat (groupes), le nom est préfixé par le groupe : `<groupe><Champ>`
 * (première lettre du champ en majuscule). Il n'existe aucune table de correspondance : la règle
 * est ce seul calcul, et tests/parameters.test.js la compare aux SynthDefs construites par sclang.
 *
 * Le champ `model` n'est pas un contrôle : il choisit la SynthDef (opération de structure).
 */

/** Groupes du contrat portés par chaque SynthDef de source. */
export const SOURCE_SYNTH_GROUPS = Object.freeze({
  in: ['input', 'inputCompressor'],
  eq: ['eq'],
  hp: ['hp'],
  lp: ['lp'],
  pitch: ['pitch'],
  dyn: ['low', 'mid', 'high', 'crossover'],
  mix: ['mix'],
});

/** Groupes portés par la SynthDef de traitement de sortie (un seul synth par sortie). */
export const OUTPUT_GROUPS = Object.freeze(['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor']);

export function controlName(prefixed, group, field) {
  return prefixed ? `${group}${field[0].toUpperCase()}${field.slice(1)}` : field;
}

function flatten(prefixed, group, object) {
  const out = {};
  for (const [field, value] of Object.entries(object)) {
    out[field === 'model' ? 'model' : controlName(prefixed, group, field)] = value;
  }
  return out;
}

/** Champs d'un objet de source (étage ou groupe de bandCompressor) -> noms de contrôles. */
export function sourceControls(group, object) {
  const synth = Object.keys(SOURCE_SYNTH_GROUPS).find((key) => SOURCE_SYNTH_GROUPS[key].includes(group));
  if (!synth) throw new Error(`Groupe de source inconnu : ${group}`);
  return flatten(SOURCE_SYNTH_GROUPS[synth].length > 1, group, object);
}

/** Champs d'un étage de sortie -> noms de contrôles (préfixés : un seul synth porte tous les étages). */
export function outputControls(stage, object) {
  if (!OUTPUT_GROUPS.includes(stage)) throw new Error(`Étage de sortie inconnu : ${stage}`);
  return flatten(true, stage, object);
}
