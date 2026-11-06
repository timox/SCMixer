import { z } from 'zod';
import {
  SourceProcessing, Output, EqBench, CROSSOVER_CASCADES, defaultSourceProcessing, defaultOutput, defaultEqBench,
} from './schemas.js';

/**
 * Catalogue des paramètres publié par GET /api/parameters.
 *
 * Plages, options et défauts sont lus dans les schémas zod (SourceProcessing, Output) et dans les
 * fonctions de défaut : rien n'est recopié ici. Seuls les libellés et les unités, qui ne sont pas
 * dans les schémas, sont tenus dans les tables ci-dessous. Chaque champ du contrat doit y figurer :
 * l'absence d'entrée fait échouer la construction du catalogue.
 */

/** Table : [libellé] ou [libellé, unité]. Une unité en Hz donne une échelle logarithmique. */
const COMP = {
  thresholdDb: ['Seuil', 'dB'],
  slopeBelow: ['Pente sous le seuil'],
  slopeAbove: ['Pente au-dessus du seuil'],
  attackMs: ['Attaque', 'ms'],
  releaseMs: ['Relâchement', 'ms'],
  mul: ['Gain de sortie'],
  add: ['Décalage'],
  bypass: ['Contournement'],
  controlLag: ['Lissage', 's'],
};

const EQ = {
  low: ['Grave'],
  mid: ['Médium'],
  high: ['Aigu'],
  rangeDb: ['Plage', 'dB'],
  lowFreq: ['Fréquence grave', 'Hz'],
  lowRs: ['Pente grave'],
  lowMul: ['Gain grave'],
  lowAdd: ['Décalage grave'],
  midFreq: ['Fréquence médium', 'Hz'],
  midRq: ['Largeur médium'],
  midMul: ['Gain médium'],
  midAdd: ['Décalage médium'],
  highFreq: ['Fréquence aigu', 'Hz'],
  highRs: ['Pente aigu'],
  highMul: ['Gain aigu'],
  highAdd: ['Décalage aigu'],
  controlLag: ['Lissage', 's'],
};

const CASCADE_LABELS = {
  lowLp: 'passe-bas grave',
  midHp: 'passe-haut médium',
  midLp: 'passe-bas médium',
  highHp: 'passe-haut aigu',
};

const CROSSOVER = {
  lowMidFreq: ['Fréquence grave / médium', 'Hz'],
  midHighFreq: ['Fréquence médium / aigu', 'Hz'],
  controlLag: ['Lissage', 's'],
};
for (const cascade of CROSSOVER_CASCADES) {
  for (const n of [1, 2]) {
    CROSSOVER[`${cascade}${n}Mul`] = [`Gain ${CASCADE_LABELS[cascade]}, cellule ${n}`];
    CROSSOVER[`${cascade}${n}Add`] = [`Décalage ${CASCADE_LABELS[cascade]}, cellule ${n}`];
  }
}

const SOURCE_META = {
  mix: {
    volume: ['Volume'],
    cue: ['Envoi Cue'],
    mute: ['Coupure'],
    balance: ['Balance'],
    panLevel: ['Niveau de panoramique'],
    balanceLevel: ['Niveau de balance'],
    spread: ['Écartement'],
    splayLevel: ['Niveau de répartition'],
    center: ['Centre de répartition'],
    levelComp: ['Compensation de niveau'],
    controlLag: ['Lissage', 's'],
  },
  input: {
    gain: ['Gain d\'entrée'],
    mul: ['Multiplicateur d\'entrée'],
    add: ['Décalage d\'entrée'],
    controlLag: ['Lissage', 's'],
  },
  inputCompressor: COMP,
  eq: EQ,
  hp: {
    enabled: ['Activé'],
    model: ['Modèle'],
    freq: ['Fréquence'],
    minHz: ['Fréquence minimale', 'Hz'],
    maxHz: ['Fréquence maximale', 'Hz'],
    q: ['Facteur de qualité'],
    mul: ['Gain'],
    add: ['Décalage'],
    floorHz: ['Plancher', 'Hz'],
    controlLag: ['Lissage', 's'],
  },
  lp: {
    enabled: ['Activé'],
    model: ['Modèle'],
    freq: ['Fréquence'],
    minHz: ['Fréquence minimale', 'Hz'],
    maxHz: ['Fréquence maximale', 'Hz'],
    q: ['Facteur de qualité'],
    gain: ['Résonance'],
    mul: ['Gain'],
    add: ['Décalage'],
    controlLag: ['Lissage', 's'],
  },
  pitch: {
    semitones: ['Transposition', 'demi-tons'],
    blend: ['Mélange'],
    level: ['Niveau'],
    windowSize: ['Taille de fenêtre', 's'],
    pitchDispersion: ['Dispersion de hauteur'],
    timeDispersion: ['Dispersion temporelle', 's'],
    mul: ['Gain'],
    add: ['Décalage'],
    controlLag: ['Lissage', 's'],
  },
  bandCompressor: {
    low: COMP,
    mid: COMP,
    high: COMP,
    crossover: CROSSOVER,
  },
};

const OUTPUT_HPF = {
  enabled: ['Activé'],
  mul: ['Gain'],
  add: ['Décalage'],
  controlLag: ['Lissage', 's'],
};

const OUTPUT_META = {
  mix: { volume: ['Volume'], controlLag: ['Lissage', 's'] },
  eq: EQ,
  infraHpf: { ...OUTPUT_HPF, hz: ['Fréquence', 'Hz'] },
  sideHpf: { ...OUTPUT_HPF, hz: ['Fréquence', 'Hz'] },
  clipper: {
    enabled: ['Activé'],
    lo: ['Seuil bas'],
    hi: ['Seuil haut'],
    controlLag: ['Lissage', 's'],
  },
  limiter: {
    enabled: ['Activé'],
    ceilingDb: ['Plafond', 'dB'],
    durMs: ['Anticipation', 'ms'],
    controlLag: ['Lissage', 's'],
  },
  compressor: {
    model: ['Modèle'],
    ...COMP,
    fadeSeconds: ['Durée du fondu', 's'],
  },
};

/** Banc EQ : la méthode et les trois bandes, à plat (corps de requête : { method, parameters: { low, mid, high } }). */
const EQ_BENCH_META = {
  method: ['Méthode'],
  low: ['Grave'],
  mid: ['Médium'],
  high: ['Aigu'],
};

/** Conditions d'usage (openapi.yaml : « seulement », « sans effet pour », « largeurs 3 et plus »). */
const SOURCE_APPLIES = {
  'mix.panLevel': { width: { min: 1, max: 1 } },
  'mix.balanceLevel': { width: { min: 2 } },
  'mix.spread': { width: { min: 3 } },
  'mix.splayLevel': { width: { min: 3 } },
  'mix.center': { width: { min: 3 } },
  'mix.levelComp': { width: { min: 3 } },
  'hp.floorHz': { model: ['RHPF'] },
  'lp.q': { model: ['BLowPass', 'RLPF', 'BLowPass4'] },
  'lp.gain': { model: ['MoogFF'] },
};

/** Libellés des étages (et des bandes du compresseur multibande). */
export const STAGE_LABELS = {
  source: {
    input: 'Entrée',
    inputCompressor: 'Compresseur d\x27entrée',
    eq: 'EQ 3 bandes',
    hp: 'Passe-haut',
    lp: 'Passe-bas',
    pitch: 'Transposition',
    bandCompressor: 'Compresseur multibande',
    mix: 'Mix',
  },
  band: { low: 'Bande grave', mid: 'Bande médium', high: 'Bande aiguë', crossover: 'Répartition' },
  output: {
    infraHpf: 'Passe-haut infra',
    sideHpf: 'Passe-haut latéral',
    eq: 'EQ 3 bandes',
    mix: 'Volume',
    clipper: 'Écrêteur',
    limiter: 'Limiteur',
    compressor: 'Compresseur',
  },
};

/**
 * Champ qui active ou contourne un étage : active vaut la valeur du champ pour laquelle l'étage agit.
 * Les étages absents de la table agissent toujours.
 */
const STATE_FIELDS = {
  enabled: { field: 'enabled', active: true },
  bypass: { field: 'bypass', active: false },
};

/** Champs rangés dans « Avancé » : réglages de structure, lissage, décalage continu et gains de cellule. */
const ADVANCED_KEYS = new Set([
  'add', 'controlLag', 'minHz', 'maxHz', 'fadeSeconds', 'windowSize', 'pitchDispersion', 'timeDispersion',
]);
const ADVANCED_PATHS = new Set(['pitch.mul']);
const isAdvanced = (key) => {
  const name = key.split('.').at(-1);
  return ADVANCED_KEYS.has(name) || ADVANCED_PATHS.has(key) || /^(low|mid|high)(Mul|Add)$/.test(name)
    || /^(lowLp|midHp|midLp|highHp)[12](Mul|Add)$/.test(name);
};

/**
 * Conversion de la valeur du contrat vers la grandeur jouée par le moteur (sc/source-defs.scd, sc/graph.scd) :
 * linexp : freq 0..1 -> minField..maxField (exponentiel) ; bipolar : v 0..1 -> (v * 2 - 1) * rangeField.
 */
const FREQ_DISPLAY = { kind: 'linexp', minField: 'minHz', maxField: 'maxHz', unit: 'Hz' };
const EQ_DISPLAY = { kind: 'bipolar', rangeField: 'rangeDb', unit: 'dB' };
const DISPLAY = {
  'hp.freq': FREQ_DISPLAY,
  'lp.freq': FREQ_DISPLAY,
  'eq.low': EQ_DISPLAY,
  'eq.mid': EQ_DISPLAY,
  'eq.high': EQ_DISPLAY,
};

function describe(schema, meta, defaultValue, key, applies) {
  if (!meta) throw new Error(`Libellé manquant pour ${key}.`);
  if (defaultValue === undefined) throw new Error(`Défaut manquant pour ${key}.`);
  const json = z.toJSONSchema(schema);
  const [label, unit] = meta;
  const isEnum = Array.isArray(json.enum);
  const type = isEnum ? 'enum' : json.type === 'integer' ? 'integer' : json.type;
  const field = {
    key: key.split('.').at(-1),
    type,
    default: defaultValue,
    label,
    description: unit ? `${label} (${unit})` : label,
    group: isAdvanced(key) ? 'advanced' : 'main',
  };
  if (type === 'number' || type === 'integer') {
    field.scale = unit === 'Hz' ? 'log' : 'linear';
    if (json.minimum !== undefined) field.min = json.minimum;
    if (json.maximum !== undefined) field.max = json.maximum;
    if (type === 'integer') field.step = 1;
  }
  if (isEnum) field.options = json.enum;
  if (unit) field.unit = unit;
  if (applies) field.appliesTo = applies;
  const display = DISPLAY[key];
  if (display) field.display = display;
  return field;
}

function stage(schema, meta, defaults, prefix, label, appliesTable = {}) {
  const keys = Object.keys(schema.shape);
  const state = keys.includes('enabled') ? STATE_FIELDS.enabled : keys.includes('bypass') ? STATE_FIELDS.bypass : undefined;
  return {
    label,
    ...(state ? { state } : {}),
    fields: Object.keys(schema.shape).map((key) => {
      const path = `${prefix}.${key}`;
      return describe(schema.shape[key], meta[key], defaults[key], path, appliesTable[path]);
    }),
  };
}

function buildCatalog() {
  const src = SourceProcessing.shape;
  const srcDefaults = defaultSourceProcessing();
  const out = Output.shape;
  const outDefaults = defaultOutput();
  const bandNames = ['low', 'mid', 'high', 'crossover'];
  return {
    source: {
      mix: stage(src.mix, SOURCE_META.mix, srcDefaults.mix, 'mix', STAGE_LABELS.source.mix, SOURCE_APPLIES),
      input: stage(src.input, SOURCE_META.input, srcDefaults.input, 'input', STAGE_LABELS.source.input),
      inputCompressor: stage(src.inputCompressor, SOURCE_META.inputCompressor, srcDefaults.inputCompressor, 'inputCompressor', STAGE_LABELS.source.inputCompressor),
      eq: stage(src.eq, SOURCE_META.eq, srcDefaults.eq, 'eq', STAGE_LABELS.source.eq),
      hp: stage(src.hp, SOURCE_META.hp, srcDefaults.hp, 'hp', STAGE_LABELS.source.hp, SOURCE_APPLIES),
      lp: stage(src.lp, SOURCE_META.lp, srcDefaults.lp, 'lp', STAGE_LABELS.source.lp, SOURCE_APPLIES),
      pitch: stage(src.pitch, SOURCE_META.pitch, srcDefaults.pitch, 'pitch', STAGE_LABELS.source.pitch),
      bandCompressor: Object.fromEntries(bandNames.map((band) => [
        band,
        stage(src.bandCompressor.shape[band], SOURCE_META.bandCompressor[band], srcDefaults.bandCompressor[band], `bandCompressor.${band}`, STAGE_LABELS.band[band]),
      ])),
    },
    output: Object.fromEntries(Object.keys(out).map((name) => [
      name,
      stage(out[name], OUTPUT_META[name], outDefaults[name], name, STAGE_LABELS.output[name]),
    ])),
    bench: {
      eq: {
        label: 'Banc EQ',
        fields: [
          describe(EqBench.shape.method, EQ_BENCH_META.method, defaultEqBench().method, 'bench.eq.method'),
          ...Object.keys(EqBench.shape.parameters.shape).map((key) => describe(
            EqBench.shape.parameters.shape[key], EQ_BENCH_META[key], defaultEqBench().parameters[key], `bench.eq.${key}`,
          )),
        ],
      },
    },
  };
}

const CATALOG = buildCatalog();

/** Copie du catalogue : la route et les tests ne peuvent pas le modifier. */
export function buildParameterCatalog() {
  return structuredClone(CATALOG);
}
