/**
 * Règle de nommage des contrôles de SynthDef (voir l'en-tête de sc/graph.scd et openapi.yaml).
 *
 * Un contrôle de SynthDef porte exactement le nom du champ du contrat. Lorsqu'une SynthDef porte
 * plusieurs objets du contrat (groupes), le nom est préfixé par le groupe : `<groupe><Champ>`
 * (première lettre du champ en majuscule). Il n'existe aucune table de correspondance : la règle
 * est ce seul calcul, et tests/parameters.test.js la compare aux SynthDefs construites par sclang.
 *
 * Les champs `model` et `inserted` sont structurels : ils choisissent la SynthDef et sa présence dans le graphe.
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

/** Objets de sortie : base composite fixe ou SynthDef d'insert selon l'étage. */
export const OUTPUT_GROUPS = Object.freeze(['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'compressor', 'limiter']);

export function controlName(prefixed, group, field) {
  return prefixed ? `${group}${field[0].toUpperCase()}${field.slice(1)}` : field;
}

function flatten(prefixed, group, object) {
  const out = {};
  for (const [field, value] of Object.entries(object)) {
    if (prefixed && field === 'inserted') continue;
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

/** Champs d'un étage de sortie -> noms préfixés ; les inserts reçoivent uniquement les contrôles de leur étape. */
export function outputControls(stage, object) {
  if (!OUTPUT_GROUPS.includes(stage)) throw new Error(`Étage de sortie inconnu : ${stage}`);
  return flatten(true, stage, object);
}
