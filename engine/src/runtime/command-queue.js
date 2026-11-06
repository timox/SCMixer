import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError } from '../contract/errors.js';

/**
 * Taille maximale (octets UTF-8) d'un texte transmis directement à sclang. Au-delà, le texte est écrit
 * dans un fichier .scd que sclang charge : une ligne interprétée plus longue est tronquée (relevé réel du
 * 6 novembre 2026 : restauration de trois sources, « syntax error, unexpected end of file » au caractère
 * 7973). Seuil à la moitié de cette limite observée.
 */
export const MAX_INLINE_BYTES = 4096;

const fail = (message) => new ApiError('SC_COMMAND_FAILED', 502, message);

/**
 * File de commandes sclang strictement sérielle. Chaque commande est envoyée
 * dans un fork { try { ... } } qui répond par '/mx/ack' (reqId, statut, message) ;
 * la suivante ne part qu'après cet acquittement.
 *
 * Délai d'acquittement (120 s par défaut) : la commande la plus longue est la construction des
 * SynthDefs de largeur 256 par ~mxEnsureWidth (9,15 s mesurés côté sclang, 0,84 s pour 64), pendant
 * laquelle l'interpréteur sclang est bloqué (relais des vumètres et routine /mx/runtime suspendus).
 * La marge est d'un facteur 13. La requête HTTP correspondante (création ou déplacement d'une source
 * de cette largeur) reste ouverte pendant la construction, puis répond ; au-delà du délai, 502
 * SC_COMMAND_FAILED. La file sérialise ces constructions : aucune ne s'intercale avec une autre commande.
 */
export class CommandQueue {
  #lang;
  #listener;
  #timeoutMs;
  #nextId = 1;
  #tail = Promise.resolve();
  #pending = null; // { id, resolve, reject }
  #disposed = null;
  #scriptDir = null;

  constructor({ lang, listener, timeoutMs = 120_000 }) {
    this.#lang = lang;
    this.#listener = listener;
    this.#timeoutMs = timeoutMs;
    listener.on('message', this.#onMessage);
  }

  #onMessage = (msg) => {
    if (msg.address !== '/mx/ack' || !this.#pending) return;
    const [id, status, message] = msg.args;
    if (id !== this.#pending.id) return;
    const { resolve, reject } = this.#pending;
    if (status === 'ok') resolve(String(message ?? ''));
    else reject(fail(`Commande sclang refusée : ${message}`));
  };

  /**
   * Exécute `code` (instructions sclang). Avec { result: true }, `code` est une
   * expression dont la valeur (asString) est renvoyée.
   * @returns {Promise<string>} message d'acquittement
   */
  run(code, { result = false } = {}) {
    const job = this.#tail.then(() => this.#execute(code, result));
    this.#tail = job.catch(() => {});
    return job;
  }

  async #execute(code, result) {
    if (this.#disposed) throw this.#disposed;
    const id = this.#nextId++;
    const body = result
      ? `var r; r = { ${code}
}.value; ~mxAck.(${id}, "ok", r.asString)`
      : `{ ${code}
}.value; ~mxAck.(${id}, "ok", "")`;
    // Valeur finale nil : l'interprétation renvoie nil et non la Routine créée par fork, dont supercolliderjs
    // relaie la représentation textuelle (au-delà d'environ 8 Ko, cette réponse est un JSON invalide et
    // l'exception de supercolliderjs arrête le service : relevé réel du 6 novembre 2026). Le résultat d'une
    // commande passe toujours par '/mx/ack'.
    const wrapper = `fork { try { ${body} } { |e| ~mxAck.(${id}, "error", e.errorString) } }; nil`;
    let file = null;
    let text = wrapper;
    if (Buffer.byteLength(wrapper, 'utf8') > MAX_INLINE_BYTES) {
      this.#scriptDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mx-sclang-cmd-'));
      file = path.join(this.#scriptDir, `cmd-${id}.scd`);
      fs.writeFileSync(file, wrapper, 'utf8');
      text = `${JSON.stringify(file.replaceAll('\\', '/'))}.load`;
    }
    let timer;
    const ack = new Promise((resolve, reject) => {
      this.#pending = { id, resolve, reject };
      timer = setTimeout(() => reject(fail(`Délai dépassé (${this.#timeoutMs} ms) sans acquittement de sclang`)), this.#timeoutMs);
    });
    ack.catch(() => {});
    try {
      let sent;
      try { sent = Promise.resolve(this.#lang.interpret(text)); } catch (e) { sent = Promise.reject(e); }
      sent.catch((e) => this.#pending?.id === id && this.#pending.reject(fail(`Envoi à sclang impossible : ${e?.message ?? e}`)));
      return await ack;
    } finally {
      clearTimeout(timer);
      if (this.#pending?.id === id) this.#pending = null;
      if (file) fs.rmSync(file, { force: true });
    }
  }

  /** Rejette la commande en cours et toutes celles en attente ; les suivantes sont refusées. */
  dispose(error) {
    this.#disposed = error instanceof Error ? error : new Error(String(error));
    this.#listener.off('message', this.#onMessage);
    if (this.#pending) this.#pending.reject(this.#disposed);
    if (this.#scriptDir) fs.rmSync(this.#scriptDir, { recursive: true, force: true });
  }
}
