import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessRegistry, buildResolveScript, buildListScript, listProcessesWindows } from '../src/runtime/process-registry.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mx-reg-'));
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'runtime-processes.json'), 'utf8'));

test('add et remove persistent dans runtime-processes.json', () => {
  const dir = tmp();
  const reg = new ProcessRegistry({ dataDir: dir, listProcesses: async () => [] });
  reg.add({ role: 'scsynth', pid: 10, command: 'scsynth -u 57130' });
  const file = read(dir);
  assert.equal(file.length, 1);
  assert.equal(file[0].role, 'scsynth');
  assert.ok(file[0].startedAt);
  reg.remove(10);
  assert.deepEqual(read(dir), []);
});

test('foreignScsynth : inscrit avec la même commande = connu, sinon étranger', async () => {
  const dir = tmp();
  const procs = [
    { pid: 10, name: 'scsynth.exe', command: 'a' },
    { pid: 11, name: 'scsynth.exe', command: 'b' },
    { pid: 12, name: 'scsynth.exe', command: 'c' },
  ];
  const reg = new ProcessRegistry({ dataDir: dir, listProcesses: async () => procs });
  reg.add({ role: 'scsynth', pid: 10, command: 'a' });
  reg.add({ role: 'scsynth', pid: 11, command: 'autre' }); // PID réutilisé, identité différente
  const foreign = await reg.foreignScsynth();
  assert.deepEqual(foreign.map((p) => p.pid), [11, 12]);
});

test('un fichier illisible équivaut à un registre vide', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'runtime-processes.json'), '{pas du json');
  const reg = new ProcessRegistry({ dataDir: dir, listProcesses: async () => [{ pid: 1, name: 'scsynth.exe', command: 'x' }] });
  assert.equal((await reg.foreignScsynth()).length, 1);
});

test('le script PowerShell d identification contient la regex exacte du port', () => {
  const script = buildResolveScript({ launcherPid: 1, sclangPid: 2, serverPort: 57130, serverExecutable: 'C:\SC\scsynth.exe', device: 'ASIO : TimoxVasio' });
  assert.ok(script.includes(String.raw`(?:^|\s)-u\s+$serverPort(?:\s|$)`));
  assert.ok(script.includes('$serverPort = 57130'));
  assert.ok(script.includes("$audioDevice = 'ASIO : TimoxVasio'"));
});

test('inventaire : le script filtre sur l\'exécutable demandé, pas toujours scsynth.exe', () => {
  assert.match(buildListScript('TimoxVirtualAsioEngine.exe'), /Name='TimoxVirtualAsioEngine\.exe'/);
  assert.match(buildListScript('scsynth.exe'), /Name='scsynth\.exe'/);
  assert.doesNotMatch(buildListScript('TimoxVirtualAsioEngine.exe'), /scsynth/);
  for (const bad of ["x' OR Name='y.exe", 'a b.exe', 'scsynth', '', null]) {
    assert.throws(() => buildListScript(bad), /Nom d'exécutable invalide/);
  }
});

test('inventaire réel : un nom inconnu donne une liste vide, sans erreur', { skip: process.platform !== 'win32' }, async () => {
  assert.deepEqual(await listProcessesWindows('mx-inexistant-0b099f6.exe'), []);
});

test('inventaire réel : le processus node courant est trouvé par son nom', { skip: process.platform !== 'win32' }, async () => {
  const found = await listProcessesWindows('node.exe');
  assert.ok(found.some((p) => p.pid === process.pid && p.name.toLowerCase() === 'node.exe'));
});
