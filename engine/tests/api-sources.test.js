import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers/api-harness.js';

const NEW = { name: 'A', firstChannel: 1, width: 2 };

test('POST /api/sources : 201, src-1 et traitement par défaut', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('POST', '/api/sources', NEW);
  assert.equal(r.status, 201);
  assert.equal(r.body.id, 'src-1');
  assert.equal(r.body.processing.mix.volume, 1);
  assert.equal(r.body.processing.hp.model, 'BHiPass');
  const list = await h.call('GET', '/api/sources');
  assert.deepEqual(list.body.map((s) => s.id), ['src-1']);
  assert.equal((await h.call('GET', '/api/sources/src-1')).body.name, 'A');
});

test('création : champ inconnu 400, chevauchement 409, moteur arrêté 409', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const bad = await h.call('POST', '/api/sources', { ...NEW, extra: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  await h.call('POST', '/api/sources', NEW);
  const overlap = await h.call('POST', '/api/sources', { name: 'B', firstChannel: 2, width: 1 });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body.error.code, 'CHANNEL_OVERLAP');
  const g = await startHarness({ running: false }); t.after(() => g.close());
  const stopped = await g.call('POST', '/api/sources', NEW);
  assert.equal(stopped.status, 409);
  assert.equal(stopped.body.error.code, 'ENGINE_NOT_RUNNING');
});

test('JSON malformé : 400 VALIDATION', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('POST', '/api/sources', '{"name":');
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION');
});

test('PUT processing/eq avec champ en trop : 400 VALIDATION', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const r = await h.call('PUT', '/api/sources/src-1/processing/eq', { low: 0.5, mid: 0.5, high: 0.5, extra: 1 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION');
});

test('PUT processing/hp RHPF : 200 et code sclang envoyé', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const r = await h.call('PUT', '/api/sources/src-1/processing/hp', { enabled: true, model: 'RHPF', freq: 0.3, q: 2, mul: 1, add: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.processing.hp.model, 'RHPF');
  const last = h.langs[0].commands().at(-1);
  assert.match(last, /~mxSetSourceStage\.\("src-1", \\hp, \(.*model: \\RHPF.*\)\)/);
});

test('PUT bandCompressor/{band} et étage inconnu', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const band = { thresholdDb: -30, ratio: 2, attackMs: 5, releaseMs: 50, makeupDb: 1, bypass: false };
  const r = await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/mid', band);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing.bandCompressor.mid, band);
  assert.match(h.langs[0].commands().at(-1), /band: \\mid/);
  assert.equal((await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/top', band)).status, 404);
  assert.equal((await h.call('PUT', '/api/sources/src-1/processing/nope', {})).status, 404);
});

test('hp/reset et lp/reset rétablissent les défauts', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  await h.call('PUT', '/api/sources/src-1/processing/lp', { enabled: true, model: 'RLPF', freq: 0.2, q: 3, gain: 2, mul: 1, add: 0 });
  const r = await h.call('POST', '/api/sources/src-1/processing/lp/reset');
  assert.equal(r.status, 200);
  assert.equal(r.body.processing.lp.model, 'BLowPass');
  assert.equal(r.body.processing.lp.enabled, false);
  assert.equal((await h.call('POST', '/api/sources/src-1/processing/hp/reset')).status, 200);
});

test('lp/reset-state : 400 sur BLowPass, ok sur MoogFF', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const bad = await h.call('POST', '/api/sources/src-1/processing/lp/reset-state');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  await h.call('PUT', '/api/sources/src-1/processing/lp', { enabled: true, model: 'MoogFF', freq: 0.5, q: 1, gain: 2, mul: 1, add: 0 });
  const ok = await h.call('POST', '/api/sources/src-1/processing/lp/reset-state');
  assert.equal(ok.status, 200);
  assert.match(h.langs[0].commands().at(-1), /~mxResetMoog\.\("src-1"\)/);
});

test('PATCH : nom seul sans recréation, largeur recrée la source ; DELETE 204', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const n = h.langs[0].commands().length;
  const renamed = await h.call('PATCH', '/api/sources/src-1', { name: 'Z' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Z');
  assert.doesNotMatch(h.langs[0].commands().slice(n).join('\n'), /mxAddSource|mxRemoveSource/);
  const wide = await h.call('PATCH', '/api/sources/src-1', { width: 4 });
  assert.equal(wide.body.width, 4);
  const code = h.langs[0].commands().at(-1);
  assert.match(code, /~mxRemoveSource\.\("src-1"\); ~mxAddSource\.\("src-1", 0, 1, 4,/);
  assert.equal((await h.call('PATCH', '/api/sources/src-1', {})).status, 400);
  const del = await h.call('DELETE', '/api/sources/src-1');
  assert.equal(del.status, 204);
  assert.equal((await h.call('GET', '/api/sources/src-1')).status, 404);
});

test('identifiant numérique ou inconnu : 404', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const eq = { low: 0.5, mid: 0.5, high: 0.5 };
  assert.equal((await h.call('PUT', '/api/sources/0/processing/eq', eq)).status, 404);
  assert.equal((await h.call('GET', '/api/sources/0')).status, 404);
  assert.equal((await h.call('DELETE', '/api/sources/src-9')).body.error.code, 'NOT_FOUND');
});
