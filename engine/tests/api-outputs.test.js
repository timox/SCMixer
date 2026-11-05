import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers/api-harness.js';
import { assertModelsAvailable } from '../src/contract/models.js';
import { defaultOutput } from '../src/contract/schemas.js';

const COMP = { ...defaultOutput().compressor, model: 'FaustRMS', bypass: false };
const LIMITER = (extra) => ({ ...defaultOutput().limiter, enabled: true, ...extra });

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
  assert.equal((await h.call('PUT', '/api/outputs/master/limiter', LIMITER({ ceilingDb: -1, x: 1 }))).status, 400);
  assert.equal((await h.call('PUT', '/api/outputs/master/nope', {})).status, 404);
  assert.equal((await h.call('PUT', '/api/outputs/aux/limiter', LIMITER({ ceilingDb: -1 }))).status, 404);
  const ok = await h.call('PUT', '/api/outputs/cue/limiter', LIMITER({ ceilingDb: -3 }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.limiter, LIMITER({ ceilingDb: -3 }));
  const g = await startHarness({ running: false }); t.after(() => g.close());
  assert.equal((await g.call('PUT', '/api/outputs/cue/limiter', LIMITER({ ceilingDb: -3 }))).body.error.code, 'ENGINE_NOT_RUNNING');
});

test('POST cue/copy-master', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('PUT', '/api/outputs/master/limiter', LIMITER({ ceilingDb: -6 }));
  const r = await h.call('POST', '/api/outputs/cue/copy-master');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.limiter, LIMITER({ ceilingDb: -6 }));
  assert.deepEqual((await h.call('GET', '/api/state')).body.outputs.cue, r.body);
});

test('processing-graph : étages ordonnés, modèle demandé et chargé', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('GET', '/api/outputs/master/processing-graph');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((s) => s.stage), ['infraHpf', 'sideHpf', 'eq', 'mix', 'clipper', 'limiter', 'compressor']);
  const comp = r.body.find((s) => s.stage === 'compressor');
  assert.equal(comp.requestedModel, 'Compander');
  assert.equal(comp.loadedModel, 'Compander');
  assert.equal((await h.call('GET', '/api/outputs/aux/processing-graph')).status, 404);
});

test('modèle stocké indisponible : PUT eq réussit, PUT compressor FaustRMS refusé', async (t) => {
  const h = await startHarness({ lang: { faustRMS: true } }); t.after(() => h.close());
  assert.equal((await h.call('PUT', '/api/outputs/master/compressor', COMP)).status, 200);
  h.lang.faustRMS = false;
  await h.call('POST', '/api/engine/restart');
  assert.equal(h.engine.state().models.FaustRMS, false);
  const eq = await h.call('PUT', '/api/outputs/master/eq', { ...defaultOutput().eq, low: 0.4, mid: 0.5, high: 0.6 });
  assert.equal(eq.status, 200);
  assert.equal((await h.call('PUT', '/api/outputs/master/compressor', COMP)).body.error.code, 'MODEL_UNAVAILABLE');
});

test('anciens champs refusés (400 VALIDATION) : ceilingDb du clipper, ratio, makeupDb, champs incomplets', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const d = defaultOutput();
  const rejected = async (stage, body) => {
    const r = await h.call('PUT', `/api/outputs/master/${stage}`, body);
    assert.equal(r.status, 400, `${stage} ${JSON.stringify(body)}`);
    assert.equal(r.body.error.code, 'VALIDATION');
  };
  await rejected('clipper', { enabled: true, ceilingDb: -3 }); // ancien contrat : plafond symétrique en dB
  await rejected('clipper', { ...d.clipper, ceilingDb: -3 });
  await rejected('clipper', { ...d.clipper, lo: 0.5, hi: -0.5 }); // lo doit être inférieur à hi (Clip.schelp)
  await rejected('limiter', { enabled: true, ceilingDb: -3 }); // durMs manquant : objet complet exigé
  await rejected('limiter', { ...d.limiter, durMs: 51 });
  await rejected('compressor', { ...d.compressor, ratio: 4 });
  await rejected('compressor', { ...d.compressor, makeupDb: 0 });
  await rejected('infraHpf', { enabled: true, hz: 30 }); // mul, add, controlLag manquants
  await rejected('eq', { low: 0.5, mid: 0.5, high: 0.5 });
  await rejected('mix', { volume: 1 });
  const ok = await h.call('PUT', '/api/outputs/master/clipper', { ...d.clipper, enabled: true, lo: -0.5, hi: 0.5 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.clipper, { ...d.clipper, enabled: true, lo: -0.5, hi: 0.5 });
  assert.match(h.langs[0].commands().at(-1), /~mxSetOutputStage\.\(\\master, \\clipper, \(clipperEnabled: 1, clipperLo: -0.5, clipperHi: 0.5, clipperControlLag: 0\)\)/);
});
