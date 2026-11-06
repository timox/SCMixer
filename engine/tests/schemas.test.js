import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CompBand, SourceProcessing, PITCH_WINDOW_MAX_SECONDS, SourceCreate, SourcePatch, Output, Session, PresetCreate,
  SOURCE_STAGES, OUTPUT_STAGES, BANDS, MAX_CHANNELS, defaultSourceProcessing, defaultOutput,
} from '../src/contract/schemas.js';
import { ApiError, codes } from '../src/contract/errors.js';

test('defaultSourceProcessing reproduit les défauts du contrat', () => {
  const p = defaultSourceProcessing();
  assert.deepEqual(p.mix, {
    volume: 1, cue: 0, mute: false, balance: 0.5, panLevel: 1, balanceLevel: 1, spread: 1, splayLevel: 1, center: 0, levelComp: 0.5, controlLag: 0,
  });
  // Son actuel : compresseur 4:1 (slopeAbove = 1 / 4), makeup 0 dB (mul = 1), pente basse 1, aucun lissage.
  assert.deepEqual(p.inputCompressor, {
    thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25, attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: true, controlLag: 0,
  });
  assert.deepEqual(p.eq.lowFreq, 80);
  assert.deepEqual(p.hp.floorHz, 40);
  assert.deepEqual(p.pitch.windowSize, PITCH_WINDOW_MAX_SECONDS);
  assert.deepEqual([p.bandCompressor.crossover.lowMidFreq, p.bandCompressor.crossover.midHighFreq], [250, 4000]);
  assert.equal(p.hp.model, 'BHiPass'); assert.equal(p.lp.model, 'BLowPass'); assert.equal(p.lp.gain, 2);
  assert.deepEqual(SourceProcessing.parse(p), p);
  assert.deepEqual(Object.keys(p.bandCompressor), [...BANDS, 'crossover']);
});
test('defaultOutput reproduit les défauts', () => {
  const o = defaultOutput();
  assert.deepEqual(o.limiter, { enabled: false, ceilingDb: -1, durMs: 10, controlLag: 0 });
  assert.deepEqual(o.clipper, { enabled: false, lo: -1, hi: 1, controlLag: 0 });
  assert.deepEqual(o.infraHpf, { enabled: false, hz: 25, mul: 1, add: 0, controlLag: 0 });
  assert.equal(o.eq.lowFreq, 200);
  assert.equal(o.compressor.slopeAbove, 0.25); assert.equal(o.compressor.bypass, true);
  assert.deepEqual(Output.parse(o), o);
});
test('les schémas sont stricts', () => {
  assert.throws(() => SourceProcessing.shape.eq.parse({ low: 0.5, mid: 0.5, high: 0.5, extra: 1 }));
  assert.throws(() => CompBand.parse({ ...defaultSourceProcessing().inputCompressor, slopeAbove: 11 }));
  assert.throws(() => CompBand.parse({ ...defaultSourceProcessing().inputCompressor, ratio: 4 }), /ratio/);
  assert.throws(() => CompBand.parse({ ...defaultSourceProcessing().inputCompressor, makeupDb: 0 }), /makeupDb/);
  assert.throws(() => SourceCreate.parse({ name: 'A', firstChannel: 0, width: 2 }));
  assert.throws(() => SourceCreate.parse({ name: '', firstChannel: 1, width: 2 }));
});
test('pitch : semitones entiers, windowSize borné par le maximum de dimensionnement', () => {
  const pitch = defaultSourceProcessing().pitch;
  assert.throws(() => SourceProcessing.shape.pitch.parse({ ...pitch, semitones: 1.5 }));
  assert.doesNotThrow(() => SourceProcessing.shape.pitch.parse({ ...pitch, windowSize: PITCH_WINDOW_MAX_SECONDS }));
  assert.throws(() => SourceProcessing.shape.pitch.parse({ ...pitch, windowSize: PITCH_WINDOW_MAX_SECONDS + 0.01 }));
  assert.throws(() => SourceProcessing.shape.pitch.parse({ ...pitch, windowSize: 0.05, timeDispersion: 0.06 }));
});
test('constantes', () => {
  assert.equal(MAX_CHANNELS, 256);
  assert.deepEqual(SOURCE_STAGES, ['mix', 'input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch']);
  assert.deepEqual(OUTPUT_STAGES, ['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor']);
});
test('session, création, patch, preset', () => {
  const s = { version: 3, nextSourceSeq: 1, sources: [], outputs: { master: defaultOutput(), cue: defaultOutput() } };
  assert.deepEqual(Session.parse(s), s);
  assert.throws(() => Session.parse({ ...s, nextPresetSeq: 1 }));
  assert.throws(() => Session.parse({ ...s, audioProfile: { sampleRate: 48000, bufferFrames: 256 } }));
  assert.throws(() => Session.parse({ ...s, version: 1 }));
  assert.throws(() => Session.parse({ ...s, version: 2 }));
  assert.throws(() => Session.parse({ ...s, version: 4 }));
  assert.throws(() => SourceCreate.parse({ name: 'A', firstChannel: 1, width: 257 }));
  assert.deepEqual(SourcePatch.parse({ width: 2 }), { width: 2 });
  assert.throws(() => SourcePatch.parse({ id: 'x' }));
  assert.deepEqual(PresetCreate.parse({ name: 'p' }), { name: 'p' });
  assert.throws(() => PresetCreate.parse({ name: 'x'.repeat(61) }));
});
test('ApiError et codes', () => {
  assert.deepEqual(codes, {
    VALIDATION: 400, NOT_FOUND: 404, CHANNEL_OVERLAP: 409, CHANNEL_LIMIT: 400, ENGINE_NOT_RUNNING: 409,
    ENGINE_BUSY: 409, ENGINE_RESTART_REQUIRED: 409, MODEL_UNAVAILABLE: 409, TIMOXVASIO_NOT_READY: 409, BENCH_RUNNING: 409, BENCH_NOT_RUNNING: 409,
    RECORDING_STATE: 409, RECORDING_FILE_EXISTS: 409, RECORDING_OPEN_FAILED: 502, SC_COMMAND_FAILED: 502,
  });
  const e = new ApiError('NOT_FOUND', 404, 'Source introuvable.');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'NOT_FOUND'); assert.equal(e.status, 404); assert.equal(e.message, 'Source introuvable.');
});
