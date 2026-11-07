/** Catalogue fermé des SynthDef internes insérables dans les chaînes source et Master/Cue. */
export const SYNTHDEF_CATALOG = Object.freeze({
  source: Object.freeze({
    hp: Object.freeze({
      slot: 'hp',
      structural: ['bus'],
      availability: 'UGen standard SuperCollider ; SynthDef vérifié au chargement de la chaîne.',
      position: 'Après EQ, avant passe-bas',
      channels: 'Largeur de la source',
      label: 'Passe-haut',
      models: Object.freeze([
        Object.freeze({ id: 'BHiPass', def: 'mx_hpBHiPass_{width}', ugen: 'BHiPass', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'mul', 'add', 'controlLag'] }),
        Object.freeze({ id: 'RHPF', def: 'mx_hpRHPF_{width}', ugen: 'RHPF', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz puis limitée par floorHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'floorHz', 'mul', 'add', 'controlLag'] }),
        Object.freeze({ id: 'BHiPass4', def: 'mx_hpBHiPass4_{width}', ugen: 'BHiPass4', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'mul', 'add', 'controlLag'] }),
      ]),
    }),
    lp: Object.freeze({
      slot: 'lp',
      structural: ['bus'],
      availability: 'UGen standard SuperCollider ; SynthDef vérifié au chargement de la chaîne.',
      position: 'Après passe-haut, avant transposition',
      channels: 'Largeur de la source',
      label: 'Passe-bas',
      models: Object.freeze([
        Object.freeze({ id: 'BLowPass', def: 'mx_lpBLowPass_{width}', ugen: 'BLowPass', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'mul', 'add', 'controlLag'] }),
        Object.freeze({ id: 'RLPF', def: 'mx_lpRLPF_{width}', ugen: 'RLPF', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'mul', 'add', 'controlLag'] }),
        Object.freeze({ id: 'BLowPass4', def: 'mx_lpBLowPass4_{width}', ugen: 'BLowPass4', args: ['freq', 'rq', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', rq: 'inverse du contrôle q' }, gui: ['inserted', 'model', 'enabled', 'freq', 'q', 'minHz', 'maxHz', 'mul', 'add', 'controlLag'] }),
        Object.freeze({ id: 'MoogFF', def: 'mx_lpMoogFF_{width}', ugen: 'MoogFF', args: ['freq', 'gain', 'reset', 'mul', 'add'], mapping: { freq: 'fréquence affichée en Hz, calculée avec minHz et maxHz', gain: 'gain de résonance MoogFF', reset: 'action « Réinitialiser l’état du filtre »' }, gui: ['inserted', 'model', 'enabled', 'freq', 'minHz', 'maxHz', 'gain', 'mul', 'add', 'controlLag'], actions: ['reset'] }),
      ]),
    }),
  }),
  output: Object.freeze({
    compressor: Object.freeze({
      slot: 'compressor',
      structural: ['bus'],
      availability: 'Compander est fourni avec SuperCollider ; les SynthDef sont vérifiés au démarrage.',
      position: 'Après écrêteur, avant limiteur',
      channels: 'Stéréo',
      label: 'Compresseur Master/Cue',
      models: Object.freeze([
        Object.freeze({ id: 'Compander', def: 'mx_output_compander', ugen: 'Compander', args: ['thresh', 'slopeBelow', 'slopeAbove', 'clampTime', 'relaxTime', 'mul', 'add'], mapping: { thresh: 'dbamp(thresholdDb)', clampTime: 'attackMs / 1000', relaxTime: 'releaseMs / 1000' }, gui: ['inserted', 'model', 'thresholdDb', 'slopeBelow', 'slopeAbove', 'attackMs', 'releaseMs', 'mul', 'add', 'bypass', 'controlLag'] }),
        Object.freeze({ id: 'CompanderD', def: 'mx_output_companderD', ugen: 'CompanderD', implementation: ['Compander', 'DelayN'], args: ['thresh', 'slopeBelow', 'slopeAbove', 'clampTime', 'relaxTime', 'mul', 'add'], mapping: { thresh: 'dbamp(thresholdDb)', clampTime: 'attackMs / 1000 et délai interne', relaxTime: 'releaseMs / 1000' }, gui: ['inserted', 'model', 'thresholdDb', 'slopeBelow', 'slopeAbove', 'attackMs', 'releaseMs', 'mul', 'add', 'bypass', 'controlLag'] }),
        Object.freeze({ id: 'FaustRMS', def: 'mx_output_faustRMS', ugen: 'MixetteFaustRMS', args: ['threshold', 'slopeBelow', 'slopeAbove', 'attack', 'release', 'mul', 'add'], mapping: { threshold: 'thresholdDb transmis en dB', attack: 'attackMs transmis en ms', release: 'releaseMs transmis en ms' }, gui: ['inserted', 'model', 'thresholdDb', 'slopeBelow', 'slopeAbove', 'attackMs', 'releaseMs', 'mul', 'add', 'bypass', 'controlLag'], availability: 'Nécessite le plug-in FaustRMS installé et chargé par SuperCollider.' }),
      ]),
    }),
    limiter: Object.freeze({
      slot: 'limiter',
      structural: ['bus'],
      availability: 'UGen standard SuperCollider ; SynthDef vérifié au démarrage.',
      position: 'Après compresseur',
      channels: 'Stéréo',
      label: 'Limiteur',
      models: Object.freeze([
        Object.freeze({ id: 'Limiter', def: 'mx_output_limiter', ugen: 'Limiter', args: ['level', 'dur'], mapping: { level: 'dbamp(ceilingDb)', dur: 'durMs / 1000, fixé à la création' }, gui: ['inserted', 'enabled', 'ceilingDb', 'durMs', 'controlLag'] }),
      ]),
    }),
  }),
});

export function synthDefEntry(slot, model) {
  const entry = SYNTHDEF_CATALOG.source[slot];
  return entry?.models.find((candidate) => candidate.id === model) ?? null;
}

export function synthDefModelIds(slot) {
  return SYNTHDEF_CATALOG.source[slot].models.map(({ id }) => id);
}

export function outputSynthDefEntry(slot, model) {
  const entry = SYNTHDEF_CATALOG.output[slot];
  return entry?.models.find((candidate) => candidate.id === model) ?? null;
}

export function outputSynthDefModelIds(slot) {
  return SYNTHDEF_CATALOG.output[slot].models.map(({ id }) => id);
}
