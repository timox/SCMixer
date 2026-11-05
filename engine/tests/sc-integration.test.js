import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeServerOptions, SYNTHDEF_TIMEOUT_SECONDS } from '../src/runtime/server-options.js';
import { OUTPUT_STAGES, defaultOutput, defaultSourceProcessing } from '../src/contract/schemas.js';
import { outputStageEventCode, processingEventCode } from '../src/sc/commands.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sclang = process.env.SCLANG_PATH || 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe';
const pluginsDir = path.resolve(here, '..', 'sc', 'plugins');
// Port UDP propre au sclang de test : jamais 57120 ni 57110.
const SCLANG_TEST_PORT = '57150';
const TIMEOUT_MS = 60000;

function runSclang(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-sclang-'));
  const conf = path.join(dir, 'sclang_conf.yaml');
  fs.writeFileSync(conf, `includePaths:\n  - '${pluginsDir}'\nexcludePaths: []\npostInlineWarnings: false\n`);
  return new Promise((resolve) => {
    const child = spawn(sclang, ['-u', SCLANG_TEST_PORT, '-l', conf, file], { windowsHide: true });
    let output = '';
    let timedOut = false;
    const collect = (chunk) => { output += String(chunk); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      // Arrête uniquement les processus lancés par ce test.
      const pid = /MX-TEST-SCSYNTH-PID (\d+)/.exec(output)?.[1];
      if (pid) {
        try { execFileSync('taskkill', ['/PID', pid, '/F']); } catch { /* déjà arrêté */ }
      }
      child.kill();
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, output, timedOut });
    });
  });
}

/**
 * Script d'amorce : ~mxFixture porte le traitement par défaut et les étages de sortie par défaut du contrat
 * (noms de contrôles produits par src/sc/commands.js), puis charge le test sclang.
 */
function fixtureScript(testFile) {
  const outputs = OUTPUT_STAGES.map((stage) => `${stage}: ${outputStageEventCode(stage, defaultOutput()[stage])}`).join(', ');
  const forward = testFile.split(path.sep).join('/');
  return `~mxFixture = (proc: ${processingEventCode(defaultSourceProcessing())}, outputs: (${outputs}));\n"${forward}".load;\n`;
}

async function runWithFixture(testFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-fixture-'));
  const file = path.join(dir, 'fixture.scd');
  fs.writeFileSync(file, fixtureScript(testFile), 'utf8');
  try { return await runSclang(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('graphe SuperCollider : sources par largeur, ordre des étages, retrait', { timeout: TIMEOUT_MS + 10000 }, async () => {
  const { output, timedOut } = await runWithFixture(path.resolve(here, 'sc', 'source-defs.scd'));
  const verdict = output.split(/\r?\n/).filter((line) => line.startsWith('MX-TEST-'));
  assert.equal(timedOut, false, `sclang n'a pas terminé en ${TIMEOUT_MS} ms\n${output.slice(-4000)}`);
  assert.ok(verdict.includes('MX-TEST-OK'), `verdict absent ou en échec : ${verdict.join(' | ')}\n${output.slice(-4000)}`);
});

test('modèles : FaustRMS indisponible si scsynth ne charge pas le plug-in ; échec /d_recv signalé', { timeout: TIMEOUT_MS + 10000 }, async () => {
  const { output, timedOut } = await runSclang(path.resolve(here, 'sc', 'models.scd'));
  const verdict = output.split(/\r?\n/).filter((line) => line.startsWith('MX-TEST-'));
  assert.equal(timedOut, false, `sclang n'a pas terminé en ${TIMEOUT_MS} ms\n${output.slice(-4000)}`);
  assert.ok(verdict.includes('MX-TEST-OK'), `verdict absent ou en échec : ${verdict.join(' | ')}\n${output.slice(-4000)}`);
});

/**
 * Copie d'engine.scd avec tous les jetons substitués, pour un serveur de test.
 * Port UDP 57130 -> 57143, sortie MME sans entrée matérielle (numInputBusChannels = 0 : l'ouverture
 * d'une entrée MME échoue sur ce poste). Jamais TimoxVasio, jamais les ports 57110/57120/57130.
 */
function testEngineSource(options) {
  // Copie d'engine.scd sur un serveur de test : port UDP 57130 -> 57143, sortie MME sans entrée matérielle
  // (numInputBusChannels = 0 : l'ouverture d'une entrée MME échoue sur ce poste). Les autres jetons du
  // dimensionnement sont ceux de computeServerOptions.
  const tokens = {
    __MX_SC_DIR__: path.resolve(here, '..', 'sc').replaceAll('\\', '/'),
    __MX_DEVICE__: 'MME : Mappeur de sons Microsoft - Output',
    __MX_SAMPLE_RATE__: '48000',
    __MX_BUFFER__: '1024',
    __MX_RELAY_PORT__: '45999',
    __MX_NUM_INPUTS__: '0',
    __MX_NUM_OUTPUTS__: String(options.numOutputBusChannels),
    __MX_NUM_AUDIO_BUSES__: String(options.numAudioBusChannels),
    __MX_WIRE_BUFS__: String(options.numWireBufs),
    __MX_MAX_NODES__: String(options.maxNodes),
    __MX_MEM_SIZE_KB__: String(options.memSize),
    __MX_BLOCK_SIZE__: String(options.blockSize),
    __MX_SYNTHDEF_TIMEOUT__: String(SYNTHDEF_TIMEOUT_SECONDS),
  };
  let source = fs.readFileSync(path.resolve(here, '..', 'sc', 'engine.scd'), 'utf8');
  for (const [token, value] of Object.entries(tokens)) {
    assert.ok(source.includes(token), `jeton ${token} absent d'engine.scd`);
    source = source.replaceAll(token, value);
  }
  assert.doesNotMatch(source, /__MX_/);
  assert.ok(source.includes('NetAddr("127.0.0.1", 57130)'));
  return source.replace('NetAddr("127.0.0.1", 57130)', 'NetAddr("127.0.0.1", 57143)');
}

async function runEngineSource(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-engine-scd-'));
  const file = path.join(dir, 'engine-test.scd');
  fs.writeFileSync(file, source, 'utf8');
  try { return await runSclang(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('engine.scd : Bus.audio alloué avant le boot est refusé avant tout démarrage de scsynth', { timeout: TIMEOUT_MS + 10000 }, async () => {
  let source = testEngineSource(computeServerOptions({ sampleRate: 48000 }));
  assert.ok(source.includes('// Garde : aucune allocation'));
  source = source.replace('// Garde : aucune allocation', 'Bus.audio(s, 2);\n// Garde : aucune allocation');
  source = source.replace('var options;', 'var options;\nSystemClock.sched(6, { 0.exit; nil });');
  const { output } = await runEngineSource(source);
  assert.match(output, /Bus\.audio alloué avant le boot du serveur/, output.slice(-3000));
  assert.doesNotMatch(output, /MX-ENGINE-READY/);
  assert.doesNotMatch(output, /Booting with/);
});

test('engine.scd : les jetons de dimensionnement sont appliqués au serveur (serveur de test, jamais TimoxVasio)', { timeout: TIMEOUT_MS + 10000 }, async () => {
  const options = computeServerOptions({ sampleRate: 48000 });
  let source = testEngineSource(options);
  source += `
// Épilogue de test : attend la fin du démarrage, relit les options passées à scsynth, vérifie les bus.
fork {
  var tries = 0;
  ("MX-TEST-SCSYNTH-PID " ++ s.pid).postln;
  while { ~mxBootState == 0 and: { tries < 400 } } { 0.1.wait; tries = tries + 1 };
  ("MX-TEST-BOOTSTATE " ++ ~mxBootState).postln;
  ("MX-TEST-CMDLINE " ++ s.options.asOptionsString(57143)).postln;
  ("MX-TEST-MASTER " ++ ~mxMasterBus.index ++ " FIRST " ++ s.options.firstPrivateBus).postln;
  ("MX-TEST-FAUST " ++ ~mxModels[\\FaustRMS]).postln;
  s.quit;
  1.wait;
  0.exit;
};
`;
  const { output, timedOut } = await runEngineSource(source);
  assert.equal(timedOut, false, `sclang n'a pas terminé en ${TIMEOUT_MS} ms\n${output.slice(-4000)}`);
  assert.match(output, /MX-TEST-BOOTSTATE 1/, output.slice(-4000));
  assert.match(output, /MX-ENGINE-READY/);
  // Journal des options relues depuis ServerOptions.
  const logged = /MX-ENGINE-OPTIONS (.*)/.exec(output)?.[1] ?? '';
  for (const [key, value] of Object.entries({
    numInputBusChannels: 0, numOutputBusChannels: 4, numAudioBusChannels: options.numAudioBusChannels, firstPrivateBus: 4,
    numWireBufs: options.numWireBufs, maxNodes: options.maxNodes, memSize: options.memSize, blockSize: 64,
  })) assert.match(logged, new RegExp(`${key}=${value}(\\s|$)`), `${key} : ${logged}`);
  // Ligne de commande effectivement passée à scsynth (-a bus audio, -w interconnexions, -n nœuds, -m mémoire, -Z tampon matériel ; -z absent = bloc de 64 par défaut).
  const cmd = /MX-TEST-CMDLINE (.*)/.exec(output)?.[1] ?? '';
  for (const flag of [`-a ${options.numAudioBusChannels}`, `-w ${options.numWireBufs}`, `-n ${options.maxNodes}`, `-m ${options.memSize}`, '-Z 1024', '-o 4']) {
    assert.ok(cmd.includes(`${flag} `) || cmd.endsWith(flag), `${flag} absent de : ${cmd}`);
  }
  assert.match(output, /MX-TEST-MASTER 4 FIRST 4/);
});
