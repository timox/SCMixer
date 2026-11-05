import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACK_MS_MAX, CompBand, LIMITER_DUR_MAX_MS, defaultOutput, defaultSourceProcessing } from '../src/contract/schemas.js';
import { PITCH_WINDOW_MAX_SECONDS, DELAYN_MAX_SECONDS, SYNTHDEF_TIMEOUT_SECONDS } from '../src/runtime/server-options.js';

// Une seule source de vérité par borne : toute dérive entre sclang, JS et contrat fait échouer ces tests.
const here = path.dirname(fileURLToPath(import.meta.url));
const sc = (name) => fs.readFileSync(path.resolve(here, '..', 'sc', name), 'utf8').split(String.fromCharCode(13)).join('');
const scNumber = (file, variable) => {
  const m = new RegExp(`~${variable} = ([0-9.]+);`).exec(sc(file));
  assert.ok(m, `${variable} introuvable dans ${file}`);
  return Number(m[1]);
};

test("délai maximal de CompanderD : graph.scd = plage d'attaque du contrat = constante de dimensionnement", () => {
  assert.equal(DELAYN_MAX_SECONDS, ATTACK_MS_MAX / 1000);
  assert.equal(scNumber('graph.scd', 'mxCompanderDMaxDelay'), ATTACK_MS_MAX / 1000);
  const band = { ...defaultSourceProcessing().inputCompressor, attackMs: ATTACK_MS_MAX };
  assert.doesNotThrow(() => CompBand.parse(band));
  assert.throws(() => CompBand.parse({ ...band, attackMs: ATTACK_MS_MAX + 1 }));
});

test("fenêtre de PitchShift : source-defs.scd = borne du contrat = constante de dimensionnement (mémoire) ; défaut du contrat = maximum", () => {
  assert.equal(scNumber('source-defs.scd', 'mxPitchWindowMaxSeconds'), PITCH_WINDOW_MAX_SECONDS);
  assert.equal(defaultSourceProcessing().pitch.windowSize, PITCH_WINDOW_MAX_SECONDS);
  assert.match(sc('source-defs.scd'), /~mxCtl\.\(nil, \\windowSize, ~mxPitchWindowMaxSeconds\)\.min\(~mxPitchWindowMaxSeconds\)/);
});

test('dur du Limiter : graph.scd = borne du contrat (mémoire de dimensionnement)', () => {
  assert.equal(scNumber('graph.scd', 'mxLimiterDurMaxSeconds'), LIMITER_DUR_MAX_MS / 1000);
  assert.ok(defaultOutput().limiter.durMs <= LIMITER_DUR_MAX_MS);
  assert.match(sc('graph.scd'), /\.min\(~mxLimiterDurMaxSeconds\)/);
});

test("durée du fondu : le contrôle compressorFadeSeconds de l'écrivain a pour défaut ~mxFadeSeconds, égal au défaut du contrat", () => {
  assert.equal(scNumber('graph.scd', 'mxFadeSeconds'), defaultOutput().compressor.fadeSeconds);
  assert.match(sc('graph.scd'), /~mxCtl\.\(\\compressor, \\fadeSeconds, ~mxFadeSeconds\)/);
  assert.doesNotMatch(sc('graph.scd'), /fadeSeconds=0\./);
  assert.doesNotMatch(sc('graph.scd'), /mxFadeMarginSeconds/);
});

test("délai de vérification des SynthDefs : jeton unique, aucun défaut caché dans sclang", () => {
  assert.equal(SYNTHDEF_TIMEOUT_SECONDS, 5);
  assert.match(sc('engine.scd'), /~mxSynthDefTimeout = __MX_SYNTHDEF_TIMEOUT__;/);
  assert.doesNotMatch(sc('source-defs.scd'), /timeout=\d/);
});
