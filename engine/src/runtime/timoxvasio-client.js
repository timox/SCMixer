import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { ApiError } from '../contract/errors.js';
import { listProcessesWindows } from './process-registry.js';

/** Version de l'API TimoxVasio visée (GET /api/v1/state, champ apiVersion). Aucune autre version n'est acceptée. */
export const TIMOXVASIO_API_VERSION = '1.1';
export const DEFAULT_TIMOXVASIO_URL = 'http://127.0.0.1:52525';
export const DEFAULT_TIMOXVASIO_ENGINE_EXE = 'C:\\Program Files\\TimoxVSSC\\resources\\backend\\TimoxVirtualAsioEngine.exe';
export const HOST_ROLE = 'timoxvasio-host';

const notReady = (message) => new ApiError('TIMOXVASIO_NOT_READY', 409, message);
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normCommand = (c) => String(c ?? '').replaceAll('"', '').trim().toLowerCase();

/**
 * Supervision de TimoxVasio au démarrage du moteur.
 *
 * Séquence de `prepare()` :
 *  1. lecture de GET /api/v1/state sur l'URL configurée ; si elle est injoignable, recherche d'un processus hôte :
 *     présent (API injoignable) -> refus, aucun second hôte, aucun arrêt ; absent -> lancement de l'hôte
 *     (sans argument, stdout/stderr séparés) et lecture du port dans l'événement JSON `api.ready` ;
 *  2. apiVersion exactement « 1.1 » ;
 *  3. état `running` -> suite ; `stopped` avec pilote physique -> une commande WebSocket `engine.start`
 *     puis attente de `running` ; sans pilote physique, `error`, ou `stopped` persistant -> refus avec la cause ;
 *  4. lecture de l'horloge audio (sampleRate, bufferFrames).
 *
 * Propriété : un hôte lancé par ce moteur est inscrit au registre (rôle `timoxvasio-host`, ownedByEngine) pour la
 * seule traçabilité. Le moteur ne l'arrête jamais et n'envoie jamais engine.stop : d'autres clients en dépendent.
 * Aucune route n'est créée ni modifiée ici : TimoxVasio ajoute lui-même scsynth à son graphe.
 */
export class TimoxVasioClient {
  #url; #fetch; #WebSocket; #spawn; #listHost; #exe; #exists; #registry; #t;

  constructor({
    apiUrl = DEFAULT_TIMOXVASIO_URL, registry = null, fetchImpl = fetch, WebSocketImpl = WebSocket, spawnImpl = spawn,
    listHostProcesses, engineExe = DEFAULT_TIMOXVASIO_ENGINE_EXE, existsImpl = fs.existsSync,
    timeouts = {},
  } = {}) {
    this.#url = String(apiUrl).replace(/\/+$/, '');
    this.#registry = registry;
    this.#fetch = fetchImpl;
    this.#WebSocket = WebSocketImpl;
    this.#spawn = spawnImpl;
    this.#exe = engineExe;
    this.#exists = existsImpl;
    this.#listHost = listHostProcesses ?? (() => listProcessesWindows(path.win32.basename(engineExe)));
    this.#t = { read: 2000, ready: 15_000, command: 10_000, running: 10_000, reconfiguring: 5000, poll: 250, ...timeouts };
  }

  /** URL effective de l'API TimoxVasio (celle configurée, ou celle annoncée par l'hôte lancé). */
  get apiUrl() { return this.#url; }

  /** @returns {Promise<object>} corps de /api/v1/state, ou { unreachable } si aucune réponse. */
  async #readState() {
    const url = `${this.#url}/api/v1/state`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#t.read);
    try {
      let res;
      try {
        res = await this.#fetch(url, { signal: controller.signal });
      } catch (e) {
        return { unreachable: `${e?.cause?.code ?? e?.message ?? e}` };
      }
      if (!res.ok) throw notReady(`TimoxVasio a répondu HTTP ${res.status} (${url}).`);
      try {
        return await res.json();
      } catch (e) {
        throw notReady(`Réponse de TimoxVasio illisible (${url}) : ${e?.message ?? e}.`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  #checkBody(body) {
    if (body?.apiVersion !== TIMOXVASIO_API_VERSION) {
      throw notReady(`Version d'API TimoxVasio non prise en charge : apiVersion « ${body?.apiVersion} » (attendue « ${TIMOXVASIO_API_VERSION} »).`);
    }
    if (body.engine === null || typeof body.engine !== 'object') throw notReady('Réponse de TimoxVasio sans champ engine.');
    return body.engine;
  }

  async #hostProcesses() {
    try {
      return await this.#listHost();
    } catch (e) {
      throw notReady(`Inventaire des processus impossible (${e?.message ?? e}) ; présence de l'hôte TimoxVasio indéterminée, aucun lancement.`);
    }
  }

  /** Lance l'hôte TimoxVasio et renvoie { port, pid, command } d'après l'événement JSON `api.ready`. */
  async #launchHost() {
    if (!this.#exists(this.#exe)) {
      throw notReady(`Hôte TimoxVasio introuvable : ${this.#exe} (SCMIXER_TIMOXVASIO_ENGINE_EXE). Installer Timox VASIO ou démarrer l'hôte.`);
    }
    const child = this.#spawn(this.#exe, [], {
      cwd: path.win32.dirname(this.#exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true,
    });
    const pid = child.pid;
    const port = await new Promise((resolve, reject) => {
      let out = ''; let err = ''; let done = false;
      let timer = null;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(value);
      };
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* déjà terminé */ }
        finish(reject, notReady(`Événement api.ready non reçu en ${this.#t.ready} ms de l'hôte TimoxVasio lancé (PID ${pid}) ; ce processus lancé par le moteur est arrêté.${err ? ` stderr : ${err.trim()}` : ''}`));
      }, this.#t.ready);
      child.once('error', (e) => finish(reject, notReady(`Lancement de l'hôte TimoxVasio impossible : ${e?.message ?? e}.`)));
      child.once('exit', (code) => finish(reject, notReady(`L'hôte TimoxVasio s'est arrêté (code ${code}) avant api.ready.${err ? ` stderr : ${err.trim()}` : ''}`)));
      child.stderr?.on('data', (d) => { err = (err + d).slice(-2000); });
      child.stdout?.on('data', (d) => {
        out += d;
        let nl;
        while ((nl = out.indexOf('\n')) >= 0) {
          const line = out.slice(0, nl).trim();
          out = out.slice(nl + 1);
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg?.event === 'api.ready') {
            if (!Number.isInteger(msg.port) || msg.port < 1 || msg.port > 65535) {
              finish(reject, notReady(`Événement api.ready de TimoxVasio sans port valide : ${line}.`));
            } else {
              finish(resolve, msg.port);
            }
          }
        }
      });
    });
    // L'hôte reste disponible pour les autres clients : le moteur ne le retient pas.
    child.stdout?.removeAllListeners?.('data');
    child.stderr?.removeAllListeners?.('data');
    child.stdout?.resume?.(); child.stderr?.resume?.();
    child.stdout?.unref?.(); child.stderr?.unref?.();
    child.unref?.();
    const command = `"${this.#exe}"`;
    this.#registry?.add({ role: HOST_ROLE, pid, command, ownedByEngine: true });
    return { port, pid, command };
  }

  /** engine.start sur le WebSocket vasio.api.v1 ; attend l'acquittement portant le même identifiant. */
  #sendEngineStart() {
    const wsUrl = `${this.#url.replace(/^http/, 'ws')}/api/v1/ws`;
    const id = `mx-engine-start-${Date.now()}`;
    return new Promise((resolve, reject) => {
      let ws;
      let done = false;
      let timer = null;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws?.close(); } catch { /* fermeture best effort */ }
        fn(value);
      };
      timer = setTimeout(() => finish(reject, notReady(`TimoxVasio n'a pas acquitté engine.start en ${this.#t.command} ms.`)), this.#t.command);
      try {
        ws = new this.#WebSocket(wsUrl, 'vasio.api.v1');
      } catch (e) {
        finish(reject, notReady(`Connexion WebSocket TimoxVasio impossible (${wsUrl}) : ${e?.message ?? e}.`));
        return;
      }
      ws.on('open', () => ws.send(JSON.stringify({ id, command: 'engine.start' })));
      ws.on('error', (e) => finish(reject, notReady(`WebSocket TimoxVasio en erreur (${wsUrl}) : ${e?.message ?? e}.`)));
      ws.on('close', () => finish(reject, notReady('WebSocket TimoxVasio fermé avant l\'acquittement de engine.start.')));
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg?.id !== id) return; // événements engine.status etc.
        if (msg.success === true) finish(resolve, msg.result);
        else finish(reject, notReady(`TimoxVasio a refusé engine.start : ${msg.error?.code ?? 'erreur'} — ${msg.error?.message ?? 'sans message'}.`));
      });
    });
  }

  async #waitState(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const body = await this.#readState();
      if (body.unreachable) throw notReady(`TimoxVasio est devenu injoignable (${this.#url}) : ${body.unreachable}.`);
      const engine = this.#checkBody(body);
      if (predicate(engine) || Date.now() >= deadline) return body;
      await sleep(this.#t.poll);
    }
  }

  /**
   * Garantit un TimoxVasio prêt (hôte joignable, transport running) et lit l'horloge audio.
   * @returns {Promise<{ audioClock: { sampleRate: number, bufferFrames: number },
   *   info: { apiUrl: string, apiVersion: string, hostPid: number|null, launchedByEngine: boolean, physicalDriverId: string|null, state: string } }>}
   */
  async prepare() {
    let hostPid = null;
    let launched = false;
    let body = await this.#readState();
    if (body.unreachable) {
      const reason = body.unreachable;
      const existing = await this.#hostProcesses();
      if (existing.length > 0) {
        const pids = existing.map((p) => p.pid).join(', ');
        throw notReady(`Un hôte TimoxVasio est actif (PID ${pids}) mais son API est injoignable sur ${this.#url} (${reason}) ; aucun second hôte n'est lancé et le processus existant n'est pas touché. Vérifier SCMIXER_TIMOXVASIO_URL ou l'état de l'hôte.`);
      }
      const host = await this.#launchHost();
      this.#url = `http://127.0.0.1:${host.port}`;
      hostPid = host.pid;
      launched = true;
      body = await this.#readState();
      if (body.unreachable) throw notReady(`Hôte TimoxVasio lancé (PID ${host.pid}) mais son API est injoignable sur ${this.#url} : ${body.unreachable}.`);
    } else {
      const existing = await this.#hostProcesses().catch(() => []);
      const live = existing[0] ?? null;
      hostPid = live?.pid ?? null;
      const owned = this.#registry?.entries().find((e) => e.role === HOST_ROLE && e.ownedByEngine === true && e.pid === hostPid);
      launched = Boolean(owned && live && normCommand(owned.command) === normCommand(live.command));
      // Entrées périmées : un hôte inscrit mais disparu n'est plus suivi.
      for (const e of this.#registry?.entries() ?? []) {
        if (e.role === HOST_ROLE && !existing.some((p) => p.pid === e.pid)) this.#registry.remove(e.pid);
      }
    }
    let engine = this.#checkBody(body);

    if (engine.state === 'reconfiguring') {
      body = await this.#waitState((e) => e.state !== 'reconfiguring', this.#t.reconfiguring);
      engine = this.#checkBody(body);
    }
    if (engine.state === 'error') {
      throw notReady(`TimoxVasio est en erreur : ${engine.lastError ?? 'cause non renseignée'}.`);
    }
    if (engine.state === 'stopped') {
      if (!engine.physicalDriverId) {
        throw notReady('aucun pilote physique configuré dans TimoxVasio — choisissez le périphérique maître dans Timox VASIO Control');
      }
      await this.#sendEngineStart();
      body = await this.#waitState((e) => e.state !== 'stopped' && e.state !== 'reconfiguring', this.#t.running);
      engine = this.#checkBody(body);
      if (engine.state === 'error') throw notReady(`TimoxVasio est en erreur après engine.start : ${engine.lastError ?? 'cause non renseignée'}.`);
      if (engine.state === 'stopped') {
        throw notReady(`TimoxVasio reste arrêté après engine.start${engine.lastError ? ` (${engine.lastError})` : ' : aucune route configurée, le moteur ne démarre pas sans route (API.md)'}. Configurer le pilote maître et les routes dans Timox VASIO Control.`);
      }
    }
    if (engine.state !== 'running') {
      throw notReady(`TimoxVasio n'est pas prêt : état « ${engine.state} » (attendu « running »).`);
    }
    if (!positiveInt(engine.sampleRate)) {
      throw notReady(`TimoxVasio n'a pas de fréquence d'échantillonnage valide : sampleRate ${JSON.stringify(engine.sampleRate)}.`);
    }
    if (!positiveInt(engine.bufferFrames)) {
      throw notReady(`TimoxVasio n'a pas de taille de tampon valide : bufferFrames ${JSON.stringify(engine.bufferFrames)}.`);
    }
    return {
      audioClock: { sampleRate: engine.sampleRate, bufferFrames: engine.bufferFrames },
      info: {
        apiUrl: this.#url, apiVersion: body.apiVersion, hostPid, launchedByEngine: launched,
        physicalDriverId: engine.physicalDriverId ?? null, state: engine.state,
      },
    };
  }
}
