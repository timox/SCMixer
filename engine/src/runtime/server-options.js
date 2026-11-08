import { ApiError } from '../contract/errors.js';
import { ATTACK_MS_MAX, LIMITER_DUR_MAX_MS, MAX_CHANNELS, PITCH_WINDOW_MAX_SECONDS } from '../contract/schemas.js';

/**
 * Dimensionnement de scsynth, calculé à partir des besoins mesurés du moteur (jamais de valeur
 * arbitraire). Ces options sont figées au boot : numWireBufs « cannot be increased thereafter
 * without rebooting » (HelpSource/Classes/ServerOptions.schelp). Une mutation qui dépasserait le
 * dimensionnement est donc refusée (assertSessionFitsSizing, ENGINE_RESTART_REQUIRED).
 *
 * Besoins (audit d'architecture ; interconnexions mesurées par sclang sans serveur :
 * tests/sc/wirebufs.scd) :
 *  - bus audio : sorties matérielles 0..7, entrées 8..263, premier bus privé 264 ; bus privés =
 *    somme Master/Cue 4 + un bus de traitement stéréo par sortie 4 = 8, plus les largeurs des
 *    sources. La somme des sources est au plus numInputBusChannels (256) : 264 + 8 + 256 = 528.
 *  - interconnexions (numWireBufs) : maximum de sorties audio vivantes d'un SynthDef. Mesuré :
 *    mx_dyn_w = 5 w + 3 (w = 2 : 13, 3 : 18, 8 : 43, 64 : 323, 256 : 1283) ; hp/lp 4 w + 1,
 *    pitch/eq/hp4/lp4/lpmoog 2 w + 1, in/mix environ w + 26 ; SynthDefs de sortie : 5 ou 6.
 *  - nœuds : 1 groupe + 7 Synths par source = 8 ; moteur : root, groupe par défaut, 3 groupes,
 *    2 bases, 2 compresseurs, 2 limiteurs, 2 écrivains et 1 sonde = 14.
 *  - mémoire temps réel : tampons de lignes à retard des UGens (PitchShift, DelayN, Limiter) et
 *    structures des Synths, mesurés par saturation de memSize sur un scsynth de test.
 */

/** Bornes du contrat : 256 canaux d'entrée, donc au plus 256 sources (largeur 1). */
export const DEFAULT_SIZING = Object.freeze({ maxSourceWidth: MAX_CHANNELS, maxSources: MAX_CHANNELS });

const NUM_INPUTS = MAX_CHANNELS;
const NUM_OUTPUTS = 8;
const BLOCK_SIZE = 64; // défaut de ServerOptions.blockSize, non modifié : 64 images par bloc de contrôle
const FIRST_PRIVATE_BUS = NUM_INPUTS + NUM_OUTPUTS;
const ENGINE_PRIVATE_BUSES = 8;
// Hors sources : root/default/groups (5), base + compresseur + limiteur + writer pour Master/Cue (8), sonde (1).
const ENGINE_NODES = 14;
const NODES_PER_SOURCE = 8;

/** Plancher : défauts de ServerOptions (maxNodes 1024, numWireBufs 64). */
const MIN_MAX_NODES = 1024;
const MIN_WIRE_BUFS = 64;
const OUTPUT_WIRE_BUFS = 6; // SynthDefs de sortie (mesure : 5, écrivain 6)

/** Marges explicites. Les échecs de mémoire ou de tampons sont silencieux côté scsynth. */
export const WIRE_MARGIN = 1.25; // numWireBufs ne peut pas croître : 25 % pour un SynthDef plus complexe ajouté plus tard
export const NODES_MARGIN = 1.5; // bancs de mesure et nœuds temporaires de diagnostic
export const MEMORY_MARGIN = 1.5; // fragmentation de l'allocateur temps réel et UGens futurs
const MEMORY_STEP_KB = 8192; // arrondi de memSize au multiple de 8 Mo (défaut ServerOptions : 8192 Ko)

// Mémoire temps réel mesurée (octets) à 48 kHz sur scsynth 3.14.1 par saturation de memSize.
// Les mesures ci-dessous précèdent l'exposition complète des paramètres (task 8b-2), qui ajoute des UGens (lissages,
// mul/add, contrôles) à chaque SynthDef. Les valeurs sont mises à l'échelle du nombre de UGens construits par sclang
// (tests/sc/wirebufs.scd, def.children.size) : chaîne de largeur 256 (pire modèles) 14 374 -> 16 613 UGens (x1,16) ;
// chaîne de largeur 1 : 191 -> 362 UGens (x1,9).
const SYNTH_BYTES_PER_CHANNEL = 19 * 1024; // 7 Synths d'une source de largeur 256 : mesuré 15,4 Ko par canal avant 8b-2, x1,16 arrondi à 19 Ko
const SYNTH_BYTES_PER_SOURCE = 64 * 1024; // 8 Synths de petite largeur : moins de 4 Ko chacun avant 8b-2, x1,9 arrondi à 8 Ko chacun
/** windowSize maximal de PitchShift (s) : borne du contrat (schemas.js), égale à ~mxPitchWindowMaxSeconds de source-defs.scd (test d'égalité). */
export { PITCH_WINDOW_MAX_SECONDS };
const PITCH_OVERHEAD = 1.15; // ajustement mesuré : 48 kHz 136..139 Ko, 96 kHz 273..282 Ko, 192 kHz 546..585 Ko par canal
/** maxdelaytime de CompanderD (s) : maximum de la plage d'attaque du contrat. Valeur de ~mxCompanderDMaxDelay dans graph.scd (test d'égalité). */
export const DELAYN_MAX_SECONDS = ATTACK_MS_MAX / 1000;
/** Délai (s) d'attente de la réponse de scsynth pour la vérification du chargement d'un SynthDef (jeton __MX_SYNTHDEF_TIMEOUT__). */
export const SYNTHDEF_TIMEOUT_SECONDS = 5;
const DELAYN_OVERHEAD = 1.28; // mesuré : 82 Ko pour 2 x 32 Ko de tampon
const LIMITER_BYTES_PER_48K = 24 * 1024; // mesuré : 19,3 Ko pour deux canaux, dur = 0,01 s
const LIMITER_MEASURED_DUR_MS = 10; // le tampon est proportionnel à dur (Limiter.schelp : tampon de retard de dur secondes)
const OUTPUT_SYNTH_BYTES = 64 * 1024; // estimation par Synth de sortie (base ou insert)
const FIXED_BYTES = 1024 * 1024;

const pow2ceil = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function assertInt(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} doit être un entier entre ${min} et ${max} (reçu : ${value})`);
  }
}

/** Interconnexions audio vivantes au plus pour un SynthDef de source de largeur `width` (mesure sclang). */
export function wireBufsNeeded(width) {
  return Math.max(5 * width + 3, OUTPUT_WIRE_BUFS);
}

function pitchBytesPerChannel(sampleRate) {
  // PitchShift alloue un tampon de nextPowerOfTwo(2 x windowSize x sampleRate) flottants (mesuré).
  const floats = pow2ceil(Math.ceil(2 * PITCH_WINDOW_MAX_SECONDS * sampleRate));
  return Math.ceil(floats * 4 * PITCH_OVERHEAD);
}

function outputBytes(sampleRate) {
  const delay = Math.ceil(2 * pow2ceil(Math.ceil(DELAYN_MAX_SECONDS * sampleRate)) * 4 * DELAYN_OVERHEAD);
  // dur du contrat jusqu'à LIMITER_DUR_MAX_MS : dimensionné pour le maximum (le tampon est fixé à la création du Synth).
  const limiter = LIMITER_BYTES_PER_48K * Math.ceil(sampleRate / 48000) * Math.ceil(LIMITER_DUR_MAX_MS / LIMITER_MEASURED_DUR_MS);
  // Deux sorties ; chacune peut porter un CompanderD, un Limiter et le Synth de base.
  return 2 * (delay + limiter + 3 * OUTPUT_SYNTH_BYTES);
}

/** Besoins bruts (sans marge) pour un dimensionnement donné. */
export function serverNeeds({ maxSourceWidth = DEFAULT_SIZING.maxSourceWidth, maxSources = DEFAULT_SIZING.maxSources, sampleRate = 48000 } = {}) {
  const channels = Math.min(maxSources * maxSourceWidth, NUM_INPUTS);
  const sources = Math.min(maxSources, channels);
  const audioBuses = FIRST_PRIVATE_BUS + ENGINE_PRIVATE_BUSES + channels;
  const wireBufs = wireBufsNeeded(maxSourceWidth);
  const nodes = NODES_PER_SOURCE * sources + ENGINE_NODES;
  const wireBufBytes = pow2ceil(wireBufs * WIRE_MARGIN) * BLOCK_SIZE * 4;
  // ~mxSynthDefLoaded instancie brièvement chaque def de la largeur construite (la plus lourde : pitch, avec ses
  // tampons) pendant que les sources existantes vivent : un pic transitoire d'une def de largeur maximale.
  const probeBytes = maxSourceWidth * (pitchBytesPerChannel(sampleRate) + SYNTH_BYTES_PER_CHANNEL);
  const memoryBytes = probeBytes + channels * (pitchBytesPerChannel(sampleRate) + SYNTH_BYTES_PER_CHANNEL)
    + sources * SYNTH_BYTES_PER_SOURCE + outputBytes(sampleRate) + wireBufBytes + FIXED_BYTES;
  return { firstPrivateBus: FIRST_PRIVATE_BUS, channels, sources, audioBuses, wireBufs, nodes, memoryBytes };
}

/**
 * Options de ServerOptions à fixer avant le boot.
 * @param {{ maxSourceWidth?: number, maxSources?: number, sampleRate?: number }} sizing
 *   largeur maximale d'une source, nombre maximal de sources, fréquence d'échantillonnage du boot.
 */
export function computeServerOptions({ maxSourceWidth = DEFAULT_SIZING.maxSourceWidth, maxSources = DEFAULT_SIZING.maxSources, sampleRate = 48000 } = {}) {
  assertInt('maxSourceWidth', maxSourceWidth, 1, MAX_CHANNELS);
  assertInt('maxSources', maxSources, 1, MAX_CHANNELS);
  assertInt('sampleRate', sampleRate, 8000, 384000);
  const needs = serverNeeds({ maxSourceWidth, maxSources, sampleRate });
  return {
    numInputBusChannels: NUM_INPUTS,
    numOutputBusChannels: NUM_OUTPUTS,
    // Puissance de deux suivante (528 -> 1024) : marge de 94 % pour des bus de bancs ou d'évolutions.
    numAudioBusChannels: pow2ceil(needs.audioBuses),
    numWireBufs: Math.max(MIN_WIRE_BUFS, pow2ceil(Math.ceil(needs.wireBufs * WIRE_MARGIN))),
    maxNodes: Math.max(MIN_MAX_NODES, pow2ceil(Math.ceil(needs.nodes * NODES_MARGIN))),
    memSize: Math.ceil((needs.memoryBytes * MEMORY_MARGIN) / 1024 / MEMORY_STEP_KB) * MEMORY_STEP_KB,
    blockSize: BLOCK_SIZE,
  };
}

/**
 * Refuse une session qui dépasserait le dimensionnement du boot. Les options de scsynth ne
 * pouvant plus croître, le moteur doit être redémarré avec un dimensionnement plus grand.
 * @throws {ApiError} ENGINE_RESTART_REQUIRED (409)
 */
export function assertSessionFitsSizing(session, { maxSourceWidth, maxSources }) {
  const restart = (message) => new ApiError('ENGINE_RESTART_REQUIRED', 409,
    `${message} Redémarrer le moteur avec un dimensionnement plus grand ; état inchangé.`);
  if (session.sources.length > maxSources) {
    throw restart(`Le moteur a été dimensionné pour ${maxSources} sources au plus ; la session en compterait ${session.sources.length}.`);
  }
  const wide = session.sources.find((s) => s.width > maxSourceWidth);
  if (wide) {
    throw restart(`Le moteur a été dimensionné pour une largeur de source de ${maxSourceWidth} canaux au plus ; la source ${wide.id ?? wide.name} en demande ${wide.width}.`);
  }
}
