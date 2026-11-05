import {
  Session, SourceCreate, SourcePatch, SourceProcessing, CompBand, Crossover, Output,
  SOURCE_STAGES, OUTPUT_STAGES, BAND_GROUPS, MAX_CHANNELS,
  defaultSourceProcessing, defaultOutput,
} from '../contract/schemas.js';
import { ApiError, codes } from '../contract/errors.js';

const fail = (code, message) => new ApiError(code, codes[code], message);

function parse(schema, value, what) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    throw fail('VALIDATION', `${what} invalide (${detail})`);
  }
  return r.data;
}

const clone = (v) => structuredClone(v);

export function emptySession() {
  return {
    version: 3,
    nextSourceSeq: 1,
    sources: [],
    outputs: { master: defaultOutput(), cue: defaultOutput() },
  };
}

export function validateChannels(sources) {
  const spans = [];
  for (const s of sources) {
    const last = s.firstChannel + s.width - 1;
    if (last > MAX_CHANNELS) {
      throw fail('CHANNEL_LIMIT', `La source ${s.id ?? s.name} dépasse le canal ${MAX_CHANNELS} (${s.firstChannel}..${last}).`);
    }
    for (const o of spans) {
      if (s.firstChannel <= o.last && o.first <= last) {
        throw fail('CHANNEL_OVERLAP', `Les canaux ${s.firstChannel}..${last} chevauchent ceux de ${o.label} (${o.first}..${o.last}).`);
      }
    }
    spans.push({ first: s.firstChannel, last, label: s.id ?? s.name });
  }
}

function indexOfSource(session, id) {
  const i = session.sources.findIndex((s) => s.id === id);
  if (i < 0) throw fail('NOT_FOUND', `Source inconnue : ${id}.`);
  return i;
}

function withSource(session, i, source) {
  const next = clone(session);
  next.sources[i] = source;
  return next;
}

export function addSource(session, input) {
  const data = parse(SourceCreate, input, 'Source');
  const source = {
    id: `src-${session.nextSourceSeq}`,
    name: data.name,
    firstChannel: data.firstChannel,
    width: data.width,
    processing: defaultSourceProcessing(),
  };
  validateChannels([...session.sources, source]);
  const next = clone(session);
  next.sources.push(source);
  next.nextSourceSeq = session.nextSourceSeq + 1;
  return { session: next, source: clone(source) };
}

export function patchSource(session, id, patch) {
  const i = indexOfSource(session, id);
  const data = parse(SourcePatch, patch, 'Modification de source');
  if (Object.keys(data).length === 0) throw fail('VALIDATION', 'Modification de source vide.');
  const source = { ...clone(session.sources[i]), ...data };
  const sources = session.sources.map((s, k) => (k === i ? source : s));
  validateChannels(sources);
  return withSource(session, i, source);
}

export function removeSource(session, id) {
  const i = indexOfSource(session, id);
  const next = clone(session);
  next.sources.splice(i, 1);
  return next;
}

export function setSourceStage(session, id, stage, value) {
  const i = indexOfSource(session, id);
  if (!SOURCE_STAGES.includes(stage)) throw fail('VALIDATION', `Étage de source inconnu : ${stage}.`);
  const data = parse(SourceProcessing.shape[stage], value, `Étage ${stage}`);
  const source = clone(session.sources[i]);
  source.processing[stage] = data;
  return withSource(session, i, source);
}

export function setSourceBand(session, id, band, value) {
  const i = indexOfSource(session, id);
  if (!BAND_GROUPS.includes(band)) throw fail('VALIDATION', `Bande inconnue : ${band}.`);
  const data = parse(band === 'crossover' ? Crossover : CompBand, value, `Bande ${band}`);
  const source = clone(session.sources[i]);
  source.processing.bandCompressor[band] = data;
  return withSource(session, i, source);
}

export function resetSourceStage(session, id, stage) {
  const i = indexOfSource(session, id);
  if (stage !== 'hp' && stage !== 'lp') throw fail('VALIDATION', `Réinitialisation non supportée pour l'étage : ${stage}.`);
  const source = clone(session.sources[i]);
  source.processing[stage] = defaultSourceProcessing()[stage];
  return withSource(session, i, source);
}

export function setOutputStage(session, output, stage, value) {
  if (output !== 'master' && output !== 'cue') throw fail('NOT_FOUND', `Sortie inconnue : ${output}.`);
  if (!OUTPUT_STAGES.includes(stage)) throw fail('VALIDATION', `Étage de sortie inconnu : ${stage}.`);
  const data = parse(Output.shape[stage], value, `Étage ${stage}`);
  const next = clone(session);
  next.outputs[output][stage] = data;
  return next;
}

export function copyMasterToCue(session) {
  const next = clone(session);
  next.outputs.cue = clone(session.outputs.master);
  return next;
}

export function replaceSessionContent(session, content) {
  const shape = Session.shape;
  const sources = parse(shape.sources, content?.sources, 'Sources');
  const outputs = parse(shape.outputs, content?.outputs, 'Sorties');
  const seq = parse(shape.nextSourceSeq, content?.nextSourceSeq, 'nextSourceSeq');
  const ids = new Set(sources.map((s) => s.id));
  if (ids.size !== sources.length) throw fail('VALIDATION', 'Identifiants de source en double.');
  validateChannels(sources);
  return {
    version: 3,
    nextSourceSeq: Math.max(session.nextSourceSeq, seq),
    sources: clone(sources),
    outputs: clone(outputs),
  };
}
