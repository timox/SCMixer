import { ApiError } from '../contract/errors.js';

const notReady = (message) => new ApiError('TIMOXVASIO_NOT_READY', 409, message);
const positiveInt = (v) => Number.isInteger(v) && v > 0;

/**
 * Lecture de l'horloge audio imposée par TimoxVasio (GET /api/v1/state).
 * Aucune valeur n'est choisie côté moteur : le périphérique maître physique de TimoxVasio fait foi.
 */
export class TimoxVasioClient {
  #url; #fetch; #timeoutMs;

  constructor({ apiUrl, fetchImpl = fetch, timeoutMs = 2000 }) {
    this.#url = `${String(apiUrl).replace(/\/+$/, '')}/api/v1/state`;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  /** @returns {Promise<{ sampleRate: number, bufferFrames: number }>} */
  async audioClock() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let body;
    try {
      let res;
      try {
        res = await this.#fetch(this.#url, { signal: controller.signal });
      } catch (e) {
        throw notReady(`TimoxVasio injoignable (${this.#url}) : ${e?.cause?.code ?? e?.message ?? e}. Démarrer TimoxVasio avant le moteur.`);
      }
      if (!res.ok) throw notReady(`TimoxVasio a répondu HTTP ${res.status} (${this.#url}).`);
      try {
        body = await res.json();
      } catch (e) {
        throw notReady(`Réponse de TimoxVasio illisible (${this.#url}) : ${e?.message ?? e}.`);
      }
    } finally {
      clearTimeout(timer);
    }
    if (body?.apiVersion !== '1.0') {
      throw notReady(`Version d'API TimoxVasio non prise en charge : apiVersion « ${body?.apiVersion} » (attendue « 1.0 »).`);
    }
    const engine = body.engine;
    if (engine === null || typeof engine !== 'object') throw notReady('Réponse de TimoxVasio sans champ engine.');
    if (engine.state !== 'running') {
      throw notReady(`TimoxVasio n'est pas prêt : état « ${engine.state} » (attendu « running »).`);
    }
    if (!positiveInt(engine.sampleRate)) {
      throw notReady(`TimoxVasio n'a pas de fréquence d'échantillonnage valide : sampleRate ${JSON.stringify(engine.sampleRate)}.`);
    }
    if (!positiveInt(engine.bufferFrames)) {
      throw notReady(`TimoxVasio n'a pas de taille de tampon valide : bufferFrames ${JSON.stringify(engine.bufferFrames)}.`);
    }
    return { sampleRate: engine.sampleRate, bufferFrames: engine.bufferFrames };
  }
}
