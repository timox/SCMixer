import { z } from 'zod';
import {
  SourceProcessing, Output, EqBench, CROSSOVER_CASCADES, defaultSourceProcessing, defaultOutput, defaultEqBench,
} from './schemas.js';
import { SYNTHDEF_CATALOG, outputSynthDefEntry } from './synthdef-catalog.js';

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
  thresholdDb: ['Seuil', 'dB', 'Niveau d’entrée où change la pente de compression. Le moteur le convertit en amplitude pour Compander.'],
  slopeBelow: ['Pente sous le seuil', undefined, 'Pente appliquée sous le seuil : 1 conserve le niveau ; une valeur plus élevée réduit davantage les signaux faibles.'],
  slopeAbove: ['Pente au-dessus du seuil', undefined, 'Pente appliquée au-dessus du seuil : 0,25 correspond à une compression 4:1 ; 1 ne compresse pas.'],
  attackMs: ['Attaque', 'ms', 'Temps de réaction à une hausse de niveau ; utilisé comme clampTime par Compander. CompanderD ajoute aussi ce délai au chemin audio.'],
  releaseMs: ['Relâchement', 'ms', 'Temps de retour au gain normal ; utilisé comme relaxTime par Compander.'],
  mul: ['Gain de sortie', undefined, 'Multiplicateur appliqué par le SynthDef du compresseur à son signal traité.'],
  add: ['Décalage', undefined, 'Valeur ajoutée à la sortie du compresseur.'],
  bypass: ['Contournement', undefined, 'Activé : transmet le signal sans compression ; désactivé : applique le modèle sélectionné.'],
  controlLag: ['Lissage', 's', 'Durée d’interpolation des changements de paramètres continus ; zéro les applique sans lissage.'],
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
    inserted: ['Insérer dans la chaîne', undefined, 'Ajoute ou retire ce filtre du graphe audio. Les réglages restent mémorisés lorsqu’il est retiré.'],
    enabled: ['Activé', undefined, 'Active le filtre lorsqu’il est inséré ; désactivé, le signal reste sec.'],
    model: ['Modèle', undefined, 'Choisit explicitement le SynthDef SuperCollider utilisé. Le modèle ne change pas lors de l’insertion.'],
    freq: ['Fréquence', undefined, 'Position de coupure normalisée, convertie exponentiellement entre la fréquence minimale et maximale.'],
    minHz: ['Fréquence minimale', 'Hz', 'Borne basse de la conversion exponentielle de Fréquence.'],
    maxHz: ['Fréquence maximale', 'Hz', 'Borne haute de la conversion exponentielle de Fréquence.'],
    q: ['Facteur de qualité', undefined, 'Contrôle la résonance autour de la coupure ; le moteur transmet son inverse comme rq aux filtres concernés.'],
    mul: ['Gain', undefined, 'Multiplicateur appliqué à la sortie du filtre.'],
    add: ['Décalage', undefined, 'Valeur ajoutée à la sortie du filtre.'],
    floorHz: ['Plancher', 'Hz', 'Fréquence minimale effective de RHPF, même si la fréquence calculée est plus basse.'],
    controlLag: ['Lissage', 's', 'Durée de l’interpolation des changements de paramètres ; zéro applique le réglage sans lissage.'],
  },
  lp: {
    inserted: ['Insérer dans la chaîne', undefined, 'Ajoute ou retire ce filtre du graphe audio. Les réglages restent mémorisés lorsqu’il est retiré.'],
    enabled: ['Activé', undefined, 'Active le filtre lorsqu’il est inséré ; désactivé, le signal reste sec.'],
    model: ['Modèle', undefined, 'Choisit explicitement le SynthDef SuperCollider utilisé. Le modèle ne change pas lors de l’insertion.'],
    freq: ['Fréquence', undefined, 'Position de coupure normalisée, convertie exponentiellement entre la fréquence minimale et maximale.'],
    minHz: ['Fréquence minimale', 'Hz', 'Borne basse de la conversion exponentielle de Fréquence.'],
    maxHz: ['Fréquence maximale', 'Hz', 'Borne haute de la conversion exponentielle de Fréquence.'],
    q: ['Facteur de qualité', undefined, 'Contrôle la résonance des modèles BLowPass, RLPF et BLowPass4.'],
    gain: ['Résonance', undefined, 'Contrôle la résonance propre à MoogFF ; ignoré pour les autres modèles.'],
    mul: ['Gain', undefined, 'Multiplicateur appliqué à la sortie du filtre.'],
    add: ['Décalage', undefined, 'Valeur ajoutée à la sortie du filtre.'],
    controlLag: ['Lissage', 's', 'Durée de l’interpolation des changements de paramètres ; zéro applique le réglage sans lissage.'],
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
    inserted: ['Insérer dans la chaîne', undefined, 'Ajoute ou retire le SynthDef Limiter après le compresseur. Les réglages restent mémorisés lorsqu’il est retiré.'],
    enabled: ['Activé', undefined, 'Active la limitation lorsqu’elle est insérée ; désactivé, le signal reste sec.'],
    ceilingDb: ['Plafond', 'dB', 'Niveau maximal en sortie du limiteur.'],
    durMs: ['Anticipation', 'ms', 'Durée de regard en avant du Limiter ; fixe le délai du nœud et sa latence. Une modification recrée le nœud.'],
    controlLag: ['Lissage', 's', 'Durée d’interpolation des changements de paramètres ; zéro applique le réglage sans lissage.'],
  },
  compressor: {
    inserted: ['Insérer dans la chaîne', undefined, 'Ajoute ou retire le modèle choisi du graphe, avant le limiteur. Les réglages restent mémorisés lorsqu’il est retiré.'],
    model: ['Modèle'],
    ...COMP,
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
  'hp.floorHz': { model: SYNTHDEF_CATALOG.source.hp.models.filter((item) => item.gui.includes('floorHz')).map(({ id }) => id) },
  'lp.q': { model: SYNTHDEF_CATALOG.source.lp.models.filter((item) => item.gui.includes('q')).map(({ id }) => id) },
  'lp.gain': { model: SYNTHDEF_CATALOG.source.lp.models.filter((item) => item.gui.includes('gain')).map(({ id }) => id) },
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
  'add', 'controlLag', 'minHz', 'maxHz', 'windowSize', 'pitchDispersion', 'timeDispersion',
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
    description: meta[2] || (unit ? `${label} (${unit})` : label),
    group: isAdvanced(key) ? 'advanced' : 'main',
  };
  if (type === 'number' || type === 'integer') {
    field.scale = unit === 'Hz' ? 'log' : 'linear';
    if (json.minimum !== undefined) field.min = json.minimum;
    if (json.maximum !== undefined) field.max = json.maximum;
    if (type === 'integer') field.step = 1;
  }
  if (isEnum) field.options = json.enum;
  const [slot, fieldName] = key.split('.');
  const modelCatalog = SYNTHDEF_CATALOG.source[slot] || SYNTHDEF_CATALOG.output[slot];
  if (fieldName === 'model' && modelCatalog) {
    field.optionInfo = modelCatalog.models.map(({ id, def, ugen, implementation, args, mapping, availability }) => ({
      value: id,
      synthDef: def,
      ugen,
      implementation,
      args,
      mapping,
      availability: availability || modelCatalog.availability,
      doc: `https://doc.sccode.org/Classes/${ugen}.html`,
    }));
  }
  if (unit) field.unit = unit;
  if (applies) field.appliesTo = applies;
  const display = DISPLAY[key];
  if (display) field.display = display;
  return field;
}

function stage(schema, meta, defaults, prefix, label, appliesTable = {}, catalog = null) {
  const keys = Object.keys(schema.shape);
  if (catalog) {
    const guiFields = new Set(catalog.models.flatMap(({ gui }) => gui));
    const missing = keys.filter((key) => !guiFields.has(key));
    if (missing.length) throw new Error(`${catalog.slot} : contrôles GUI absents du catalogue (${missing.join(', ')}).`);
    for (const model of catalog.models) {
      const unmapped = model.args.filter((arg) => !model.gui.includes(arg) && !model.mapping?.[arg] && !model.actions?.includes(arg));
      if (unmapped.length) throw new Error(`${model.id} : arguments DSP sans commande GUI documentée (${unmapped.join(', ')}).`);
    }
  }
  const state = keys.includes('enabled') ? STATE_FIELDS.enabled : keys.includes('bypass') ? STATE_FIELDS.bypass : undefined;
  return {
    label,
    ...(catalog ? { slot: catalog.slot, position: catalog.position, channels: catalog.channels,
      structural: catalog.structural || [],
      synthDefs: catalog.models.map((model) => ({ ...model, availability: model.availability || catalog.availability })) } : {}),
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
      hp: stage(src.hp, SOURCE_META.hp, srcDefaults.hp, 'hp', STAGE_LABELS.source.hp, SOURCE_APPLIES, SYNTHDEF_CATALOG.source.hp),
      lp: stage(src.lp, SOURCE_META.lp, srcDefaults.lp, 'lp', STAGE_LABELS.source.lp, SOURCE_APPLIES, SYNTHDEF_CATALOG.source.lp),
      pitch: stage(src.pitch, SOURCE_META.pitch, srcDefaults.pitch, 'pitch', STAGE_LABELS.source.pitch),
      bandCompressor: Object.fromEntries(bandNames.map((band) => [
        band,
        stage(src.bandCompressor.shape[band], SOURCE_META.bandCompressor[band], srcDefaults.bandCompressor[band], `bandCompressor.${band}`, STAGE_LABELS.band[band]),
      ])),
    },
    output: Object.fromEntries(Object.keys(out).map((name) => [
      name,
      stage(out[name], OUTPUT_META[name], outDefaults[name], name, STAGE_LABELS.output[name], {},
        SYNTHDEF_CATALOG.output[name] || null),
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
export function buildParameterCatalog(models) {
  const catalog = structuredClone(CATALOG);
  if (models) {
    const available = new Set(Object.entries(models).filter(([, loaded]) => loaded === true).map(([id]) => id));
    const compressor = catalog.output.compressor;
    const model = compressor.fields.find((field) => field.key === 'model');
    model.options = model.options.filter((id) => available.has(id));
    model.optionInfo = model.optionInfo.filter(({ value }) => available.has(value));
    compressor.synthDefs = compressor.synthDefs.filter(({ id }) => available.has(id));
  }
  return catalog;
}
