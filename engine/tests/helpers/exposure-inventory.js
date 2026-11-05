/**
 * Inventaire de référence des arguments de UGens exposés par l'API.
 *
 * Source : HelpSource/Classes/<UGen>.schelp de SuperCollider 3.14.1 (liste des `argument::` et
 * valeurs par défaut des signatures de SCClassLibrary). Chaque ligne : UGen, argument documenté,
 * site (`source` ou `output`), objet du contrat (étage, ou `bandCompressor.<groupe>`) et champ qui
 * le pilote. Les arguments qui portent le signal (in, control, bus) n'y figurent pas.
 *
 * Les tests vérifient chaque ligne : champ présent dans le schéma strict ET contrôle de même nom
 * dans la SynthDef correspondante (tests/parameters.test.js). Ce fichier sert aussi de source au
 * tableau du rapport.
 */
const SRC = 'source';
const OUT = 'output';

const compander = (ugen, scope, stage) => [
  [ugen, 'thresh', scope, stage, 'thresholdDb'],
  [ugen, 'slopeBelow', scope, stage, 'slopeBelow'],
  [ugen, 'slopeAbove', scope, stage, 'slopeAbove'],
  [ugen, 'clampTime', scope, stage, 'attackMs'],
  [ugen, 'relaxTime', scope, stage, 'releaseMs'],
  [ugen, 'mul', scope, stage, 'mul'],
  [ugen, 'add', scope, stage, 'add'],
  ['Select', 'which', scope, stage, 'bypass'],
  ['Lag', 'lagTime', scope, stage, 'controlLag'],
];

const eq = (scope, stage) => [
  ['BLowShelf', 'freq', scope, stage, 'lowFreq'],
  ['BLowShelf', 'rs', scope, stage, 'lowRs'],
  ['BLowShelf', 'db', scope, stage, 'low'],
  ['BLowShelf', 'mul', scope, stage, 'lowMul'],
  ['BLowShelf', 'add', scope, stage, 'lowAdd'],
  ['BPeakEQ', 'freq', scope, stage, 'midFreq'],
  ['BPeakEQ', 'rq', scope, stage, 'midRq'],
  ['BPeakEQ', 'db', scope, stage, 'mid'],
  ['BPeakEQ', 'mul', scope, stage, 'midMul'],
  ['BPeakEQ', 'add', scope, stage, 'midAdd'],
  ['BHiShelf', 'freq', scope, stage, 'highFreq'],
  ['BHiShelf', 'rs', scope, stage, 'highRs'],
  ['BHiShelf', 'db', scope, stage, 'high'],
  ['BHiShelf', 'mul', scope, stage, 'highMul'],
  ['BHiShelf', 'add', scope, stage, 'highAdd'],
  ['Lag', 'lagTime', scope, stage, 'controlLag'],
];

const pass = (ugens, stage) => ugens.flatMap((ugen) => [
  [ugen, 'freq', SRC, stage, 'freq'],
  [ugen, 'rq', SRC, stage, 'q'],
  [ugen, 'mul', SRC, stage, 'mul'],
  [ugen, 'add', SRC, stage, 'add'],
]);

export const INVENTORY = [
  ['SoundIn', 'mul', SRC, 'input', 'mul'],
  ['SoundIn', 'add', SRC, 'input', 'add'],
  ['Lag', 'lagTime', SRC, 'input', 'controlLag'],
  ...compander('Compander', SRC, 'inputCompressor'),
  ...eq(SRC, 'eq'),
  ...pass(['BHiPass', 'RHPF', 'BHiPass4'], 'hp'),
  ['RHPF', 'freq (plancher)', SRC, 'hp', 'floorHz'],
  ['LinExp', 'dstlo', SRC, 'hp', 'minHz'],
  ['LinExp', 'dsthi', SRC, 'hp', 'maxHz'],
  ['Lag', 'lagTime', SRC, 'hp', 'controlLag'],
  ...pass(['BLowPass', 'RLPF', 'BLowPass4', 'MoogFF'], 'lp'),
  ['MoogFF', 'gain', SRC, 'lp', 'gain'],
  ['MoogFF', 'reset', SRC, 'lp', 'reset (action)'],
  ['LinExp', 'dstlo', SRC, 'lp', 'minHz'],
  ['LinExp', 'dsthi', SRC, 'lp', 'maxHz'],
  ['Lag', 'lagTime', SRC, 'lp', 'controlLag'],
  ['PitchShift', 'windowSize', SRC, 'pitch', 'windowSize'],
  ['PitchShift', 'pitchRatio', SRC, 'pitch', 'semitones'],
  ['PitchShift', 'pitchDispersion', SRC, 'pitch', 'pitchDispersion'],
  ['PitchShift', 'timeDispersion', SRC, 'pitch', 'timeDispersion'],
  ['PitchShift', 'mul', SRC, 'pitch', 'mul'],
  ['PitchShift', 'add', SRC, 'pitch', 'add'],
  ['XFade2', 'pan', SRC, 'pitch', 'blend'],
  ['XFade2', 'level', SRC, 'pitch', 'level'],
  ['Lag', 'lagTime', SRC, 'pitch', 'controlLag'],
  ...['low', 'mid', 'high'].flatMap((band) => compander('Compander', SRC, `bandCompressor.${band}`)),
  ['LPF', 'freq', SRC, 'bandCompressor.crossover', 'lowMidFreq'],
  ['HPF', 'freq', SRC, 'bandCompressor.crossover', 'lowMidFreq'],
  ['LPF', 'freq', SRC, 'bandCompressor.crossover', 'midHighFreq'],
  ['HPF', 'freq', SRC, 'bandCompressor.crossover', 'midHighFreq'],
  ...['lowLp', 'midHp', 'midLp', 'highHp'].flatMap((cascade) => [1, 2].flatMap((n) => {
    const ugen = cascade.endsWith('Lp') ? 'LPF' : 'HPF';
    return [
      [ugen, `mul (${cascade} ${n})`, SRC, 'bandCompressor.crossover', `${cascade}${n}Mul`],
      [ugen, `add (${cascade} ${n})`, SRC, 'bandCompressor.crossover', `${cascade}${n}Add`],
    ];
  })),
  ['Lag', 'lagTime', SRC, 'bandCompressor.crossover', 'controlLag'],
  ['Pan2', 'pos', SRC, 'mix', 'balance'],
  ['Pan2', 'level', SRC, 'mix', 'panLevel'],
  ['Balance2', 'pos', SRC, 'mix', 'balance'],
  ['Balance2', 'level', SRC, 'mix', 'balanceLevel'],
  ['Splay', 'spread', SRC, 'mix', 'spread'],
  ['Splay', 'level', SRC, 'mix', 'splayLevel'],
  ['Splay', 'center', SRC, 'mix', 'center'],
  ['Splay', 'levelComp', SRC, 'mix', 'levelComp'],
  ['Lag', 'lagTime', SRC, 'mix', 'controlLag'],

  ['HPF', 'freq', OUT, 'infraHpf', 'hz'],
  ['HPF', 'mul', OUT, 'infraHpf', 'mul'],
  ['HPF', 'add', OUT, 'infraHpf', 'add'],
  ['Lag', 'lagTime', OUT, 'infraHpf', 'controlLag'],
  ['HPF', 'freq', OUT, 'sideHpf', 'hz'],
  ['HPF', 'mul', OUT, 'sideHpf', 'mul'],
  ['HPF', 'add', OUT, 'sideHpf', 'add'],
  ['Lag', 'lagTime', OUT, 'sideHpf', 'controlLag'],
  ...eq(OUT, 'eq'),
  ['Lag', 'lagTime', OUT, 'mix', 'controlLag'],
  ['Clip', 'lo', OUT, 'clipper', 'lo'],
  ['Clip', 'hi', OUT, 'clipper', 'hi'],
  ['Lag', 'lagTime', OUT, 'clipper', 'controlLag'],
  ['Limiter', 'level', OUT, 'limiter', 'ceilingDb'],
  ['Limiter', 'dur', OUT, 'limiter', 'durMs'],
  ['Lag', 'lagTime', OUT, 'limiter', 'controlLag'],
  ...compander('Compander', OUT, 'compressor'),
  ['CompanderD', 'thresh', OUT, 'compressor', 'thresholdDb'],
  ['CompanderD', 'slopeBelow', OUT, 'compressor', 'slopeBelow'],
  ['CompanderD', 'slopeAbove', OUT, 'compressor', 'slopeAbove'],
  ['CompanderD', 'clampTime', OUT, 'compressor', 'attackMs'],
  ['CompanderD', 'relaxTime', OUT, 'compressor', 'releaseMs'],
  ['CompanderD', 'mul', OUT, 'compressor', 'mul'],
  ['CompanderD', 'add', OUT, 'compressor', 'add'],
  ['MixetteFaustRMS', 'thresholdDb', OUT, 'compressor', 'thresholdDb'],
  ['MixetteFaustRMS', 'slopeBelow', OUT, 'compressor', 'slopeBelow'],
  ['MixetteFaustRMS', 'slopeAbove', OUT, 'compressor', 'slopeAbove'],
  ['MixetteFaustRMS', 'attackMs', OUT, 'compressor', 'attackMs'],
  ['MixetteFaustRMS', 'releaseMs', OUT, 'compressor', 'releaseMs'],
  ['VarLag', 'time', OUT, 'compressor', 'fadeSeconds'],
];

/**
 * Arguments documentés des UGens audités (hors signal) : chacun doit figurer dans INVENTORY ou dans
 * EXCLUSIONS. Listes tirées des `argument::` des fichiers .schelp (et de la signature de la classe
 * pour CompanderD et MixetteFaustRMS).
 */
export const DOCUMENTED_ARGS = {
  SoundIn: ['mul', 'add'],
  Compander: ['thresh', 'slopeBelow', 'slopeAbove', 'clampTime', 'relaxTime', 'mul', 'add'],
  CompanderD: ['thresh', 'slopeBelow', 'slopeAbove', 'clampTime', 'relaxTime', 'mul', 'add'],
  BLowShelf: ['freq', 'rs', 'db', 'mul', 'add'],
  BPeakEQ: ['freq', 'rq', 'db', 'mul', 'add'],
  BHiShelf: ['freq', 'rs', 'db', 'mul', 'add'],
  BHiPass: ['freq', 'rq', 'mul', 'add'],
  BLowPass: ['freq', 'rq', 'mul', 'add'],
  BHiPass4: ['freq', 'rq', 'mul', 'add'],
  BLowPass4: ['freq', 'rq', 'mul', 'add'],
  RHPF: ['freq', 'rq', 'mul', 'add'],
  RLPF: ['freq', 'rq', 'mul', 'add'],
  MoogFF: ['freq', 'gain', 'reset', 'mul', 'add'],
  LPF: ['freq', 'mul', 'add'],
  HPF: ['freq', 'mul', 'add'],
  PitchShift: ['windowSize', 'pitchRatio', 'pitchDispersion', 'timeDispersion', 'mul', 'add'],
  XFade2: ['pan', 'level'],
  Pan2: ['pos', 'level'],
  Balance2: ['pos', 'level'],
  Splay: ['spread', 'level', 'center', 'levelComp'],
  Clip: ['lo', 'hi'],
  Limiter: ['level', 'dur'],
  Select: ['which'],
  MixetteFaustRMS: ['thresholdDb', 'slopeBelow', 'slopeAbove', 'attackMs', 'releaseMs'],
  VarLag: ['time', 'curvature', 'warp', 'start', 'mul', 'add'],
  Lag: ['lagTime', 'mul', 'add'],
};

/** Arguments documentés volontairement non exposés, avec la justification écrite. */
export const EXCLUSIONS = [
  ['VarLag', 'warp', 'Fixé à la construction du SynthDef : VarLag.new1 (Filter.sc) évalue `Env.shapeNames[warp]` et `curve != 1` dans sclang pour choisir entre le UGen VarLag (linéaire) et un EnvGen dont le niveau initial est `in` ; une valeur de contrôle (UGen) ne peut pas être évaluée à ce stade et un EnvGen à niveau initial `in` supprimerait la rampe (VarLag.schelp : warp « determines the shape », Env.shapeNumber requis pour piloter de l\'extérieur sans garantie de rampe). Rampe linéaire retenue, exposée par fadeSeconds.'],
  ['VarLag', 'curvature', 'N\'agit que si warp vaut 5 (VarLag.schelp : « Control curvature if warp input is 5 ») ; warp étant fixé linéaire, curvature est sans effet.'],
  ['VarLag', 'start', 'Valeur initiale de la rampe de fondu de sortie : par défaut celle de l\'entrée (VarLag.schelp : « If not specified, same as the input signal »), donc la position courante de l\'écrivain ; une autre valeur provoquerait un saut au démarrage de l\'écrivain.'],
  ['VarLag', 'mul', 'mul appliqué à la rampe de mélange changerait le poids du second signal sans changer celui du premier : la somme des poids cesserait de valoir 1 (1 - blend, blend). Le fondu complémentaire n\'a de sens qu\'avec mul = 1.'],
  ['VarLag', 'add', 'add décalerait les deux poids dans le même sens : même raison que mul, la somme des poids ne vaudrait plus 1.'],
  ['Lag', 'mul', 'Lag lisse un contrôle : mul/add appliqués au contrôle lissé dupliqueraient le paramètre lui-même (Lag.schelp : « Output will be multiplied by this value »).'],
  ['Lag', 'add', 'Voir mul : add appliqué au contrôle lissé dupliquerait le paramètre lui-même.'],
];
