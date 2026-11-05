import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers/api-harness.js';
import { assertModelsAvailable } from '../src/contract/models.js';
import { defaultOutput } from '../src/contract/schemas.js';

const COMP = { model: 'FaustRMS', thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25, attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: false };

test('assertModelsAvailable', () => {
  const outputs = { master: defaultOutput(), cue: defaultOutput() };
  assertModelsAvailable({ outputs }, { Compander: true, CompanderD: false, FaustRMS: false });
  outputs.cue.compressor.model = 'FaustRMS';
  assert.throws(() => assertModelsAvailable(outputs, { Compander: true, CompanderD: true, FaustRMS: false }),
    (e) => e.code === 'MODEL_UNAVAILABLE' && e.status === 409);
});

test('compresseur FaustRMS indisponible : 409 et état inchangé', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const before = (await h.call('GET', '/api/state')).body.outputs;
  const r = await h.call('PUT', '/api/outputs/master/compressor', COMP);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'MODEL_UNAVAILABLE');
  assert.deepEqual((await h.call('GET', '/api/state')).body.outputs, before);
});

test('compresseur CompanderD disponible : 200 et Output confirmé', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('PUT', '/api/outputs/master/compressor', { ...COMP, model: 'CompanderD' });
  assert.equal(r.status, 200);
  assert.equal(r.body.compressor.model, 'CompanderD');
  assert.match(h.langs[0].commands().at(-1), /~mxSetOutputStage\.\(\\master, \\compressor, \(model: \\CompanderD/);
});

test('étage de sortie : validation, sortie inconnue, moteur arrêté', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  assert.equal((await h.call('PUT', '/api/outputs/master/limiter', { enabled: true, ceilingDb: -1, x: 1 })).status, 400);
  assert.equal((await h.call('PUT', '/api/outputs/master/nope', {})).status, 400);
  assert.equal((await h.call('PUT', '/api/outputs/aux/limiter', { enabled: true, ceilingDb: -1 })).status, 404);
  const ok = await h.call('PUT', '/api/outputs/cue/limiter', { enabled: true, ceilingDb: -3 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.limiter, { enabled: true, ceilingDb: -3 });
  const g = await startHarness({ running: false }); t.after(() => g.close());
  assert.equal((await g.call('PUT', '/api/outputs/cue/limiter', { enabled: true, ceilingDb: -3 })).body.error.code, 'ENGINE_NOT_RUNNING');
});

test('POST cue/copy-master', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('PUT', '/api/outputs/master/limiter', { enabled: true, ceilingDb: -6 });
  const r = await h.call('POST', '/api/outputs/cue/copy-master');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.limiter, { enabled: true, ceilingDb: -6 });
  assert.deepEqual((await h.call('GET', '/api/state')).body.outputs.cue, r.body);
});

test('processing-graph : étages ordonnés, modèle demandé et chargé', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('GET', '/api/outputs/master/processing-graph');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((s) => s.stage), ['infraHpf', 'sideHpf', 'eq', 'compressor', 'clipper', 'limiter', 'mix']);
  const comp = r.body.find((s) => s.stage === 'compressor');
  assert.equal(comp.requestedModel, 'Compander');
  assert.equal(comp.loadedModel, 'Compander');
  assert.equal((await h.call('GET', '/api/outputs/aux/processing-graph')).status, 404);
});
