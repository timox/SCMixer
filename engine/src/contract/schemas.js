import { z } from 'zod';

export const MAX_CHANNELS = 256;
/** Maximum de la plage d'attaque (ms) : borne unique du contrat, dont dérive le délai maximal de CompanderD. */
export const ATTACK_MS_MAX = 100;
export const SOURCE_STAGES = ['mix', 'input', 'inputCompressor', 'eq', 'hp', 'lp', 'pitch'];
export const OUTPUT_STAGES = ['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor'];
export const BANDS = ['low', 'mid', 'high'];

const range = (min, max) => z.number().min(min).max(max);
const unit = () => range(0, 1);
const name = () => z.string().min(1).max(60);

export const CompBand = z.strictObject({
  thresholdDb: range(-80, 0),
  ratio: range(1, 16),
  attackMs: range(1, ATTACK_MS_MAX),
  releaseMs: range(10, 1000),
  makeupDb: range(-24, 24),
  bypass: z.boolean(),
});

const Eq = z.strictObject({ low: unit(), mid: unit(), high: unit() });

export const SourceProcessing = z.strictObject({
  mix: z.strictObject({ volume: unit(), cue: unit(), mute: z.boolean(), balance: unit() }),
  input: z.strictObject({ gain: unit() }),
  inputCompressor: CompBand,
  eq: Eq,
  hp: z.strictObject({
    enabled: z.boolean(),
    model: z.enum(['BHiPass', 'RHPF', 'BHiPass4']),
    freq: unit(),
    q: range(0.5, 10),
    mul: range(0, 2),
    add: range(-1, 1),
  }),
  lp: z.strictObject({
    enabled: z.boolean(),
    model: z.enum(['BLowPass', 'RLPF', 'BLowPass4', 'MoogFF']),
    freq: unit(),
    q: range(0.5, 10),
    gain: range(0, 4),
    mul: range(0, 2),
    add: range(-1, 1),
  }),
  pitch: z.strictObject({ semitones: z.number().int().min(-12).max(12) }),
  bandCompressor: z.strictObject({ low: CompBand, mid: CompBand, high: CompBand }),
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
  mix: z.strictObject({ volume: unit() }),
  eq: Eq,
  infraHpf: z.strictObject({ enabled: z.boolean(), hz: range(20, 200) }),
  sideHpf: z.strictObject({ enabled: z.boolean(), hz: range(20, 1000) }),
  clipper: z.strictObject({ enabled: z.boolean(), ceilingDb: range(-24, 0) }),
  limiter: z.strictObject({ enabled: z.boolean(), ceilingDb: range(-24, 0) }),
  compressor: z.strictObject({
    model: z.enum(['Compander', 'CompanderD', 'FaustRMS']),
    thresholdDb: range(-80, 0),
    slopeBelow: range(0.1, 4),
    slopeAbove: range(0.1, 4),
    attackMs: range(1, ATTACK_MS_MAX),
    releaseMs: range(10, 1000),
    mul: range(0, 4),
    add: range(-1, 1),
    bypass: z.boolean(),
  }),
});

export const Session = z.strictObject({
  version: z.literal(2),
  nextSourceSeq: z.number().int().min(1),
  sources: z.array(Source),
  outputs: z.strictObject({ master: Output, cue: Output }),
});

export const PresetCreate = z.strictObject({ name: name() });

function defaultCompBand() {
  return { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: true };
}

export function defaultSourceProcessing() {
  return {
    mix: { volume: 1, cue: 0, mute: false, balance: 0.5 },
    input: { gain: 1 },
    inputCompressor: defaultCompBand(),
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    hp: { enabled: false, model: 'BHiPass', freq: 0, q: 1, mul: 1, add: 0 },
    lp: { enabled: false, model: 'BLowPass', freq: 1, q: 1, gain: 2, mul: 1, add: 0 },
    pitch: { semitones: 0 },
    bandCompressor: { low: defaultCompBand(), mid: defaultCompBand(), high: defaultCompBand() },
  };
}

export function defaultOutput() {
  return {
    mix: { volume: 1 },
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    infraHpf: { enabled: false, hz: 25 },
    sideHpf: { enabled: false, hz: 100 },
    clipper: { enabled: false, ceilingDb: 0 },
    limiter: { enabled: false, ceilingDb: -1 },
    compressor: {
      model: 'Compander', thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25,
      attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: true,
    },
  };
}
