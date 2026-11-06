import { z } from 'zod';

export const MAX_CHANNELS = 256;
/** Maximum de la plage d'attaque (ms) : borne unique du contrat, dont dérive le délai maximal de CompanderD. */
export const ATTACK_MS_MAX = 100;
/**
 * Maximum de windowSize de PitchShift (s) : borne unique du contrat. PitchShift alloue son tampon à la
 * création du Synth (PitchShift.schelp : windowSize « cannot be modulated ») : memSize est dimensionné
 * pour ce maximum (server-options.js) et sc/source-defs.scd borne windowSize à la même valeur.
 */
export const PITCH_WINDOW_MAX_SECONDS = 0.2;
/** Maximum de la durée d'anticipation du Limiter (ms) : même principe (Limiter.schelp : dur « cannot be modulated »). */
export const LIMITER_DUR_MAX_MS = 50;
export const SOURCE_STAGES = ['mix', 'input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch'];
export const OUTPUT_STAGES = ['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor'];
export const BANDS = ['low', 'mid', 'high'];
/** Objets adressables sous bandCompressor : les trois bandes et les filtres de répartition. */
export const BAND_GROUPS = [...BANDS, 'crossover'];
/** Filtres LR4 de la répartition : chaque cascade est formée de deux UGens identiques (LPF/HPF) en série. */
export const CROSSOVER_CASCADES = ['lowLp', 'midHp', 'midLp', 'highHp'];

const range = (min, max) => z.number().min(min).max(max);
const unit = () => range(0, 1);
const name = () => z.string().min(1).max(60);
const hz = () => range(20, 20000);
const controlLag = () => range(0, 2);
const mul = (max = 4) => range(0, max);
const add = () => range(-1, 1);
const level = () => range(0, 2);
const slope = () => range(0.05, 10);

export const CompBand = z.strictObject({
  thresholdDb: range(-80, 0),
  slopeBelow: slope(),
  slopeAbove: slope(),
  attackMs: range(1, ATTACK_MS_MAX),
  releaseMs: range(10, 1000),
  mul: mul(16),
  add: add(),
  bypass: z.boolean(),
  controlLag: controlLag(),
});

const eqShape = () => ({
  low: unit(), mid: unit(), high: unit(), rangeDb: range(0, 24),
  lowFreq: hz(), lowRs: range(0.1, 10), lowMul: mul(), lowAdd: add(),
  midFreq: hz(), midRq: range(0.05, 10), midMul: mul(), midAdd: add(),
  highFreq: hz(), highRs: range(0.1, 10), highMul: mul(), highAdd: add(),
  controlLag: controlLag(),
});
const SourceEq = z.strictObject(eqShape());
const OutputEq = z.strictObject(eqShape());

const hzOrder = (schema) => schema.refine((v) => v.minHz < v.maxHz, { message: 'minHz doit être inférieur à maxHz' });

const crossoverShape = { lowMidFreq: hz(), midHighFreq: hz(), controlLag: controlLag() };
for (const cascade of CROSSOVER_CASCADES) {
  for (const n of [1, 2]) {
    crossoverShape[`${cascade}${n}Mul`] = mul();
    crossoverShape[`${cascade}${n}Add`] = add();
  }
}
export const Crossover = z.strictObject(crossoverShape).refine(
  (v) => v.lowMidFreq < v.midHighFreq, { message: 'lowMidFreq doit être inférieur à midHighFreq' },
);

export const SourceProcessing = z.strictObject({
  mix: z.strictObject({
    volume: unit(), cue: unit(), mute: z.boolean(), balance: unit(),
    panLevel: level(), balanceLevel: level(), spread: unit(), splayLevel: level(),
    center: range(-1, 1), levelComp: unit(), controlLag: controlLag(),
  }),
  input: z.strictObject({ gain: unit(), mul: mul(), add: add(), controlLag: controlLag() }),
  inputCompressor: CompBand,
  eq: SourceEq,
  hp: hzOrder(z.strictObject({
    enabled: z.boolean(),
    model: z.enum(['BHiPass', 'RHPF', 'BHiPass4']),
    freq: unit(), minHz: hz(), maxHz: hz(),
    q: range(0.5, 10),
    mul: range(0, 2),
    add: add(),
    floorHz: hz(),
    controlLag: controlLag(),
  })),
  lp: hzOrder(z.strictObject({
    enabled: z.boolean(),
    model: z.enum(['BLowPass', 'RLPF', 'BLowPass4', 'MoogFF']),
    freq: unit(), minHz: hz(), maxHz: hz(),
    q: range(0.5, 10),
    gain: range(0, 4),
    mul: range(0, 2),
    add: add(),
    controlLag: controlLag(),
  })),
  pitch: z.strictObject({
    semitones: z.number().int().min(-12).max(12),
    blend: range(-1, 1),
    level: level(),
    windowSize: range(0.01, PITCH_WINDOW_MAX_SECONDS),
    pitchDispersion: range(0, 1),
    timeDispersion: range(0, PITCH_WINDOW_MAX_SECONDS),
    mul: mul(),
    add: add(),
    controlLag: controlLag(),
  }).refine((v) => v.timeDispersion <= v.windowSize,
    { message: 'timeDispersion ne peut pas dépasser windowSize (PitchShift.schelp)' }),
  bandCompressor: z.strictObject({ low: CompBand, mid: CompBand, high: CompBand, crossover: Crossover }),
});

export const SourceCreate = z.strictObject({
  name: name(),
  firstChannel: z.number().int().min(1).max(MAX_CHANNELS),
  width: z.number().int().min(1).max(MAX_CHANNELS),
});

export const SourcePatch = SourceCreate.partial();

export const Source = z.strictObject({
  id: z.string().min(1),
  name: name(),
  firstChannel: z.number().int().min(1).max(MAX_CHANNELS),
  width: z.number().int().min(1).max(MAX_CHANNELS),
  processing: SourceProcessing,
});

export const Output = z.strictObject({
  mix: z.strictObject({ volume: unit(), controlLag: controlLag() }),
  eq: OutputEq,
  infraHpf: z.strictObject({ enabled: z.boolean(), hz: range(20, 200), mul: mul(), add: add(), controlLag: controlLag() }),
  sideHpf: z.strictObject({ enabled: z.boolean(), hz: range(20, 1000), mul: mul(), add: add(), controlLag: controlLag() }),
  clipper: z.strictObject({ enabled: z.boolean(), lo: range(-4, 4), hi: range(-4, 4), controlLag: controlLag() })
    .refine((v) => v.lo < v.hi, { message: 'lo doit être inférieur à hi (Clip.schelp)' }),
  limiter: z.strictObject({ enabled: z.boolean(), ceilingDb: range(-24, 0), durMs: range(1, LIMITER_DUR_MAX_MS), controlLag: controlLag() }),
  compressor: z.strictObject({
    model: z.enum(['Compander', 'CompanderD', 'FaustRMS']),
    thresholdDb: range(-80, 0),
    slopeBelow: slope(),
    slopeAbove: slope(),
    attackMs: range(1, ATTACK_MS_MAX),
    releaseMs: range(10, 1000),
    mul: mul(16),
    add: add(),
    bypass: z.boolean(),
    controlLag: controlLag(),
    fadeSeconds: range(0.005, 2),
  }),
});

export const Session = z.strictObject({
  version: z.literal(3),
  nextSourceSeq: z.number().int().min(1),
  sources: z.array(Source),
  outputs: z.strictObject({ master: Output, cue: Output }),
});

export const PresetCreate = z.strictObject({ name: name() });

/** Bancs de mesure : méthodes du banc EQ (bruit rose à la place de Master) et durée du banc compresseur. */
export const EQ_BENCH_METHODS = ['legacyStack', 'threeBand'];
export const COMPRESSOR_BENCH_SECONDS = 3;
/** Réglages initiaux du banc EQ (méthode à trois bandes, bandes neutres). */
export function defaultEqBench() {
  return { method: 'threeBand', parameters: { low: 0.5, mid: 0.5, high: 0.5 } };
}

export const EqBench = z.strictObject({
  method: z.enum(EQ_BENCH_METHODS),
  parameters: z.strictObject({ low: unit(), mid: unit(), high: unit() }),
});

function defaultCompBand() {
  return {
    thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25, attackMs: 10, releaseMs: 100,
    mul: 1, add: 0, bypass: true, controlLag: 0,
  };
}

function defaultEq(lowFreq) {
  return {
    low: 0.5, mid: 0.5, high: 0.5, rangeDb: 12,
    lowFreq, lowRs: 0.5, lowMul: 1, lowAdd: 0,
    midFreq: 1000, midRq: 0.7, midMul: 1, midAdd: 0,
    highFreq: 8000, highRs: 0.5, highMul: 1, highAdd: 0,
    controlLag: 0,
  };
}

function defaultCrossover() {
  const crossover = { lowMidFreq: 250, midHighFreq: 4000, controlLag: 0 };
  for (const cascade of CROSSOVER_CASCADES) {
    for (const n of [1, 2]) {
      crossover[`${cascade}${n}Mul`] = 1;
      crossover[`${cascade}${n}Add`] = 0;
    }
  }
  return crossover;
}

export function defaultSourceProcessing() {
  return {
    mix: {
      volume: 1, cue: 0, mute: false, balance: 0.5,
      panLevel: 1, balanceLevel: 1, spread: 1, splayLevel: 1, center: 0, levelComp: 0.5, controlLag: 0,
    },
    input: { gain: 1, mul: 1, add: 0, controlLag: 0 },
    inputCompressor: defaultCompBand(),
    eq: defaultEq(80),
    hp: {
      enabled: false, model: 'BHiPass', freq: 0, minHz: 20, maxHz: 20000, q: 1, mul: 1, add: 0, floorHz: 40, controlLag: 0,
    },
    lp: {
      enabled: false, model: 'BLowPass', freq: 1, minHz: 20, maxHz: 20000, q: 1, gain: 2, mul: 1, add: 0, controlLag: 0,
    },
    pitch: {
      semitones: 0, blend: -1, level: 1, windowSize: PITCH_WINDOW_MAX_SECONDS, pitchDispersion: 0,
      timeDispersion: 0.01, mul: 1, add: 0, controlLag: 0,
    },
    bandCompressor: { low: defaultCompBand(), mid: defaultCompBand(), high: defaultCompBand(), crossover: defaultCrossover() },
  };
}

export function defaultOutput() {
  return {
    mix: { volume: 1, controlLag: 0 },
    eq: defaultEq(200),
    infraHpf: { enabled: false, hz: 25, mul: 1, add: 0, controlLag: 0 },
    sideHpf: { enabled: false, hz: 100, mul: 1, add: 0, controlLag: 0 },
    clipper: { enabled: false, lo: -1, hi: 1, controlLag: 0 },
    limiter: { enabled: false, ceilingDb: -1, durMs: 10, controlLag: 0 },
    compressor: {
      model: 'Compander', thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25,
      attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: true, controlLag: 0, fadeSeconds: 0.05,
    },
  };
}
