import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeServerOptions, wireBufsNeeded, serverNeeds, assertSessionFitsSizing, DEFAULT_SIZING,
} from '../src/runtime/server-options.js';
import { emptySession, addSource } from '../src/session/session-model.js';

test('dimensionnement par défaut (256 sources, largeur 256, 48 kHz) : valeurs épinglées', () => {
  assert.deepEqual(computeServerOptions({}), {
    numInputBusChannels: 256,
    numOutputBusChannels: 4,
    numAudioBusChannels: 1024, // besoin 528 (260 + 12 + 256), puissance de deux suivante
    numWireBufs: 2048, // besoin mesuré 1283 (mx_dyn_256), marge 25 % = 1604, puissance de deux suivante
    maxNodes: 4096, // besoin 8 x 256 + 12 = 2060, marge 50 % = 3090, puissance de deux suivante
    memSize: 81920, // Ko : 53 439 420 octets de besoin x 1,5, arrondi au multiple de 8192 Ko
    blockSize: 64,
  });
});

test('les besoins sont ceux de l\'audit : bus 528, interconnexions 1283, nœuds 2060', () => {
  const needs = serverNeeds({ maxSourceWidth: 256, maxSources: 256 });
  assert.equal(needs.audioBuses, 528);
  assert.equal(needs.wireBufs, 1283);
  assert.equal(needs.nodes, 2060);
  assert.equal(needs.firstPrivateBus, 260);
});

test('wireBufsNeeded : borne mesurée par sclang (5 w + 3, au moins 6 pour les SynthDefs de sortie)', () => {
  assert.equal(wireBufsNeeded(256), 1283);
  assert.equal(wireBufsNeeded(64), 323);
  assert.equal(wireBufsNeeded(8), 43);
  assert.equal(wireBufsNeeded(1), 8);
});

test('dimensionnement minimal : les plafonds de SuperCollider servent de plancher pour les nœuds et les tampons', () => {
  const o = computeServerOptions({ maxSourceWidth: 1, maxSources: 1 });
  assert.equal(o.numAudioBusChannels, 512); // 260 + 12 + 1 = 273
  assert.equal(o.numWireBufs, 64); // plancher = défaut ServerOptions
  assert.equal(o.maxNodes, 1024); // plancher = défaut ServerOptions
  assert.ok(o.memSize >= 8192);
});

test('la mémoire temps réel croît avec la fréquence d\'échantillonnage (tampons de PitchShift et de DelayN)', () => {
  const at = (sampleRate) => computeServerOptions({ sampleRate }).memSize;
  assert.ok(at(96000) > at(48000));
  assert.ok(at(192000) > at(96000));
  assert.equal(at(44100), at(48000)); // même puissance de deux de tampon, même arrondi
});

test('mêmes paramètres, mêmes valeurs ; entrées invalides refusées', () => {
  assert.deepEqual(computeServerOptions({ maxSourceWidth: 64, maxSources: 32 }), computeServerOptions({ maxSourceWidth: 64, maxSources: 32 }));
  for (const bad of [{ maxSourceWidth: 0 }, { maxSourceWidth: 257 }, { maxSources: 0 }, { maxSources: 257 }, { maxSources: 1.5 }, { sampleRate: 100 }]) {
    assert.throws(() => computeServerOptions(bad), RangeError, JSON.stringify(bad));
  }
});

test('DEFAULT_SIZING reprend les bornes du contrat (256 canaux, 256 sources)', () => {
  assert.deepEqual(DEFAULT_SIZING, { maxSourceWidth: 256, maxSources: 256 });
});

test('garde : une session au-delà du dimensionnement est refusée par ENGINE_RESTART_REQUIRED (409)', () => {
  let session = emptySession();
  session = addSource(session, { name: 'A', firstChannel: 1, width: 2 }).session;
  session = addSource(session, { name: 'B', firstChannel: 3, width: 4 }).session;
  assertSessionFitsSizing(session, { maxSourceWidth: 4, maxSources: 2 });
  assert.throws(() => assertSessionFitsSizing(session, { maxSourceWidth: 3, maxSources: 2 }),
    (e) => e.code === 'ENGINE_RESTART_REQUIRED' && e.status === 409 && /largeur/i.test(e.message) && /redémarr/i.test(e.message));
  assert.throws(() => assertSessionFitsSizing(session, { maxSourceWidth: 4, maxSources: 1 }),
    (e) => e.code === 'ENGINE_RESTART_REQUIRED' && e.status === 409 && /sources/i.test(e.message));
});

// --- Mesure par sclang (sans serveur) : le dimensionnement doit majorer chaque SynthDef mesuré. ---
const here = path.dirname(fileURLToPath(import.meta.url));
const sclang = process.env.SCLANG_PATH || 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe';
// Port UDP propre à ce sclang : ni 57120 ni 57150 (autre test d'intégration).
const WIRE_TEST_PORT = '57151';

test('numWireBufs majore le maximum mesuré de chaque SynthDef (sclang sans serveur)', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-wire-'));
  const conf = path.join(dir, 'sclang_conf.yaml');
  fs.writeFileSync(conf, `includePaths:\n  - '${path.resolve(here, '..', 'sc', 'plugins')}'\nexcludePaths: []\npostInlineWarnings: false\n`);
  const result = await new Promise((resolve) => {
    const child = spawn(sclang, ['-u', WIRE_TEST_PORT, '-l', conf, path.resolve(here, 'sc', 'wirebufs.scd')], { windowsHide: true });
    let output = '';
    const collect = (c) => { output += String(c); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), 100000);
    child.on('close', () => { clearTimeout(timer); resolve(output); });
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(result, /MX-TEST-OK/, result.slice(-2000));
  const rows = [...result.matchAll(/^MX-WIRE (\d+) (\S+) (\d+)/gm)].map((m) => ({ width: Number(m[1]), name: m[2], max: Number(m[3]) }));
  assert.ok(rows.some((r) => r.width === 256 && r.name === 'mx_dyn_256' && r.max === 1283), 'mx_dyn_256 doit mesurer 1283');
  for (const row of rows) {
    const bound = row.width === 0 ? 6 : wireBufsNeeded(row.width);
    assert.ok(row.max <= bound, `${row.name} : mesure ${row.max} > borne ${bound}`);
  }
  const widest = Math.max(...rows.filter((r) => r.width > 0).map((r) => r.max));
  assert.ok(computeServerOptions({}).numWireBufs >= widest * 1.25);
});
