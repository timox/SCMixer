import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startHarness } from './helpers/api-harness.js';
import { defaultSourceProcessing, defaultOutput } from '../src/contract/schemas.js';

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
  assert.deepEqual(Object.keys(body).sort(), ['engine', 'outputs', 'sources']);
  assert.equal(body.engine.status, 'stopped');
  assert.equal(body.engine.audioClock, null);
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
  assert.match(h.langs[0].commands().at(-1), /'\/g_queryTree', 0, 0\)/);
  assert.equal((await h.call('GET', '/api/engine/node-tree?controls=true')).status, 200);
  assert.match(h.langs[0].commands().at(-1), /'\/g_queryTree', 0, 1\)/);
  assert.equal((await h.call('GET', '/api/engine/node-tree?controls=false')).status, 200);
  assert.match(h.langs[0].commands().at(-1), /'\/g_queryTree', 0, 0\)/);
  const bad = await h.call('GET', '/api/engine/node-tree?controls=oui');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
});

test('horloge audio imposée par TimoxVasio : lue dans /api/engine et /api/state', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  assert.equal((await h.call('GET', '/api/engine')).body.audioClock, null);
  const started = await h.call('POST', '/api/engine/start');
  assert.deepEqual(started.body.audioClock, { sampleRate: 48000, bufferFrames: 2048 });
  assert.deepEqual((await h.call('GET', '/api/state')).body.engine.audioClock, { sampleRate: 48000, bufferFrames: 2048 });
});

test('ancien contrat profil audio : GET et PUT /api/engine/audio-profile répondent 404', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const get = await h.call('GET', '/api/engine/audio-profile');
  assert.equal(get.status, 404);
  assert.equal(get.body.error.code, 'NOT_FOUND');
  assert.equal((await h.call('PUT', '/api/engine/audio-profile', { sampleRate: 48000, bufferFrames: 256 })).status, 404);
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

test('journal : lignes de sclang et repères du service, lecture après un numéro, événement engineLog', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/api/ws`);
  const messages = collect(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const before = (await h.call('GET', '/api/engine/log')).body;
  assert.ok(before.lines.some((l) => l.stream === 'service' && l.text === 'moteur running'));
  assert.ok(before.lines.some((l) => l.stream === 'stdout' && l.text.startsWith('MX-SIZING ')));
  h.langs[0].output('stdout', 'ligne 1\r\nligne 2\n');
  h.langs[0].output('stderr', 'ERROR: x');
  const after = (await h.call('GET', `/api/engine/log?after=${before.lastSeq}`)).body;
  assert.deepEqual(after.lines.map((l) => [l.seq, l.stream, l.text]), [
    [before.lastSeq + 1, 'stdout', 'ligne 1'], [before.lastSeq + 2, 'stdout', 'ligne 2'], [before.lastSeq + 3, 'stderr', 'ERROR: x'],
  ]);
  assert.equal(after.lastSeq, before.lastSeq + 3);
  assert.match(after.lines[0].time, /^\d{4}-\d\d-\d\dT/);
  await until(() => messages.filter((m) => m.type === 'engineLog').length >= 3);
  assert.deepEqual(messages.filter((m) => m.type === 'engineLog').map((m) => m.data.text), ['ligne 1', 'ligne 2', 'ERROR: x']);
  await h.call('POST', '/api/engine/stop');
  const stopped = (await h.call('GET', `/api/engine/log?after=${after.lastSeq}`)).body;
  assert.deepEqual(stopped.lines.map((l) => l.text), ['moteur stopping', 'moteur stopped']);
  for (const bad of ['-1', 'x', '01']) assert.equal((await h.call('GET', `/api/engine/log?after=${bad}`)).status, 400);
  ws.close();
});

test('RAZ globale : traitements de toutes les sources et des sorties, volumes compris ; sources et canaux gardés', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/sources', { name: 'A', firstChannel: 1, width: 2 });
  await h.call('POST', '/api/sources', { name: 'B', firstChannel: 3, width: 1 });
  const src = (await h.call('GET', '/api/sources/src-1')).body;
  await h.call('PUT', '/api/sources/src-1/processing/mix', { ...src.processing.mix, volume: 0.2, mute: true });
  await h.call('PUT', '/api/sources/src-2/processing/bandCompressor/low', { ...src.processing.bandCompressor.low, bypass: false });
  const master = (await h.call('GET', '/api/state')).body.outputs.master;
  await h.call('PUT', '/api/outputs/master/mix', { ...master.mix, volume: 0.1 });
  const r = await h.call('POST', '/api/processing/reset');
  assert.equal(r.status, 200);
  const code = h.langs[0].commands().at(-1);
  assert.match(code, /~mxSetSourceStage\.\("src-1", \\mix, /);
  assert.match(code, /~mxSetSourceStage\.\("src-2", \\bandCompressor, \(.*band: \\low/);
  assert.match(code, /~mxSetOutputStage\.\(\\cue, \\compressor, /);
  assert.deepEqual(r.body.sources.map((s) => [s.id, s.name, s.firstChannel, s.width]), [['src-1', 'A', 1, 2], ['src-2', 'B', 3, 1]]);
  for (const s of r.body.sources) assert.deepEqual(s.processing, defaultSourceProcessing());
  assert.deepEqual(r.body.outputs, { master: defaultOutput(), cue: defaultOutput() });
  const g = await startHarness({ running: false }); t.after(() => g.close());
  assert.equal((await g.call('POST', '/api/processing/reset')).status, 409);
});
