import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../contract/errors.js';
import { setAudioProfile as setSessionAudioProfile } from '../session/session-model.js';
import { applySessionCode } from '../sc/commands.js';
import { CommandQueue } from './command-queue.js';
import { OscListener } from './osc-listener.js';
import { ProcessRegistry, resolveScsynthWindows } from './process-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SC_DIR = path.resolve(here, '..', '..', 'sc');

/** Pilote audio fixé par le contrat ; aucun champ de l'API ne le choisit. */
export const AUDIO_DEVICE = 'ASIO : TimoxVasio';
/** Ports UDP dédiés : jamais 57110 (autre produit) ni 57120 (port par défaut de sclang). */
export const SERVER_PORT = 57130;
export const DEFAULT_LANG_PORT = 57131;

const fwd = (p) => p.replaceAll('\\', '/');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const busy = (message) => new ApiError('ENGINE_BUSY', 409, message);

/** Démarre sclang via supercolliderjs (chargé à la demande : absent des tests). */
export async function defaultLangFactory({ includePaths, langPort }) {
  const { default: sc } = await import('supercolliderjs');
  const sclang = process.env.SCLANG_PATH
    || (process.platform === 'win32' ? 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe' : 'sclang');
  return sc.lang.boot({ sclang, conf: { includePaths }, stdin: false, echo: false, langPort });
}

/** Décodage d'une réponse /g_queryTree aplatie (copie réduite de hub/sc/query-tree.js). */
export function decodeServerTree(args) {
  const values = args.slice();
  if (values.length < 3) throw new Error('Réponse /g_queryTree incomplète');
  const [flag, rootId, rootCount] = values.map(Number);
  if (![0, 1].includes(flag) || !Number.isInteger(rootId) || !Number.isInteger(rootCount) || rootCount < 0) {
    throw new Error('En-tête /g_queryTree invalide');
  }
  let cursor = 3;
  let order = 0;
  const nodes = [];
  const parseChildren = (parentId, count) => {
    for (let child = 0; child < count; child += 1) {
      if (cursor + 1 >= values.length) throw new Error('Arbre /g_queryTree tronqué');
      const nodeId = Number(values[cursor++]);
      const childCount = Number(values[cursor++]);
      if (!Number.isInteger(nodeId) || !Number.isInteger(childCount) || childCount < -1) throw new Error('Nœud /g_queryTree invalide');
      const node = { nodeId, parentId, order: order++, kind: childCount < 0 ? 'synth' : 'group' };
      if (childCount < 0) {
        if (cursor >= values.length) throw new Error('Nom de Synth /g_queryTree manquant');
        node.synthDef = String(values[cursor++]);
        if (flag) {
          const controlCount = Number(values[cursor++]);
          if (!Number.isInteger(controlCount) || controlCount < 0 || cursor + controlCount * 2 > values.length) {
            throw new Error('Contrôles /g_queryTree invalides ou tronqués');
          }
          node.controls = {};
          for (let k = 0; k < controlCount; k += 1) {
            const name = String(values[cursor++]);
            node.controls[name] = values[cursor++];
          }
        }
      }
      nodes.push(node);
      if (childCount > 0) parseChildren(nodeId, childCount);
    }
  };
  parseChildren(rootId, rootCount);
  if (cursor !== values.length) throw new Error('Réponse /g_queryTree contient des champs non interprétés');
  return { rootId, nodes };
}

const NODE_TREE_CODE = `var tree, cond = Condition.new, resp;
resp = OSCFunc({ |msg| tree = msg; cond.test = true; cond.signal }, '/g_queryTree.reply', ~mxServer.addr).oneShot;
~mxServer.sendMsg('/g_queryTree', 0, 0);
SystemClock.sched(5, { cond.test = true; cond.signal; nil });
cond.wait;
resp.free;
if(tree.isNil) { Error("Pas de réponse /g_queryTree").throw };
"[" ++ tree.drop(1).collect { |v| if(v.isKindOf(String) or: { v.isKindOf(Symbol) }) { v.asString.asCompileString } { v.asString } }.join(",") ++ "]"`;

/**
 * Cycle de vie du moteur (sclang + scsynth) et unique point de mutation de la session.
 *
 * États : stopped → starting → restoring → running ; running → stopping → stopped ;
 * arrêt inattendu de sclang ou de scsynth → failed (session.json inchangé).
 * Événements : `state` (EngineState), `session` ({ session, generation }), `runtime`, `meter`
 * (les deux derniers sont alimentés par le relais de mesures, tâche 7).
 */
export class EngineProcess extends EventEmitter {
  #store; #registry; #langFactory; #listenerFactory; #resolveScsynth; #isAlive; #kill; #watchMs;
  #apiUrl; #langPort; #dataDir;
  #status = 'stopped'; #error = null; #scsynthPid = null;
  #models = { Compander: true, CompanderD: false, FaustRMS: false };
  #session; #generation = 0;
  #meterIds = new Map(); #nextMeterId = 0;
  #lang = null; #queue = null; #listener = null; #procs = []; #watcher = null;
  #abortBoot = null; #cleanup = Promise.resolve(); #transition = false;
  #mutations = Promise.resolve();

  constructor({
    store, langFactory = defaultLangFactory, registry, dataDir,
    listenerFactory = () => new OscListener(), resolveScsynth = resolveScsynthWindows,
    isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } },
    killProcess = (pid) => process.kill(pid, 'SIGTERM'),
    watchIntervalMs = 1000, langPort = DEFAULT_LANG_PORT,
    apiUrl = process.env.MIXETTE_TIMOXVASIO_URL || 'http://127.0.0.1:52525',
  }) {
    super();
    this.#store = store;
    this.#dataDir = dataDir;
    this.#registry = registry ?? new ProcessRegistry({ dataDir });
    this.#langFactory = langFactory;
    this.#listenerFactory = listenerFactory;
    this.#resolveScsynth = resolveScsynth;
    this.#isAlive = isAlive;
    this.#kill = killProcess;
    this.#watchMs = watchIntervalMs;
    this.#langPort = langPort;
    this.#apiUrl = apiUrl;
    this.#session = store.load();
  }

  state() {
    return {
      status: this.#status,
      error: this.#error,
      scsynthPid: this.#scsynthPid,
      timoxVasio: { apiUrl: this.#apiUrl },
      models: { ...this.#models },
    };
  }

  /** Session courante (copie profonde). */
  session() { return structuredClone(this.#session); }

  /** Récepteur OSC de la session moteur en cours (null moteur arrêté) ; sert au relais de mesures. */
  get oscListener() { return this.#listener; }

  /** Source associée à un identifiant de vumètre, ou undefined. */
  resolveSourceId(meterId) {
    for (const [sourceId, id] of this.#meterIds) if (id === meterId) return sourceId;
    return undefined;
  }

  #setStatus(status, error = null) {
    this.#status = status;
    this.#error = error;
    this.emit('state', this.state());
  }

  #rebuildMeterIds() {
    this.#meterIds = new Map(this.#session.sources.map((s, i) => [s.id, i]));
    this.#nextMeterId = this.#session.sources.length;
  }

  #commitSession(session) {
    this.#store.save(session);
    this.#session = session;
    this.#generation += 1;
    this.emit('session', { session: structuredClone(session), generation: this.#generation });
  }

  #bootSource(relayPort) {
    const { sampleRate, bufferFrames } = this.#session.audioProfile;
    const tokens = {
      __MX_SC_DIR__: fwd(SC_DIR),
      __MX_DEVICE__: AUDIO_DEVICE,
      __MX_SAMPLE_RATE__: String(sampleRate),
      __MX_BUFFER__: String(bufferFrames),
      __MX_RELAY_PORT__: String(relayPort),
    };
    let source = fs.readFileSync(path.join(SC_DIR, 'engine.scd'), 'utf8');
    for (const [token, value] of Object.entries(tokens)) {
      if (!source.includes(token)) throw new Error(`Jeton ${token} absent de engine.scd`);
      source = source.replaceAll(token, value);
    }
    return source;
  }

  async start() {
    if (this.#status === 'running') return this.state();
    if (this.#transition || ['starting', 'restoring', 'stopping'].includes(this.#status)) {
      throw busy('Le moteur change d\'état ; réessayer une fois la transition terminée.');
    }
    this.#transition = true;
    try {
      await this.#cleanup;
      const foreign = await this.#registry.foreignScsynth();
      if (foreign.length > 0) {
        const pids = foreign.map((p) => p.pid).join(', ');
        throw busy(`Un scsynth.exe non inscrit par ce moteur est déjà actif (PID ${pids}) ; démarrage refusé.`);
      }
      this.#setStatus('starting');
      const abort = new Promise((_, reject) => { this.#abortBoot = reject; });
      abort.catch(() => {});
      try {
        await Promise.race([this.#boot(), abort]);
      } catch (e) {
        this.#failInternal(e);
        throw e;
      } finally {
        this.#abortBoot = null;
      }
      return this.state();
    } finally {
      this.#transition = false;
    }
  }

  async #boot() {
    this.#rebuildMeterIds();
    const listener = this.#listenerFactory();
    this.#listener = listener;
    const relayPort = await listener.start();
    const includePaths = [path.join(SC_DIR, 'plugins')];
    const lang = await this.#langFactory({ includePaths, langPort: this.#langPort });
    this.#lang = lang;
    lang.on('exit', (code) => this.#onLangExit(lang, code));
    this.#queue = new CommandQueue({ lang, listener });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixette-engine-'));
    try {
      const file = path.join(dir, 'engine.scd');
      fs.writeFileSync(file, this.#bootSource(relayPort), 'utf8');
      await lang.executeFile(fwd(file));
      await this.#waitReady(lang);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const [launcherPid, serverPort, serverExecutable] = await lang.interpret('[s.pid, s.addr.port, Server.program.asString]');
    const sclang = lang.process;
    if (!Number.isInteger(launcherPid) || serverPort !== SERVER_PORT || !sclang?.pid) {
      throw new Error('Impossible d\'identifier les processus sclang et scsynth');
    }
    const found = await this.#resolveScsynth({
      launcherPid, sclangPid: sclang.pid, serverPort, serverExecutable, device: AUDIO_DEVICE,
    });
    this.#procs = [
      { role: 'sclang', pid: sclang.pid, command: [sclang.spawnfile, ...(sclang.spawnargs ?? []).slice(1)].join(' ') },
      { role: 'scsynth-launcher', pid: found.launcher.processId, command: found.launcher.commandLine },
      { role: 'scsynth', pid: found.server.processId, command: found.server.commandLine },
    ];
    for (const p of this.#procs) this.#registry.add(p);
    this.#scsynthPid = found.server.processId;

    const [companderD, faustRMS] = await lang.interpret('[~mxModels[\\CompanderD], ~mxModels[\\FaustRMS]]');
    this.#models = { Compander: true, CompanderD: Boolean(companderD), FaustRMS: Boolean(faustRMS) };

    this.#setStatus('restoring');
    await this.#queue.run(applySessionCode(this.#session, this.#meterIds));
    this.#startWatcher();
    this.#setStatus('running');
  }

  async #waitReady(lang, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await lang.interpret('~mxBootState');
      if (state === 1) return;
      if (state === -1) throw new Error('Démarrage du serveur SuperCollider impossible (pilote audio indisponible ?)');
      await sleep(100);
    }
    throw new Error('Le graphe SuperCollider ne s\'est pas initialisé dans le délai imparti');
  }

  #startWatcher() {
    if (!this.#watchMs) return;
    const pid = this.#scsynthPid;
    this.#watcher = setInterval(() => {
      if (this.#status === 'running' && !this.#isAlive(pid)) {
        this.#onFailure(new Error(`scsynth (PID ${pid}) s'est arrêté`));
      }
    }, this.#watchMs);
    this.#watcher.unref();
  }

  #onLangExit(lang, code) {
    if (lang !== this.#lang || this.#status === 'stopping' || this.#status === 'stopped') return;
    this.#onFailure(new Error(`sclang s'est arrêté (code ${code ?? 'inconnu'})`));
  }

  #onFailure(error) {
    if (this.#abortBoot) { this.#abortBoot(error); return; }
    if (this.#status === 'running') this.#failInternal(error);
  }

  /** Passe en failed et libère les ressources ; l'état est publié sans attendre le nettoyage. */
  #failInternal(error) {
    const queue = this.#queue;
    queue?.dispose(error);
    this.#setStatus('failed', error?.message ?? String(error));
    this.#scsynthPid = null;
    this.#cleanup = this.#release(false).catch(() => {});
  }

  /** Arrête sclang, scsynth et le récepteur, retire les entrées du registre. */
  async #release(graceful) {
    const lang = this.#lang; const listener = this.#listener; const procs = this.#procs; const watcher = this.#watcher;
    this.#lang = null; this.#queue = null; this.#listener = null; this.#procs = []; this.#watcher = null;
    if (watcher) clearInterval(watcher);
    const scsynth = procs.find((p) => p.role === 'scsynth');
    if (lang && graceful) {
      try { await Promise.race([lang.interpret('s.quit'), sleep(3000)]); } catch { /* sclang peut être mort */ }
    }
    if (lang) { try { await lang.quit(); } catch { /* déjà arrêté */ } }
    let problem = null;
    if (scsynth) {
      try { await this.#terminateScsynth(scsynth); } catch (e) { problem = e; }
    }
    if (!problem) for (const p of procs) this.#registry.remove(p.pid);
    if (listener) listener.stop();
    if (problem) throw problem;
  }

  async #terminateScsynth(entry) {
    const gone = async (ms) => {
      const deadline = Date.now() + ms;
      while (this.#isAlive(entry.pid)) {
        if (Date.now() >= deadline) return false;
        await sleep(100);
      }
      return true;
    };
    if (await gone(3500)) return;
    const live = (await this.#registry.listProcesses()).find((p) => p.pid === entry.pid);
    if (!live || live.command !== entry.command) {
      throw new Error(`L'identité du PID ${entry.pid} a changé ; arrêt refusé`);
    }
    this.#kill(entry.pid);
    if (!(await gone(3500))) throw new Error(`PID ${entry.pid} toujours actif après terminaison`);
  }

  async stop() {
    if (this.#status === 'stopped') return this.state();
    if (this.#transition || ['starting', 'restoring', 'stopping'].includes(this.#status)) {
      throw busy('Le moteur change d\'état ; réessayer une fois la transition terminée.');
    }
    this.#transition = true;
    try {
      if (this.#status === 'failed') {
        await this.#cleanup;
        this.#setStatus('stopped');
        return this.state();
      }
      this.#setStatus('stopping');
      this.#queue?.dispose(new Error('Moteur en cours d\'arrêt'));
      try {
        await this.#release(true);
      } catch (e) {
        this.#scsynthPid = null;
        this.#setStatus('failed', e.message);
        throw e;
      }
      this.#scsynthPid = null;
      this.#setStatus('stopped');
      return this.state();
    } finally {
      this.#transition = false;
    }
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  /**
   * Unique chemin de mutation. `fn(session, { meterIdFor })` renvoie `{ session, code }` ;
   * `meterIdFor(sourceId)` renvoie l'identifiant de vumètre de la source (alloué à la demande,
   * à utiliser pour toute nouvelle source). Le code est exécuté par la file ; seulement après
   * acquittement la session est validée, enregistrée et publiée (`session`, génération croissante).
   * Les mutations sont appliquées l'une après l'autre dans l'ordre d'appel.
   */
  mutate(fn) {
    try { this.#assertMutable(); } catch (e) { return Promise.reject(e); }
    const job = this.#mutations.then(() => this.#applyMutation(fn));
    this.#mutations = job.catch(() => {});
    return job;
  }

  #assertMutable() {
    if (this.#status === 'running') return;
    if (this.#status === 'stopped' || this.#status === 'failed') {
      throw new ApiError('ENGINE_NOT_RUNNING', 409, 'Le moteur n\'est pas démarré.');
    }
    throw busy('Le moteur change d\'état ; mutation refusée pour l\'instant.');
  }

  async #applyMutation(fn) {
    this.#assertMutable();
    const meterIds = new Map(this.#meterIds);
    let next = this.#nextMeterId;
    const meterIdFor = (sourceId) => {
      if (!meterIds.has(sourceId)) meterIds.set(sourceId, next++);
      return meterIds.get(sourceId);
    };
    const { session, code } = fn(structuredClone(this.#session), { meterIdFor });
    await this.#queue.run(code);
    const alive = new Set(session.sources.map((s) => s.id));
    for (const id of [...meterIds.keys()]) if (!alive.has(id)) meterIds.delete(id);
    this.#meterIds = meterIds;
    this.#nextMeterId = next;
    this.#commitSession(session);
    return structuredClone(session);
  }

  /** Valide et enregistre le profil audio ; moteur démarré, redémarre scsynth puis restaure la session. */
  setAudioProfile(profile) {
    const job = this.#mutations.then(async () => {
      const next = setSessionAudioProfile(this.#session, profile);
      this.#commitSession(next);
      if (this.#status === 'running') {
        await this.stop();
        await this.start();
      }
      return structuredClone(next.audioProfile);
    });
    this.#mutations = job.catch(() => {});
    return job;
  }

  /** Arbre des nœuds du serveur (/g_queryTree). */
  async nodeTree() {
    if (this.#status !== 'running') throw new ApiError('ENGINE_NOT_RUNNING', 409, 'Le moteur n\'est pas démarré.');
    const payload = await this.#queue.run(NODE_TREE_CODE, { result: true });
    return decodeServerTree(JSON.parse(payload));
  }
}
