import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('graphe SuperCollider : sources par largeur, ordre des étages, retrait', { timeout: TIMEOUT_MS + 10000 }, async () => {
  const file = path.resolve(here, 'sc', 'source-defs.scd');
  const { output, timedOut } = await runSclang(file);
  const verdict = output.split(/\r?\n/).filter((line) => line.startsWith('MX-TEST-'));
  assert.equal(timedOut, false, `sclang n'a pas terminé en ${TIMEOUT_MS} ms\n${output.slice(-4000)}`);
  assert.ok(verdict.includes('MX-TEST-OK'), `verdict absent ou en échec : ${verdict.join(' | ')}\n${output.slice(-4000)}`);
});
