import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toScEvent, addSourceCode, removeSourceCode, setSourceStageCode, setSourceBandCode,
  setOutputStageCode, resetMoogCode, applySessionCode, ensureWidthCode, replaceSourceCode,
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

test('setSourceBandCode ajoute band et préfixe les contrôles par le groupe (une SynthDef, quatre groupes)', () => {
  const band = defaultSourceProcessing().bandCompressor.low;
  assert.equal(
    setSourceBandCode('src-1', 'low', band),
    '~mxSetSourceStage.("src-1", \\bandCompressor, (band: \\low, lowThresholdDb: -20, lowSlopeBelow: 1, lowSlopeAbove: 0.25, lowAttackMs: 10, lowReleaseMs: 100, lowMul: 1, lowAdd: 0, lowBypass: 1, lowControlLag: 0))',
  );
  assert.match(setSourceBandCode('src-1', 'crossover', { lowMidFreq: 250, lowLp1Mul: 1 }), /band: \\crossover, crossoverLowMidFreq: 250, crossoverLowLp1Mul: 1\)\)$/);
});

test('étages à une seule SynthDef : champ seul ; étages de la SynthDef d\'entrée et de sortie : préfixés', () => {
  const p = defaultSourceProcessing();
  assert.match(setSourceStageCode('src-1', 'inputCompressor', p.inputCompressor), /\\inputCompressor, \(inputCompressorThresholdDb: -20, inputCompressorSlopeBelow: 1, /);
  assert.match(setSourceStageCode('src-1', 'input', p.input), /\\input, \(inputGain: 1, inputMul: 1, inputAdd: 0, inputControlLag: 0\)/);
  assert.match(setSourceStageCode('src-1', 'pitch', p.pitch), /\\pitch, \(semitones: 0, blend: -1, level: 1, windowSize: 0\.2, /);
  assert.match(setOutputStageCode('master', 'eq', defaultOutput().eq), /\\eq, \(eqLow: 0\.5, eqMid: 0\.5, eqHigh: 0\.5, eqRangeDb: 12, eqLowFreq: 200, /);
  assert.match(setOutputStageCode('cue', 'limiter', defaultOutput().limiter), /\\limiter, \(limiterEnabled: 0, limiterCeilingDb: -1, limiterDurMs: 10, limiterControlLag: 0\)/);
  assert.match(setOutputStageCode('cue', 'compressor', defaultOutput().compressor), /\\compressor, \(model: \\Compander, compressorThresholdDb: -20, compressorSlopeBelow: 1, compressorSlopeAbove: 0\.25, /);
  assert.match(setOutputStageCode('cue', 'compressor', defaultOutput().compressor), /compressorFadeSeconds: 0\.05\)\)$/);
});

test('sorties, remove et reset moog', () => {
  assert.equal(setOutputStageCode('cue', 'mix', { volume: 0.5, controlLag: 0 }), '~mxSetOutputStage.(\\cue, \\mix, (mixVolume: 0.5, mixControlLag: 0))');
  assert.equal(removeSourceCode('src-2'), '~mxRemoveSource.("src-2")');
  assert.equal(resetMoogCode('src-2'), '~mxResetMoog.("src-2")');
});

test('addSourceCode imbrique le traitement complet sans le nom', () => {
  const code = addSourceCode(source('src-1', 'Secret'), 4);
  assert.match(code, /^~mxAddSource\.\("src-1", 4, 1, 2, \(mix: \(/);
  assert.match(code, /bandCompressor: \(low: \(lowThresholdDb: -20/);
  assert.match(code, /crossover: \(crossoverLowMidFreq: 250, crossoverMidHighFreq: 4000, /);
  assert.doesNotMatch(code, /ratio|makeupDb|ceilingDb/);
  assert.ok(!code.includes('Secret'));
  assert.throws(() => addSourceCode(source('src-1', 'x'), 1.5));
});

test('applySessionCode : sources puis 14 sorties, sans noms', () => {
  const session = {
    version: 3, nextSourceSeq: 3,
    sources: [source('src-1', 'Alpha'), source('src-2', 'Beta')],
    outputs: { master: defaultOutput(), cue: defaultOutput() }, outputChannels: { master: 1, cue: 3 },
  };
  const code = applySessionCode(session, new Map([['src-1', 0], ['src-2', 1]]));
  assert.equal(code.match(/~mxAddSource\./g).length, 2);
  assert.equal(code.match(/~mxSetOutputStage\./g).length, 14);
  assert.ok(code.indexOf('"src-1"') < code.indexOf('"src-2"'));
  assert.ok(!/Alpha|Beta/.test(code));
  assert.throws(() => applySessionCode(session, new Map([['src-1', 0]])));
});

test('replaceSourceCode : un seul appel ~mxReplaceSource avec le traitement complet', () => {
  const code = replaceSourceCode(source('src-1', 'Secret'), 4);
  assert.match(code, /^~mxReplaceSource\.\("src-1", 4, 1, 2, \(mix: \(/);
  assert.ok(!code.includes('Secret'));
  assert.throws(() => replaceSourceCode(source('src-1', 'x'), -1));
});

test('ensureWidthCode : largeur entière de 1 à 256 uniquement', () => {
  assert.equal(ensureWidthCode(4), '~mxEnsureWidth.(4)');
  assert.throws(() => ensureWidthCode(0));
  assert.throws(() => ensureWidthCode(257));
  assert.throws(() => ensureWidthCode(1.5));
});
