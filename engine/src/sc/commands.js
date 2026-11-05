import { SOURCE_STAGES, OUTPUT_STAGES, BAND_GROUPS } from '../contract/schemas.js';
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
  return `~mxSetOutputStage.(${symbols}, ${toScEvent(outputControls(stage, value))})`;
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
