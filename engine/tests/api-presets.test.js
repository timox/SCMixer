import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startHarness } from './helpers/api-harness.js';
import { defaultSourceProcessing } from '../src/contract/schemas.js';

const EQ = (low) => ({ ...defaultSourceProcessing().eq, low });

async function sessionWithAB(h) {
  const a = (await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 1 })).body;
  const b = (await h.call('POST', '/api/sources', { name: 'B', firstChannel: 3, width: 2 })).body;
  await h.call('PUT', `/api/sources/${b.id}/processing/eq`, EQ(0.7));
  await h.call('PUT', '/api/outputs/cue/limiter', { enabled: true, ceilingDb: -3, durMs: 10, controlLag: 0 });
  return { a, b };
}

const snapshot = (state) => ({ sources: state.sources, outputs: state.outputs });

test('presets : création, liste, application qui restaure exactement l\'instantané', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const { a, b } = await sessionWithAB(h);
  const saved = snapshot((await h.call('GET', '/api/state')).body);

  const created = await h.call('POST', '/api/presets', { name: 'Deux sources' });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'preset-1');
  assert.equal(created.body.name, 'Deux sources');
  assert.deepEqual((await h.call('GET', '/api/presets')).body.map((p) => p.id), ['preset-1']);

  // Divergence : suppression de A, ajout de C, changement de l'EQ de B et du limiteur de Cue.
  assert.equal((await h.call('DELETE', `/api/sources/${a.id}`)).status, 204);
  const c = (await h.call('POST', '/api/sources', { name: 'C', firstChannel: 10, width: 5 })).body;
  await h.call('PUT', `/api/sources/${b.id}/processing/eq`, EQ(0.2));
  await h.call('PUT', '/api/outputs/cue/limiter', { enabled: false, ceilingDb: -1, durMs: 10, controlLag: 0 });

  const before = h.langs[0].commands().length;
  const applied = await h.call('POST', '/api/presets/preset-1/apply');
  assert.equal(applied.status, 200);
  assert.deepEqual(snapshot(applied.body), saved);
  assert.deepEqual(snapshot((await h.call('GET', '/api/state')).body), saved);

  // Un seul passage par sclang : C sort en fondu, B est remplacé en fondu enchaîné, A revient.
  const commands = h.langs[0].commands().slice(before);
  assert.equal(commands.length, 1);
  const code = commands[0];
  assert.match(code, new RegExp(`~mxRemoveSource\\.\\("${c.id}"\\)`));
  assert.match(code, new RegExp(`~mxReplaceSource\\.\\("${b.id}"`));
  assert.match(code, new RegExp(`~mxAddSource\\.\\("${a.id}"`));
  assert.ok(code.indexOf('~mxRemoveSource') < code.indexOf('~mxAddSource'), 'retrait avant ajout');
  assert.match(code, /~mxSetOutputStage\.\(\\cue, \\limiter/);

  // Les identifiants ne sont jamais réutilisés : la source suivante ne reprend pas celui de C.
  const d = (await h.call('POST', '/api/sources', { name: 'D', firstChannel: 20, width: 1 })).body;
  assert.ok(Number(d.id.slice(4)) > Number(c.id.slice(4)));
});

test('preset contenant un modèle indisponible : 409, session et fichier inchangés', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await sessionWithAB(h);
  await h.call('POST', '/api/presets', { name: 'P' });
  const file = h.presets.fileOf('preset-1');
  const preset = JSON.parse(fs.readFileSync(file, 'utf8'));
  preset.content.outputs.master.compressor.model = 'FaustRMS';
  fs.writeFileSync(file, JSON.stringify(preset));
  const fileBefore = fs.readFileSync(file, 'utf8');
  const stateBefore = (await h.call('GET', '/api/state')).body;
  const commandsBefore = h.langs[0].commands().length;

  const r = await h.call('POST', '/api/presets/preset-1/apply');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'MODEL_UNAVAILABLE');
  assert.deepEqual((await h.call('GET', '/api/state')).body, stateBefore);
  assert.equal(fs.readFileSync(file, 'utf8'), fileBefore);
  assert.equal(h.langs[0].commands().length, commandsBefore, 'aucun code sclang');
});

test('presets : suppression, inconnu, nom invalide, moteur arrêté', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  assert.equal((await h.call('DELETE', '/api/presets/preset-9')).status, 404);
  assert.equal((await h.call('POST', '/api/presets/preset-9/apply')).status, 404);
  assert.equal((await h.call('POST', '/api/presets', { name: '' })).status, 400);
  assert.equal((await h.call('POST', '/api/presets', { name: 'X', extra: 1 })).status, 400);
  await h.call('POST', '/api/presets', { name: 'X' });
  assert.equal((await h.call('DELETE', '/api/presets/preset-1')).status, 204);
  assert.deepEqual((await h.call('GET', '/api/presets')).body, []);

  await h.call('POST', '/api/presets', { name: 'Y' });
  await h.engine.stop();
  const r = await h.call('POST', '/api/presets/preset-2/apply');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ENGINE_NOT_RUNNING');
});
