import test from 'node:test';
import assert from 'node:assert/strict';
import { TimoxVasioClient } from '../src/runtime/timoxvasio-client.js';

const stateBody = (engine, apiVersion = '1.0') => ({ apiVersion, engine: { state: 'running', physicalDriverId: 'x', sampleRate: 48000, bufferFrames: 2048, lastError: null, ...engine } });
const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
const client = (fetchImpl) => new TimoxVasioClient({ apiUrl: 'http://127.0.0.1:1/', fetchImpl });
const notReady = (re) => (e) => e.code === 'TIMOXVASIO_NOT_READY' && e.status === 409 && re.test(e.message);

test('audioClock : running 48000/2048', async () => {
  const urls = [];
  const c = client(async (url, opts) => { urls.push(url); assert.ok(opts.signal); return { ok: true, status: 200, json: async () => stateBody({}) }; });
  assert.deepEqual(await c.audioClock(), { sampleRate: 48000, bufferFrames: 2048 });
  assert.deepEqual(urls, ['http://127.0.0.1:1/api/v1/state']);
});

test('audioClock : TimoxVasio injoignable', async () => {
  const c = client(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(c.audioClock(), notReady(/TimoxVasio.*injoignable.*fetch failed/s));
});

test('audioClock : état différent de running', async () => {
  await assert.rejects(client(reply(stateBody({ state: 'stopped', sampleRate: null, bufferFrames: null }))).audioClock(), notReady(/« stopped »/));
  await assert.rejects(client(reply(stateBody({ state: 'reconfiguring' }))).audioClock(), notReady(/« reconfiguring »/));
});

test('audioClock : fréquence ou tampon invalides', async () => {
  await assert.rejects(client(reply(stateBody({ sampleRate: null }))).audioClock(), notReady(/sampleRate/));
  await assert.rejects(client(reply(stateBody({ bufferFrames: 0 }))).audioClock(), notReady(/bufferFrames/));
  await assert.rejects(client(reply(stateBody({ bufferFrames: 12.5 }))).audioClock(), notReady(/bufferFrames/));
});

test('audioClock : version d\'API, statut HTTP et corps illisible', async () => {
  await assert.rejects(client(reply(stateBody({}, '2.0'))).audioClock(), notReady(/apiVersion.*2\.0/));
  await assert.rejects(client(reply({}, false, 500)).audioClock(), notReady(/HTTP 500/));
  await assert.rejects(client(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })).audioClock(), notReady(/illisible/));
  await assert.rejects(client(reply({ apiVersion: '1.0' })).audioClock(), notReady(/engine/));
});

test('audioClock : délai dépassé', async () => {
  const c = new TimoxVasioClient({ apiUrl: 'http://x', timeoutMs: 20, fetchImpl: (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  await assert.rejects(c.audioClock(), notReady(/injoignable/));
});
