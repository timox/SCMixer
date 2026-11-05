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
    if (code.includes('~mxBootState')) return 1;
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
    resolveScsynth: async () => ({
      launcher: { processId: 7002, parentProcessId: 7001, commandLine: 'cmd.exe /c scsynth' },
      server: { processId: 7003, parentProcessId: 7002, commandLine: 'scsynth.exe -u 57130', serverPort: 57130 },
    }),
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
