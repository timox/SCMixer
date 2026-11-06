/**
 * Lanceur du service moteur : start | stop | status (engine.cmd).
 *
 * Le service (`node src/main.js`) est inscrit dans le registre des processus du moteur
 * (runtime-processes.json, rôle « service ») avec son PID et sa ligne de commande relevés dans
 * l'inventaire système. Un processus n'est jamais arrêté si son PID et sa ligne de commande ne
 * correspondent pas tous deux à une entrée du registre (AGENTS.md). Les entrées des autres rôles
 * (scsynth, hôte TimoxVasio) appartiennent au moteur et ne sont jamais modifiées ici.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProcessRegistry, listProcessesWindows } from '../src/runtime/process-registry.js';
import { DEFAULT_PORT, defaultDataDir } from '../src/main.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLE = 'service';
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 30_000;
const LOG_TAIL_LINES = 20;

const USAGE = 'Usage : engine.cmd start [--sc-dir <dossier>] | stop | status';

function defaultDeps(env) {
  return {
    env,
    log: (line) => console.log(line),
    listProcesses: () => listProcessesWindows('node.exe'),
    spawn: nodeSpawn,
    fetch: globalThis.fetch,
    kill: (pid) => process.kill(pid),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  };
}

function context(deps) {
  const dataDir = defaultDataDir(deps.env);
  const port = Number(deps.env.SCMIXER_ENGINE_PORT ?? DEFAULT_PORT);
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    logFile: path.join(dataDir, 'service.log'),
    registry: new ProcessRegistry({ dataDir, listProcesses: deps.listProcesses }),
  };
}

/** Entrées « service » avec l'état du processus : running (même PID et même commande), reassigned, gone. */
async function classify(ctx, deps) {
  const processes = await deps.listProcesses();
  return ctx.registry.entries().filter((e) => e.role === ROLE).map((entry) => {
    const proc = processes.find((p) => p.pid === entry.pid);
    let state = 'gone';
    if (proc) state = proc.command === entry.command ? 'running' : 'reassigned';
    return { entry, state };
  });
}

async function engineStatus(ctx, deps, timeoutMs = 2000) {
  try {
    const res = await deps.fetch(`${ctx.base}/api/engine`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()).status ?? null;
  } catch {
    return null;
  }
}

function logTail(file) {
  if (!fs.existsSync(file)) return '(journal absent)';
  return fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n');
}

export async function start(args, deps) {
  const ctx = context(deps);
  const entries = await classify(ctx, deps);
  const alive = entries.find((e) => e.state === 'running');
  if (alive) {
    deps.log(`Le service est déjà démarré (PID ${alive.entry.pid}).`);
    return 0;
  }
  for (const { entry, state } of entries) {
    ctx.registry.remove(entry.pid);
    if (state === 'reassigned') deps.log(`PID ${entry.pid} réattribué à un autre programme ; non arrêté, retiré du registre.`);
  }

  const out = fs.openSync(ctx.logFile, 'a');
  let child;
  try {
    child = deps.spawn(process.execPath, ['src/main.js', ...args], {
      cwd: ENGINE_DIR, detached: true, windowsHide: true, stdio: ['ignore', out, out],
    });
  } finally {
    fs.closeSync(out);
  }
  child.unref?.();
  const { pid } = child;
  if (!Number.isInteger(pid)) {
    deps.log(`Lancement du service impossible.\n${logTail(ctx.logFile)}`);
    return 1;
  }

  // Ligne de commande relevée dans l'inventaire système : c'est elle qui identifie le processus à l'arrêt.
  let proc;
  for (let waited = 0; !proc && waited <= START_TIMEOUT_MS; waited += 200) {
    proc = (await deps.listProcesses()).find((p) => p.pid === pid);
    if (!proc) await deps.sleep(200);
  }
  if (!proc) {
    deps.log(`Le service (PID ${pid}) s'est arrêté au démarrage.\n${logTail(ctx.logFile)}`);
    return 1;
  }
  ctx.registry.add({ role: ROLE, pid, command: proc.command });

  for (let waited = 0; waited <= START_TIMEOUT_MS; waited += 250) {
    if (await engineStatus(ctx, deps)) {
      deps.log(`Service démarré (PID ${pid}) : ${ctx.base}. Journal : ${ctx.logFile}.`);
      return 0;
    }
    if (!(await deps.listProcesses()).some((p) => p.pid === pid)) break;
    await deps.sleep(250);
  }
  const stillThere = (await deps.listProcesses()).find((p) => p.pid === pid && p.command === proc.command);
  if (!stillThere) ctx.registry.remove(pid);
  deps.log(`Le service (PID ${pid}) ne répond pas sur ${ctx.base}.\n${logTail(ctx.logFile)}`);
  return 1;
}

export async function stop(deps) {
  const ctx = context(deps);
  const entries = await classify(ctx, deps);
  if (entries.length === 0) {
    deps.log('Aucun service inscrit.');
    return 0;
  }
  let code = 0;
  for (const { entry, state } of entries) {
    if (state === 'gone') {
      ctx.registry.remove(entry.pid);
      deps.log(`PID ${entry.pid} déjà arrêté ; retiré du registre.`);
      continue;
    }
    if (state === 'reassigned') {
      ctx.registry.remove(entry.pid);
      deps.log(`PID ${entry.pid} réattribué à un autre programme ; non arrêté, retiré du registre.`);
      continue;
    }
    // Arrêt propre de SuperCollider d'abord (le service n'exécute pas son propre arrêt quand Windows le termine).
    try {
      await deps.fetch(`${ctx.base}/api/engine/stop`, { method: 'POST', signal: AbortSignal.timeout(STOP_TIMEOUT_MS) });
    } catch { /* moteur déjà arrêté ou service muet : l'arrêt du processus suit */ }
    try {
      deps.kill(entry.pid);
    } catch (e) {
      deps.log(`Arrêt du PID ${entry.pid} impossible : ${e.message}`);
      code = 1;
      continue;
    }
    ctx.registry.remove(entry.pid);
    deps.log(`Service arrêté (PID ${entry.pid}).`);
  }
  return code;
}

export async function status(deps) {
  const ctx = context(deps);
  const entries = await classify(ctx, deps);
  if (entries.length === 0) deps.log('Aucun service inscrit.');
  const labels = { running: 'actif', reassigned: 'PID réattribué à un autre programme', gone: 'arrêté' };
  for (const { entry, state } of entries) {
    deps.log(`PID ${entry.pid} : ${labels[state]} — ${entry.command}`);
  }
  const engine = await engineStatus(ctx, deps);
  deps.log(engine ? `API ${ctx.base} : moteur « ${engine} ».` : `API ${ctx.base} : injoignable.`);
  return 0;
}

export async function run(argv, deps = defaultDeps(process.env)) {
  const [command, ...args] = argv;
  if (command === 'start') return start(args, deps);
  if (command === 'stop' && args.length === 0) return stop(deps);
  if (command === 'status' && args.length === 0) return status(deps);
  deps.log(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
