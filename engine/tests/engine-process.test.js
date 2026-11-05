import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineProcess } from '../src/runtime/engine-process.js';
import { ProcessRegistry } from '../src/runtime/process-registry.js';
import { SessionStore } from '../src/session/session-store.js';
import { addSource, setOutputStage } from '../src/session/session-model.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeListener extends EventEmitter {
  started = 0;
  stopped = 0;
  async start() { this.started += 1; return 45678; }
  stop() { this.stopped += 1; }
}

class FakeLang extends EventEmitter {
  constructor(listener, opts = {}) {
    super();
    this.listener = listener;
    this.opts = opts;
    this.calls = [];
    this.process = { pid: 7001, spawnfile: 'sclang.exe', spawnargs: ['sclang.exe', '-u', '57131'] };
    this.quitCalled = false;
  }
  async executeFile(file) { this.calls.push(`file:${path.basename(file)}`); this.bootSource = fs.readFileSync(file, 'utf8'); }
  async interpret(code) {
    this.calls.push(code);
    if (code.includes('~mxBootState')) return this.opts.bootState ? this.opts.bootState() : 1;
    if (code.includes('s.pid')) return [7002, 57130, 'C:\\SC\\scsynth.exe'];
    if (code.includes('~mxModels')) return [this.opts.companderD ?? true, this.opts.faustRMS ?? false];
    const m = /~mxAck\.\((\d+), "ok"/.exec(code);
    if (m) {
      const failing = this.opts.failWhen?.(code);
      const hold = this.opts.holdWhen?.(code);
      if (hold) { this.held = Number(m[1]); return undefined; }
      setImmediate(() => this.listener.emit('message', {
        address: '/mx/ack',
        args: failing ? [Number(m[1]), 'error', 'erreur simulée'] : [Number(m[1]), 'ok', this.opts.payload?.(code) ?? ''],
      }));
    }
    return undefined;
  }
  release() { this.listener.emit('message', { address: '/mx/ack', args: [this.held, 'ok', ''] }); }
  async quit() { this.quitCalled = true; }
  crash() { this.emit('exit', 1); }
  /** Codes de commandes exécutées (hors boot), sans l'enveloppe fork. */
  commands() { return this.calls.filter((c) => c.includes('~mxAck.(')); }
}

function setup(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-eng-'));
  const store = new SessionStore(dataDir);
  if (opts.session) store.save(opts.session);
  const listener = new FakeListener();
  const langs = [];
  const listProcesses = opts.listProcesses ?? (async () => []);
  const registry = new ProcessRegistry({ dataDir, listProcesses });
  const engine = new EngineProcess({
    store,
    dataDir,
    registry,
    listenerFactory: () => listener,
    langFactory: async (o) => {
      const lang = new FakeLang(listener, opts.lang);
      lang.factoryOptions = o;
      langs.push(lang);
      return lang;
    },
    ...(opts.engine ?? {}),
    resolveScsynth: opts.resolveScsynth ?? (async () => ({
      launcher: { processId: 7002, parentProcessId: 7001, commandLine: 'cmd.exe /c scsynth' },
      server: { processId: 7003, parentProcessId: 7002, commandLine: 'scsynth.exe -u 57130', serverPort: 57130 },
    })),
    isAlive: opts.isAlive ?? (() => false),
    killProcess: opts.killProcess ?? (() => {}),
    watchIntervalMs: opts.watchIntervalMs ?? 0,
  });
  return { engine, store, listener, langs, dataDir, registry };
}

const sessionWithSource = () => addSource(setup().store.load(), { name: 'Entrée', firstChannel: 1, width: 2 }).session;

test('mutate avant start : ENGINE_NOT_RUNNING', async () => {
  const { engine } = setup();
  await assert.rejects(engine.mutate((s) => ({ session: s, code: 'x' })), (e) => e.code === 'ENGINE_NOT_RUNNING' && e.status === 409);
});

test('start exécute applySessionCode avant d\'émettre running', async () => {
  const { engine, langs } = setup({ session: sessionWithSource() });
  const states = [];
  engine.on('state', (s) => states.push(s.status));
  const state = await engine.start();
  assert.deepEqual(states, ['starting', 'restoring', 'running']);
  assert.equal(state.status, 'running');
  assert.equal(state.scsynthPid, 7003);
  assert.deepEqual(state.models, { Compander: true, CompanderD: true, FaustRMS: false });
  assert.equal(state.timoxVasio.apiUrl, 'http://127.0.0.1:52525');
  const cmds = langs[0].commands();
  assert.equal(cmds.length, 1);
  assert.match(cmds[0], /~mxAddSource\.\(\"src-1", 0, 1, 2,/);
  assert.match(cmds[0], /~mxSetOutputStage\.\(\\master/);
});

test('start remplace les jetons et fixe les ports sclang et scsynth', async () => {
  const { engine, langs } = setup();
  await engine.start();
  const src = langs[0].bootSource;
  assert.match(src, /ASIO : TimoxVasio/);
  assert.match(src, /sampleRate = 48000;/);
  assert.match(src, /hardwareBufferSize = 256;/);
  assert.doesNotMatch(src, /__MX_/);
  assert.ok(langs[0].factoryOptions.langPort);
  assert.notEqual(langs[0].factoryOptions.langPort, 57120);
  assert.match(src, /45678/);
  assert.ok(langs[0].factoryOptions.includePaths.some((p) => p.replaceAll('\\', '/').endsWith('sc/plugins')));
});

test('mutate pendant restoring : ENGINE_BUSY', async () => {
  const { engine, langs } = setup({ lang: { holdWhen: () => true }, session: sessionWithSource() });
  const starting = engine.start();
  while (engine.state().status !== 'restoring') await wait(5);
  await assert.rejects(engine.mutate((s) => ({ session: s, code: 'x' })), (e) => e.code === 'ENGINE_BUSY');
  langs[0].release();
  await starting;
  assert.equal(engine.state().status, 'running');
});

test('échec sclang : session et fichier inchangés, aucun événement session', async () => {
  const { engine, store } = setup({ lang: { failWhen: (c) => c.includes('BOOM') } });
  await engine.start();
  const before = fs.existsSync(store.file) ? fs.readFileSync(store.file, 'utf8') : null;
  const sessions = [];
  engine.on('session', (e) => sessions.push(e));
  await assert.rejects(
    engine.mutate((s) => ({ session: setOutputStage(s, 'master', 'mix', { volume: 0.2 }), code: 'BOOM' })),
    (e) => e.code === 'SC_COMMAND_FAILED',
  );
  assert.equal(engine.session().outputs.master.mix.volume, 1);
  assert.equal(fs.existsSync(store.file) ? fs.readFileSync(store.file, 'utf8') : null, before);
  assert.equal(sessions.length, 0);
});

test('mutate valide, enregistre puis émet session ; meterIds alloués et libérés', async () => {
  const { engine, store } = setup();
  await engine.start();
  const events = [];
  engine.on('session', (e) => events.push(e));
  let id;
  await engine.mutate((s, { meterIdFor }) => {
    const r = addSource(s, { name: 'A', firstChannel: 1, width: 2 });
    id = r.source.id;
    return { session: r.session, code: `add(${meterIdFor(id)})` };
  });
  assert.equal(engine.resolveSourceId(0), id);
  assert.equal(store.load().sources.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].session.sources.length, 1);
  await engine.mutate((s) => ({ session: { ...s, sources: [] }, code: 'rm' }));
  assert.equal(engine.resolveSourceId(0), undefined);
  await engine.mutate((s, { meterIdFor }) => {
    const r = addSource(s, { name: 'B', firstChannel: 1, width: 2 });
    return { session: r.session, code: `add(${meterIdFor(r.source.id)})` };
  });
  assert.equal(engine.resolveSourceId(1) !== undefined, true);
});

test('50 mutate eq successifs : ordre, valeur finale, générations strictement croissantes', async () => {
  const { engine, langs } = setup();
  await engine.start();
  const gens = [];
  engine.on('session', (e) => gens.push(e.generation));
  const jobs = [];
  for (let i = 1; i <= 50; i += 1) {
    const value = i / 100;
    jobs.push(engine.mutate((s) => ({
      session: setOutputStage(s, 'master', 'eq', { low: value, mid: 0.5, high: 0.5 }),
      code: `EQ(${i})`,
    })));
  }
  await Promise.all(jobs);
  const codes = langs[0].commands().filter((c) => c.includes('EQ(')).map((c) => Number(/EQ\((\d+)\)/.exec(c)[1]));
  assert.deepEqual(codes, Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(engine.session().outputs.master.eq.low, 0.5);
  assert.equal(gens.length, 50);
  for (let i = 1; i < gens.length; i += 1) assert.ok(gens[i] > gens[i - 1]);
});

test('arrêt brutal du faux scsynth : failed, mutate refusé, session.json identique, restart restaure', async () => {
  const { engine, store, langs } = setup();
  await engine.start();
  await engine.mutate((s) => {
    const r = addSource(s, { name: 'A', firstChannel: 1, width: 2 });
    return { session: r.session, code: 'add' };
  });
  const before = fs.readFileSync(store.file, 'utf8');
  langs[0].crash();
  const st = engine.state();
  assert.equal(st.status, 'failed');
  assert.ok(st.error);
  assert.equal(st.scsynthPid, null);
  await assert.rejects(engine.mutate((s) => ({ session: s, code: 'x' })), (e) => e.code === 'ENGINE_NOT_RUNNING');
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  const state = await engine.restart();
  assert.equal(state.status, 'running');
  assert.equal(engine.session().sources.length, 1);
  assert.equal(langs.length, 2);
  assert.match(langs[1].commands()[0], /~mxAddSource\.\(\"src-1", 0,/);
});

test('crash pendant restoring : start échoue, état failed', async () => {
  const { engine, langs } = setup({ lang: { holdWhen: () => true }, session: sessionWithSource() });
  const starting = engine.start();
  while (engine.state().status !== 'restoring') await wait(5);
  langs[0].crash();
  await assert.rejects(starting);
  assert.equal(engine.state().status, 'failed');
});

test('stop : running → stopping → stopped, sclang quitté, registre vidé', async () => {
  const { engine, langs, dataDir } = setup();
  await engine.start();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime-processes.json'), 'utf8')).length > 0, true);
  const states = [];
  engine.on('state', (s) => states.push(s.status));
  await engine.stop();
  assert.deepEqual(states, ['stopping', 'stopped']);
  assert.equal(langs[0].quitCalled, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime-processes.json'), 'utf8')), []);
  assert.equal(engine.state().scsynthPid, null);
});

test('setAudioProfile moteur running : stop, start avec nouveaux jetons, session restaurée', async () => {
  const { engine, langs, store } = setup({ session: sessionWithSource() });
  await engine.start();
  const states = [];
  engine.on('state', (s) => states.push(s.status));
  await engine.setAudioProfile({ sampleRate: 96000, bufferFrames: 512 });
  assert.deepEqual(states, ['stopping', 'stopped', 'starting', 'restoring', 'running']);
  assert.equal(store.load().audioProfile.sampleRate, 96000);
  assert.match(langs[1].bootSource, /sampleRate = 96000;/);
  assert.match(langs[1].bootSource, /hardwareBufferSize = 512;/);
  assert.match(langs[1].commands()[0], /~mxAddSource/);
});

test('setAudioProfile moteur arrêté : enregistre sans démarrer ; profil invalide refusé', async () => {
  const { engine, langs, store } = setup();
  await engine.setAudioProfile({ sampleRate: 44100, bufferFrames: 64 });
  assert.equal(engine.state().status, 'stopped');
  assert.equal(langs.length, 0);
  assert.equal(store.load().audioProfile.bufferFrames, 64);
  await assert.rejects(engine.setAudioProfile({ sampleRate: 1, bufferFrames: 64 }), (e) => e.code === 'VALIDATION');
  await assert.rejects(engine.setAudioProfile({ sampleRate: 48000, bufferFrames: 64, device: 'x' }), (e) => e.code === 'VALIDATION');
});

test('scsynth inconnu présent : start refusé sans connexion', async () => {
  const { engine, langs, listener } = setup({
    listProcesses: async () => [{ pid: 4242, name: 'scsynth.exe', command: 'scsynth.exe -u 57110' }],
  });
  await assert.rejects(engine.start(), (e) => e.code === 'ENGINE_BUSY' && /4242/.test(e.message));
  assert.equal(langs.length, 0);
  assert.equal(listener.started, 0);
  assert.equal(engine.state().status, 'stopped');
});

test('nodeTree décode la réponse /g_queryTree', async () => {
  const flat = [0, 0, 1, 1, 2, 2, -1, 'a', 3, -1, 'mx_x'];
  const { engine } = setup({ lang: { payload: (c) => (c.includes('g_queryTree') ? JSON.stringify(flat) : '') } });
  await engine.start();
  const tree = await engine.nodeTree();
  assert.equal(tree.rootId, 0);
  assert.deepEqual(tree.nodes.map((n) => n.nodeId), [1, 2, 3]);
  assert.equal(tree.nodes[2].synthDef, 'mx_x');
});

test('start sur moteur running est idempotent', async () => {
  const { engine, langs } = setup();
  await engine.start();
  await engine.start();
  assert.equal(langs.length, 1);
});

test('mort de scsynth détectée par la surveillance : failed', async () => {
  let alive = true;
  const { engine } = setup({ isAlive: () => alive, watchIntervalMs: 10 });
  await engine.start();
  alive = false;
  await wait(60);
  assert.equal(engine.state().status, 'failed');
  assert.match(engine.state().error, /scsynth/);
  await assert.rejects(engine.mutate((s) => ({ session: s, code: 'x' })), (e) => e.code === 'ENGINE_NOT_RUNNING');
});

test('arrêt : scsynth récalcitrant terminé seulement si l’identité correspond', async () => {
  const killed = [];
  let alive = true;
  let listed = [];
  const { engine } = setup({
    isAlive: () => alive,
    killProcess: (pid) => { killed.push(pid); alive = false; },
    listProcesses: async () => listed,
  });
  await engine.start();
  listed = [{ pid: 7003, name: 'scsynth.exe', command: 'scsynth.exe -u 57130' }];
  await engine.stop();
  assert.deepEqual(killed, [7003]);
  assert.equal(engine.state().status, 'stopped');
});

const registryPids = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime-processes.json'), 'utf8')).map((e) => e.pid);

test('setAudioProfile pendant une transition : ENGINE_BUSY, profil inchangé', async () => {
  const { engine, langs, store } = setup({ lang: { holdWhen: () => true }, session: sessionWithSource() });
  const starting = engine.start();
  while (engine.state().status !== 'restoring') await wait(5);
  await assert.rejects(engine.setAudioProfile({ sampleRate: 96000, bufferFrames: 512 }), (e) => e.code === 'ENGINE_BUSY');
  assert.equal(engine.session().audioProfile.sampleRate, 48000);
  assert.equal(store.load().audioProfile.sampleRate, 48000);
  langs[0].release();
  await starting;
});

test('échec du démarrage après inscription : sclang et scsynth libérés, registre vide', async () => {
  const { engine, langs, listener, dataDir } = setup({ lang: { bootState: () => -1 } });
  await assert.rejects(engine.start(), /pilote audio/);
  assert.equal(engine.state().status, 'failed');
  await wait(20);
  assert.equal(langs[0].quitCalled, true);
  assert.equal(listener.stopped, 1);
  assert.deepEqual(registryPids(dataDir), []);
  const state = await engine.stop();
  assert.equal(state.status, 'stopped');
});

test('scsynth non identifiable : erreur explicite avec PID, aucun processus inconnu n est tué', async () => {
  const killed = [];
  const { engine, langs, dataDir } = setup({
    resolveScsynth: async () => { throw new Error('introuvable'); },
    engine: { resolveAttempts: 1 },
    killProcess: (pid) => killed.push(pid),
    isAlive: () => true,
  });
  await assert.rejects(engine.start(), (e) => /PID 7002/.test(e.message) && /PID 7001/.test(e.message) && /manuellement/.test(e.message));
  await wait(20);
  assert.deepEqual(killed, []);
  assert.equal(langs[0].quitCalled, true);
  assert.deepEqual(registryPids(dataDir), []);
});

test('démarrage périmé : libère ses ressources, ne change jamais l état', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  const { engine, langs, listener, dataDir } = setup({
    lang: { bootState: () => { if (first) { first = false; return gate; } return 1; } },
  });
  const states = [];
  engine.on('state', (s) => states.push(s.status));
  const starting = engine.start();
  while (!langs[0] || !langs[0].calls.some((c) => c.includes('~mxBootState'))) await wait(5);
  langs[0].crash();
  await assert.rejects(starting);
  assert.equal(engine.state().status, 'failed');
  const before = states.length;
  release(1);
  await wait(50);
  assert.equal(engine.state().status, 'failed');
  assert.equal(states.length, before);
  assert.equal(langs[0].commands().length, 0);
  assert.deepEqual(registryPids(dataDir), []);
  assert.ok(listener.stopped >= 1);
});

test('sclang qui ne répond pas pendant le démarrage : délai, état failed', async () => {
  const { engine } = setup({ lang: { bootState: () => new Promise(() => {}) }, engine: { askTimeoutMs: 50 } });
  await assert.rejects(engine.start(), /n'a pas répondu/);
  assert.equal(engine.state().status, 'failed');
});

test('mutate en vol au moment du crash : rejet ENGINE_NOT_RUNNING, aucune validation, fichier inchangé', async () => {
  const { engine, store, langs } = setup({ lang: { holdWhen: (c) => c.includes('HOLD') } });
  await engine.start();
  await engine.mutate((s) => ({ session: s, code: 'noop' }));
  const before = fs.readFileSync(store.file, 'utf8');
  const sessions = [];
  engine.on('session', (e) => sessions.push(e));
  const p = engine.mutate((s) => ({ session: setOutputStage(s, 'master', 'mix', { volume: 0.1 }), code: 'HOLD' }));
  await wait(20);
  langs[0].crash();
  await assert.rejects(p, (e) => e.code === 'ENGINE_NOT_RUNNING');
  assert.equal(engine.session().outputs.master.mix.volume, 1);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  assert.equal(sessions.length, 0);
});

test('relais : meter et runtime émis depuis le récepteur OSC, runtime() remis à null à l\'arrêt', async () => {
  const { engine, listener } = setup({ session: sessionWithSource() });
  const meters = [];
  const runtimes = [];
  engine.on('meter', (e) => meters.push(e));
  engine.on('runtime', (e) => runtimes.push(e));
  await engine.start();
  assert.equal(engine.runtime(), null);
  listener.emit('message', { address: '/mx/source-meter', args: [1, 0, 0.5, 0.25] });
  listener.emit('message', { address: '/mx/source-meter', args: [1, 42, 0.5, 0.25] });
  listener.emit('message', { address: '/mx/output-meter', args: [1, 2, 0.5, 0.25] });
  listener.emit('message', { address: '/mx/ack', args: [999, 'ok', ''] });
  assert.deepEqual(meters.map((m) => m.type), ['sourceMeter', 'outputMeter']);
  assert.equal(meters[0].data.sourceId, 'src-1');
  assert.equal(meters[1].data.output, 'cue');
  listener.emit('message', { address: '/mx/runtime', args: [1, 2, 3, 4, 5, 48000, 48000, 64, 256, 10, ''] });
  assert.equal(runtimes.length, 1);
  assert.equal(runtimes[0].type, 'engineRuntimeChanged');
  assert.equal(engine.runtime().cpuAvg, 1);
  await engine.stop();
  assert.equal(engine.runtime(), null);
});

test('scDir est transmis à la fabrique sclang', async () => {
  const { engine, langs } = setup({ engine: { scDir: 'D:\SC' } });
  await engine.start();
  assert.equal(langs[0].factoryOptions.scDir, 'D:\SC');
});

test('échec de démarrage : ApiError SC_COMMAND_FAILED avec la cause audio lue dans la sortie sclang', async () => {
  let alive = true;
  const { engine, langs, dataDir } = setup({
    isAlive: () => alive, watchIntervalMs: 10,
    lang: { bootState: () => new Promise(() => {}) },
    engine: { askTimeoutMs: 2000 },
  });
  const started = engine.start();
  await wait(50);
  langs[0].factoryOptions.onOutput('stdout', "SC_PortAudioDriver: PortAudio failed at Pa_OpenStream with error: 'Invalid sample rate'\ncould not initialize audio.\n");
  alive = false;
  await assert.rejects(started, (e) => e.code === 'SC_COMMAND_FAILED' && e.status === 502
    && /s'est arrêté/.test(e.message) && /Invalid sample rate/.test(e.message));
  assert.match(engine.state().error, /Invalid sample rate/);
  const log = fs.readFileSync(path.join(dataDir, 'logs', 'sclang.log'), 'utf8');
  assert.match(log, /===== .* démarrage du moteur =====/);
  assert.match(log, /Invalid sample rate/);
});
