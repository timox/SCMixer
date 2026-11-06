import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../contract/errors.js';
import { recStartCode, REC_PAUSE_CODE, REC_RESUME_CODE, REC_STOP_CODE } from '../sc/commands.js';

/** Données audio maximales d'un fichier : sous la limite de 4 Gio du WAV, avec une marge pour l'en-tête. */
export const RECORDING_MAX_DATA_BYTES = 4_000_000_000;
/** En dessous de cet espace libre sur le disque du dossier, l'enregistrement s'arrête en erreur. */
export const RECORDING_MIN_FREE_BYTES = 64 * 1024 * 1024;
export const SAMPLE_FORMAT_BYTES = Object.freeze({ int16: 2, int24: 3, float: 4 });
const CHANNELS = 2;
const DISK_FULL = 'Espace disque insuffisant pour continuer l\'enregistrement.';

const pad = (n) => String(n).padStart(2, '0');

/** AAAA-MM-JJ_HH-MM-SS_master.wav, en heure locale. */
export function recordingFileName(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_`
    + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}_master.wav`;
}

const stateError = (message) => new ApiError('RECORDING_STATE', 409, message);
const unexpected = (text) => new ApiError('SC_COMMAND_FAILED', 502, `Réponse inattendue de sclang (enregistrement) : ${text}`);

function defaultFreeBytes(dir) {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

/**
 * Enregistrement WAV de la sortie Master : état publié par l'API (GET /api/recording, événement
 * recordingChanged). Les commandes sont envoyées à sclang par `run(code)` (file de commandes du moteur,
 * sans modification de la session) et traitées l'une après l'autre.
 */
export class Recorder extends EventEmitter {
  #run; #dir; #now; #clock; #freeBytes; #tickMs;
  #state = 'stopped'; #file = null; #sampleFormat = null; #sampleRate = null;
  #accumulatedMs = 0; #segmentStart = null; #stopReason = null; #error = null;
  #queue = Promise.resolve(); #timer = null;

  constructor({ run, dir, now = () => performance.now(), clock = () => new Date(), freeBytes = defaultFreeBytes, tickMs = 1000 }) {
    super();
    this.#run = run;
    this.#dir = dir;
    this.#now = now;
    this.#clock = clock;
    this.#freeBytes = freeBytes;
    this.#tickMs = tickMs;
  }

  state() {
    const seconds = this.#seconds();
    return {
      state: this.#state,
      file: this.#file,
      sampleFormat: this.#sampleFormat,
      sampleRate: this.#sampleRate,
      channels: CHANNELS,
      recordedSeconds: seconds,
      bytes: this.#sampleRate ? Math.round(seconds * this.#sampleRate) * CHANNELS * SAMPLE_FORMAT_BYTES[this.#sampleFormat] : 0,
      stopReason: this.#stopReason,
      error: this.#error,
    };
  }

  start(sampleFormat) {
    return this.#serial(async () => {
      if (this.#state !== 'stopped') throw stateError('Un enregistrement est déjà en cours.');
      fs.mkdirSync(this.#dir, { recursive: true });
      const file = path.join(this.#dir, recordingFileName(this.#clock()));
      if (fs.existsSync(file)) {
        throw new ApiError('RECORDING_FILE_EXISTS', 409, `Le fichier existe déjà : ${file}. Réessayer dans une seconde.`);
      }
      const reply = String(await this.#run(recStartCode(file, sampleFormat)));
      const m = /^recording\|(\d+)$/.exec(reply);
      if (!m) {
        if (reply === 'refused|RECORDING_ACTIVE') throw stateError('Un enregistrement est déjà en cours dans le moteur.');
        if (reply === 'refused|OPEN_FAILED') throw new ApiError('RECORDING_OPEN_FAILED', 502, `Ouverture du fichier impossible : ${file}.`);
        throw unexpected(reply);
      }
      this.#file = file;
      this.#sampleFormat = sampleFormat;
      this.#sampleRate = Number(m[1]);
      this.#accumulatedMs = 0;
      this.#segmentStart = this.#now();
      this.#stopReason = null;
      this.#error = null;
      this.#state = 'recording';
      this.#startTimer();
      return this.#changed();
    });
  }

  pause() {
    return this.#serial(async () => {
      if (this.#state !== 'recording') throw stateError('Aucun enregistrement en cours à mettre en pause.');
      this.#expect(await this.#run(REC_PAUSE_CODE), 'paused');
      this.#accumulatedMs += this.#now() - this.#segmentStart;
      this.#segmentStart = null;
      this.#state = 'paused';
      return this.#changed();
    });
  }

  resume() {
    return this.#serial(async () => {
      if (this.#state !== 'paused') throw stateError('Aucun enregistrement en pause à reprendre.');
      this.#expect(await this.#run(REC_RESUME_CODE), 'recording');
      this.#segmentStart = this.#now();
      this.#state = 'recording';
      return this.#changed();
    });
  }

  stop(reason = 'user') {
    return this.#serial(() => this.#close(reason, null));
  }

  /** Avant l'arrêt du moteur : ferme le fichier en cours ou en pause ; sans effet à l'arrêt. */
  closeForEngineStop() {
    return this.#serial(async () => {
      if (this.#state !== 'stopped') await this.#close('engineStopped', null);
    });
  }

  /** Moteur en échec : scsynth ne répond plus, aucune commande n'est envoyée. */
  engineFailed(message) {
    if (this.#state === 'stopped') return;
    this.#finish('error', message);
  }

  /** Progression (une fois par seconde en production) : limite de taille et espace disque. */
  tick() {
    return this.#serial(async () => {
      if (this.#state !== 'recording') return;
      if (this.state().bytes >= RECORDING_MAX_DATA_BYTES) {
        await this.#close('sizeLimit', null);
      } else if (this.#freeBytes(this.#dir) < RECORDING_MIN_FREE_BYTES) {
        await this.#close('error', DISK_FULL);
      } else {
        this.#changed();
      }
    });
  }

  async #close(reason, error) {
    if (this.#state === 'stopped') throw stateError('Aucun enregistrement à arrêter.');
    let reply;
    try {
      reply = await this.#run(REC_STOP_CODE);
    } catch (e) {
      this.#finish('error', e.message);
      throw e;
    }
    if (String(reply) !== 'stopped') {
      this.#finish('error', `Réponse inattendue de sclang à l'arrêt : ${reply}`);
      throw unexpected(reply);
    }
    return this.#finish(reason, error);
  }

  #finish(reason, error) {
    if (this.#segmentStart !== null) this.#accumulatedMs += this.#now() - this.#segmentStart;
    this.#segmentStart = null;
    this.#state = 'stopped';
    this.#stopReason = reason;
    this.#error = error;
    this.#stopTimer();
    return this.#changed();
  }

  #expect(reply, expected) {
    const text = String(reply);
    if (text === expected) return;
    if (text.startsWith('refused|')) throw stateError(`Commande refusée par le moteur : ${text}.`);
    throw unexpected(text);
  }

  #seconds() {
    const running = this.#segmentStart === null ? 0 : this.#now() - this.#segmentStart;
    return (this.#accumulatedMs + running) / 1000;
  }

  #changed() {
    const state = this.state();
    this.emit('changed', state);
    return state;
  }

  #serial(fn) {
    const job = this.#queue.then(fn);
    this.#queue = job.catch(() => {});
    return job;
  }

  #startTimer() {
    if (this.#tickMs <= 0 || this.#timer) return;
    this.#timer = setInterval(() => { this.tick().catch(() => {}); }, this.#tickMs);
    this.#timer.unref?.();
  }

  #stopTimer() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
