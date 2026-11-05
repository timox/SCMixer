import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TimoxVasioClient } from '../src/runtime/timoxvasio-client.js';
import { ProcessRegistry } from '../src/runtime/process-registry.js';

const EXE = 'C:\\Program Files\\TimoxVSSC\\resources\\backend\\TimoxVirtualAsioEngine.exe';
const body = (engine = {}, apiVersion = '1.1') => ({
  apiVersion,
  engine: { state: 'running', physicalDriverId: 'drv', sampleRate: 48000, bufferFrames: 2048, lastError: null, ...engine },
});
const notReady = (re) => (e) => e.code === 'TIMOXVASIO_NOT_READY' && e.status === 409 && re.test(e.message);

/** Hôte simulé : état modifiable, joignable ou non selon l'URL. */
function world({ reachable = () => true, state = body(), hosts = [], startFlipsTo = 'running' } = {}) {
  const w = {
    reachable, state, hosts, urls: [], spawns: [], wsCommands: [], wsUrls: [], killed: [],
    fetchImpl: async (url, opts) => {
      assert.ok(opts.signal);
      w.urls.push(url);
      if (!w.reachable(url)) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return { ok: true, status: 200, json: async () => structuredClone(w.state) };
    },
    WebSocketImpl: class extends EventEmitter {
      constructor(url, protocol) {
        super();
        w.wsUrls.push([url, protocol]);
        setImmediate(() => this.emit('open'));
      }
      send(text) {
        const msg = JSON.parse(text);
        w.wsCommands.push(msg);
        setImmediate(() => {
          this.emit('message', Buffer.from(JSON.stringify({ event: 'engine.status', payload: {} })));
          if (w.wsFail) {
            this.emit('message', Buffer.from(JSON.stringify({ id: msg.id, success: false, error: { code: 'AUDIO_ENGINE_UNAVAILABLE', message: 'indisponible' } })));
            return;
          }
          if (startFlipsTo) w.state = body({ state: startFlipsTo });
          this.emit('message', Buffer.from(JSON.stringify({ id: msg.id, success: true, result: { accepted: true } })));
        });
      }
      close() {}
    },
    listHostProcesses: async () => w.hosts,
    existsImpl: () => true,
    spawnImpl: (exe, args, opts) => {
      const child = new EventEmitter();
      child.pid = 9100;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { w.killed.push(child.pid); };
      child.unref = () => {};
      w.spawns.push({ exe, args, opts, child });
      if (w.apiReadyPort) setImmediate(() => child.stdout.emit('data', Buffer.from(`{"event":"api.ready","port":${w.apiReadyPort}}\n`)));
      return child;
    },
  };
  return w;
}

const mk = (w, extra = {}) => new TimoxVasioClient({
  apiUrl: 'http://127.0.0.1:52525/', fetchImpl: w.fetchImpl, WebSocketImpl: w.WebSocketImpl, spawnImpl: w.spawnImpl,
  listHostProcesses: w.listHostProcesses, engineExe: EXE, existsImpl: w.existsImpl,
  timeouts: { read: 50, ready: 60, command: 200, running: 150, reconfiguring: 100, poll: 5 }, ...extra,
});
const tmpRegistry = () => new ProcessRegistry({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mx-tv-')), listProcesses: async () => [] });

test('hôte présent et running : horloge et informations, aucune commande, aucun lancement', async () => {
  const w = world({ hosts: [{ pid: 4242, name: 'TimoxVirtualAsioEngine.exe', command: `"${EXE}"` }] });
  const res = await mk(w).prepare();
  assert.deepEqual(res.audioClock, { sampleRate: 48000, bufferFrames: 2048 });
  assert.deepEqual(res.info, {
    apiUrl: 'http://127.0.0.1:52525', apiVersion: '1.1', hostPid: 4242, launchedByEngine: false, physicalDriverId: 'drv', state: 'running',
  });
  assert.deepEqual(w.urls, ['http://127.0.0.1:52525/api/v1/state']);
  assert.equal(w.spawns.length, 0);
  assert.equal(w.wsCommands.length, 0);
});

test('apiVersion 1.0 refusée, 1.1 exigée', async () => {
  await assert.rejects(mk(world({ state: body({}, '1.0') })).prepare(), notReady(/apiVersion « 1\.0 ».*« 1\.1 »/));
  await assert.rejects(mk(world({ state: body({}, '2.0') })).prepare(), notReady(/apiVersion/));
  await assert.rejects(mk(world({ state: { apiVersion: '1.1' } })).prepare(), notReady(/engine/));
});

test('hôte absent : lancé sans argument, port lu dans api.ready, enregistré, API relue sur ce port', async () => {
  const registry = tmpRegistry();
  const w = world({ reachable: (url) => url.includes(':53001'), hosts: [] });
  w.apiReadyPort = 53001;
  const res = await mk(w, { registry }).prepare();
  assert.equal(w.spawns.length, 1);
  assert.equal(w.spawns[0].exe, EXE);
  assert.deepEqual(w.spawns[0].args, []);
  assert.equal(w.spawns[0].opts.cwd, 'C:\\Program Files\\TimoxVSSC\\resources\\backend');
  assert.deepEqual(w.spawns[0].opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(res.info.apiUrl, 'http://127.0.0.1:53001');
  assert.equal(res.info.hostPid, 9100);
  assert.equal(res.info.launchedByEngine, true);
  const [entry] = registry.entries();
  assert.equal(entry.role, 'timoxvasio-host');
  assert.equal(entry.pid, 9100);
  assert.equal(entry.ownedByEngine, true);
  assert.ok(entry.command.includes('TimoxVirtualAsioEngine.exe'));
  assert.deepEqual(w.killed, []);
});

test('hôte absent et exécutable introuvable : refus sans lancement', async () => {
  const w = world({ reachable: () => false });
  await assert.rejects(mk(w, { existsImpl: () => false }).prepare(), notReady(/introuvable.*TimoxVirtualAsioEngine\.exe/));
  assert.equal(w.spawns.length, 0);
});

test('processus hôte présent mais API injoignable : refus sans lancer ni tuer', async () => {
  const w = world({ reachable: () => false, hosts: [{ pid: 4242, name: 'TimoxVirtualAsioEngine.exe', command: EXE }] });
  await assert.rejects(mk(w).prepare(), notReady(/PID 4242.*injoignable.*aucun second hôte/s));
  assert.equal(w.spawns.length, 0);
  assert.deepEqual(w.killed, []);
});

test('api.ready absent dans le délai : refus et seul le processus lancé est terminé', async () => {
  const registry = tmpRegistry();
  const w = world({ reachable: () => false, hosts: [] });
  await assert.rejects(mk(w, { registry }).prepare(), notReady(/api\.ready.*PID 9100/s));
  assert.deepEqual(w.killed, [9100]);
  assert.deepEqual(registry.entries(), []);
});

test('hôte lancé qui sort avant api.ready : refus avec la cause', async () => {
  const w = world({ reachable: () => false, hosts: [] });
  const spawnImpl = (...a) => { const c = w.spawnImpl(...a); setImmediate(() => { c.stderr.emit('data', Buffer.from('port occupé')); c.emit('exit', 1); }); return c; };
  await assert.rejects(mk(w, { spawnImpl }).prepare(), notReady(/code 1.*port occupé/s));
});

test('transport arrêté avec pilote : engine.start envoyé une fois sur vasio.api.v1, puis running', async () => {
  const w = world({ state: body({ state: 'stopped', sampleRate: null, bufferFrames: null }), hosts: [{ pid: 4242, name: 'x', command: EXE }] });
  const res = await mk(w).prepare();
  assert.equal(w.wsCommands.length, 1);
  assert.equal(w.wsCommands[0].command, 'engine.start');
  assert.equal(typeof w.wsCommands[0].id, 'string');
  assert.deepEqual(w.wsUrls, [['ws://127.0.0.1:52525/api/v1/ws', 'vasio.api.v1']]);
  assert.equal(res.info.state, 'running');
  assert.deepEqual(res.audioClock, { sampleRate: 48000, bufferFrames: 2048 });
  // Idempotence : un second prepare sur un hôte running n'envoie plus rien.
  await mk(w).prepare();
  assert.equal(w.wsCommands.length, 1);
});

test('transport qui reste arrêté après engine.start (aucune route) : refus avec la cause', async () => {
  const w = world({ state: body({ state: 'stopped', sampleRate: null, bufferFrames: null }), startFlipsTo: null });
  await assert.rejects(mk(w).prepare(), notReady(/reste arrêté après engine\.start.*aucune route/s));
  assert.equal(w.wsCommands.length, 1);
});

test('engine.start refusé par TimoxVasio : code et message repris', async () => {
  const w = world({ state: body({ state: 'stopped' }) });
  w.wsFail = true;
  await assert.rejects(mk(w).prepare(), notReady(/AUDIO_ENGINE_UNAVAILABLE.*indisponible/s));
});

test('aucun pilote physique : refus nommant Timox VASIO Control, sans commande', async () => {
  const w = world({ state: body({ state: 'stopped', physicalDriverId: null, sampleRate: null, bufferFrames: null }) });
  await assert.rejects(mk(w).prepare(), notReady(/aucun pilote physique configuré dans TimoxVasio — choisissez le périphérique maître dans Timox VASIO Control/));
  assert.equal(w.wsCommands.length, 0);
});

test('état error : refus avec lastError ; reconfiguring : attente puis relecture', async () => {
  await assert.rejects(mk(world({ state: body({ state: 'error', lastError: 'PHYSICAL_DRIVER_OPEN_FAILED' }) })).prepare(), notReady(/PHYSICAL_DRIVER_OPEN_FAILED/));
  const w = world({ state: body({ state: 'reconfiguring' }) });
  setTimeout(() => { w.state = body(); }, 30);
  const res = await mk(w).prepare();
  assert.equal(res.info.state, 'running');
  assert.equal(w.wsCommands.length, 0);
  await assert.rejects(mk(world({ state: body({ state: 'reconfiguring' }) })).prepare(), notReady(/« reconfiguring »/));
});

test('horloge invalide, statut HTTP, corps illisible', async () => {
  await assert.rejects(mk(world({ state: body({ sampleRate: null }) })).prepare(), notReady(/sampleRate/));
  await assert.rejects(mk(world({ state: body({ bufferFrames: 12.5 }) })).prepare(), notReady(/bufferFrames/));
  const w = world();
  await assert.rejects(mk(w, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }).prepare(), notReady(/HTTP 500/));
  await assert.rejects(mk(w, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) }).prepare(), notReady(/illisible/));
});

test('hôte lancé par le moteur, retrouvé au démarrage suivant : launchedByEngine true, pas de nouveau lancement', async () => {
  const registry = tmpRegistry();
  registry.add({ role: 'timoxvasio-host', pid: 9100, command: `"${EXE}"`, ownedByEngine: true });
  const w = world({ hosts: [{ pid: 9100, name: 'TimoxVirtualAsioEngine.exe', command: `"${EXE}" ` }] });
  const res = await mk(w, { registry }).prepare();
  assert.equal(res.info.launchedByEngine, true);
  assert.equal(w.spawns.length, 0);
  // Un hôte de même PID mais de commande différente n'est pas réputé nôtre.
  const w2 = world({ hosts: [{ pid: 9100, name: 'TimoxVirtualAsioEngine.exe', command: 'autre.exe' }] });
  assert.equal((await mk(w2, { registry }).prepare()).info.launchedByEngine, false);
});
