import { STAGE_LABELS } from './descriptors.js';
import { outputSynthDefEntry, synthDefEntry } from './synthdef-catalog.js';

/**
 * Chaînes de traitement publiées par GET /api/sources/{id}/processing-graph et
 * GET /api/outputs/{output}/processing-graph : étages dans l'ordre du signal, libellé, état, modèle et
 * documentation des UGens SuperCollider effectivement utilisés (selon le modèle et la largeur courants).
 */

/** Ordre du signal d'une source (sc/source-defs.scd, sc/graph.scd ~mxCreateSource). */
export const SOURCE_GRAPH_ORDER = ['input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch', 'bandCompressor', 'mix'];

/** Ordre du signal d'une sortie (sc/graph.scd, SynthDef de traitement de sortie). */
export const OUTPUT_GRAPH_ORDER = ['infraHpf', 'sideHpf', 'eq', 'mix', 'clipper', 'compressor', 'limiter'];

/** Page d'aide d'une classe de la bibliothèque standard de SuperCollider. */
export const SC_DOC_BASE = 'https://doc.sccode.org/Classes/';

const doc = (name) => ({ name, url: `${SC_DOC_BASE}${name}.html` });
/** UGen propre au projet (plug-in local) : pas de page d'aide en ligne. */
const localDoc = (name) => ({ name, url: null });

const LAG = doc('Lag');
const EQ_DOCS = [doc('BLowShelf'), doc('BPeakEQ'), doc('BHiShelf'), LAG];

function sourceDocs(stage, settings, width) {
  switch (stage) {
    case 'input': return [doc('SoundIn'), LAG];
    case 'inputCompressor': return [doc('Compander'), LAG];
    case 'eq': return EQ_DOCS;
    case 'hp':
    case 'lp': return [doc(synthDefEntry(stage, settings.model).ugen), LAG];
    case 'pitch': return [doc('PitchShift'), doc('XFade2'), LAG];
    case 'bandCompressor': return [doc('LPF'), doc('HPF'), doc('Compander'), LAG];
    case 'mix':
      if (width === 1) return [doc('Pan2'), LAG];
      if (width === 2) return [doc('Balance2'), LAG];
      return [doc('Splay'), doc('Balance2'), LAG];
    default: throw new Error(`Étage de source sans documentation : ${stage}.`);
  }
}

function outputDocs(stage, settings) {
  switch (stage) {
    case 'infraHpf':
    case 'sideHpf': return [doc('HPF'), LAG];
    case 'eq': return EQ_DOCS;
    case 'mix': return [LAG];
    case 'clipper': return [doc('Clip'), LAG];
    case 'limiter': return [doc('Limiter'), LAG];
    case 'compressor': {
      const entry = outputSynthDefEntry('compressor', settings.model);
      const docs = (entry.implementation || [entry.ugen]).map((ugen) => (
        ugen === 'MixetteFaustRMS' ? localDoc(ugen) : doc(ugen)
      ));
      if (entry.implementation) docs.unshift(doc(entry.ugen));
      return [...docs, LAG];
    }
    default: throw new Error(`Étage de sortie sans documentation : ${stage}.`);
  }
}

function sourceEnabled(stage, settings) {
  switch (stage) {
    case 'inputCompressor': return !settings.bypass;
    case 'hp':
    case 'lp': return settings.enabled;
    // blend = -1 : chemin direct seul (XFade2), la transposition n'agit pas.
    case 'pitch': return settings.blend > -1;
    case 'bandCompressor': return ['low', 'mid', 'high'].some((band) => !settings[band].bypass);
    case 'mix': return !settings.mute;
    default: return true;
  }
}

/** Chaîne d'une source ; un filtre retiré n'a pas de modèle chargé. */
export function sourceGraph(source) {
  return SOURCE_GRAPH_ORDER.map((stage) => {
    const settings = source.processing[stage];
    const requestedModel = stage === 'hp' || stage === 'lp' ? settings.model : null;
    return {
      stage,
      label: STAGE_LABELS.source[stage],
      enabled: (stage === 'hp' || stage === 'lp') ? settings.inserted && settings.enabled : sourceEnabled(stage, settings),
      inserted: stage === 'hp' || stage === 'lp' ? settings.inserted : null,
      requestedModel,
      loadedModel: requestedModel && settings.inserted ? requestedModel : null,
      docs: sourceDocs(stage, settings, source.width),
    };
  });
}

/** Chaîne d'une sortie ; `models` : disponibilité des modèles de compresseur (GET /api/engine). */
export function outputGraph(output, models) {
  return OUTPUT_GRAPH_ORDER.map((stage) => {
    const settings = output[stage];
    const requestedModel = stage === 'compressor' ? settings.model : null;
    const plugin = stage === 'compressor' || stage === 'limiter';
    const inserted = plugin ? settings.inserted : null;
    return {
      stage,
      label: STAGE_LABELS.output[stage],
      enabled: stage === 'compressor' ? inserted && !settings.bypass
        : stage === 'limiter' ? inserted && settings.enabled : (settings.enabled ?? true),
      inserted,
      requestedModel,
      loadedModel: stage === 'limiter' ? (inserted ? 'Limiter' : null)
        : requestedModel && inserted && models[requestedModel] ? requestedModel : null,
      docs: outputDocs(stage, settings),
    };
  });
}
