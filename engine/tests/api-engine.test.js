import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startHarness } from './helpers/api-harness.js';

function collect(ws) {
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  return messages;
}
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 20)); };

test('cycle de vie : start, stop, restart renvoient EngineState', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  assert.equal((await h.call('GET', '/api/engine')).body.status, 'stopped');
  const s = await h.call('POST', '/api/engine/start');
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'running');
  assert.equal((await h.call('POST', '/api/engine/restart')).body.status, 'running');
  assert.equal((await h.call('POST', '/api/engine/stop')).body.status, 'stopped');
});

test('GET /api/state', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const { body } = await h.call('GET', '/api/state');
  assert.deepEqual(Object.keys(body).sort(), ['audioProfile', 'engine', 'outputs', 'sources']);
  assert.equal(body.engine.status, 'stopped');
});

test('runtime null et node-tree', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const rt = await h.call('GET', '/api/engine/runtime');
  assert.equal(rt.status, 200);
  assert.equal(rt.body, null);
  assert.equal((await h.call('GET', '/api/engine/node-tree')).body.error.code, 'ENGINE_NOT_RUNNING');
  await h.call('POST', '/api/engine/start');
  const tree = await h.call('GET', '/api/engine/node-tree');
  assert.equal(tree.status, 200);
  assert.deepEqual(tree.body, { rootId: 0, nodes: [] });
});

test('profil audio : lecture, écriture, champ device refusé', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  assert.deepEqual((await h.call('GET', '/api/engine/audio-profile')).body, { sampleRate: 48000, bufferFrames: 256 });
  const ok = await h.call('PUT', '/api/engine/audio-profile', { sampleRate: 96000, bufferFrames: 128 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { sampleRate: 96000, bufferFrames: 128 });
  const bad = await h.call('PUT', '/api/engine/audio-profile', { sampleRate: 48000, bufferFrames: 256, device: 'x' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  assert.equal((await h.call('PUT', '/api/engine/audio-profile', { sampleRate: 1, bufferFrames: 256 })).status, 400);
});

test('WebSocket : stateChanged à la connexion et après mutation, engineStateChanged, meters', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/api/ws`);
  const messages = collect(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => messages.length >= 1);
  assert.equal(messages[0].type, 'stateChanged');
  assert.equal(messages[0].data.engine.status, 'running');
  await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 1 });
  await until(() => messages.filter((m) => m.type === 'stateChanged').length >= 2);
  const last = messages.filter((m) => m.type === 'stateChanged').at(-1);
  assert.equal(last.data.sources[0].id, 'src-1');
  h.engine.emit('meter', { type: 'sourceMeter', data: { sourceId: 'src-1', peakDb: -3, rmsDb: -6 } });
  h.engine.emit('runtime', { type: 'engineRuntimeChanged', data: { cpuAvg: 1 } });
  await h.call('POST', '/api/engine/stop');
  await until(() => messages.some((m) => m.type === 'engineStateChanged' && m.data.status === 'stopped'));
  assert.ok(messages.some((m) => m.type === 'sourceMeter' && m.data.sourceId === 'src-1'));
  assert.ok(messages.some((m) => m.type === 'engineRuntimeChanged'));
  ws.close();
});

test('trame WebSocket invalide : le service survit et les autres clients reçoivent', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const bad = new WebSocket(`ws://127.0.0.1:${h.port}/api/ws`);
  const good = new WebSocket(`ws://127.0.0.1:${h.port}/api/ws`);
  const messages = collect(good);
  bad.on('error', () => {});
  await Promise.all([bad, good].map((w) => new Promise((r) => w.once('open', r))));
  bad._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0])); // opcode réservé
  await new Promise((r) => setTimeout(r, 150));
  await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 1 });
  await until(() => messages.filter((m) => m.type === 'stateChanged').length >= 2);
  assert.ok(messages.filter((m) => m.type === 'stateChanged').length >= 2);
  good.close();
});

test('erreur interne : message générique sans détail', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  h.engine.runtime = () => { throw new Error('secret interne'); };
  const orig = console.error; console.error = () => {};
  const r = await h.call('GET', '/api/engine/runtime');
  console.error = orig;
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'INTERNAL');
  assert.doesNotMatch(r.body.error.message, /secret/);
});
