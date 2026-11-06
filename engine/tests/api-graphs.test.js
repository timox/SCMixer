import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { startHarness } from './helpers/api-harness.js';
import { defaultSourceProcessing } from '../src/contract/schemas.js';
import { SC_DOC_BASE } from '../src/contract/chains.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = parse(fs.readFileSync(path.join(here, '..', 'openapi.yaml'), 'utf8'));
const SOURCE_ORDER = ['input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch', 'bandCompressor', 'mix'];
const names = (stage) => stage.docs.map((d) => d.name);

async function withSource(t, width) {
  const h = await startHarness(); t.after(() => h.close());
  const created = await h.call('POST', '/api/sources', { name: 'Essai', firstChannel: 1, width });
  assert.equal(created.status, 201);
  return { h, id: created.body.id };
}

test('source : étages ordonnés, libellés du catalogue, ordre identique à openapi.yaml', async (t) => {
  const { h, id } = await withSource(t, 2);
  const r = await h.call('GET', `/api/sources/${id}/processing-graph`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((s) => s.stage), SOURCE_ORDER);
  assert.deepEqual(spec.components.schemas.SourceGraphStage.properties.stage.enum, SOURCE_ORDER);
  assert.ok(spec.paths['/api/sources/{id}/processing-graph'].get.description.includes(SOURCE_ORDER.join(', ')));
  const catalog = (await h.call('GET', '/api/parameters')).body;
  for (const stage of r.body.filter((s) => s.stage !== 'bandCompressor')) {
    assert.equal(stage.label, catalog.source[stage.stage].label, stage.stage);
  }
  assert.equal(r.body.find((s) => s.stage === 'bandCompressor').label, 'Compresseur multibande');
  assert.equal((await h.call('GET', '/api/sources/src-99/processing-graph')).status, 404);
});

test('source : états selon les réglages (défauts puis modifications)', async (t) => {
  const { h, id } = await withSource(t, 2);
  const enabled = async () => Object.fromEntries(
    (await h.call('GET', `/api/sources/${id}/processing-graph`)).body.map((s) => [s.stage, s.enabled]),
  );
  const d = defaultSourceProcessing();
  assert.deepEqual(await enabled(), {
    input: true,
    inputCompressor: !d.inputCompressor.bypass,
    eq: true,
    hp: d.hp.enabled,
    lp: d.lp.enabled,
    pitch: d.pitch.blend > -1,
    bandCompressor: ['low', 'mid', 'high'].some((b) => !d.bandCompressor[b].bypass),
    mix: !d.mix.mute,
  });
  assert.equal((await h.call('PUT', `/api/sources/${id}/processing/hp`, { ...d.hp, enabled: true })).status, 200);
  assert.equal((await h.call('PUT', `/api/sources/${id}/processing/bandCompressor/mid`, { ...d.bandCompressor.mid, bypass: false })).status, 200);
  assert.equal((await h.call('PUT', `/api/sources/${id}/processing/mix`, { ...d.mix, mute: true })).status, 200);
  const after = await enabled();
  assert.equal(after.hp, true);
  assert.equal(after.bandCompressor, true);
  assert.equal(after.mix, false);
});

test('source : documentation selon le modèle de filtre et la largeur', async (t) => {
  const { h, id } = await withSource(t, 1);
  const graph = async () => Object.fromEntries(
    (await h.call('GET', `/api/sources/${id}/processing-graph`)).body.map((s) => [s.stage, s]),
  );
  const d = defaultSourceProcessing();
  let g = await graph();
  assert.deepEqual(names(g.lp), [d.lp.model, 'Lag']);
  assert.deepEqual(names(g.mix), ['Pan2', 'Lag']);
  assert.deepEqual(names(g.eq), ['BLowShelf', 'BPeakEQ', 'BHiShelf', 'Lag']);
  assert.equal((await h.call('PUT', `/api/sources/${id}/processing/lp`, { ...d.lp, model: 'MoogFF' })).status, 200);
  assert.equal((await h.call('PATCH', `/api/sources/${id}`, { width: 4 })).status, 200);
  g = await graph();
  assert.equal(g.lp.requestedModel, 'MoogFF');
  assert.equal(g.lp.loadedModel, 'MoogFF');
  assert.deepEqual(names(g.lp), ['MoogFF', 'Lag']);
  assert.deepEqual(names(g.mix), ['Splay', 'Balance2', 'Lag']);
  for (const stage of Object.values(g)) {
    for (const entry of stage.docs) assert.equal(entry.url, `${SC_DOC_BASE}${entry.name}.html`);
  }
});

test('sortie : libellés et documentation du compresseur selon le modèle ; UGen local sans lien', async (t) => {
  const h = await startHarness({ lang: { faustRMS: true } }); t.after(() => h.close());
  let g = (await h.call('GET', '/api/outputs/master/processing-graph')).body;
  assert.deepEqual(g.map((s) => s.label),
    ['Passe-haut infra', 'Passe-haut latéral', 'EQ 3 bandes', 'Volume', 'Écrêteur', 'Limiteur', 'Compresseur']);
  assert.deepEqual(names(g.find((s) => s.stage === 'limiter')), ['Limiter', 'Lag']);
  const comp = (await h.call('GET', '/api/state')).body.outputs.master.compressor;
  assert.equal((await h.call('PUT', '/api/outputs/master/compressor', { ...comp, model: 'CompanderD' })).status, 200);
  g = (await h.call('GET', '/api/outputs/master/processing-graph')).body;
  assert.deepEqual(names(g.at(-1)), ['CompanderD', 'DelayN', 'Lag']);
  assert.equal((await h.call('PUT', '/api/outputs/master/compressor', { ...comp, model: 'FaustRMS' })).status, 200);
  g = (await h.call('GET', '/api/outputs/master/processing-graph')).body;
  assert.deepEqual(g.at(-1).docs[0], { name: 'MixetteFaustRMS', url: null });
});
