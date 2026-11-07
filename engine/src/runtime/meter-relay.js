const FLOOR_DB = -120;
const OUTPUTS = [['master', 'left'], ['master', 'right'], ['cue', 'left'], ['cue', 'right']];

/** Amplitude linéaire vers dBFS ; 0, -Infinity, NaN et valeurs non finies donnent le plancher. */
export function toDb(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(n));
}

function maxOf(values) {
  let max = 0;
  for (const v of values) { const n = Number(v); if (Number.isFinite(n) && n > max) max = n; }
  return max;
}

/**
 * Convertit les messages OSC de mesure de sclang en événements de l'API.
 * `handle` renvoie null pour tout message non reconnu ou invalide (jamais d'exception).
 */
export class MeterRelay {
  #resolveSourceId;

  constructor(resolveSourceId) { this.#resolveSourceId = resolveSourceId; }

  handle(message) {
    try {
      const { address, args } = message ?? {};
      if (!Array.isArray(args)) return null;
      if (address === '/mx/source-meter') return this.#source(args);
      if (address === '/mx/output-meter') return this.#output(args);
      if (address === '/mx/runtime') return this.#runtime(args);
      return null;
    } catch {
      return null;
    }
  }

  /** args : [nodeId, meterId, peak1, rms1, peak2, rms2, …] */
  #pairs(args) {
    const peaks = []; const rms = [];
    for (let i = 2; i + 1 < args.length; i += 2) { peaks.push(args[i]); rms.push(args[i + 1]); }
    return { peaks, rms };
  }

  #source(args) {
    const { peaks, rms } = this.#pairs(args);
    if (peaks.length === 0) return null;
    const sourceId = this.#resolveSourceId(args[1]);
    if (!sourceId) return null;
    return { type: 'sourceMeter', data: { sourceId, peakDb: toDb(maxOf(peaks)), rmsDb: toDb(maxOf(rms)) } };
  }

  #output(args) {
    const { peaks, rms } = this.#pairs(args);
    const target = OUTPUTS[args[1]];
    if (!target || peaks.length === 0) return null;
    const [output, channel] = target;
    return { type: 'outputMeter', data: { output, channel, peakDb: toDb(maxOf(peaks)), rmsDb: toDb(maxOf(rms)) } };
  }

  #runtime(args) {
    if (args.length < 12) return null;
    const num = (v) => Number(v);
    const [cpuAvg, cpuPeak, synths, ugens, groups, req, actual, blockSize, hw, latencyMs, fail, replyAge] = args;
    return { type: 'engineRuntimeChanged', data: {
      cpuAvg: num(cpuAvg), cpuPeak: num(cpuPeak), synths: num(synths), ugens: num(ugens), groups: num(groups),
      sampleRateRequested: num(req), sampleRateActual: num(actual), blockSize: num(blockSize),
      hardwareBufferFrames: num(hw), latencyMs: num(latencyMs), lastFail: fail === '' || fail == null ? null : String(fail),
      // Secondes depuis la dernière réponse /status.reply de scsynth, converties en ms.
      scsynthReplyAgeMs: Math.round(num(replyAge) * 1000),
    } };
  }
}
