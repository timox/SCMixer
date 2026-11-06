import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './api/server.js';
import { DEFAULT_SC_DIR, EngineProcess } from './runtime/engine-process.js';
import { documentsDir } from './runtime/documents-dir.js';
import { PresetStore } from './session/preset-store.js';
import { SessionStore } from './session/session-store.js';

export const DEFAULT_PORT = 3100;
const HOST = '127.0.0.1';

function parseArgs(argv) {
  const options = { scDir: DEFAULT_SC_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sc-dir') {
      options.scDir = argv[i + 1];
      i += 1;
      if (!options.scDir) throw new Error('--sc-dir attend un dossier.');
    } else {
      throw new Error(`Option inconnue : ${argv[i]}.`);
    }
  }
  return options;
}

export function defaultDataDir(env) {
  if (env.SCMIXER_ENGINE_DATA_DIR) return env.SCMIXER_ENGINE_DATA_DIR;
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'SCMixer');
}

/** Dossier des enregistrements WAV : SCMIXER_RECORDINGS_DIR, sinon Documents\SCMixer\Enregistrements. */
export function defaultRecordingsDir(env, resolveDocuments = documentsDir) {
  if (env.SCMIXER_RECORDINGS_DIR) return env.SCMIXER_RECORDINGS_DIR;
  return path.join(resolveDocuments(), 'SCMixer', 'Enregistrements');
}

/** Compose le service ; ne démarre pas SuperCollider (POST /api/engine/start). */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const { scDir } = parseArgs(argv);
  const port = Number(env.SCMIXER_ENGINE_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Port invalide : ${env.SCMIXER_ENGINE_PORT}.`);
  const dataDir = defaultDataDir(env);
  const recordingsDir = defaultRecordingsDir(env);
  const engine = new EngineProcess({ store: new SessionStore(dataDir), dataDir, scDir, recordingsDir });
  const api = createServer({ engine, presets: new PresetStore(dataDir) });
  const httpServer = await new Promise((resolve, reject) => {
    const server = api.app.listen(port, HOST, () => resolve(server));
    server.once('error', (e) => {
      reject(e.code === 'EADDRINUSE'
        ? new Error(`Le port ${HOST}:${port} est déjà utilisé ; le moteur ne réutilise jamais un service existant.`)
        : e);
    });
  });
  api.attachWebSocket(httpServer);
  console.log(`Moteur SCMixer à l'écoute sur http://${HOST}:${port} (données : ${dataDir} ; enregistrements : ${recordingsDir}).`);
  return { engine, httpServer };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(({ engine, httpServer }) => {
    httpServer.on('error', (e) => {
      console.error(`Erreur du serveur HTTP : ${e.message}`);
      process.exit(1);
    });
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      let code = 0;
      try {
        await engine.stop();
      } catch (e) {
        console.error(`Arrêt du moteur impossible : ${e.message}`);
        code = 1;
      }
      httpServer.close();
      httpServer.closeAllConnections?.();
      process.exit(code);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }, (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
