import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PresetStore } from '../src/session/preset-store.js';
import { emptySession, addSource } from '../src/session/session-model.js';
import { ApiError } from '../src/contract/errors.js';

const withDir = (fn) => () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const sess = () => addSource(emptySession(), { name: 'A', firstChannel: 1, width: 2 }).session;

test('create/list/get/remove', withDir((dir) => {
  const store = new PresetStore(dir);
  const s = sess();
  const p = store.create('Live', s);
  assert.equal(p.id, 'preset-1');
  assert.equal(p.version, 1);
  assert.equal(p.name, 'Live');
  assert.ok(!Number.isNaN(Date.parse(p.createdAt)));
  assert.deepEqual(p.content, { sources: s.sources, outputs: s.outputs });
  assert.deepEqual(store.get('preset-1'), p);
  assert.deepEqual(store.list(), [{ id: 'preset-1', name: 'Live', createdAt: p.createdAt }]);
  store.remove('preset-1');
  assert.deepEqual(store.list(), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'presets')).sort(), ['sequence.json']);
}));

test('ids jamais reutilises, compteur persiste', withDir((dir) => {
  const a = new PresetStore(dir);
  a.create('A', sess());
  a.remove('preset-1');
  const b = new PresetStore(dir);
  assert.equal(b.create('B', sess()).id, 'preset-2');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'presets', 'sequence.json'), 'utf8')), { nextPresetSeq: 3 });
}));

test('get/remove inconnu : NOT_FOUND', withDir((dir) => {
  const store = new PresetStore(dir);
  for (const f of [() => store.get('preset-9'), () => store.remove('preset-9'), () => store.get('../x')]) {
    assert.throws(f, (e) => e instanceof ApiError && e.code === 'NOT_FOUND' && e.status === 404);
  }
}));

test('nom invalide : VALIDATION', withDir((dir) => {
  assert.throws(() => new PresetStore(dir).create('', sess()), (e) => e instanceof ApiError && e.code === 'VALIDATION');
}));

test('contenu invalide sur disque : exclu de list, get leve', withDir((dir) => {
  const store = new PresetStore(dir);
  store.create('Ok', sess());
  const file = path.join(dir, 'presets', 'preset-7.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, id: 'preset-7', name: 'Bad', createdAt: new Date().toISOString(), content: { sources: 'x', outputs: {} } }));
  assert.deepEqual(store.list().map((p) => p.id), ['preset-1']);
  assert.throws(() => store.get('preset-7'), (e) => e instanceof ApiError && e.code === 'VALIDATION' && e.message.includes('preset-7.json'));
}));
