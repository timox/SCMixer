import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineProcess } from '../../src/runtime/engine-process.js';
import { ProcessRegistry } from '../../src/runtime/process-registry.js';
import { SessionStore } from '../../src/session/session-store.js';
import { PresetStore } from '../../src/session/preset-store.js';
import { createServer } from '../../src/api/server.js';

/** Horloge TimoxVasio simulée : aucun appel réseau. */
export const fakeInfo = { apiUrl: 'http://127.0.0.1:52525', apiVersion: '1.1', hostPid: 4242, launchedByEngine: false, physicalDriverId: 'drv', state: 'running' };
export const fakeTimoxVasio = (clock = { sampleRate: 48000, bufferFrames: 2048 }) => ({
  apiUrl: fakeInfo.apiUrl, prepare: async () => ({ audioClock: { ...clock }, info: { ...fakeInfo } }),
});

class FakeListener extends EventEmitter {
  async start() { return 45678; }
  stop() {}
}

class FakeLang extends EventEmitter {
  constructor(listener, opts) {
    super();
    this.listener = listener;
    this.opts = opts;
    this.calls = [];
    this.process = { pid: 7001, spawnfile: 'sclang.exe', spawnargs: ['sclang.exe', '-u', '57131'] };
  }
  async executeFile() {}
  async interpret(code) {
    this.calls.push(code);
    if (code.includes('~mxBootState')) return 1;
    if (code.includes('s.pid')) return [7002, 57130, 'C:\\SC\\scsynth.exe'];
    if (code.includes('~mxModels')) return [this.opts.companderD ?? true, this.opts.faustRMS ?? false];
    const m = /~mxAck\.\((\d+), "ok"/.exec(code);
    if (m) {
      setImmediate(() => this.listener.emit('message', {
        address: '/mx/ack',
        args: [Number(m[1]), 'ok', this.opts.reply?.(code) ?? (code.includes('g_queryTree') ? '[0,0,0]' : '')],
      }));
    }
    return undefined;
  }
  async quit() {}
  commands() { return this.calls.filter((c) => c.includes('~mxAck.(')); }
}

/** Serveur d'API sur port 0 avec faux sclang ; ne démarre jamais SuperCollider. */
export async function startHarness({ running = true, lang = {}, engineOptions = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-api-'));
  const store = new SessionStore(dataDir);
  const listener = new FakeListener();
  const langs = [];
  const engine = new EngineProcess({
    store,
    dataDir,
    registry: new ProcessRegistry({ dataDir, listProcesses: async () => [] }),
    listenerFactory: () => listener,
    langFactory: async () => { const l = new FakeLang(listener, lang); langs.push(l); return l; },
    resolveScsynth: async () => ({
      launcher: { processId: 7002, parentProcessId: 7001, commandLine: 'cmd.exe /c scsynth' },
      server: { processId: 7003, parentProcessId: 7002, commandLine: 'scsynth.exe -u 57130', serverPort: 57130 },
    }),
    isAlive: () => false,
    killProcess: () => {},
    watchIntervalMs: 0,
    timoxVasio: fakeTimoxVasio(),
    ...engineOptions,
  });
  const presets = new PresetStore(dataDir);
  if (running) await engine.start();
  const api = createServer({ engine, presets });
  const httpServer = await new Promise((resolve) => {
    const s = api.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const wss = api.attachWebSocket(httpServer);
  const port = httpServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return {
    engine, lang, store, presets, api, base, port, call, langs, wss,
    async close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => httpServer.close(r));
      if (engine.state().status === 'running') await engine.stop();
    },
  };
}
