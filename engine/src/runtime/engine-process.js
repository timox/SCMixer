import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../contract/errors.js';
import { applySessionCode } from '../sc/commands.js';
import { CommandQueue } from './command-queue.js';
import { MeterRelay } from './meter-relay.js';
import { OscListener } from './osc-listener.js';
import { Recorder } from './recorder.js';
import { ProcessRegistry, resolveScsynthWindows } from './process-registry.js';
import { DEFAULT_SIZING, SYNTHDEF_TIMEOUT_SECONDS, assertSessionFitsSizing, computeServerOptions } from './server-options.js';
import { DEFAULT_TIMOXVASIO_ENGINE_EXE, DEFAULT_TIMOXVASIO_URL, TimoxVasioClient } from './timoxvasio-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SC_DIR = path.resolve(here, '..', '..', 'sc');

/** Pilote audio fixé par le contrat ; aucun champ de l'API ne le choisit. */
export const AUDIO_DEVICE = 'ASIO : TimoxVasio';
/** Ports UDP dédiés : jamais 57110 (autre produit) ni 57120 (port par défaut de sclang). */
export const SERVER_PORT = 57130;
export const DEFAULT_LANG_PORT = 57131;

/** Nombre de lignes conservées par le journal du moteur (GET /api/engine/log). */
export const JOURNAL_CAPACITY = 5000;
/** scsynth est déclaré muet après SCSYNTH_STALL_STATUSES statuts de suite sans réponse depuis plus de SCSYNTH_STALL_MS. */
export const SCSYNTH_STALL_MS = 5000;
export const SCSYNTH_STALL_STATUSES = 3;

const fwd = (p) => p.replaceAll('\\', '/');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const busy = (message) => new ApiError('ENGINE_BUSY', 409, message);

export const DEFAULT_SC_DIR = 'C:\\Program Files\\SuperCollider-3.14.1';

/** Démarre sclang via supercolliderjs (chargé à la demande : absent des tests). */
export async function defaultLangFactory({ includePaths, langPort, scDir = DEFAULT_SC_DIR, onOutput = () => {} }) {
  const { default: sc } = await import('supercolliderjs');
  const sclang = process.env.SCLANG_PATH
    || (process.platform === 'win32' ? path.join(scDir, 'sclang.exe') : 'sclang');
  // Sans fenêtre de console : le service n'en a pas, Windows en ouvrirait une pour sclang (et scsynth qui
  // en hérite), et sa fermeture tuerait le moteur. La sortie est lue par le journal (GET /api/engine/log).
  class HiddenConsoleLang extends sc.lang.default {
    _spawnProcess(execPath, commandLineOptions) {
      return spawn(execPath, commandLineOptions, { cwd: path.dirname(execPath), windowsHide: true });
    }
  }
  // Instance créée avant boot() pour journaliser aussi la sortie du démarrage (compilation, erreurs).
  const lang = new HiddenConsoleLang({ sclang, conf: { includePaths }, stdin: false, echo: false, langPort });
  lang.on('stdout', (text) => onOutput('stdout', text));
  lang.on('stderr', (text) => onOutput('stderr', text));
  lang.on('error', (err) => onOutput('error', JSON.stringify(err)));
  await lang.boot();
  return lang;
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

/** Requête /g_queryTree ; `flag` 1 ajoute les valeurs des contrôles de chaque Synth (Server-Command-Reference). */
const nodeTreeCode = (flag) => `var tree, cond = Condition.new, resp;
resp = OSCFunc({ |msg| tree = msg; cond.test = true; cond.signal }, '/g_queryTree.reply', ~mxServer.addr).oneShot;
~mxServer.sendMsg('/g_queryTree', 0, ${flag});
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
 * (alimentés par MeterRelay depuis le récepteur OSC).
 *
 * Chaque démarrage possède un contexte (`ctx`) : sclang, récepteur OSC, file, processus
 * inscrits, surveillance. Un démarrage périmé (abandonné après une panne) libère ce qu'il
 * a créé et ne modifie jamais l'état.
 */
class StaleBoot extends Error {}

export class EngineProcess extends EventEmitter {
  #store; #registry; #langFactory; #listenerFactory; #resolveScsynth; #isAlive; #kill; #watchMs;
  #timoxVasio; #tvInfo = null; #audioClock = null; #scDir; #langPort; #logFile; #askTimeoutMs; #resolveAttempts; #sizing;
  #status = 'stopped'; #error = null; #scsynthPid = null;
  #models = { Compander: true, CompanderD: false, FaustRMS: false };
  #session; #generation = 0;
  #meterIds = new Map(); #nextMeterId = 0;
  #ctx = null; #abortBoot = null; #cleanup = Promise.resolve(); #transition = false;
  #mutations = Promise.resolve(); #runtime = null;
  #journal = []; #journalSeq = 0;

  constructor({
    store, langFactory = defaultLangFactory, registry, dataDir,
    listenerFactory = () => new OscListener(), resolveScsynth = resolveScsynthWindows,
    isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } },
    killProcess = (pid) => process.kill(pid, 'SIGTERM'),
    watchIntervalMs = 1000, langPort = DEFAULT_LANG_PORT, askTimeoutMs = 30_000, resolveAttempts = 20,
    apiUrl = process.env.SCMIXER_TIMOXVASIO_URL || DEFAULT_TIMOXVASIO_URL,
    timoxVasioEngineExe = process.env.SCMIXER_TIMOXVASIO_ENGINE_EXE || DEFAULT_TIMOXVASIO_ENGINE_EXE,
    scDir = DEFAULT_SC_DIR, timoxVasio,
    sizing = DEFAULT_SIZING, recordingsDir = null,
  }) {
    super();
    this.#sizing = Object.freeze({ maxSourceWidth: sizing.maxSourceWidth, maxSources: sizing.maxSources });
    computeServerOptions(this.#sizing); // valide le dimensionnement dès la construction
    this.#store = store;
    this.#registry = registry ?? new ProcessRegistry({ dataDir });
    this.#langFactory = langFactory;
    this.#listenerFactory = listenerFactory;
    this.#resolveScsynth = resolveScsynth;
    this.#isAlive = isAlive;
    this.#kill = killProcess;
    this.#watchMs = watchIntervalMs;
    this.#langPort = langPort;
    this.#askTimeoutMs = askTimeoutMs;
    this.#resolveAttempts = resolveAttempts;
    this.#timoxVasio = timoxVasio ?? new TimoxVasioClient({ apiUrl, registry: this.#registry, engineExe: timoxVasioEngineExe });
    this.#timoxVasio.on?.('routingError', (message) => this.#journalAppend('timoxVasio', message));
    this.#scDir = scDir;
    this.#logFile = dataDir ? path.join(dataDir, 'logs', 'sclang.log') : null;
    this.#session = store.load();
    /** Enregistrement WAV de la sortie Master ; commandes par la file sclang, sans modifier la session. */
    this.recorder = new Recorder({ run: (code) => this.diagnostic(code), dir: recordingsDir });
  }

  state() {
    return {
      status: this.#status,
      error: this.#error,
      scsynthPid: this.#scsynthPid,
      timoxVasio: this.#tvInfo ? { ...this.#tvInfo } : {
        apiUrl: this.#timoxVasio.apiUrl, apiVersion: null, hostPid: null, launchedByEngine: false, physicalDriverId: null, state: null,
      },
      audioClock: this.#audioClock ? { ...this.#audioClock } : null,
      models: { ...this.#models },
    };
  }

  /** Session courante (copie profonde). */
  session() { return structuredClone(this.#session); }

  publishRouting() {
    if (this.#status === 'running') this.#timoxVasio.publishRouting?.(this.#session, this.#scsynthPid);
  }

  /** Récepteur OSC de la session moteur en cours (null moteur arrêté) ; sert au relais de mesures. */
  get oscListener() { return this.#ctx?.listener ?? null; }

  /** Dernier statut runtime reçu de sclang (null moteur arrêté ou avant la première mesure). */
  runtime() { return this.#runtime ? { ...this.#runtime } : null; }

  /** Source associée à un identifiant de vumètre, ou undefined. */
  resolveSourceId(meterId) {
    for (const [sourceId, id] of this.#meterIds) if (id === meterId) return sourceId;
    return undefined;
  }

  #setStatus(status, error = null) {
    this.#status = status;
    this.#error = error;
    if (status === 'running') this.publishRouting();
    else if (status === 'stopped' || status === 'failed') this.#timoxVasio.clearRouting?.();
    this.#journalAppend('service', error ? `moteur ${status} : ${error}` : `moteur ${status}`);
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
    this.publishRouting();
  }

  /**
   * Journal du moteur, lu par GET /api/engine/log et diffusé par l'événement `log` : une entrée par ligne
   * de sortie de sclang (et de scsynth, dont sclang relaie la sortie), plus les repères du service
   * (démarrage, arrêt, échec). Les JOURNAL_CAPACITY dernières lignes sont conservées pour la durée du service.
   */
  #journalAppend(stream, text) {
    for (const raw of String(text).split(/\r?\n/)) {
      if (raw === '') continue;
      this.#journalSeq += 1;
      const line = { seq: this.#journalSeq, time: new Date().toISOString(), stream, text: raw };
      this.#journal.push(line);
      if (this.#journal.length > JOURNAL_CAPACITY) this.#journal.shift();
      this.emit('log', line);
    }
  }

  /** Lignes du journal de numéro strictement supérieur à `after` (toutes si 0), dans l'ordre. */
  log(after = 0) {
    return { lines: this.#journal.filter((l) => l.seq > after).map((l) => ({ ...l })), lastSeq: this.#journalSeq };
  }

  /** Ouvre un nouveau bloc horodaté de `<dataDir>/logs/sclang.log` et renvoie l'écriveur de sortie sclang (fichier et journal). */
  #openLog() {
    const write = (text) => {
      if (!this.#logFile) return;
      try { fs.appendFileSync(this.#logFile, text); } catch { /* le journal ne doit jamais faire échouer le moteur */ }
    };
    if (this.#logFile) {
      try { fs.mkdirSync(path.dirname(this.#logFile), { recursive: true }); } catch { /* idem */ }
    }
    write(`\n===== ${new Date().toISOString()} démarrage du moteur =====\n`);
    const line = (text) => String(text).replace(/\n?$/, '\n');
    return (stream, text) => {
      write(stream === 'stdout' ? line(text) : `[${stream}] ${line(text)}`);
      this.#journalAppend(stream, text);
    };
  }

  /** Options de scsynth calculées pour le dimensionnement et la fréquence d'échantillonnage du démarrage. */
  #serverOptions() {
    return computeServerOptions({ ...this.#sizing, sampleRate: this.#audioClock.sampleRate });
  }

  #bootSource(relayPort) {
    const { sampleRate, bufferFrames } = this.#audioClock;
    const options = this.#serverOptions();
    const tokens = {
      __MX_NUM_INPUTS__: String(options.numInputBusChannels),
      __MX_NUM_OUTPUTS__: String(options.numOutputBusChannels),
      __MX_NUM_AUDIO_BUSES__: String(options.numAudioBusChannels),
      __MX_WIRE_BUFS__: String(options.numWireBufs),
      __MX_MAX_NODES__: String(options.maxNodes),
      __MX_MEM_SIZE_KB__: String(options.memSize),
      __MX_BLOCK_SIZE__: String(options.blockSize),
      __MX_SYNTHDEF_TIMEOUT__: String(SYNTHDEF_TIMEOUT_SECONDS),
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
      // Une session persistée au-delà du dimensionnement ne peut pas être restaurée : refus avant tout démarrage.
      assertSessionFitsSizing(this.#session, this.#sizing);
      await this.#cleanup;
      const foreign = await this.#registry.foreignScsynth();
      if (foreign.length > 0) {
        const pids = foreign.map((p) => p.pid).join(', ');
        throw busy(`Un scsynth.exe non inscrit par ce moteur est déjà actif (PID ${pids}) ; démarrage refusé.`);
      }
      // TimoxVasio supervisé puis horloge imposée, lues à chaque démarrage ; aucune surveillance ensuite.
      // L'hôte et son transport ne sont jamais arrêtés par le moteur (voir TimoxVasioClient).
      this.#tvInfo = null;
      const { audioClock: clock, info } = await this.#timoxVasio.prepare();
      this.#tvInfo = info;
      this.#audioClock = { sampleRate: clock.sampleRate, bufferFrames: clock.bufferFrames };
      this.#setStatus('starting');
      const ctx = { lang: null, listener: null, queue: null, procs: [], watcher: null };
      this.#ctx = ctx;
      const abort = new Promise((_, reject) => { this.#abortBoot = reject; });
      abort.catch(() => {});
      try {
        await Promise.race([this.#boot(ctx), abort]);
      } catch (e) {
        if (this.#ctx === ctx) this.#failInternal(e);
        if (e instanceof ApiError || e instanceof StaleBoot) throw e;
        throw new ApiError('SC_COMMAND_FAILED', 502, `Démarrage du moteur impossible : ${e?.message ?? e}`);
      } finally {
        this.#abortBoot = null;
      }
      return this.state();
    } finally {
      this.#transition = false;
    }
  }

  /** Vérifie, après chaque attente, que ce démarrage est toujours le démarrage courant. */
  async #alive(ctx) {
    if (this.#ctx === ctx) return;
    // Démarrage périmé : libère ce qu'il a créé, sans toucher à l'état.
    await this.#release(ctx, false).catch(() => {});
    throw new StaleBoot('Démarrage abandonné');
  }

  /** Appel sclang avec délai : une réponse qui n'arrive pas fait échouer le démarrage. */
  async #ask(ctx, code) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sclang n'a pas répondu en ${this.#askTimeoutMs} ms`)), this.#askTimeoutMs);
    });
    try {
      return await Promise.race([ctx.lang.interpret(code), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #boot(ctx) {
    this.#rebuildMeterIds();
    ctx.listener = this.#listenerFactory();
    const relay = new MeterRelay((meterId) => this.resolveSourceId(meterId) ?? null);
    let staleStatuses = 0;
    ctx.listener.on('message', (message) => {
      if (this.#ctx !== ctx) return;
      const event = relay.handle(message);
      if (!event) return;
      if (event.type === 'engineRuntimeChanged') {
        this.#runtime = event.data;
        this.emit('runtime', event);
        // scsynth traite ses commandes au rythme des appels audio : s'il ne répond plus à /status, il ne
        // reçoit plus d'audio. Un retard isolé (sclang occupé) ne compte pas ; trois statuts de suite, si.
        staleStatuses = event.data.scsynthReplyAgeMs > SCSYNTH_STALL_MS ? staleStatuses + 1 : 0;
        if (staleStatuses >= SCSYNTH_STALL_STATUSES && this.#status === 'running') {
          const seconds = Math.round(event.data.scsynthReplyAgeMs / 1000);
          this.#failInternal(new Error(`scsynth ne répond plus depuis ${seconds} s : il ne reçoit plus d'audio `
            + '(client TimoxVasio arrêté, par exemple après un redémarrage de TimoxVasio). Redémarrer le moteur.'));
        }
      } else {
        this.emit('meter', event);
      }
    });
    const relayPort = await ctx.listener.start();
    await this.#alive(ctx);
    const includePaths = [path.join(SC_DIR, 'plugins')];
    const writeLog = this.#openLog();
    writeLog('stdout', `MX-SIZING ${JSON.stringify({ ...this.#sizing, sampleRate: this.#audioClock.sampleRate, ...this.#serverOptions() })}`);
    const onOutput = (stream, text) => {
      writeLog(stream, text);
      const m = /PortAudio failed[^\r\n]*|could not initialize audio/.exec(String(text));
      if (m) ctx.audioCause = ctx.audioCause ? `${ctx.audioCause} ; ${m[0]}` : m[0];
      // Échec annoncé par engine.scd (garde de démarrage, graphe) : la vraie cause remplace l'attente d'un délai.
      const fail = /MX-ENGINE-FAIL ([^\r\n]*)/.exec(String(text));
      if (fail && !ctx.engineFail) {
        ctx.engineFail = fail[1];
        this.#onFailure(ctx, new Error(`sclang a refusé le démarrage : ${fail[1]}`));
      }
    };
    const lang = await this.#langFactory({ includePaths, langPort: this.#langPort, scDir: this.#scDir, onOutput });
    ctx.lang = lang;
    lang.on('exit', (code) => this.#onLangExit(ctx, code));
    await this.#alive(ctx);
    ctx.queue = new CommandQueue({ lang, listener: ctx.listener });
    const sclang = lang.process;
    if (!sclang?.pid) throw new Error('PID de sclang introuvable');
    this.#register(ctx, { role: 'sclang', pid: sclang.pid, command: [sclang.spawnfile, ...(sclang.spawnargs ?? []).slice(1)].join(' ') });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scmixer-engine-'));
    try {
      const file = path.join(dir, 'engine.scd');
      fs.writeFileSync(file, this.#bootSource(relayPort), 'utf8');
      await lang.executeFile(fwd(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await this.#alive(ctx);

    // Identification et inscription de scsynth dès son apparition, avant l'attente de disponibilité.
    const [launcherPid, serverPort, serverExecutable] = await this.#waitServerProcess(ctx);
    let found;
    let lastError;
    for (let attempt = 0; attempt < this.#resolveAttempts; attempt += 1) {
      try {
        found = await this.#resolveScsynth({
          launcherPid, sclangPid: sclang.pid, serverPort, serverExecutable, device: AUDIO_DEVICE,
        });
        break;
      } catch (e) {
        lastError = e;
        await this.#alive(ctx);
        await sleep(250);
      }
    }
    await this.#alive(ctx);
    if (!found) {
      throw new Error(`scsynth n'a pas pu être identifié (lanceur PID ${launcherPid}, sclang PID ${sclang.pid}) : ${lastError?.message ?? 'inconnu'}. `
        + 'Aucun processus non identifié n\'est arrêté ; vérifier manuellement ces PID.');
    }
    this.#register(ctx, { role: 'scsynth-launcher', pid: found.launcher.processId, command: found.launcher.commandLine });
    this.#register(ctx, { role: 'scsynth', pid: found.server.processId, command: found.server.commandLine });
    this.#scsynthPid = found.server.processId;
    this.#startWatcher(ctx);

    await this.#waitReady(ctx);
    const [companderD, faustRMS] = await this.#ask(ctx, '[~mxModels[\\CompanderD], ~mxModels[\\FaustRMS]]');
    await this.#alive(ctx);
    this.#models = { Compander: true, CompanderD: Boolean(companderD), FaustRMS: Boolean(faustRMS) };

    this.#setStatus('restoring');
    await ctx.queue.run(applySessionCode(this.#session, this.#meterIds));
    await this.#alive(ctx);
    this.#setStatus('running');
  }

  #register(ctx, entry) {
    ctx.procs.push(entry);
    this.#registry.add(entry);
  }

  async #waitServerProcess(ctx, timeoutMs = this.#askTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [pid, port, exe] = await this.#ask(ctx, '[s.pid, s.addr.port, Server.program.asString]');
      await this.#alive(ctx);
      if (Number.isInteger(pid)) {
        if (port !== SERVER_PORT) throw new Error(`Port serveur inattendu : ${port} (attendu ${SERVER_PORT})`);
        return [pid, port, exe];
      }
      await sleep(100);
    }
    throw new Error('Le serveur SuperCollider n\'a pas lancé scsynth dans le délai imparti');
  }

  async #waitReady(ctx, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.#ask(ctx, '~mxBootState');
      await this.#alive(ctx);
      if (state === 1) return;
      if (state === -1) throw new Error('Démarrage du serveur SuperCollider impossible (pilote audio indisponible ?)');
      await sleep(100);
    }
    throw new Error('Le graphe SuperCollider ne s\'est pas initialisé dans le délai imparti');
  }

  #startWatcher(ctx) {
    if (!this.#watchMs) return;
    const pid = this.#scsynthPid;
    ctx.watcher = setInterval(() => {
      if (this.#ctx === ctx && ['starting', 'restoring', 'running'].includes(this.#status) && !this.#isAlive(pid)) {
        this.#onFailure(ctx, new Error(`scsynth (PID ${pid}) s'est arrêté`));
      }
    }, this.#watchMs);
    ctx.watcher.unref();
  }

  #onLangExit(ctx, code) {
    if (this.#ctx !== ctx || this.#status === 'stopping' || this.#status === 'stopped') return;
    this.#onFailure(ctx, new Error(`sclang s'est arrêté (code ${code ?? 'inconnu'})`));
  }

  #onFailure(ctx, error) {
    if (this.#ctx !== ctx) return;
    if (ctx.audioCause) error = new Error(`${error.message} (cause audio : ${ctx.audioCause}, voir logs/sclang.log)`);
    if (this.#abortBoot) { this.#abortBoot(error); return; }
    if (this.#status === 'running') this.#failInternal(error);
  }

  #notRunning(message) {
    return new ApiError('ENGINE_NOT_RUNNING', 409, `Le moteur n'est plus disponible : ${message}`);
  }

  /** Passe en failed et libère les ressources ; l'état est publié sans attendre le nettoyage. */
  #failInternal(error) {
    const ctx = this.#ctx;
    this.#ctx = null;
    this.#runtime = null;
    this.#audioClock = null;
    const message = error?.message ?? String(error);
    ctx?.queue?.dispose(this.#notRunning(message));
    this.#setStatus('failed', message);
    this.recorder.engineFailed(message);
    this.#scsynthPid = null;
    this.#cleanup = ctx ? this.#release(ctx, false).catch(() => {}) : Promise.resolve();
  }

  /** Arrête sclang, scsynth et le récepteur, retire les entrées du registre. */
  async #release(ctx, graceful) {
    const { lang, listener, procs, watcher } = ctx;
    ctx.lang = null; ctx.queue = null; ctx.listener = null; ctx.procs = []; ctx.watcher = null;
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
      // Le fichier d'enregistrement est fermé tant que scsynth tourne encore.
      if (this.#status === 'running') {
        try { await this.recorder.closeForEngineStop(); } catch (e) {
          this.#journalAppend('service', `fermeture de l'enregistrement impossible : ${e.message}`);
        }
      }
      if (this.#status === 'failed') {
        await this.#cleanup;
        this.#setStatus('stopped');
        return this.state();
      }
      const ctx = this.#ctx;
      this.#ctx = null;
      this.#runtime = null;
      this.#audioClock = null;
      this.#setStatus('stopping');
      ctx?.queue?.dispose(this.#notRunning('arrêt en cours'));
      try {
        if (ctx) await this.#release(ctx, true);
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
    const ctx = this.#ctx;
    const meterIds = new Map(this.#meterIds);
    let next = this.#nextMeterId;
    const meterIdFor = (sourceId) => {
      if (!meterIds.has(sourceId)) meterIds.set(sourceId, next++);
      return meterIds.get(sourceId);
    };
    const { session, code } = fn(structuredClone(this.#session), { meterIdFor });
    // Les options de scsynth sont figées au boot : une mutation au-delà du dimensionnement est refusée.
    assertSessionFitsSizing(session, this.#sizing);
    await ctx.queue.run(code);
    if (this.#ctx !== ctx) throw this.#notRunning('arrêt pendant la commande');
    const alive = new Set(session.sources.map((s) => s.id));
    for (const id of [...meterIds.keys()]) if (!alive.has(id)) meterIds.delete(id);
    this.#meterIds = meterIds;
    this.#nextMeterId = next;
    this.#commitSession(session);
    return structuredClone(session);
  }

  /** Commande de mesure (bancs) : ne modifie pas la session ; sérialisée avec les autres commandes sclang. */
  async diagnostic(code) {
    if (this.#status !== 'running') throw new ApiError('ENGINE_NOT_RUNNING', 409, "Le moteur n'est pas démarré.");
    return this.#ctx.queue.run(code, { result: true });
  }

  /** Arbre des nœuds du serveur (/g_queryTree) ; avec `controls`, valeurs des contrôles de chaque Synth. */
  async nodeTree({ controls = false } = {}) {
    if (this.#status !== 'running') throw new ApiError('ENGINE_NOT_RUNNING', 409, 'Le moteur n\'est pas démarré.');
    const payload = await this.#ctx.queue.run(nodeTreeCode(controls ? 1 : 0), { result: true });
    return decodeServerTree(JSON.parse(payload));
  }
}
