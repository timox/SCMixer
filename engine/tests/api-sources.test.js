import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers/api-harness.js';
import { defaultSourceProcessing } from '../src/contract/schemas.js';

const D = defaultSourceProcessing();

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
  const r = await h.call('PUT', '/api/sources/src-1/processing/hp', { ...D.hp, enabled: true, model: 'RHPF', freq: 0.3, q: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.processing.hp.model, 'RHPF');
  const last = h.langs[0].commands().at(-1);
  assert.match(last, /~mxSetSourceStage\.\("src-1", \\hp, \(.*model: \\RHPF.*\)\)/);
});

test('PUT bandCompressor/{band} et étage inconnu', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const band = { ...D.bandCompressor.mid, thresholdDb: -30, slopeAbove: 0.5, attackMs: 5, releaseMs: 50, mul: 1.2, bypass: false };
  const r = await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/mid', band);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing.bandCompressor.mid, band);
  assert.match(h.langs[0].commands().at(-1), /band: \\mid/);
  assert.equal((await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/top', band)).status, 404);
  assert.equal((await h.call('PUT', '/api/sources/src-1/processing/nope', {})).status, 404);
});

test('RAZ par étage : tout étage de source rétablit son défaut, étage inconnu 404', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  await h.call('PUT', '/api/sources/src-1/processing/lp', { ...D.lp, enabled: true, model: 'RLPF', freq: 0.2, q: 3 });
  await h.call('PUT', '/api/sources/src-1/processing/eq', { ...D.eq, low: 0.2 });
  const r = await h.call('POST', '/api/sources/src-1/processing/lp/reset');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing.lp, D.lp);
  assert.equal(r.body.processing.eq.low, 0.2);
  assert.match(h.langs[0].commands().at(-1), /~mxSetSourceStage\.\("src-1", \\lp, /);
  for (const stage of ['mix', 'input', 'inputCompressor', 'eq', 'hp', 'pitch']) {
    const s = await h.call('POST', `/api/sources/src-1/processing/${stage}/reset`);
    assert.equal(s.status, 200, stage);
    assert.deepEqual(s.body.processing[stage], D[stage]);
  }
  assert.equal((await h.call('POST', '/api/sources/src-1/processing/nope/reset')).status, 404);
  assert.equal((await h.call('POST', '/api/sources/src-9/processing/eq/reset')).status, 404);
});

test('RAZ d\'une bande du multibande et de la répartition', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/mid', { ...D.bandCompressor.mid, thresholdDb: -30, bypass: false });
  await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/crossover', { ...D.bandCompressor.crossover, lowMidFreq: 300 });
  const r = await h.call('POST', '/api/sources/src-1/processing/bandCompressor/mid/reset');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing.bandCompressor.mid, D.bandCompressor.mid);
  assert.equal(r.body.processing.bandCompressor.crossover.lowMidFreq, 300);
  assert.match(h.langs[0].commands().at(-1), /band: \\mid/);
  const c = await h.call('POST', '/api/sources/src-1/processing/bandCompressor/crossover/reset');
  assert.deepEqual(c.body.processing.bandCompressor.crossover, D.bandCompressor.crossover);
  assert.equal((await h.call('POST', '/api/sources/src-1/processing/bandCompressor/top/reset')).status, 404);
});

test('RAZ de toute la source : chaîne complète, mix compris, nom et canaux gardés', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  await h.call('PUT', '/api/sources/src-1/processing/mix', { ...D.mix, volume: 0.3, mute: true });
  await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/high', { ...D.bandCompressor.high, bypass: false });
  const r = await h.call('POST', '/api/sources/src-1/processing/reset');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing, D);
  assert.deepEqual([r.body.name, r.body.firstChannel, r.body.width], ['A', 1, 2]);
  const code = h.langs[0].commands().at(-1);
  for (const stage of ['mix', 'input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch']) assert.ok(code.includes(`"src-1", \\${stage}, `), stage);
  for (const band of ['low', 'mid', 'high', 'crossover']) assert.ok(code.includes(`band: \\${band}`), band);
  assert.equal((await h.call('POST', '/api/sources/src-9/processing/reset')).status, 404);
});

test('lp/reset-state : 400 sur BLowPass, ok sur MoogFF', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const bad = await h.call('POST', '/api/sources/src-1/processing/lp/reset-state');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  await h.call('PUT', '/api/sources/src-1/processing/lp', { ...D.lp, enabled: true, model: 'MoogFF', freq: 0.5 });
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
  // Un seul appel : construction de la largeur, puis fondu enchaîné ancienne/nouvelle chaîne dans un seul bundle.
  assert.match(code, /~mxReplaceSource\.\("src-1", 0, 1, 4,/);
  assert.doesNotMatch(code, /mxRemoveSource|mxAddSource/);
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

test('dimensionnement dépassé : 409 ENGINE_RESTART_REQUIRED, source non créée', async (t) => {
  const h = await startHarness({ engineOptions: { sizing: { maxSourceWidth: 2, maxSources: 1 } } }); t.after(() => h.close());
  const wide = await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 3 });
  assert.equal(wide.status, 409);
  assert.equal(wide.body.error.code, 'ENGINE_RESTART_REQUIRED');
  assert.equal((await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 2 })).status, 201);
  const many = await h.call('POST', '/api/sources', { name: 'B', firstChannel: 3, width: 1 });
  assert.equal(many.status, 409);
  assert.equal(many.body.error.code, 'ENGINE_RESTART_REQUIRED');
  const grow = await h.call('PATCH', '/api/sources/src-1', { width: 3 });
  assert.equal(grow.status, 409);
  assert.equal(grow.body.error.code, 'ENGINE_RESTART_REQUIRED');
  assert.deepEqual((await h.call('GET', '/api/sources')).body.map((s) => [s.id, s.width]), [['src-1', 2]]);
});

test('anciens champs refusés (400 VALIDATION) : ratio, makeupDb, étages incomplets, contrôles hors plage', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const rejected = async (path, body) => {
    const r = await h.call('PUT', `/api/sources/src-1/processing/${path}`, body);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.equal(r.body.error.code, 'VALIDATION');
  };
  const oldBand = { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: true };
  await rejected('inputCompressor', oldBand);
  await rejected('bandCompressor/low', oldBand);
  await rejected('inputCompressor', { ...D.inputCompressor, ratio: 4 });
  await rejected('inputCompressor', { ...D.inputCompressor, makeupDb: 0 });
  await rejected('bandCompressor/mid', { ...D.bandCompressor.mid, ratio: 4 });
  await rejected('eq', { low: 0.5, mid: 0.5, high: 0.5 });
  await rejected('hp', { enabled: true, model: 'BHiPass', freq: 0, q: 1, mul: 1, add: 0 });
  await rejected('pitch', { semitones: 3 });
  await rejected('mix', { volume: 1, cue: 0, mute: false, balance: 0.5 });
  await rejected('inputCompressor', { ...D.inputCompressor, slopeAbove: 11 });
  await rejected('hp', { ...D.hp, minHz: 5000, maxHz: 100 });
  await rejected('pitch', { ...D.pitch, windowSize: 0.3 });
  await rejected('pitch', { ...D.pitch, windowSize: 0.05, timeDispersion: 0.1 });
  await rejected('eq', { ...D.eq, controlLag: -1 });
  await rejected('bandCompressor/crossover', { ...D.bandCompressor.crossover, lowMidFreq: 5000, midHighFreq: 4000 });
  assert.deepEqual((await h.call('GET', '/api/sources/src-1')).body.processing, D);
});

test('PUT bandCompressor/crossover : filtres de répartition, noms de contrôles préfixés', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  const crossover = { ...D.bandCompressor.crossover, lowMidFreq: 300, lowLp2Mul: 0.9, midHp1Add: 0.01 };
  const r = await h.call('PUT', '/api/sources/src-1/processing/bandCompressor/crossover', crossover);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing.bandCompressor.crossover, crossover);
  const code = h.langs[0].commands().at(-1);
  assert.match(code, /~mxSetSourceStage\.\("src-1", \\bandCompressor, \(band: \\crossover, crossoverLowMidFreq: 300, /);
  assert.match(code, /crossoverLowLp2Mul: 0\.9/);
  assert.match(code, /crossoverMidHp1Add: 0\.01/);
});

test('étage mis à jour : le code sclang porte les noms de contrôles du contrat (préfixe de groupe si la SynthDef en porte plusieurs)', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', NEW);
  await h.call('PUT', '/api/sources/src-1/processing/inputCompressor', { ...D.inputCompressor, slopeBelow: 1.5, mul: 2, bypass: false });
  assert.match(h.langs[0].commands().at(-1), /\\inputCompressor, \(inputCompressorThresholdDb: -20, inputCompressorSlopeBelow: 1\.5, inputCompressorSlopeAbove: 0\.25, /);
  await h.call('PUT', '/api/sources/src-1/processing/eq', { ...D.eq, lowFreq: 120, midRq: 0.9 });
  assert.match(h.langs[0].commands().at(-1), /\\eq, \(low: 0\.5, mid: 0\.5, high: 0\.5, rangeDb: 12, lowFreq: 120, lowRs: 0\.5, /);
  await h.call('PUT', '/api/sources/src-1/processing/pitch', { ...D.pitch, semitones: 5, blend: 1, windowSize: 0.1 });
  assert.match(h.langs[0].commands().at(-1), /\\pitch, \(semitones: 5, blend: 1, level: 1, windowSize: 0\.1, /);
});
