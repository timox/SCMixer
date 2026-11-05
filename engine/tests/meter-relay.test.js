import test from 'node:test';
import assert from 'node:assert/strict';
import { MeterRelay } from '../src/runtime/meter-relay.js';

const relay = () => new MeterRelay((id) => (id === 3 ? 'src-1' : null));

test('sourceMeter : maximum des crêtes et des RMS sur 5 canaux', () => {
  const ev = relay().handle({ address: '/mx/source-meter', args: [1001, 3, 0.1, 0.01, 0.5, 0.05, 0.2, 0.3, 0.25, 0.02, 0.4, 0.1] });
  assert.equal(ev.type, 'sourceMeter');
  assert.equal(ev.data.sourceId, 'src-1');
  assert.ok(Math.abs(ev.data.peakDb - 20 * Math.log10(0.5)) < 1e-9);
  assert.ok(Math.abs(ev.data.rmsDb - 20 * Math.log10(0.3)) < 1e-9);
});

test('niveau 0, NaN ou -Infinity : plancher -120 dB', () => {
  const ev = relay().handle({ address: '/mx/source-meter', args: [1, 3, 0, 0] });
  assert.deepEqual(ev.data, { sourceId: 'src-1', peakDb: -120, rmsDb: -120 });
  const nan = relay().handle({ address: '/mx/source-meter', args: [1, 3, NaN, Infinity * 0] });
  assert.equal(nan.data.peakDb, -120);
  assert.equal(nan.data.rmsDb, -120);
});

test('meterId inconnu ou adresse inconnue : null sans exception', () => {
  assert.equal(relay().handle({ address: '/mx/source-meter', args: [1, 99, 0.5, 0.5] }), null);
  assert.equal(relay().handle({ address: '/mx/source-meter', args: [1, 3] }), null);
  assert.equal(relay().handle({ address: '/mx/ack', args: [1, 'ok', ''] }), null);
  assert.equal(relay().handle({ address: '/autre', args: [] }), null);
  assert.equal(relay().handle({ address: '/mx/output-meter', args: [1, 7, 0.5, 0.5] }), null);
  const throwing = new MeterRelay(() => { throw new Error('x'); });
  assert.equal(throwing.handle({ address: '/mx/source-meter', args: [1, 3, 0.5, 0.5] }), null);
});

test('outputMeter : ID 0..3 vers master/cue et left/right', () => {
  const r = relay();
  const expected = [['master', 'left'], ['master', 'right'], ['cue', 'left'], ['cue', 'right']];
  expected.forEach(([output, channel], id) => {
    const ev = r.handle({ address: '/mx/output-meter', args: [1000, id, 1, 0.5] });
    assert.equal(ev.type, 'outputMeter');
    assert.equal(ev.data.output, output);
    assert.equal(ev.data.channel, channel);
    assert.ok(Math.abs(ev.data.peakDb) < 1e-9);
    assert.ok(Math.abs(ev.data.rmsDb - 20 * Math.log10(0.5)) < 1e-9);
  });
});

test('engineRuntimeChanged : champs mappés, lastFail vide devient null', () => {
  const args = [12.5, 20, 7, 300, 4, 48000, 47999.5, 64, 256, 11.2, ''];
  const ev = relay().handle({ address: '/mx/runtime', args });
  assert.deepEqual(ev, { type: 'engineRuntimeChanged', data: {
    cpuAvg: 12.5, cpuPeak: 20, synths: 7, ugens: 300, groups: 4, sampleRateRequested: 48000,
    sampleRateActual: 47999.5, blockSize: 64, hardwareBufferFrames: 256, latencyMs: 11.2, lastFail: null,
  } });
  const fail = relay().handle({ address: '/mx/runtime', args: [...args.slice(0, 10), '/s_new : erreur'] });
  assert.equal(fail.data.lastFail, '/s_new : erreur');
  assert.equal(relay().handle({ address: '/mx/runtime', args: [1, 2] }), null);
});
