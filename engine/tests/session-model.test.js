import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySession, addSource, patchSource, removeSource, setSourceStage, setSourceBand, resetSourceStage,
  setOutputStage, copyMasterToCue, replaceSessionContent, validateChannels,
} from '../src/session/session-model.js';
import { Session, defaultSourceProcessing, defaultOutput } from '../src/contract/schemas.js';

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

const withAB = () => {
  let s = emptySession();
  ({ session: s } = addSource(s, { name: 'A', firstChannel: 1, width: 2 }));
  ({ session: s } = addSource(s, { name: 'B', firstChannel: 3, width: 2 }));
  return s;
};

test('emptySession est une Session valide', () => {
  const s = emptySession();
  assert.doesNotThrow(() => Session.parse(s));
  assert.equal(s.nextSourceSeq, 1);
  assert.deepEqual(s.sources, []);
});

test('ids src-<n> jamais réutilisés', () => {
  let s = emptySession();
  ({ session: s } = addSource(s, { name: 'A', firstChannel: 1, width: 2 }));
  s = removeSource(s, 'src-1');
  const { source } = addSource(s, { name: 'B', firstChannel: 1, width: 2 });
  assert.equal(source.id, 'src-2');
});

test('addSource applique le traitement par défaut', () => {
  const { source } = addSource(emptySession(), { name: 'A', firstChannel: 1, width: 2 });
  assert.deepEqual(source.processing, defaultSourceProcessing());
});

test('chevauchement refusé', () => {
  const { session } = addSource(emptySession(), { name: 'A', firstChannel: 1, width: 4 });
  assert.throws(() => addSource(session, { name: 'B', firstChannel: 4, width: 1 }), { code: 'CHANNEL_OVERLAP', status: 409 });
});

test('limite 256', () => {
  assert.doesNotThrow(() => addSource(emptySession(), { name: 'A', firstChannel: 255, width: 2 }));
  assert.throws(() => addSource(emptySession(), { name: 'A', firstChannel: 256, width: 2 }), { code: 'CHANNEL_LIMIT', status: 400 });
});

test('création invalide → VALIDATION', () => {
  assert.throws(() => addSource(emptySession(), { name: '', firstChannel: 1, width: 2 }), { code: 'VALIDATION' });
  assert.throws(() => addSource(emptySession(), { name: 'A', firstChannel: 0, width: 2 }), { code: 'VALIDATION' });
  assert.throws(() => addSource(emptySession(), { name: 'A', firstChannel: 1, width: 2, x: 1 }), { code: 'VALIDATION' });
});

test('patch de largeur revalide les canaux', () => {
  const s = withAB();
  assert.throws(() => patchSource(s, 'src-1', { width: 3 }), { code: 'CHANNEL_OVERLAP' });
  assert.throws(() => patchSource(s, 'src-2', { width: 256 }), { code: 'CHANNEL_LIMIT' });
  const ok = patchSource(s, 'src-1', { name: 'Z' });
  assert.equal(ok.sources[0].name, 'Z');
});

test('patch vide ou invalide → VALIDATION, id inconnu → NOT_FOUND', () => {
  const s = withAB();
  assert.throws(() => patchSource(s, 'src-1', {}), { code: 'VALIDATION' });
  assert.throws(() => patchSource(s, 'src-1', { id: 'x' }), { code: 'VALIDATION' });
  assert.throws(() => patchSource(s, 'src-9', { name: 'Z' }), { code: 'NOT_FOUND', status: 404 });
  assert.throws(() => removeSource(s, 'src-9'), { code: 'NOT_FOUND' });
});

test('id inconnu → NOT_FOUND', () => {
  assert.throws(() => setSourceStage(emptySession(), 'src-9', 'eq', { low: 0.5, mid: 0.5, high: 0.5 }), { code: 'NOT_FOUND' });
});

test('setSourceStage valide la valeur et le nom d’étage', () => {
  const s = withAB();
  const out = setSourceStage(s, 'src-1', 'eq', { low: 0.8, mid: 0.5, high: 0.5 });
  assert.equal(out.sources[0].processing.eq.low, 0.8);
  assert.throws(() => setSourceStage(s, 'src-1', 'eq', { low: 2, mid: 0.5, high: 0.5 }), { code: 'VALIDATION' });
  assert.throws(() => setSourceStage(s, 'src-1', 'bogus', {}), { code: 'VALIDATION' });
  assert.throws(() => setSourceStage(s, 'src-1', 'bandCompressor', {}), { code: 'VALIDATION' });
});

test('setSourceBand', () => {
  const s = withAB();
  const band = { ...defaultSourceProcessing().bandCompressor.mid, ratio: 8 };
  const out = setSourceBand(s, 'src-2', 'mid', band);
  assert.equal(out.sources[1].processing.bandCompressor.mid.ratio, 8);
  assert.throws(() => setSourceBand(s, 'src-2', 'x', band), { code: 'VALIDATION' });
  assert.throws(() => setSourceBand(s, 'src-2', 'mid', { ...band, ratio: 99 }), { code: 'VALIDATION' });
});

test('resetSourceStage hp/lp seulement', () => {
  let s = withAB();
  s = setSourceStage(s, 'src-1', 'hp', { ...defaultSourceProcessing().hp, enabled: true, freq: 0.7 });
  const r = resetSourceStage(s, 'src-1', 'hp');
  assert.deepEqual(r.sources[0].processing.hp, defaultSourceProcessing().hp);
  assert.deepEqual(resetSourceStage(s, 'src-1', 'lp').sources[0].processing.lp, defaultSourceProcessing().lp);
  assert.throws(() => resetSourceStage(s, 'src-1', 'eq'), { code: 'VALIDATION' });
  assert.throws(() => resetSourceStage(s, 'src-9', 'hp'), { code: 'NOT_FOUND' });
});

test('setOutputStage', () => {
  const s = emptySession();
  const out = setOutputStage(s, 'master', 'eq', { low: 0.2, mid: 0.5, high: 0.5 });
  assert.equal(out.outputs.master.eq.low, 0.2);
  assert.equal(out.outputs.cue.eq.low, 0.5);
  assert.throws(() => setOutputStage(s, 'x', 'eq', { low: 0.2, mid: 0.5, high: 0.5 }), { code: 'NOT_FOUND' });
  assert.throws(() => setOutputStage(s, 'cue', 'bogus', {}), { code: 'VALIDATION' });
  assert.throws(() => setOutputStage(s, 'cue', 'limiter', { enabled: true, ceilingDb: 5 }), { code: 'VALIDATION' });
});

test('copyMasterToCue copie tous les étages', () => {
  let s = setOutputStage(emptySession(), 'master', 'eq', { low: 0.8, mid: 0.5, high: 0.5 });
  s = setOutputStage(s, 'master', 'limiter', { enabled: true, ceilingDb: -3 });
  const c = copyMasterToCue(s);
  assert.deepEqual(c.outputs.cue, c.outputs.master);
  assert.equal(c.outputs.cue.eq.low, 0.8);
  assert.notEqual(c.outputs.cue, c.outputs.master);
});

test('validateChannels', () => {
  const s = withAB();
  assert.doesNotThrow(() => validateChannels(s.sources));
  assert.throws(() => validateChannels([s.sources[0], { ...s.sources[1], firstChannel: 2 }]), { code: 'CHANNEL_OVERLAP' });
});

test('replaceSessionContent', () => {
  const s = withAB();
  const other = withAB();
  const r = replaceSessionContent(emptySession(), { sources: other.sources, outputs: other.outputs, nextSourceSeq: 3 });
  assert.equal(r.sources.length, 2);
  assert.equal(r.nextSourceSeq, 3);
  const keep = replaceSessionContent(s, { sources: [], outputs: s.outputs, nextSourceSeq: 1 });
  assert.equal(keep.nextSourceSeq, 3);
  assert.throws(() => replaceSessionContent(s, { sources: [{ ...s.sources[0], width: 9 }, s.sources[1]], outputs: s.outputs, nextSourceSeq: 3 }), { code: 'CHANNEL_OVERLAP' });
  assert.throws(() => replaceSessionContent(s, { sources: [], outputs: { master: {} }, nextSourceSeq: 3 }), { code: 'VALIDATION' });
  assert.throws(() => replaceSessionContent(s, { sources: [], outputs: s.outputs, nextSourceSeq: 0 }), { code: 'VALIDATION' });
});

test('les opérations ne mutent pas l’entrée', () => {
  const s = deepFreeze(withAB());
  const band = defaultSourceProcessing().bandCompressor.low;
  assert.doesNotThrow(() => {
    addSource(s, { name: 'C', firstChannel: 5, width: 1 });
    patchSource(s, 'src-1', { name: 'Q' });
    removeSource(s, 'src-1');
    setSourceStage(s, 'src-1', 'pitch', { semitones: 3 });
    setSourceBand(s, 'src-1', 'low', band);
    resetSourceStage(s, 'src-1', 'lp');
    setOutputStage(s, 'cue', 'mix', { volume: 0.3 });
    copyMasterToCue(s);
    replaceSessionContent(s, { sources: s.sources, outputs: s.outputs, nextSourceSeq: 9 });
  });
  assert.deepEqual(defaultOutput(), s.outputs.master);
});
