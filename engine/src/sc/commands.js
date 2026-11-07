import { SOURCE_STAGES, OUTPUT_STAGES, BAND_GROUPS, EQ_BENCH_METHODS } from '../contract/schemas.js';
import { sourceControls, outputControls } from '../contract/controls.js';

const OUTPUTS = ['master', 'cue'];
const SOURCE_ID = /^src-\d+$/;
const IDENT = /^[A-Za-z][A-Za-z0-9]*$/;

function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Nombre fini attendu : ${value}`);
  }
  return String(value);
}

function scValue(value) {
  if (typeof value === 'number') return number(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') {
    if (!IDENT.test(value)) throw new Error(`Symbole invalide : ${value}`);
    return `\\${value}`;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return toScEvent(value);
  throw new Error('Valeur non convertible en sclang');
}

export function toScEvent(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Objet attendu');
  }
  const fields = Object.entries(obj).map(([key, value]) => {
    if (!IDENT.test(key)) throw new Error(`Nom de champ invalide : ${key}`);
    return `${key}: ${scValue(value)}`;
  });
  return `(${fields.join(', ')})`;
}

function sourceId(id) {
  if (typeof id !== 'string' || !SOURCE_ID.test(id)) throw new Error(`Identifiant de source invalide : ${id}`);
  return `"${id}"`;
}

function oneOf(list, value, label) {
  if (!list.includes(value)) throw new Error(`${label} inconnu : ${value}`);
  return `\\${value}`;
}

/** Traitement complet -> Event de contrôles par étage (noms de contrôles : src/contract/controls.js). */
function processingEvent(processing) {
  const proc = {};
  for (const stage of SOURCE_STAGES) proc[stage] = sourceControls(stage, processing[stage]);
  proc.bandCompressor = Object.fromEntries(BAND_GROUPS.map((group) => [group, sourceControls(group, processing.bandCompressor[group])]));
  return proc;
}

/** Event sclang du traitement complet (contrôles par étage) : forme du paramètre `proc` de ~mxAddSource. */
export function processingEventCode(processing) {
  return toScEvent(processingEvent(processing));
}

/** Event sclang d'un étage de sortie (noms de contrôles) : forme du paramètre `controls` de ~mxSetOutputStage. */
export function outputStageEventCode(stage, value) {
  return toScEvent(outputControls(stage, value));
}

export function addSourceCode(source, meterId) {
  if (!Number.isInteger(meterId) || meterId < 0) throw new Error(`meterId invalide : ${meterId}`);
  return `~mxAddSource.(${sourceId(source.id)}, ${meterId}, ${number(source.firstChannel)}, ${number(source.width)}, ${processingEventCode(source.processing)})`;
}

/** Remplacement d'une source existante (déplacement) : construction de la largeur puis fondu enchaîné en un seul bundle. */
export function replaceSourceCode(source, meterId) {
  if (!Number.isInteger(meterId) || meterId < 0) throw new Error(`meterId invalide : ${meterId}`);
  return `~mxReplaceSource.(${sourceId(source.id)}, ${meterId}, ${number(source.firstChannel)}, ${number(source.width)}, ${processingEventCode(source.processing)})`;
}

export function ensureWidthCode(width) {
  if (!Number.isInteger(width) || width < 1 || width > 256) throw new Error(`Largeur invalide : ${width}`);
  return `~mxEnsureWidth.(${width})`;
}

export function removeSourceCode(id) {
  return `~mxRemoveSource.(${sourceId(id)})`;
}

export function setSourceStageCode(id, stage, value) {
  const symbol = oneOf(SOURCE_STAGES, stage, 'Étage de source');
  return `~mxSetSourceStage.(${sourceId(id)}, ${symbol}, ${toScEvent(sourceControls(stage, value))})`;
}

export function setSourceBandCode(id, band, value) {
  oneOf(BAND_GROUPS, band, 'Bande');
  const event = toScEvent({ band, ...sourceControls(band, value) });
  return `~mxSetSourceStage.(${sourceId(id)}, \\bandCompressor, ${event})`;
}

export function setOutputStageCode(output, stage, value) {
  const symbols = `${oneOf(OUTPUTS, output, 'Sortie')}, ${oneOf(OUTPUT_STAGES, stage, 'Étage de sortie')}`;
  const controls = outputControls(stage, value);
  if (stage === 'compressor' || stage === 'limiter') controls.inserted = value.inserted;
  return `~mxSetOutputStage.(${symbols}, ${toScEvent(controls)})`;
}

/** Tous les étages et toutes les bandes d'une source, en réglages de contrôles (aucune recréation de nœud). */
export function sourceProcessingCode(id, processing) {
  const stages = SOURCE_STAGES.map((stage) => setSourceStageCode(id, stage, processing[stage]));
  const bands = BAND_GROUPS.map((band) => setSourceBandCode(id, band, processing.bandCompressor[band]));
  return [...stages, ...bands].join('; ');
}

/** Tous les étages d'une sortie. */
export function outputCode(output, value) {
  return OUTPUT_STAGES.map((stage) => setOutputStageCode(output, stage, value[stage])).join('; ');
}

export function resetMoogCode(id) {
  return `~mxResetMoog.(${sourceId(id)})`;
}

export function applySessionCode(session, meterIds) {
  const statements = session.sources.map((source) => {
    if (!meterIds.has(source.id)) throw new Error(`meterId manquant pour ${source.id}`);
    return addSourceCode(source, meterIds.get(source.id));
  });
  for (const output of OUTPUTS) {
    for (const stage of OUTPUT_STAGES) {
      statements.push(setOutputStageCode(output, stage, session.outputs[output][stage]));
    }
  }
  return statements.join('; ');
}

/**
 * Banc compresseur : exécution de `seconds` sur signal interne ; `cases` donne, par cas, les bandes compressées
 * (transmises à sclang en drapeaux de contournement 0/1). Renvoie « statut|peak,rms|… » (graph.scd).
 */
export function compressorBenchCode(seconds, cases) {
  const list = cases.map(({ compressed }) => `[${['low', 'mid', 'high'].map((b) => (compressed[b] ? 0 : 1)).join(', ')}]`);
  return `~mxCompressorBenchRun.(${number(seconds)}, [${list.join(', ')}])`;
}

function eqBenchArgs({ method, parameters }) {
  return `${oneOf(EQ_BENCH_METHODS, method, 'Méthode de banc EQ')}, ${number(parameters.low)}, ${number(parameters.mid)}, ${number(parameters.high)}`;
}

/** Banc EQ : chaque fonction renvoie l'état « stopped » ou « running|méthode|low|mid|high », ou « refused|CODE ». */
export function eqBenchStartCode(bench) {
  return `~mxEqBenchStart.(${eqBenchArgs(bench)})`;
}

export function eqBenchSetCode(bench) {
  return `~mxEqBenchSet.(${eqBenchArgs(bench)})`;
}

export const EQ_BENCH_STOP_CODE = '~mxEqBenchStop.()';
export const EQ_BENCH_STATE_CODE = '~mxEqBenchState.()';

/** Application d'un preset en un seul passage : retraits (fondu sortant), remplacements (fondu enchaîné), ajouts, puis sorties. */
export function applyPresetCode(current, next, meterIdFor) {
  const kept = new Set(next.sources.map((s) => s.id));
  const existing = new Set(current.sources.map((s) => s.id));
  const statements = current.sources.filter((s) => !kept.has(s.id)).map((s) => removeSourceCode(s.id));
  for (const source of next.sources) {
    const meterId = meterIdFor(source.id);
    statements.push(existing.has(source.id) ? replaceSourceCode(source, meterId) : addSourceCode(source, meterId));
  }
  for (const output of OUTPUTS) {
    for (const stage of OUTPUT_STAGES) statements.push(setOutputStageCode(output, stage, next.outputs[output][stage]));
  }
  return statements.join('; ');
}

/**
 * Enregistrement de la sortie Master (sc/recording.scd). Le chemin est transmis avec des barres obliques.
 * Réponses : « recording|<sampleRate> », « paused », « recording », « stopped » ou « refused|CODE ».
 */
export function recStartCode(file, sampleFormat) {
  return `~mxRecStart.(${JSON.stringify(file.replaceAll('\\', '/'))}, ${JSON.stringify(sampleFormat)})`;
}
export const REC_PAUSE_CODE = '~mxRecPause.()';
export const REC_RESUME_CODE = '~mxRecResume.()';
export const REC_STOP_CODE = '~mxRecStop.()';
