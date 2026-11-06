import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../tools/engine-launcher.mjs';
import { ProcessRegistry } from '../src/runtime/process-registry.js';

const SERVICE_CMD = '"C:\\node\\node.exe" src/main.js';

/** Faux système : processus node.exe vivants, lancement, arrêt et API simulés. Aucun vrai processus. */
function fakeSystem({ processes = [], apiUp = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-launcher-'));
  const sys = {
    dataDir,
    processes: [...processes],
    spawned: [],
    killed: [],
    requests: [],
    lines: [],
  };
  sys.deps = {
    env: { SCMIXER_ENGINE_DATA_DIR: dataDir, SCMIXER_ENGINE_PORT: '3999' },
    log: (line) => sys.lines.push(line),
    listProcesses: async () => sys.processes.map((p) => ({ ...p })),
    spawn: (cmd, args, options) => {
      const pid = 5000 + sys.spawned.length;
      sys.spawned.push({ cmd, args, options });
      sys.processes.push({ pid, name: 'node.exe', command: SERVICE_CMD });
      return { pid, unref() {} };
    },
    fetch: async (url, options = {}) => {
      sys.requests.push({ url, method: options.method ?? 'GET' });
      if (!apiUp) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ status: 'stopped' }) };
    },
    kill: (pid) => {
      sys.killed.push(pid);
      sys.processes = sys.processes.filter((p) => p.pid !== pid);
    },
    sleep: () => new Promise((resolve) => { setImmediate(resolve); }),
  };
  sys.registry = new ProcessRegistry({ dataDir, listProcesses: sys.deps.listProcesses });
  return sys;
}

test('start sans entrée : lance node src/main.js, inscrit le service, garde les autres rôles', async () => {
  const sys = fakeSystem();
  sys.registry.add({ role: 'scsynth', pid: 42, command: 'scsynth.exe -u 57130' });
  assert.equal(await run(['start', '--sc-dir', 'C:\\SC'], sys.deps), 0);
  assert.equal(sys.spawned.length, 1);
  assert.equal(sys.spawned[0].cmd, process.execPath);
  assert.deepEqual(sys.spawned[0].args, ['src/main.js', '--sc-dir', 'C:\\SC']);
  assert.ok(sys.spawned[0].options.cwd.endsWith('engine'));
  const entries = sys.registry.entries();
  assert.deepEqual(entries.find((e) => e.role === 'scsynth'), { ...entries.find((e) => e.role === 'scsynth'), pid: 42 });
  const service = entries.find((e) => e.role === 'service');
  assert.equal(service.pid, 5000);
  assert.equal(service.command, SERVICE_CMD);
  assert.ok(sys.requests.some((r) => r.url === 'http://127.0.0.1:3999/api/engine'));
});

test('start avec un service vivant de même commande : aucun lancement', async () => {
  const sys = fakeSystem({ processes: [{ pid: 77, name: 'node.exe', command: SERVICE_CMD }] });
  sys.registry.add({ role: 'service', pid: 77, command: SERVICE_CMD });
  assert.equal(await run(['start'], sys.deps), 0);
  assert.equal(sys.spawned.length, 0);
  assert.match(sys.lines.join('\n'), /déjà démarré \(PID 77\)/);
});

test('start : API muette et processus disparu → code 1, entrée retirée', async () => {
  const sys = fakeSystem({ apiUp: false });
  sys.deps.spawn = (cmd, args, options) => {
    sys.spawned.push({ cmd, args, options });
    sys.processes.push({ pid: 6000, name: 'node.exe', command: SERVICE_CMD });
    // Le service s'arrête aussitôt (port occupé, par exemple) après avoir été relevé une fois.
    setImmediate(() => { sys.processes = []; });
    return { pid: 6000, unref() {} };
  };
  assert.equal(await run(['start'], sys.deps), 1);
  assert.equal(sys.registry.entries().some((e) => e.role === 'service'), false);
});

test('stop : entrée vivante et de même commande → arrêt du moteur puis du PID, entrée retirée', async () => {
  const sys = fakeSystem({ processes: [{ pid: 77, name: 'node.exe', command: SERVICE_CMD }] });
  sys.registry.add({ role: 'service', pid: 77, command: SERVICE_CMD });
  sys.registry.add({ role: 'scsynth', pid: 42, command: 'scsynth.exe' });
  assert.equal(await run(['stop'], sys.deps), 0);
  assert.deepEqual(sys.requests.map((r) => `${r.method} ${r.url}`), ['POST http://127.0.0.1:3999/api/engine/stop']);
  assert.deepEqual(sys.killed, [77]);
  assert.deepEqual(sys.registry.entries().map((e) => e.role), ['scsynth']);
});

test('stop : PID vivant avec une autre commande → aucun arrêt, entrée retirée, message', async () => {
  const sys = fakeSystem({ processes: [{ pid: 77, name: 'node.exe', command: 'node autre-programme.js' }] });
  sys.registry.add({ role: 'service', pid: 77, command: SERVICE_CMD });
  assert.equal(await run(['stop'], sys.deps), 0);
  assert.deepEqual(sys.killed, []);
  assert.deepEqual(sys.requests, []);
  assert.equal(sys.registry.entries().length, 0);
  assert.match(sys.lines.join('\n'), /PID 77 réattribué à un autre programme ; non arrêté/);
});

test('stop sans entrée : aucun arrêt', async () => {
  const sys = fakeSystem({ processes: [{ pid: 77, name: 'node.exe', command: SERVICE_CMD }] });
  assert.equal(await run(['stop'], sys.deps), 0);
  assert.deepEqual(sys.killed, []);
  assert.match(sys.lines.join('\n'), /Aucun service inscrit/);
});

test('status, puis argument inconnu → code 2', async () => {
  const sys = fakeSystem({ processes: [{ pid: 77, name: 'node.exe', command: SERVICE_CMD }] });
  sys.registry.add({ role: 'service', pid: 77, command: SERVICE_CMD });
  assert.equal(await run(['status'], sys.deps), 0);
  assert.match(sys.lines.join('\n'), /PID 77 : actif/);
  assert.match(sys.lines.join('\n'), /moteur « stopped »/);
  assert.equal(await run(['restart'], sys.deps), 2);
  assert.equal(await run([], sys.deps), 2);
  assert.equal(sys.spawned.length, 0);
});
