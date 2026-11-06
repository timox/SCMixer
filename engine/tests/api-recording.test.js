import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WebSocket } from 'ws';
import { startHarness } from './helpers/api-harness.js';
import { defaultRecordingsDir } from '../src/main.js';
import { REC_STOP_CODE } from '../src/sc/commands.js';

function collect(ws) {
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  return messages;
}
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 20)); };

test('GET /api/recording : arrêté au départ ; présent dans GET /api/state', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('GET', '/api/recording');
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'stopped');
  assert.equal(r.body.file, null);
  assert.equal(r.body.channels, 2);
  assert.deepEqual((await h.call('GET', '/api/state')).body.recording, r.body);
});

test('cycle start, pause, resume, stop : réponses et événements recordingChanged', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/api/ws`);
  const messages = collect(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const started = await h.call('POST', '/api/recording/start', { sampleFormat: 'int24' });
  assert.equal(started.status, 200);
  assert.equal(started.body.state, 'recording');
  assert.equal(started.body.sampleRate, 48000);
  assert.equal(path.dirname(started.body.file), h.recordingsDir);
  assert.equal((await h.call('POST', '/api/recording/pause')).body.state, 'paused');
  assert.equal((await h.call('POST', '/api/recording/resume')).body.state, 'recording');
  const stopped = await h.call('POST', '/api/recording/stop');
  assert.equal(stopped.body.state, 'stopped');
  assert.equal(stopped.body.stopReason, 'user');
  await until(() => messages.filter((m) => m.type === 'recordingChanged').length >= 4);
  assert.deepEqual(messages.filter((m) => m.type === 'recordingChanged').map((m) => m.data.state),
    ['recording', 'paused', 'recording', 'stopped']);
  assert.equal(messages.find((m) => m.type === 'stateChanged').data.recording.state, 'stopped');
});

test('validation : précision inconnue ou champ en trop refusés (400)', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const bad = await h.call('POST', '/api/recording/start', { sampleFormat: 'int32' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  assert.equal((await h.call('POST', '/api/recording/start', { sampleFormat: 'int24', x: 1 })).status, 400);
  assert.equal((await h.call('POST', '/api/recording/start', {})).status, 400);
});

test('refus d\'état : 409 RECORDING_STATE', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('POST', '/api/recording/pause');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'RECORDING_STATE');
});

test('moteur arrêté : start refusé 409 ENGINE_NOT_RUNNING', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const r = await h.call('POST', '/api/recording/start', { sampleFormat: 'int24' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ENGINE_NOT_RUNNING');
  assert.equal((await h.call('GET', '/api/recording')).body.state, 'stopped');
});

test('arrêt du moteur pendant l\'enregistrement : fichier fermé avant s.quit, motif engineStopped', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  await h.call('POST', '/api/recording/start', { sampleFormat: 'int16' });
  assert.equal((await h.call('POST', '/api/engine/stop')).status, 200);
  const calls = h.langs[0].calls;
  const stopAt = calls.findIndex((c) => c.includes(REC_STOP_CODE));
  const quitAt = calls.findIndex((c) => c === 's.quit');
  assert.ok(stopAt >= 0, 'commande d\'arrêt d\'enregistrement envoyée');
  assert.ok(quitAt > stopAt, 's.quit après la fermeture du fichier');
  const r = (await h.call('GET', '/api/recording')).body;
  assert.equal(r.state, 'stopped');
  assert.equal(r.stopReason, 'engineStopped');
});

test('mort de scsynth pendant l\'enregistrement : motif error', async (t) => {
  let alive = true;
  const h = await startHarness({ engineOptions: { isAlive: () => alive, watchIntervalMs: 10 } }); t.after(() => h.close());
  await h.call('POST', '/api/recording/start', { sampleFormat: 'float' });
  alive = false;
  await until(() => h.engine.state().status === 'failed');
  const r = (await h.call('GET', '/api/recording')).body;
  assert.equal(r.state, 'stopped');
  assert.equal(r.stopReason, 'error');
  assert.match(r.error, /scsynth/);
});

test('dossier des enregistrements : variable SCMIXER_RECORDINGS_DIR, sinon Documents\\SCMixer\\Enregistrements', () => {
  assert.equal(defaultRecordingsDir({ SCMIXER_RECORDINGS_DIR: 'X:\\r' }), 'X:\\r');
  assert.equal(defaultRecordingsDir({}, () => 'D:\\Docs'), path.join('D:\\Docs', 'SCMixer', 'Enregistrements'));
});
