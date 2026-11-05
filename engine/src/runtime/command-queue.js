import { ApiError } from '../contract/errors.js';

const fail = (message) => new ApiError('SC_COMMAND_FAILED', 502, message);

/**
 * File de commandes sclang strictement sérielle. Chaque commande est envoyée
 * dans un fork { try { ... } } qui répond par '/mx/ack' (reqId, statut, message) ;
 * la suivante ne part qu'après cet acquittement.
 */
export class CommandQueue {
  #lang;
  #listener;
  #timeoutMs;
  #nextId = 1;
  #tail = Promise.resolve();
  #pending = null; // { id, resolve, reject }
  #disposed = null;

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
      ? `var r; r = { ${code} }.value; ~mxAck.(${id}, "ok", r.asString)`
      : `{ ${code} }.value; ~mxAck.(${id}, "ok", "")`;
    const wrapper = `fork { try { ${body} } { |e| ~mxAck.(${id}, "error", e.errorString) } }`;
    let timer;
    const ack = new Promise((resolve, reject) => {
      this.#pending = { id, resolve, reject };
      timer = setTimeout(() => reject(fail(`Délai dépassé (${this.#timeoutMs} ms) sans acquittement de sclang`)), this.#timeoutMs);
    });
    ack.catch(() => {});
    try {
      Promise.resolve(this.#lang.interpret(wrapper)).catch((e) => this.#pending?.id === id && this.#pending.reject(fail(`Envoi à sclang impossible : ${e?.message ?? e}`)));
      return await ack;
    } finally {
      clearTimeout(timer);
      if (this.#pending?.id === id) this.#pending = null;
    }
  }

  /** Rejette la commande en cours et toutes celles en attente ; les suivantes sont refusées. */
  dispose(error) {
    this.#disposed = error instanceof Error ? error : new Error(String(error));
    this.#listener.off('message', this.#onMessage);
    if (this.#pending) this.#pending.reject(this.#disposed);
  }
}
