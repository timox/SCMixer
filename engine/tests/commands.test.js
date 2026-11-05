import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toScEvent, addSourceCode, removeSourceCode, setSourceStageCode, setSourceBandCode,
  setOutputStageCode, resetMoogCode, applySessionCode, ensureWidthCode,
} from '../src/sc/commands.js';
import { defaultSourceProcessing, defaultOutput } from '../src/contract/schemas.js';

const source = (id, name) => ({ id, name, firstChannel: 1, width: 2, processing: defaultSourceProcessing() });

test('setSourceStageCode produit exactement la forme attendue', () => {
  assert.equal(
    setSourceStageCode('src-3', 'eq', { low: 0.6, mid: 0.5, high: 0.5 }),
    '~mxSetSourceStage.("src-3", \\eq, (low: 0.6, mid: 0.5, high: 0.5))',
  );
});

test('identifiants, sorties et étages invalides lèvent', () => {
  assert.throws(() => setSourceStageCode('3', 'eq', {}));
  assert.throws(() => removeSourceCode('src-1; 1'));
  assert.throws(() => resetMoogCode('src-x'));
  assert.throws(() => setSourceStageCode('src-1', 'bandCompressor', {}));
  assert.throws(() => setSourceStageCode('src-1', 'nope', {}));
  assert.throws(() => setOutputStageCode('main', 'mix', { volume: 1 }));
  assert.throws(() => setOutputStageCode('master', 'nope', {}));
  assert.throws(() => setSourceBandCode('src-1', 'top', {}));
});

test('booléens en 0/1, modèles en symboles, négatifs valides', () => {
  const code = setSourceStageCode('src-1', 'hp', { enabled: true, model: 'RHPF', freq: 0.2, q: 1, mul: 1, add: -0.5 });
  assert.equal(code, '~mxSetSourceStage.("src-1", \\hp, (enabled: 1, model: \\RHPF, freq: 0.2, q: 1, mul: 1, add: -0.5))');
  assert.equal(toScEvent({ a: false }), '(a: 0)');
});

test('nombres non finis et valeurs inconnues lèvent', () => {
  assert.throws(() => toScEvent({ a: NaN }));
  assert.throws(() => toScEvent({ a: Infinity }));
  assert.throws(() => toScEvent({ a: 'x"; 1' }));
  assert.throws(() => toScEvent({ 'a b': 1 }));
  assert.throws(() => toScEvent({ a: null }));
});

test('setSourceBandCode ajoute band', () => {
  const band = { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: true };
  assert.equal(
    setSourceBandCode('src-1', 'low', band),
    '~mxSetSourceStage.("src-1", \\bandCompressor, (band: \\low, thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: 1))',
  );
});

test('sorties, remove et reset moog', () => {
  assert.equal(setOutputStageCode('cue', 'mix', { volume: 0.5 }), '~mxSetOutputStage.(\\cue, \\mix, (volume: 0.5))');
  assert.equal(removeSourceCode('src-2'), '~mxRemoveSource.("src-2")');
  assert.equal(resetMoogCode('src-2'), '~mxResetMoog.("src-2")');
});

test('addSourceCode imbrique le traitement complet sans le nom', () => {
  const code = addSourceCode(source('src-1', 'Secret'), 4);
  assert.match(code, /^~mxAddSource\.\("src-1", 4, 1, 2, \(mix: \(/);
  assert.match(code, /bandCompressor: \(low: \(thresholdDb: -20/);
  assert.ok(!code.includes('Secret'));
  assert.throws(() => addSourceCode(source('src-1', 'x'), 1.5));
});

test('applySessionCode : sources puis 14 sorties, sans noms', () => {
  const session = {
    version: 2, nextSourceSeq: 3,
    sources: [source('src-1', 'Alpha'), source('src-2', 'Beta')],
    outputs: { master: defaultOutput(), cue: defaultOutput() },
  };
  const code = applySessionCode(session, new Map([['src-1', 0], ['src-2', 1]]));
  assert.equal(code.match(/~mxAddSource\./g).length, 2);
  assert.equal(code.match(/~mxSetOutputStage\./g).length, 14);
  assert.ok(code.indexOf('"src-1"') < code.indexOf('"src-2"'));
  assert.ok(!/Alpha|Beta/.test(code));
  assert.throws(() => applySessionCode(session, new Map([['src-1', 0]])));
});

test('ensureWidthCode : largeur entière de 1 à 256 uniquement', () => {
  assert.equal(ensureWidthCode(4), '~mxEnsureWidth.(4)');
  assert.throws(() => ensureWidthCode(0));
  assert.throws(() => ensureWidthCode(257));
  assert.throws(() => ensureWidthCode(1.5));
});
