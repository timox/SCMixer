import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Recorder, recordingFileName, RECORDING_MAX_DATA_BYTES, RECORDING_MIN_FREE_BYTES,
} from '../src/runtime/recorder.js';
import { documentsDir } from '../src/runtime/documents-dir.js';
import { recStartCode, REC_PAUSE_CODE, REC_RESUME_CODE, REC_STOP_CODE } from '../src/sc/commands.js';

const FIXED = new Date(2026, 10, 6, 21, 4, 33);

/** Enregistreur avec faux sclang, horloge manuelle et date fixe ; aucun tic automatique. */
function setup({ reply = {}, freeBytes = () => 10 * RECORDING_MIN_FREE_BYTES } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-rec-'));
  const sent = [];
  let t = 0;
  const run = async (code) => {
    sent.push(code);
    if (code.startsWith('~mxRecStart')) return reply.start ?? 'recording|48000';
    if (code === REC_PAUSE_CODE) return 'paused';
    if (code === REC_RESUME_CODE) return 'recording';
    if (code === REC_STOP_CODE) return 'stopped';
    throw new Error(`code inattendu : ${code}`);
  };
  const recorder = new Recorder({ run, dir, now: () => t, clock: () => FIXED, freeBytes, tickMs: 0 });
  const events = [];
  recorder.on('changed', (s) => events.push(s));
  return { recorder, dir, sent, events, advance: (seconds) => { t += seconds * 1000; } };
}

const rejectsCode = (promise, code) => assert.rejects(promise, (e) => e.code === code);

test('nom de fichier : date locale du démarrage', () => {
  assert.equal(recordingFileName(FIXED), '2026-11-06_21-04-33_master.wav');
});

test('dossier Documents : dossier connu de Windows ; sortie vide refusée', () => {
  assert.equal(documentsDir(() => 'D:\\Docs\r\n'), 'D:\\Docs');
  assert.throws(() => documentsDir(() => ''));
});

test('état initial', () => {
  const { recorder } = setup();
  assert.deepEqual(recorder.state(), {
    state: 'stopped', file: null, sampleFormat: null, sampleRate: null, channels: 2,
    recordedSeconds: 0, bytes: 0, stopReason: null, error: null,
  });
});

test('cycle démarrage, pause, reprise, arrêt : durée et taille hors pause', async () => {
  const { recorder, dir, sent, events } = setup();
  const started = await recorder.start('int24');
  assert.equal(started.state, 'recording');
  assert.equal(started.sampleRate, 48000);
  assert.equal(started.sampleFormat, 'int24');
  assert.equal(started.file, path.join(dir, '2026-11-06_21-04-33_master.wav'));
  assert.equal(started.stopReason, null);
  assert.ok(fs.existsSync(dir));
  assert.equal(sent[0], recStartCode(started.file, 'int24'));
  assert.deepEqual(events.map((e) => e.state), ['recording']);
});

test('durées : pause exclue, taille calculée', async () => {
  const s = setup();
  await s.recorder.start('int24');
  s.advance(2);
  assert.equal((await s.recorder.pause()).state, 'paused');
  s.advance(10);
  assert.equal((await s.recorder.resume()).state, 'recording');
  s.advance(1);
  const stopped = await s.recorder.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.recordedSeconds, 3);
  assert.equal(stopped.bytes, 3 * 48000 * 2 * 3);
  assert.equal(stopped.stopReason, 'user');
  assert.ok(stopped.file.endsWith('_master.wav'), 'dernier fichier conservé');
  assert.deepEqual(s.events.map((e) => e.state), ['recording', 'paused', 'recording', 'stopped']);
  assert.deepEqual(s.sent.slice(1), [REC_PAUSE_CODE, REC_RESUME_CODE, REC_STOP_CODE]);
});

test('refus : action impossible dans l\'état courant', async () => {
  const { recorder } = setup();
  await rejectsCode(recorder.pause(), 'RECORDING_STATE');
  await rejectsCode(recorder.resume(), 'RECORDING_STATE');
  await rejectsCode(recorder.stop(), 'RECORDING_STATE');
  await recorder.start('int16');
  await rejectsCode(recorder.resume(), 'RECORDING_STATE');
});

test('deux démarrages simultanés : le second est refusé, une seule commande', async () => {
  const { recorder, sent } = setup();
  const results = await Promise.allSettled([recorder.start('int24'), recorder.start('int24')]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'RECORDING_STATE');
  assert.equal(sent.filter((c) => c.startsWith('~mxRecStart')).length, 1);
});

test('fichier existant : refus sans écrasement ni commande', async () => {
  const { recorder, dir, sent } = setup();
  const file = path.join(dir, '2026-11-06_21-04-33_master.wav');
  fs.writeFileSync(file, 'x');
  await rejectsCode(recorder.start('int24'), 'RECORDING_FILE_EXISTS');
  assert.equal(sent.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'x');
});

test('ouverture impossible : RECORDING_OPEN_FAILED, état arrêté', async () => {
  const { recorder } = setup({ reply: { start: 'refused|OPEN_FAILED' } });
  await rejectsCode(recorder.start('int24'), 'RECORDING_OPEN_FAILED');
  assert.equal(recorder.state().state, 'stopped');
});

test('réponse inattendue : SC_COMMAND_FAILED', async () => {
  const { recorder } = setup({ reply: { start: 'bizarre' } });
  await rejectsCode(recorder.start('int24'), 'SC_COMMAND_FAILED');
  assert.equal(recorder.state().state, 'stopped');
});

test('taille limite : arrêt sizeLimit au tic', async () => {
  const s = setup();
  await s.recorder.start('float');
  s.advance(Math.ceil(RECORDING_MAX_DATA_BYTES / (48000 * 2 * 4)) + 1);
  await s.recorder.tick();
  const state = s.recorder.state();
  assert.equal(state.state, 'stopped');
  assert.equal(state.stopReason, 'sizeLimit');
  assert.equal(s.sent.at(-1), REC_STOP_CODE);
});

test('tic sous la limite : publie la progression sans arrêter', async () => {
  const s = setup();
  await s.recorder.start('int24');
  s.advance(5);
  await s.recorder.tick();
  assert.equal(s.recorder.state().state, 'recording');
  assert.equal(s.events.at(-1).recordedSeconds, 5);
});

test('espace disque insuffisant : arrêt en erreur au tic', async () => {
  const s = setup({ freeBytes: () => 0 });
  await s.recorder.start('int24');
  await s.recorder.tick();
  const state = s.recorder.state();
  assert.equal(state.state, 'stopped');
  assert.equal(state.stopReason, 'error');
  assert.equal(state.error, 'Espace disque insuffisant pour continuer l\'enregistrement.');
  assert.equal(s.sent.at(-1), REC_STOP_CODE);
});

test('arrêt du moteur en pause : fichier fermé, motif engineStopped', async () => {
  const s = setup();
  await s.recorder.start('int24');
  await s.recorder.pause();
  await s.recorder.closeForEngineStop();
  assert.equal(s.sent.at(-1), REC_STOP_CODE);
  assert.equal(s.recorder.state().stopReason, 'engineStopped');
  const count = s.sent.length;
  await s.recorder.closeForEngineStop();
  assert.equal(s.sent.length, count, 'rien à fermer à l\'arrêt');
});

test('moteur en échec : arrêt en erreur sans commande sclang', async () => {
  const s = setup();
  await s.recorder.start('int24');
  const count = s.sent.length;
  s.recorder.engineFailed('scsynth mort');
  const state = s.recorder.state();
  assert.equal(s.sent.length, count);
  assert.equal(state.state, 'stopped');
  assert.equal(state.stopReason, 'error');
  assert.equal(state.error, 'scsynth mort');
  assert.equal(s.events.at(-1).state, 'stopped');
});
